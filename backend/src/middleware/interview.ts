/**
 * Zod schemas — Interview router
 *
 * Dùng cho middleware `validate()` theo cùng pattern với middleware/application.ts.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Param schemas
// ---------------------------------------------------------------------------

export const interviewIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type InterviewIdParam = z.infer<typeof interviewIdParamSchema>;

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

const INTERVIEW_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'] as const;

/**
 * Query cho GET /interviews — HR list lịch phỏng vấn của company.
 * - `status` optional — filter theo trạng thái.
 * - `applicationId` optional — filter theo 1 application cụ thể.
 * - `interviewerId` optional — filter theo người phỏng vấn.
 * - `page` / `limit` — phân trang chuẩn.
 */
export const listInterviewQuerySchema = z.object({
  status: z.enum(INTERVIEW_STATUSES).optional(),
  applicationId: z.string().uuid().optional(),
  interviewerId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListInterviewQuery = z.infer<typeof listInterviewQuerySchema>;

// ---------------------------------------------------------------------------
// Body schemas
// ---------------------------------------------------------------------------

/**
 * Body POST / — HR tạo lịch phỏng vấn mới.
 * - `applicationId` BẮT BUỘC — phải thuộc company của HR.
 * - `interviewerId` BẮT BUỘC — người sẽ phỏng vấn (có thể là chính HR).
 * - `scheduledAt` BẮT BUỘC — phải là thời điểm trong tương lai.
 * - `durationMin` optional, default 60.
 * - `location` xor `meetingLink` — ít nhất 1 trong 2.
 */
export const createInterviewBodySchema = z
  .object({
    applicationId: z.string().uuid(),
    interviewerId: z.string().uuid(),
    scheduledAt: z
      .string()
      .datetime({ offset: true })
      .refine((v) => new Date(v) > new Date()),
    durationMin: z.number().int().min(15).max(480).default(60),
    location: z.string().trim().max(500).optional(),
    meetingLink: z.string().url().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((d) => d.location || d.meetingLink, {
    path: ['location'],
  });

export type CreateInterviewBody = z.infer<typeof createInterviewBodySchema>;

/**
 * Body PUT /:id — HR cập nhật lịch phỏng vấn.
 * Dùng .partial() để cho phép update từng field.
 * scheduledAt nếu có thì phải là tương lai.
 */
export const updateInterviewBodySchema = z
  .object({
    interviewerId: z.string().uuid().optional(),
    scheduledAt: z
      .string()
      .datetime({ offset: true })
      .refine((v) => new Date(v) > new Date())
      .optional(),
    durationMin: z.number().int().min(15).max(480).optional(),
    location: z.string().trim().max(500).optional(),
    meetingLink: z.string().url().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((d) => Object.keys(d).length > 0);

export type UpdateInterviewBody = z.infer<typeof updateInterviewBodySchema>;

/**
 * Body PUT /:id/cancel — HR hủy phỏng vấn.
 * `cancelReason` optional nhưng khuyến khích điền để ứng viên biết lý do.
 */
export const cancelInterviewBodySchema = z.object({
  cancelReason: z.string().trim().max(1000).optional(),
});

export type CancelInterviewBody = z.infer<typeof cancelInterviewBodySchema>;

/**
 * Body PUT /:id/feedback — người phỏng vấn điền đánh giá sau buổi phỏng vấn.
 */
export const feedbackBodySchema = z.object({
  scores: z.record(z.string(), z.number().min(0).max(10)),
  comments: z.string().trim().min(1).max(5000),
  recommendation: z.enum(['strong_hire', 'hire', 'no_hire', 'strong_no_hire']),
});

export type FeedbackBody = z.infer<typeof feedbackBodySchema>;

// ---------------------------------------------------------------------------
// Candidate-side schemas
// ---------------------------------------------------------------------------

/**
 * Query cho GET /interviews/my — candidate xem danh sách lịch phỏng vấn của mình.
 * - `upcoming` optional — nếu true chỉ lấy lịch chưa tới.
 * - `limit` optional — giới hạn số lượng kết quả (1-50, default 10).
 * - `page` optional — số trang (default 1).
 */
export const listCandidateInterviewQuerySchema = z.object({
  upcoming: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type ListCandidateInterviewQuery = z.infer<typeof listCandidateInterviewQuerySchema>;

/**
 * Body PUT /:id/reject — candidate từ chối lịch phỏng vấn.
 * `reason` optional nhưng khuyến khích điền để HR biết lý do.
 */
export const rejectInterviewBodySchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

export type RejectInterviewBody = z.infer<typeof rejectInterviewBodySchema>;