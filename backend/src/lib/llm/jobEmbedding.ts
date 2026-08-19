import { createHash } from 'crypto';
import { eq, and, sql, SQL } from 'drizzle-orm';
import { EmbedContentRequest, GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env';
import { db } from '../../config/database';
import { embeddings, jobs } from '../../db/schema';
import type { JobListItem, JobLevel, JobType, JobStatus, JobLocation } from '../../interface/job';

const sha256 = (s: string): string =>
  createHash('sha256').update(s, 'utf8').digest('hex');

/** Raw Gemini SDK (không dùng LangChain wrapper — wrapper không pass outputDimensionality).
 *  Lý do: gemini-embedding-001 default 3072-dim, HNSW index max 2000-dim
 *         → phải truncate về 768-dim qua `outputDimensionality` param. */
const genai = env.GEMINI_API_KEY ? new GoogleGenerativeAI(env.GEMINI_API_KEY) : null;
const embeddingSdk = genai
  ? genai.getGenerativeModel({ model: env.GEMINI_EMBEDDING_MODEL })
  : null;

export const buildJobEmbeddingText = (job: {
  title: string;
  description: string;
  requirements?: string | null;
  requiredSkills: string[] | null;
  niceToHaveSkills: string[] | null;
  benefits?: string | null;
  industry?: string | null;
  location?: JobLocation | null;
}): string => {
  const parts = [
    `Tiêu đề: ${job.title}`,
    `Mô tả: ${job.description}`,
    job.requirements ? `Yêu cầu: ${job.requirements}` : null,
    job.requiredSkills?.length ? `Skills bắt buộc: ${job.requiredSkills.join(', ')}` : null,  // ← ADD
    job.niceToHaveSkills?.length ? `Skills ưu tiên: ${job.niceToHaveSkills.join(', ')}` : null,
    job.benefits ? `Quyền lợi: ${job.benefits}` : null,
    job.industry ? `Ngành: ${job.industry}` : null,
    job.location?.city ? `Địa điểm: ${job.location.city}` : null,
  ].filter(Boolean);
  return parts.join('\n');
};

/** Embed 1 text → 768-dim vector.
 *  Throw error nếu Gemini fail → caller (worker) retry qua BullMQ. */
export const embedText = async (text: string): Promise<number[]> => {
  if (!embeddingSdk) {
    throw new Error('GEMINI_API_KEY chưa được cấu hình');
  }
  const result = await embeddingSdk.embedContent({
    content: { role: 'user', parts: [{ text }] },
    taskType: 'RETRIEVAL_QUERY',
    outputDimensionality: 768,
  } as EmbedContentRequest);
  return result.embedding.values;
};

/** Embed batch texts → 768-dim vectors. */
// export const embedTexts = async (texts: string[]): Promise<number[][]> => {
//   if (!embeddingSdk) throw new Error('GEMINI_API_KEY chưa được cấu hình');
//   const result = await embeddingSdk.batchEmbedContents({
//     requests: texts.map((text) => ({
//       content: { role: 'user', parts: [{ text }] },
//       taskType: 'RETRIEVAL_DOCUMENT',
//       outputDimensionality: 768,
//     })),
//   } as any);
//   return result.embeddings.map((e) => e.values);
// };

export interface JobEmbeddingRow {
  vector: number[];
  textHash: string;
  model: string;
}

export const getJobEmbedding = async (jobId: string): Promise<JobEmbeddingRow | null> => {
  const [row] = await db
    .select({
      vector: embeddings.vector,
      textHash: embeddings.textHash,
      model: embeddings.model,
    })
    .from(embeddings)
    .where(
      and(
        eq(embeddings.contentType, 'job'),
        eq(embeddings.contentId, jobId),
        eq(embeddings.model, env.GEMINI_EMBEDDING_MODEL),
      ),
    )
    .limit(1);
  return row ?? null;
};

export interface UpsertResult {
  inserted: boolean;   // true nếu tạo/cập nhật embedding
  skipped: boolean;     // true nếu textHash không đổi → skip (không tốn token)
}

export const upsertJobEmbedding = async (
  jobId: string,
  text: string,
): Promise<UpsertResult> => {
  const hash = sha256(text);

  const existing = await getJobEmbedding(jobId);
  if (existing && existing.textHash === hash) {
    return { inserted: false, skipped: true };
  }

  const vector = await embedText(text);

  await db
    .insert(embeddings)
    .values({
      contentType: 'job',
      contentId: jobId,
      vector,
      model: env.GEMINI_EMBEDDING_MODEL,
      textHash: hash,
    })
    .onConflictDoUpdate({
      target: [embeddings.contentType, embeddings.contentId, embeddings.model],
      set: { vector, textHash: hash },
    });

  return { inserted: true, skipped: false };
};

export interface SemanticSearchOpts {
  limit?: number;
  threshold?: number;     // 0..1 — filter bỏ result similarity thấp
  locationCity?: string;
  jobLevel?: JobLevel;
  jobType?: JobType;
}

export interface SemanticSearchResult extends JobListItem {
  similarity: number;   // 1 = identical, 0 = unrelated
}

/** Semantic search bằng cosine similarity (pgvector `<=>`).
 *
 *  Flow:
 *  1. Embed query → queryVec (768-dim)
 *  2. JOIN embeddings với jobs, filter status='live' + optional filters
 *  3. ORDER BY cosine distance ASC → similarity DESC
 *  4. Return top K jobs
 *
 *  Cosine distance range: 0 (identical) → 2 (opposite) cho normalized vectors.
 *  similarity = 1 - distance → range [0, 1].
 *  Threshold 0.5 nghĩa là "ít nhất 50% similar" — reasonable cho semantic search.
 */
export const searchSimilarJobs = async (
  query: string,
  opts: SemanticSearchOpts = {},
): Promise<SemanticSearchResult[]> => {
  const {
    limit = 20,
    threshold = 0.55,
    locationCity,
    jobLevel,
    jobType,
  } = opts;

  const queryVec = await embedText(query);
  const vecLiteral = `[${queryVec.join(',')}]`;

  const filters: SQL[] = [
    sql`e.content_type = 'job'`,
    sql`e.model = ${env.GEMINI_EMBEDDING_MODEL}`,
    sql`j.status = 'live'`,
  ];
  if (locationCity) filters.push(sql`j.location->>'city' = ${locationCity}`);
  if (jobLevel) filters.push(sql`j.job_level = ${jobLevel}`);
  if (jobType) filters.push(sql`j.job_type = ${jobType}`);

  const result = await db.execute<{
    id: string;
    title: string;
    slug: string | null;
    company_id: string;
    job_level: string | null;
    job_type: string | null;
    industry: string | null;
    salary_min: string | null;
    salary_max: string | null;
    salary_currency: string | null;
    salary_visible: boolean | null;
    location: JobLocation | null;
    remote_ok: boolean | null;
    deadline: Date | null;
    status: string;
    views_count: number;
    applies_count: number;
    published_at: Date | null;
    similarity: number;
  }>(sql`
    WITH scored AS (
      SELECT
        j.id, j.title, j.slug, j.company_id, j.job_level, j.job_type,
        j.industry, j.salary_min, j.salary_max, j.salary_currency,
        j.salary_visible, j.location, j.remote_ok, j.deadline,
        j.status, j.views_count, j.applies_count, j.published_at,
        e.vector <=> ${vecLiteral}::vector AS distance,
        1 - (e.vector <=> ${vecLiteral}::vector) AS similarity
      FROM embeddings e
      INNER JOIN jobs j ON j.id = e.content_id
      WHERE ${sql.join(filters, sql` AND `)}
    )
    SELECT * FROM scored
    WHERE similarity >= ${threshold}
    ORDER BY distance ASC
    LIMIT ${limit}
  `);

  return result.rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    companyId: r.company_id,
    jobLevel: r.job_level as JobLevel | null,
    jobType: r.job_type as JobType | null,
    industry: r.industry,
    salaryMin: r.salary_min,
    salaryMax: r.salary_max,
    salaryCurrency: r.salary_currency,
    salaryVisible: r.salary_visible,
    location: r.location,
    remoteOk: r.remote_ok,
    deadline: r.deadline,
    status: r.status as JobStatus,
    viewsCount: r.views_count,
    appliesCount: r.applies_count,
    publishedAt: r.published_at,
    similarity: Number(r.similarity),
  }));
};