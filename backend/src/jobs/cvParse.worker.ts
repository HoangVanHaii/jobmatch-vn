/**
 * BullMQ worker — CV parse pipeline
 * 1. Extract text từ PDF/DOCX
 * 2. Gọi LLM parse thành JSON
 * 3. Validate + save vào cvs.parsed_data
 * 4. Trigger scoring worker
 */
import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { db } from '../config/database';
import { cvs } from '../db/schema';
import { eq } from 'drizzle-orm';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { parsingProvider } from '../config/ai';
import { CV_PARSE_SYSTEM_PROMPT, CV_PARSE_USER_PROMPT } from '../ai/prompts/cv_parse.v1';

const extractText = async (buffer: Buffer, mimetype: string): Promise<string> => {
  if (mimetype === 'application/pdf') {
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (mimetype.includes('wordprocessingml') || mimetype === 'application/msword') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  throw new Error(`Unsupported mimetype: ${mimetype}`);
};

export const cvParseWorker = new Worker(
  'ai',
  async (job) => {
    if (job.name !== 'cv-parse') return;
    const { cvId, file } = job.data as { cvId: string; file: { buffer: string; mimetype: string } };
    logger.info({ cvId, jobId: job.id }, 'Parsing CV...');

    const buffer = Buffer.from(file.buffer, 'base64');
    const text = await extractText(buffer, file.mimetype);

    const result = await parsingProvider.chat(
      [{ role: 'system', content: CV_PARSE_SYSTEM_PROMPT }, { role: 'user', content: CV_PARSE_USER_PROMPT(text) }],
      { temperature: 0.2 },
    );

    const parsed = JSON.parse(result.content);
    await db.update(cvs).set({ parsedData: parsed, updatedAt: new Date() }).where(eq(cvs.id, cvId));

    logger.info({ cvId }, 'CV parsed successfully');
    return parsed;
  },
  { connection: redis, concurrency: 3 },
);

cvParseWorker.on('failed', (job, err) => logger.error({ jobId: job.id, err }, 'CV parse failed'));