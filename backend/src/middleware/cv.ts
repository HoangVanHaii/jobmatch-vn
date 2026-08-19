import { z } from "zod";
import { validate } from "./validate";

/* ============================================================================
 * POST /cvs/upload — client đã upload file lên MinIO/S3, gửi URL + mime về đây.
 * CV upload: source='upload' (default), templateId=null. Title optional.
 * ==========================================================================*/
export const createCvSchema = z.object({
  title: z.string().trim().max(200).optional(),
  fileUrl: z.string().url().max(2000).optional(),
  fileType: z.string().trim().max(50).optional(),
  isPrimary: z.boolean().optional(),
});

export const cvIdParamSchema = z.object({
  cvId: z.string().uuid(),
});

/* ============================================================================
 * Reusable schemas cho direct CV content.
 * Bound: max 50 items/array, string max độ dài — chống spam quá tải DB.
 * ==========================================================================*/

const directCvContactSchema = z.object({
  name: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  portfolio: z.string().url().max(2000).optional(),
  github: z.string().url().max(2000).optional(),
  linkedin: z.string().url().max(2000).optional(),
  facebook: z.string().url().max(2000).optional(),
  avatarUrl: z.string().url().max(2000).optional(),
});

const directCvEducationSchema = z.object({
  school: z.string().trim().min(1).max(200),
  degree: z.string().trim().max(200).optional(),
  major: z.string().trim().max(200).optional(),
  startYear: z.number().int().min(1900).max(2100).optional(),
  endYear: z.number().int().min(1900).max(2100).optional(),
  description: z.string().max(2000).optional(),
});

const directCvExperienceSchema = z.object({
  company: z.string().trim().min(1).max(200),
  position: z.string().trim().min(1).max(200),
  startDate: z.string().trim().max(20).optional(),
  endDate: z.string().trim().max(20).nullable().optional(),
  description: z.string().max(2000).optional(),
});

const directCvLanguageSchema = z.object({
  language: z.string().trim().min(1).max(100),
  proficiency: z.string().trim().max(50).optional(),
});

const directCvProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  link: z.string().url().max(2000).optional(),
});

const directCvCertificationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  issuer: z.string().trim().max(200).optional(),
  date: z.string().trim().max(20).optional(),
});

/**
 * Phần content dùng chung cho create + update (mọi field optional).
 */
const directCvContentSchema = z.object({
  summary: z.string().max(5000).optional(),
  contact: directCvContactSchema.optional(),
  education: z.array(directCvEducationSchema).max(20).optional(),
  experience: z.array(directCvExperienceSchema).max(20).optional(),
  skills: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  languages: z.array(directCvLanguageSchema).max(10).optional(),
  projects: z.array(directCvProjectSchema).max(20).optional(),
  certifications: z.array(directCvCertificationSchema).max(20).optional(),
});

/* ============================================================================
 * POST /cvs/direct — user nhập CV thủ công trên web.
 * templateId BẮT BUỘC 1-5 (đồng bộ FE — 5 template render).
 * CHECK constraint ở DB enforce cùng range (xem migration 0012 + 0013).
 * ==========================================================================*/
export const createDirectCvSchema = z.object({
  title: z.string().trim().min(1).max(200),
  templateId: z.number().int().min(1).max(5),
  isPrimary: z.boolean().optional(),
}).merge(directCvContentSchema);

export const validateCreateCv = validate(createCvSchema, "body");
export const validateCvIdParam = validate(cvIdParamSchema, "params");
export const validateCreateDirectCv = validate(createDirectCvSchema, "body");

/* ============================================================================
 * GET /cvs?source=upload|direct — filter theo source + pagination.
 * Query param optional: bỏ trống → trả cả 2 loại.
 * - limit: 1..100, default 10.
 * - offset: >=0, default 0.
 * ==========================================================================*/
export const listCvQuerySchema = z.object({
  source: z.enum(["upload", "direct"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
});
export const validateListCvQuery = validate(listCvQuerySchema, "query");
