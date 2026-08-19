import { db } from "../config/database";
import { cvs } from "../db/schema";
import { desc, eq, and, ne, sql } from "drizzle-orm";
import type { CreateCvInput, CreateDirectCvInput, Cv, CvDetail, CvStatus, CvSource, ListCvResponse, AiScore } from "../interface/cv";
import { notificationGateway } from "../socket/notificationGateway";
import { githubLookupService } from "./githubLookup.service";
import { logger } from "../config/logger";


/**
 * Tạo parsedData từ input form direct CV.
 * Helper tách ra để tránh duplicate code giữa 2 path (có/không isPrimary).
 */
const buildParsedData = (input: CreateDirectCvInput): NonNullable<typeof cvs.$inferSelect.parsedData> => {
  const parsedData: NonNullable<typeof cvs.$inferSelect.parsedData> = {};
  if (input.contact) {
    if (input.contact.name !== undefined) parsedData.name = input.contact.name;
    if (input.contact.email !== undefined) parsedData.email = input.contact.email;
    if (input.contact.phone !== undefined) parsedData.phone = input.contact.phone;
    if (input.contact.portfolio !== undefined) parsedData.portfolio = input.contact.portfolio;
    if (input.contact.github !== undefined) parsedData.github = input.contact.github;
    if (input.contact.linkedin !== undefined) parsedData.linkedin = input.contact.linkedin;
    if (input.contact.facebook !== undefined) parsedData.facebook = input.contact.facebook;
    if (input.contact.avatarUrl !== undefined) parsedData.avatarUrl = input.contact.avatarUrl;
  }
  if (input.summary !== undefined) parsedData.summary = input.summary;
  if (input.education) parsedData.education = input.education as unknown as Record<string, unknown>[];
  if (input.experience) parsedData.experience = input.experience as unknown as Record<string, unknown>[];
  if (input.skills) parsedData.skills = input.skills;
  if (input.languages) parsedData.languages = input.languages as unknown as Record<string, unknown>[];
  if (input.projects) parsedData.projects = input.projects as unknown as Record<string, unknown>[];
  if (input.certifications) parsedData.certifications = input.certifications as unknown as Record<string, unknown>[];
  return parsedData;
};

const LINKEDIN_URL_RE = /^https?:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?$/;
const GITHUB_URL_RE = /^https?:\/\/(www\.)?github\.com\/[A-Za-z0-9_-]+\/?$/;

