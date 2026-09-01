import { z } from "zod";


export const createPaymentSchema = z.object({
  planId: z.string().uuid({ message: "planId phải là UUID" }),
});


export const    paymentListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  userId: z.string().uuid().optional(),
  status: z
    .enum(["pending", "paid", "failed", "cancelled", "refunded", "expired"])
    .optional(),
});

export const paymentIdParamsSchema = z.object({
  id: z.string().uuid({ message: "Invalid payment id" }),
});

export const orderCodeParamsSchema = z.object({
  orderCode: z.string().min(1, "orderCode không được rỗng"),
});

export type CreatePaymentBody = z.infer<typeof createPaymentSchema>;
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;
export type OrderCodeParams = z.infer<typeof orderCodeParamsSchema>;
