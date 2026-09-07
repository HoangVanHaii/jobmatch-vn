
import { z } from 'zod';

export const createApplicationBodySchema = z.object({
  jobId: z.string().uuid('jobId must be a valid UUID'),
  cvId: z.string().uuid('cvId must be a valid UUID').optional(),
  coverLetter: z.string().trim().max(5000).optional(),
});

export type CreateApplicationBody = z.infer<typeof createApplicationBodySchema>;
export const jobIdParamSchema = z.object({
  jobId: z.string().uuid('jobId must be a valid UUID'),
});

export type JobIdParam = z.infer<typeof jobIdParamSchema>;

export const applicationIdParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

export type ApplicationIdParam = z.infer<typeof applicationIdParamSchema>;


const APPLICATION_STATUSES = [
  'pending',
  'viewed',
  'screening',
  'interview',
  'offered',
  'hired',
  'rejected',
  'withdrawn',
] as const;

/**
 * Query chung cho list endpoints (`GET /me`, `/job/:jobId`, `/company`).
 *
 * - `status` optional — filter theo status.
 * - `jobId` optional — chỉ dùng cho `/company` để filter theo job cụ thể.
 * - `page` coerce string → number, default 1.
 * - `limit` coerce string → number, default 20, max 50 (chống DOS).
 */
export const listApplicationQuerySchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  jobId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListApplicationQuery = z.infer<typeof listApplicationQuerySchema>;

/**
 * Body `PATCH /applications/:id/status` — employer đổi status/stage.
 * Dùng .partial() cho stage (optional update).
 */
export const updateStatusBodySchema = z.object({
  status: z.enum(APPLICATION_STATUSES),
  stage: z.string().trim().max(100).optional(),
});

export type UpdateStatusBody = z.infer<typeof updateStatusBodySchema>;