export const cvService = {
  /**
   * Upload CV: client đã upload file lên MinIO, gửi URL + mime về đây.
   * - source='upload', templateId=null.
   * - status='pending' (default) — worker sẽ chuyển sang 'parsing' → 'ready' / 'failed'.
   */
  upload: async (input: CreateCvInput, candidateId: string): Promise<Cv> => {
    const [cv] = await db
      .insert(cvs)
      .values({
        candidateId,
        title: input.title,
        fileUrl: input.fileUrl,
        fileType: input.fileType,
        isPrimary: input.isPrimary ?? false,
        source: "upload",
      })
      .returning();

    return cv;
  },

  /**
   * List CVs của candidate (ẩn status='deleted'), sort primary trước.
   * Có phân trang: trả về `items` (trang hiện tại) + `total` (tổng khớp filter).
   *
   * @param source — optional filter: 'upload' | 'direct'. Bỏ trống → trả cả 2 loại.
   * @param limit — số row tối đa trên 1 trang (default 10, 1..100).
   * @param offset — bỏ qua N row đầu (default 0, >=0).
   */
  list: async (
    candidateId: string,
    source?: CvSource,
    limit: number = 10,
    offset: number = 0,
  ): Promise<ListCvResponse> => {
    const whereClauses = [
      eq(cvs.candidateId, candidateId),
      ne(cvs.status, "deleted"),
    ];
    if (source) {
      whereClauses.push(eq(cvs.source, source));
    }
    const whereExpr = and(...whereClauses);

    // Items của trang hiện tại.
    // `aiScoreTotal` chỉ lấy con số `total` từ jsonb (response gọn) —
    // full object xem � GET /cvs/:cvId.
    const rows = await db
      .select({
        id: cvs.id,
        candidateId: cvs.candidateId,
        title: cvs.title,
        fileUrl: cvs.fileUrl,
        fileType: cvs.fileType,
        isPrimary: cvs.isPrimary,
        templateId: cvs.templateId,
        status: cvs.status,
        source: cvs.source,
        aiScoreTotal: sql<number | null>`(${cvs.aiScore}->>'total')::int`,
      })
      .from(cvs)
      .where(whereExpr)
      .orderBy(desc(cvs.isPrimary), desc(cvs.createdAt))
      .limit(limit)
      .offset(offset);

    // Tổng số CV khớp filter (không phụ thuộc limit/offset).
    const [{ count }] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(cvs)
      .where(whereExpr);

    return { items: rows, total: count };
  },

  /**
   * GET /cvs/:cvId — trả về toàn bộ row (1 endpoint duy nhất).
   * Bao gồm: summary fields + parsedData + aiScore + scoreUpdatedAt.
   *
   * Vài field nullable tùy `source`:
   * - fileUrl/fileType: NULL với direct CV; có với upload CV.
   * - templateId: NULL với upload CV; có (1-5) với direct CV.
   * - parsedData: NULL khi upload CV đang pending/parsing/failed; có khi 'ready'.
   * - aiScore/scoreUpdatedAt: NULL khi upload CV chưa score, hoặc luôn NULL với direct.
   *
   * Trả null nếu không tồn tại / không thuộc candidate / đã soft-delete.
   */
  getDetail: async (
    candidateId: string,
    cvId: string,
  ): Promise<CvDetail | null> => {
    const [row] = await db
      .select()
      .from(cvs)
      .where(
        and(
          eq(cvs.id, cvId),
          eq(cvs.candidateId, candidateId),
          ne(cvs.status, "deleted"),
        ),
      )
      .limit(1);

    return row ?? null;
  },

  /**
   * Set primary: trong transaction:
   * 1. Verify CV thuộc về candidate + chưa deleted.
   * 2. Reset tất cả CV của candidate về isPrimary=false.
   * 3. Set CV này về isPrimary=true.
   */
  setPrimary: async (candidateId: string, cvId: string): Promise<Cv | null> => {
    return db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: cvs.id })
        .from(cvs)
        .where(
          and(
            eq(cvs.id, cvId),
            eq(cvs.candidateId, candidateId),
            ne(cvs.status, "deleted"),
          ),
        )
        .limit(1);
      if (!target) return null;
      await tx
        .update(cvs)
        .set({ isPrimary: false })
        .where(and(eq(cvs.candidateId, candidateId), eq(cvs.isPrimary, true)));
      const [updated] = await tx
        .update(cvs)
        .set({ isPrimary: true })
        .where(eq(cvs.id, cvId))
        .returning();

      return updated ?? null;
    });
  },

  /**
   * Tạo CV direct: lưu toàn bộ form data vào parsedData jsonb.
   * - source='direct', templateId bắt buộc (1-5, validate ở Zod + DB CHECK).
   * - status='ready' ngay (không qua worker).
   * - Nếu isPrimary=true: transaction reset isPrimary của các CV khác trước
   *   (giữ invariant "chỉ 1 CV primary").
   */
  create: async (
    candidateId: string,
    input: CreateDirectCvInput,
  ): Promise<Cv> => {
    const parsedData = buildParsedData(input);
    const baseValues = {
      candidateId,
      title: input.title,
      templateId: input.templateId,
      parsedData,
      source: "direct" as const,
      status: "ready" as const,
    };

    if (input.isPrimary === true) {
      return db.transaction(async (tx) => {
        await tx
          .update(cvs)
          .set({ isPrimary: false })
          .where(
            and(eq(cvs.candidateId, candidateId), eq(cvs.isPrimary, true)),
          );
        const [cv] = await tx
          .insert(cvs)
          .values({ ...baseValues, isPrimary: true })
          .returning();
        return cv;
      });
    }

    const [cv] = await db
      .insert(cvs)
      .values({ ...baseValues, isPrimary: false })
      .returning();
    return cv;
  },
  softDelete: async (cvId: string, candidateId: string): Promise<Cv | null> => {
    return db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: cvs.id, isPrimary: cvs.isPrimary })
        .from(cvs)
        .where(
          and(
            eq(cvs.id, cvId),
            eq(cvs.candidateId, candidateId),
            ne(cvs.status, "deleted"),
          ),
        )
        .limit(1);
      if (!target) return null;

      const [deleted] = await tx
        .update(cvs)
        .set({ status: "deleted", updatedAt: new Date() })
        .where(eq(cvs.id, cvId))
        .returning();

      if (target.isPrimary) {
        const [nextPrimary] = await tx
          .select({ id: cvs.id })
          .from(cvs)
          .where(
            and(
              eq(cvs.candidateId, candidateId),
              ne(cvs.status, "deleted"),
              ne(cvs.id, cvId),
            ),
          )
          .orderBy(desc(cvs.createdAt))
          .limit(1);
        if (nextPrimary) {
          await tx
            .update(cvs)
            .set({ isPrimary: true })
            .where(eq(cvs.id, nextPrimary.id));
        }
      }
      return deleted ?? null;
    });
  },
  chageStatus: async (
    candidateId: string,
    cvId: string,
    newStatus: Exclude<CvStatus, "pending" | "deleted">,
  ): Promise<boolean> => {
    const [updated] = await db
      .update(cvs)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(
        and(
          eq(cvs.id, cvId),
          eq(cvs.candidateId, candidateId),
          ne(cvs.status, "deleted"),
        ),
      )
      .returning({ id: cvs.id });
    if (!updated) return false;

    notificationGateway.emitToUser(candidateId, "cv:status-changed", {
      cvId,
      status: newStatus,
    });
    return true;
  },
  saveParseData: async (
    cvId: string,
    title: string,
    data: NonNullable<typeof cvs.$inferSelect.parsedData>
  ): Promise<Cv | null> => {
    const [row] = await db
      .update(cvs)
      .set({
        title,
        parsedData: data,
      })
      .where(
        and(
          eq(cvs.id, cvId),
          ne(cvs.status, 'deleted')
        )
      )
      .returning();
    
    if (!row) return null;
    return row;
  },
  saveAiScore: async(
    cvId: string,
    score: AiScore
  ): Promise<Cv | null> => {
    const [row] = await db
      .update(cvs)
      .set({
        aiScore: score,
        scoreUpdatedAt: new Date(),
        updatedAt: new Date()
      })
      .where(
        and(
          eq(cvs.id, cvId),
          ne(cvs.status, 'deleted')
        )
      )
      .returning();
    return row ?? null;
  },

  validateGithubUrl: async (url: string): Promise<void> => {
    if (!GITHUB_URL_RE.test(url)) {
      throw new Error(`Invalid GitHub URL format: ${url}`);
    }
    try {
      const exist = await githubLookupService.lookup(url);
      if (!exist) {
        throw new Error(`GitHub user không tồn tại: ${url}`);
      }
    } catch (err) {
      console.error("")
    }
  },

  validateLinkedinUrl: (url: string): void => {
    if (!LINKEDIN_URL_RE.test(url)) {
      throw new Error(`Invalid LinkedIn URL format: ${url}`);
    }
  },

  validateContactUrls: async (
    contact: { github?: string; linkedin?: string } | null | undefined,
  ): Promise<void> => {
    if (!contact) return;
    if (contact.github) await cvService.validateGithubUrl(contact.github);
    if (contact.linkedin) cvService.validateLinkedinUrl(contact.linkedin);
  },

};
