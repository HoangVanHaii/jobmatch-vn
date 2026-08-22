import { z } from 'zod';

const jobLevelEnum = z.enum(['intern', 'fresher', 'junior', 'mid', 'senior', 'lead', 'manager']);
const jobTypeEnum  = z.enum(['full-time', 'part-time', 'contract', 'internship', 'freelance']);
const jobStatusEnum = z.enum(['draft', 'pending', 'live', 'expired', 'closed']);
const skillsSchema = z.array(z.string().min(1).max(100)).max(50);

const locationSchema = z.object({
    city: z.string().optional(),
    district: z.string().optional(),
    address: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
  }).optional();

export const jobIdParamsSchema = z.object({
  id: z.string().uuid(),
});


export const jobListQuerySchema = z.object({
  search: z.string().min(1).optional(),
  jobLevel: jobLevelEnum.optional(),
  jobType: jobTypeEnum.optional(),

  locationCity: z.string().min(1).max(100).optional(),
  salaryMin: z.coerce.number().int().nonnegative().optional(),
  remoteOk: z.coerce.boolean().optional(),
  industry: z.string().min(1).max(100).optional(),

  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const jobSearchQuerySchema = z.object({
  keyword: z.string().min(2).max(200),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// Query GET /jobs/search/semantic — embedding-based search (cosine similarity)
export const jobSemanticSearchQuerySchema = z.object({
  query: z.string().min(3).max(500),
  threshold: z.coerce.number().min(0).max(1).default(0.55), // 0..1, default 50% similar
  locationCity: z.string().min(1).max(100).optional(),
  jobLevel: jobLevelEnum.optional(),
  jobType: jobTypeEnum.optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const jobCreateSchema = z
  .object({
    companyId: z.string().uuid(),
    title: z.string().min(3).max(200),
    description: z.string().min(10),
    requirements: z.string().optional(),
    benefits: z.string().optional(),
    jobLevel: jobLevelEnum.optional(),
    jobType: jobTypeEnum.optional(),
    industry: z.string().optional(),
    salaryMin: z.coerce.number().int().nonnegative().optional(),
    salaryMax: z.coerce.number().int().nonnegative().optional(),
    salaryCurrency: z.string().length(3).default('VND'),
    salaryVisible: z.boolean().default(true),
    location: locationSchema,
    remoteOk: z.boolean().default(false),
    experienceYearsMin: z.coerce.number().int().nonnegative().optional(),
    experienceYearsMax: z.coerce.number().int().nonnegative().optional(),
    requiredSkills: skillsSchema.optional().default([]),
    niceToHaveSkills: skillsSchema.optional().default([]),
    deadline: z.string().datetime().optional(),
    status: jobStatusEnum.default('draft'),
    extraData: z.record(z.unknown()).default({}),
  })
  .refine(
    (d) => d.salaryMin === undefined || d.salaryMax === undefined || d.salaryMax >= d.salaryMin,
    { message: 'salaryMax phải >= salaryMin', path: ['salaryMax'] },
  );

// Body PATCH /jobs/:id — không cho đổi companyId
export const jobUpdateSchema = z
  .object({
    title: z.string().min(3).max(200).optional(),
    description: z.string().min(10).optional(),
    requirements: z.string().optional(),
    benefits: z.string().optional(),
    jobLevel: jobLevelEnum.optional(),
    jobType: jobTypeEnum.optional(),
    industry: z.string().optional(),
    salaryMin: z.coerce.number().int().nonnegative().optional(),
    salaryMax: z.coerce.number().int().nonnegative().optional(),
    salaryCurrency: z.string().length(3).optional(),
    salaryVisible: z.boolean().optional(),
    location: locationSchema,
    remoteOk: z.boolean().optional(),
    experienceYearsMin: z.coerce.number().int().nonnegative().optional(),
    experienceYearsMax: z.coerce.number().int().nonnegative().optional(),
    requiredSkills: skillsSchema.optional().default([]),
    niceToHaveSkills: skillsSchema.optional().default([]),
    deadline: z.string().datetime().optional(),
    status: jobStatusEnum.optional(),
    extraData: z.record(z.unknown()).optional(),
  })
  .refine(
    (d) =>
      d.salaryMin === undefined ||
      d.salaryMax === undefined ||
      d.salaryMax >= d.salaryMin,
    { message: 'salaryMax phải >= salaryMin', path: ['salaryMax'] },
  );

export type JobListQuery = z.infer<typeof jobListQuerySchema>;
export type JobCreateBody = z.infer<typeof jobCreateSchema>;
export type JobUpdateBody = z.infer<typeof jobUpdateSchema>;
export type JobSemanticSearchQuery = z.infer<typeof jobSemanticSearchQuerySchema>;

// Body POST /jobs/generate — keyword input cho AI generate JD draft
export const jobGenerateSchema = z.object({
  keyword: z.string().min(5).max(500),
  companyName: z.string().max(200).optional(),
});

export type JobGenerateBody = z.infer<typeof jobGenerateSchema>;
