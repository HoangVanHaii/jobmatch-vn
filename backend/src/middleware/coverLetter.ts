/**
 * Zod schema cho POST /candidates/me/cover-letter.
 *
 * Body:
 *   - jobId: required UUID — job đang ứng tuyển.
 *   - cvId: optional UUID — nếu có sẽ fetch CV parsedData để cá nhân hoá.
 *           Nếu null, sinh cover letter tổng quát dựa trên job info.
 *   - language: optional 'vi' | 'en' — ngôn ngữ output. Default 'vi' ở service
 *               layer. Frontend truyền qua để cover letter match audience của
 *               nhà tuyển dụng (foreign company → 'en').
 *
 * KHÔNG rate-limit ở middleware — quota check tại service nếu cần.
 */
import { z } from 'zod';

export const generateCoverLetterBodySchema = z.object({
  jobId: z.string().uuid('jobId must be a valid UUID'),
  cvId: z.string().uuid('cvId must be a valid UUID').optional(),
  language: z.enum(['vi', 'en']).optional(),
});

export type GenerateCoverLetterBody = z.infer<typeof generateCoverLetterBodySchema>;
