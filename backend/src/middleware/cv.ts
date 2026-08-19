import { z } from "zod";
import { validate } from "./validate";

export const createCvSchema = z.object({
  fileUrl: z.string().url().max(2000).optional(),
  fileType: z.string().trim().max(50).optional(),
  isPrimary: z.boolean().optional(),
});

export const validateCreateCv = validate(createCvSchema, "body");
