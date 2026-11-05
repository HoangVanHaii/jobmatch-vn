/**
 * Interview router — mount tại `/api/v1/interviews` (xem router/index.ts).
 *
 * Endpoints (Phần 1 — HR/Employer):
 *   - POST   /                       HR tạo lịch phỏng vấn mới
 *   - GET    /                       HR list lịch phỏng vấn của company
 *   - GET    /:id                    HR xem detail 1 lịch phỏng vấn
 *   - PUT    /:id                    HR cập nhật lịch phỏng vấn (giờ, link, v.v.)
 *   - PUT    /:id/cancel             HR hủy lịch phỏng vấn
 *   - PUT    /:id/feedback           Người phỏng vấn gửi đánh giá sau buổi phỏng vấn
 *
 * Endpoints (Phần 2 — Candidate):
 *   - GET    /candidate/my           Candidate xem danh sách lịch phỏng vấn của mình
 *   - PUT    /candidate/:id/confirm  Candidate xác nhận tham gia phỏng vấn
 *   - PUT    /candidate/:id/reject   Candidate từ chối phỏng vấn
 */
import { Router } from 'express';
import { auth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { validate } from '../middleware/validate';
import {
  createInterviewBodySchema,
  updateInterviewBodySchema,
  cancelInterviewBodySchema,
  feedbackBodySchema,
  interviewIdParamSchema,
  listInterviewQuerySchema,
  listCandidateInterviewQuerySchema,
  rejectInterviewBodySchema,
  publicInterviewTokenQuerySchema,
  publicInterviewRespondBodySchema,
} from '../middleware/interview';
import { interviewController } from '../controller/interview.controller';

export const interviewRouter = Router();

// ============================================================================
// Phần 1 — HR/Employer routes
// ============================================================================

// POST / — HR tạo lịch phỏng vấn mới
interviewRouter.post(
  '/',
  auth,
  requireRole('employer', 'admin'),
  validate(createInterviewBodySchema),
  interviewController.create,
);

// GET / — HR list lịch phỏng vấn
interviewRouter.get(
  '/',
  auth,
  requireRole('employer', 'admin'),
  validate(listInterviewQuerySchema, 'query'),
  interviewController.list,
);

// ============================================================================
// Google Calendar Integration routes (TRƯỚC /:id)
// ============================================================================

// GET /calendar/callback — Google redirect về sau khi user cấp quyền (Public endpoint)
interviewRouter.get(
  '/calendar/callback',
  interviewController.handleCalendarCallback,
);

// ============================================================================
// Public Token-based routes (Ứng viên nhận link từ Email, KHÔNG cần auth)
// ============================================================================

// GET /public/details — Lấy thông tin phỏng vấn theo token
interviewRouter.get(
  '/public/details',
  validate(publicInterviewTokenQuerySchema, 'query'),
  interviewController.getPublicByToken,
);

// POST /public/respond — Xác nhận / Xin đổi lịch / Từ chối theo token
interviewRouter.post(
  '/public/respond',
  validate(publicInterviewRespondBodySchema),
  interviewController.respondPublicByToken,
);

// GET /calendar/connect-url — HR lấy link OAuth Google Calendar
interviewRouter.get(
  '/calendar/connect-url',
  auth,
  requireRole('employer', 'admin'),
  interviewController.getCalendarConnectUrl,
);

// GET /calendar/status — Kiểm tra trạng thái kết nối Google Calendar của HR
interviewRouter.get(
  '/calendar/status',
  auth,
  requireRole('employer', 'admin'),
  interviewController.getCalendarStatus,
);

// DELETE /calendar/disconnect — HR ngắt kết nối Google Calendar
interviewRouter.delete(
  '/calendar/disconnect',
  auth,
  requireRole('employer', 'admin'),
  interviewController.disconnectCalendar,
);

// GET /calendar/busy-times — HR lấy danh sách khung giờ bận trong ngày
interviewRouter.get(
  '/calendar/busy-times',
  auth,
  requireRole('employer', 'admin'),
  interviewController.getBusyTimes,
);

// PUT /:id/cancel — TRƯỚC /:id để Express không nuốt
interviewRouter.put(
  '/:id/cancel',
  auth,
  requireRole('employer', 'admin'),
  validate(interviewIdParamSchema, 'params'),
  validate(cancelInterviewBodySchema),
  interviewController.cancel,
);

// PUT /:id/feedback — TRƯỚC /:id
interviewRouter.put(
  '/:id/feedback',
  auth,
  requireRole('employer', 'admin'),
  validate(interviewIdParamSchema, 'params'),
  validate(feedbackBodySchema),
  interviewController.submitFeedback,
);

// GET /:id — CUỐI nhóm GET
interviewRouter.get(
  '/:id',
  auth,
  requireRole('employer', 'admin'),
  validate(interviewIdParamSchema, 'params'),
  interviewController.getById,
);

// PUT /:id — SAU /:id/cancel và /:id/feedback
interviewRouter.put(
  '/:id',
  auth,
  requireRole('employer', 'admin'),
  validate(interviewIdParamSchema, 'params'),
  validate(updateInterviewBodySchema),
  interviewController.update,
);

// ============================================================================
// Phần 2 — Candidate routes  (prefix /candidate/*)
// ============================================================================

// GET /candidate/my — Candidate xem danh sách lịch phỏng vấn của mình
interviewRouter.get(
  '/candidate/my',
  auth,
  requireRole('candidate'),
  validate(listCandidateInterviewQuerySchema, 'query'),
  interviewController.listMy,
);

// GET /candidate/:id — Candidate xem detail 1 lịch phỏng vấn
interviewRouter.get(
  '/candidate/:id',
  auth,
  requireRole('candidate'),
  validate(interviewIdParamSchema, 'params'),
  interviewController.getDetail,
);

// PUT /candidate/:id/confirm
interviewRouter.put(
  '/candidate/:id/confirm',
  auth,
  requireRole('candidate'),
  validate(interviewIdParamSchema, 'params'),
  interviewController.confirm,
);

// PUT /candidate/:id/reject
interviewRouter.put(
  '/candidate/:id/reject',
  auth,
  requireRole('candidate'),
  validate(interviewIdParamSchema, 'params'),
  validate(rejectInterviewBodySchema),
  interviewController.reject,
);
