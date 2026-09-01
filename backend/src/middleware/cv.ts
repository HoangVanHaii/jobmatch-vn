import { z } from "zod";
import { validate } from "./validate";

export const createCvSchema = z.object({
  title: z.string().trim().max(200).optional(),
  fileUrl: z.string().url().max(2000).optional(),
  fileType: z.string().trim().max(100).optional(),
  isPrimary: z.boolean().optional(),
});

export const cvIdParamSchema = z.object({
  cvId: z.string().uuid(),
});


const directCvContactSchema = z.object({
  name: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  // URL fields cho phép null: theo RFC 7396 (JSON Merge Patch), null = "xoá field".
  // Cần thiết cho PATCH update direct CV khi user muốn clear 1 link.
  portfolio: z.string().url().max(2000).nullable().optional(),
  github: z.string().url().max(2000).nullable().optional(),
  linkedin: z.string().url().max(2000).nullable().optional(),
  facebook: z.string().url().max(2000).nullable().optional(),
  avatarUrl: z.string().url().max(2000).nullable().optional(),
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
  link: z.string().url().max(2000).nullable().optional(),
});

const directCvCertificationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  issuer: z.string().trim().max(200).optional(),
  date: z.string().trim().max(20).optional(),
});


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


export const createDirectCvSchema = z.object({
  title: z.string().trim().min(1).max(200),
  templateId: z.number().int().min(1).max(5),
  isPrimary: z.boolean().optional(),
}).merge(directCvContentSchema);

export const validateCreateCv = validate(createCvSchema, "body");
export const validateCvIdParam = validate(cvIdParamSchema, "params");
export const validateCreateDirectCv = validate(createDirectCvSchema, "body");

export const updateDirectCvSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  parsedData: directCvContentSchema.optional(),
});

export const validateUpdateDirectCv = validate(updateDirectCvSchema, "body");


export const listCvQuerySchema = z.object({
  source: z.enum(["upload", "direct"]).optional(),
  // Tìm theo tiêu đề CV (case-insensitive). FE debounce 400ms trước khi gọi
  // API → không spam DB. Trim + min(1) để empty string bị loại bỏ ở middleware,
  // không phải xử lý lại ở controller/service.
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
});
export const validateListCvQuery = validate(listCvQuerySchema, "query");
