import { Router } from "express";
import { cvController } from "../controller/cv.controller";

import {
  validateCreateCv,
  validateCreateDirectCv,
  validateUpdateDirectCv,
  validateCvIdParam,
  validateListCvQuery,
} from "../middleware/cv";
import { auth, candidateOnly } from "../middleware/auth";
import { cvAiRateLimiter, cvWriteRateLimiter } from "../middleware/rateLimit";

export const cvRouter = Router();

/**
 * PUBLIC route — đặt TRƯỚC `cvRouter.use(auth, candidateOnly)` để bypass auth.
 *
 * GET /cvs/:cvId/render-data?token=... — Playwright (server-side Chromium) gọi
 * qua FE print page để lấy parsedData + templateId cho `CVTemplateRenderer`.
 * Authorize qua HMAC signed token (TTL 120s, scope 1 cvId) — KHÔNG cần Bearer.
 *
 * Endpoint này trả data tối thiểu (id, title, source, templateId, parsedData)
 * đủ cho Playwright render CV ra PDF vector. KHÔNG trả fileUrl/ai_analysis.
 *
 * Security:
 *   - Token scope chỉ 1 cvId + TTL ngắn → leak URL vẫn an toàn trong 2 phút.
 *   - Ownership đã verify ở downloadPdf (Bearer + candidateId) trước khi ký token.
 */
cvRouter.get("/:cvId/render-data", cvController.getRenderData);

cvRouter.use(auth, candidateOnly);

cvRouter.post("/upload", auth, cvAiRateLimiter, validateCreateCv, cvController.upload);

cvRouter.get("/", auth, validateListCvQuery, cvController.list);

cvRouter.get("/:cvId", auth, validateCvIdParam, cvController.getDetail);

/**
 * GET /cvs/:cvId/download-pdf — render CV direct sang PDF vector bằng
 * Playwright + Chromium server-side. Rate-limit riêng (PDF render nặng).
 *
 * KHÔNG áp cvAiRateLimiter (không gọi AI) nhưng áp cvWriteRateLimiter? —
 * thực ra download PDF là read-only + side-effect server (CPU/RAM), không
 * ghi DB. Bỏ qua rate limiter để giữ latency đơn giản; nếu cần scale thêm
 * thì wrap semaphore concurrency ở playwright.service.ts đã đủ (default 2).
 */
cvRouter.get("/:cvId/download-pdf", auth, validateCvIdParam, cvController.downloadPdf);

cvRouter.post("/direct", auth, cvAiRateLimiter, validateCreateDirectCv, cvController.create);

cvRouter.patch("/:cvId/primary", auth, validateCvIdParam, cvController.setPrimary);

cvRouter.post("/:cvId/analyze", auth, cvAiRateLimiter, validateCvIdParam, cvController.triggerAnalysis);

cvRouter.patch("/:cvId", auth, cvWriteRateLimiter, cvAiRateLimiter, validateCvIdParam, validateUpdateDirectCv, cvController.update);

cvRouter.delete("/:cvId", auth, cvWriteRateLimiter, validateCvIdParam, cvController.remove)