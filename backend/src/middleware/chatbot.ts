/**
 * Zod schemas cho chatbot router.
 * Dùng chung cho validate middleware.
 */
import { z } from 'zod';

const uuid = z.string().uuid();

export const sessionIdParamsSchema = z.object({
  id: uuid,
});

/**
 * Metadata của 1 job user đính kèm. Frontend gửi kèm message để backend persist
 * theo message — khi reload, mỗi bubble hiển thị đúng chip theo thời điểm gửi
 * (không lệch khi user đổi attach giữa chừng).
 *
 * Chỉ validate các field cần thiết cho chip render + đủ strict để chặn rác
 * (string dài bất thường, số âm, …). Field optional có thể null.
 */
const attachedJobItemSchema = z.object({
  id: uuid,
  title: z.string().max(300),
  slug: z.string().max(300).nullable().optional(),
  companyId: uuid,
  companyName: z.string().max(300).nullable().optional(),
  salaryMin: z.string().nullable().optional(),
  salaryMax: z.string().nullable().optional(),
  salaryCurrency: z.string().max(10).nullable().optional(),
  salaryVisible: z.boolean().nullable().optional(),
  location: z.object({ city: z.string().max(200).optional() }).nullable().optional(),
  jobLevel: z.string().max(50).nullable().optional(),
  jobType: z.string().max(50).nullable().optional(),
  status: z.string().max(30),
  publishedAt: z.string().nullable().optional(),
});

const attachedCvItemSchema = z.object({
  id: uuid,
  title: z.string().max(300).nullable().optional(),
  isPrimary: z.boolean(),
  status: z.string().max(30),
  source: z.string().max(30),
  aiAnalysisTotal: z.number().nullable().optional(),
});

/**
 * Body cho POST /sessions/:id/turn.
 *
 * Phase 2 refactor: thêm `jobIds` + `cvIds` vào body. Frontend attach chip → local
 * state only (không gọi API); lúc gửi message, gửi kèm context hiện tại → backend
 * lưu context + xử lý turn trong 1 call. Trade-off: reload giữa lúc attach (chưa
 * gửi) sẽ mất chip — chấp nhận được vì chưa có intent từ user.
 *
 * Phase 2.5: thêm `attachedJobs` + `attachedCvs` (snapshot metadata đầy đủ của
 * items đã attach). Backend persist vào ChatMessage để reload hiển thị chips đúng
 * historical. Default [] — backend không yêu cầu FE gửi (nếu thiếu sẽ fallback
 * rỗng).
 */
export const turnBodySchema = z.object({
  message: z.string().trim().min(1, 'Câu hỏi không được rỗng').max(2000, 'Câu hỏi quá dài (tối đa 2000 ký tự)'),
  jobIds: z.array(uuid).max(3, 'Tối đa 3 job').default([]),
  cvIds: z.array(uuid).max(3, 'Tối đa 3 CV').default([]),
  attachedJobs: z.array(attachedJobItemSchema).max(3).default([]),
  attachedCvs: z.array(attachedCvItemSchema).max(3).default([]),
});

/**
 * Phase 2 refactor: contextPatch không còn được FE gọi nữa (frontend chỉ attach
 * local rồi gửi kèm message). Schema giữ lại để admin/debug hoặc nếu sau này
 * cần endpoint riêng cho đổi context không qua send.
 */
export const contextPatchSchema = z.object({
  jobIds: z.array(uuid).max(3, 'Tối đa 3 job').default([]),
  cvIds: z.array(uuid).max(3, 'Tối đa 3 CV').default([]),
});

export const jobsPickerQuerySchema = z.object({
  source: z.enum(['all', 'saved', 'applied']).default('all'),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
