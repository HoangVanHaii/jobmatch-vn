
import { z } from 'zod';

export const planIdParamsSchema = z.object({
  id: z.string().uuid({ message: 'Invalid plan id (must be UUID)' }),
});

export const planFeaturesSchema = z
  .record(z.string(), z.unknown())
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'features must be a non-empty object',
  });

export const planCreateSchema = z.object({
  code: z
    .string()
    .min(2, 'code phải có ít nhất 2 ký tự')
    .max(50, 'code tối đa 50 ký tự')
    .regex(/^[a-z0-9_]+$/, 'code chỉ chứa chữ thường, số và _'),
  name: z.string().min(1, 'name là bắt buộc').max(200),
  priceVnd: z.coerce.number().int('priceVnd phải là số nguyên').nonnegative('priceVnd phải >= 0'),
  durationDays: z.coerce.number().int('durationDays phải là số nguyên').positive('durationDays phải > 0'),
  features: planFeaturesSchema,
  isActive: z.boolean().optional().default(true),
});

export const planUpdateSchema = z
  .object({
    code: z
      .string()
      .min(2)
      .max(50)
      .regex(/^[a-z0-9_]+$/)
      .optional(),
    name: z.string().min(1).max(200).optional(),
    priceVnd: z.coerce.number().int().nonnegative().optional(),
    durationDays: z.coerce.number().int().positive().optional(),
    features: planFeaturesSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Body phải có ít nhất 1 field để update',
  });

export const planListQuerySchema = z.object({
  includeInactive: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type PlanCreateBody = z.infer<typeof planCreateSchema>;
export type PlanUpdateBody = z.infer<typeof planUpdateSchema>;
export type PlanListQuery = z.infer<typeof planListQuerySchema>;
