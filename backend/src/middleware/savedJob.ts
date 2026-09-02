import { z } from 'zod';

const jobLevelEnum = z.enum(['intern', 'fresher', 'junior', 'mid', 'senior', 'lead', 'manager']);
const jobTypeEnum = z.enum(['full-time', 'part-time', 'contract', 'internship', 'freelance']);

/** Query GET /saved-jobs — filter + pagination (limit/offset qua page/limit) */
export const savedJobListQuerySchema = z.object({
  jobLevel: jobLevelEnum.optional(),
  jobType: jobTypeEnum.optional(),
  remoteOk: z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' ? false : v),
    z.boolean().optional(),
  ),
  industry: z.string().min(1).max(100).optional(),
  /** Free-text search trên title / companyName / requiredSkills của job đã lưu. */
  search: z.string().min(1).max(200).optional(),

  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type SavedJobListQuery = z.infer<typeof savedJobListQuerySchema>;

/** Body POST /saved-jobs */
export const saveJobSchema = z.object({
  jobId: z.string().uuid(),
});

export type SaveJobBody = z.infer<typeof saveJobSchema>;

/** Params DELETE /saved-jobs/:jobId */
export const unsaveJobParamsSchema = z.object({
  jobId: z.string().uuid(),
});

export type UnsaveJobParams = z.infer<typeof unsaveJobParamsSchema>;