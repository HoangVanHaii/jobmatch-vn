/**
 * Router chatbot AI — mount tại /chatbot.
 *
 * Order chuẩn: optionalAuth | auth → role? → rateLimit? → validate → controller.
 *
 * - /sessions      : auth (candidate & employer dùng được)
 * - /turn          : auth + chatbotRateLimiter (10 lượt/phút/user) — rate limit
 *                    chỉ áp dụng cho LLM call, không cho attach chip local.
 * - /jobs/picker   : auth (read-only)
 * - /cvs/picker    : auth (read-only)
 *
 * Phase 2 refactor: PATCH /sessions/:id/context bị comment khỏi route vì FE
 * attach chip giờ là local state only. Khi user gửi message, payload POST /turn
 * mang kèm { jobIds, cvIds } → backend lưu context + xử lý turn trong 1 call.
 * Schema `contextPatchSchema` vẫn giữ để admin tool / Phase 3 dùng nếu cần.
 */
import { Router } from 'express';
import { auth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { chatbotRateLimiter } from '../middleware/rateLimit';
import {
  sessionIdParamsSchema,
  turnBodySchema,
  contextPatchSchema,
  updateSessionSchema,
  jobsPickerQuerySchema,
} from '../middleware/chatbot';
import { chatbotController } from '../controller/chatbot.controller';
import { z } from 'zod';

export const chatbotRouter = Router();

// REST: sessions
chatbotRouter.post('/sessions', auth, chatbotController.createSession);
chatbotRouter.get('/sessions', auth, chatbotController.listSessions);
chatbotRouter.get(
  '/sessions/:id',
  auth,
  validate(sessionIdParamsSchema, 'params'),
  chatbotController.getSession,
);

// PATCH /sessions/:id/context — comment khỏi route vì FE không còn gọi.
// Schema `contextPatchSchema` + controller.patchContext vẫn còn trong code để
// admin tool / Phase 3 dùng lại khi cần đổi context không qua send.
// chatbotRouter.patch(
//   '/sessions/:id/context',
//   auth,
//   validate(sessionIdParamsSchema, 'params'),
//   validate(contextPatchSchema, 'body'),
//   chatbotController.patchContext,
// );
void contextPatchSchema; // giữ import không bị TS unused-warning
chatbotRouter.delete(
  '/sessions/:id/context',
  auth,
  validate(sessionIdParamsSchema, 'params'),
  chatbotController.resetContext,
);
// Xóa hẳn 1 session (toàn bộ messages + context). User action từ sidebar.
chatbotRouter.delete(
  '/sessions/:id',
  auth,
  validate(sessionIdParamsSchema, 'params'),
  chatbotController.deleteSession,
);
// Đổi title phiên chat (chỉnh từ sidebar). Body: { title }.
chatbotRouter.patch(
  '/sessions/:id',
  auth,
  validate(sessionIdParamsSchema, 'params'),
  validate(updateSessionSchema, 'body'),
  chatbotController.updateSession,
);

// SSE: turn (rate limit chỉ áp dụng cho turn, không cho attach chip)
chatbotRouter.post(
  '/sessions/:id/turn',
  auth,
  chatbotRateLimiter,
  validate(sessionIdParamsSchema, 'params'),
  validate(turnBodySchema, 'body'),
  chatbotController.streamTurn,
);

// Picker
chatbotRouter.get(
  '/jobs/picker',
  auth,
  validate(jobsPickerQuerySchema, 'query'),
  chatbotController.listJobsPicker,
);
chatbotRouter.get('/cvs/picker', auth, chatbotController.listCvsPicker);

// Tiny alias để TS không warning unused zod import ở middleware — dùng zod cho parser nội bộ.
void z;
