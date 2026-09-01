import { Request, Response, NextFunction } from 'express';
import { cvService } from '../service/cv.service';
import type { CreateCvInput, CreateDirectCvInput, CvSource, UpdateDirectCvInput } from '../interface/cv';
import { AppError } from "../middleware/errorHandler";
import { notificationGateway } from "../socket/notificationGateway";
import { renderUrlToPdf } from '../service/playwright.service';
import { signPrintToken, verifyPrintToken } from '../utils/printToken';
import { env } from '../config/env';

const requireSelfCandidateId = (req: Request): string => {
  if (!req.user) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  }
  return req.user.userId;
};

/**
 * Build filename cho CV direct PDF download.
 *
 * Quy tắc:
 *   - Dùng `cv.title` (user đặt) làm base name; fallback 'cv' nếu rỗng.
 *   - Extension cố định `.pdf` (Playwright luôn render ra PDF).
 *   - Sanitize filesystem-unsafe chars + cap 200 chars để tránh path traversal.
 *   - KHÔNG dùng extension từ URL/fileType (CV direct không có file gốc).
 */
const SAFE_FILENAME_RE = /[\\/:*?"<>|\x00-\x1f]/g;
const buildDownloadFilename = (title: string | null, _templateId: number | null): string => {
  const base = (title?.trim() || 'cv').replace(/\.(pdf|doc|docx|jpe?g|png|gif|webp)$/i, '');
  const safe = base.replace(SAFE_FILENAME_RE, '_').trim().slice(0, 200) || 'cv';
  return `${safe}.pdf`;
};

/**
 * Parse pagination query về number. Zod đã coerce số ở middleware, nhưng
 * TypeScript vẫn nhìn thấy string|undefined — ép kiểu an toàn tại controller.
 */
const toInt = (v: unknown, fallback: number): number => {
  const n = typeof v === 'string' ? Number(v) : (typeof v === 'number' ? v : NaN);
  return Number.isFinite(n) ? n : fallback;
};
export const cvController = {
  upload: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cv = await cvService.upload(
        req.body as CreateCvInput,
        req.user!.userId,
      );

      res.status(201).json({
        success: true,
        data: cv,
      });
    } catch (err) {

      next(err);
    }
  },
  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const source = req.query.source as CvSource | undefined;
      // Zod middleware (validateListCvQuery) đã trim + validate q là string min(1).
      // Tuy nhiên TypeScript vẫn thấy string|undefined do Request.query loose type —
      // ép kiểu an toàn + fallback undefined khi absent (không match gì).
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
      const limit = toInt(req.query.limit, 10);
      const offset = toInt(req.query.offset, 0);
      const result = await cvService.getListDetail(candidateId, source, limit, offset, q);
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('[cv.list] error:', err);
      next(err);
    }
  },
  getDetail: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const { cvId } = req.params as { cvId: string };
      const cv = await cvService.getDetail(candidateId, cvId);

      if (!cv) {
        throw new AppError(404, 'CV_NOT_FOUND', 'CV not found or already deleted');
      }

      res.json({ success: true, data: cv });
    } catch (err) {
      console.error('[cv.getDetail] error:', err);
      next(err);
    }
  },
  setPrimary: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const { cvId } = req.params as { cvId: string };
      const updated = await cvService.setPrimary(candidateId, cvId);

      if (!updated) {
        throw new AppError(404, 'CV_NOT_FOUND', 'CV not found or already deleted');
      }

      res.json({ success: true, data: updated });
    } catch (err) {
      console.error('[cv.setPrimary] error:', err)
      next(err);
    }
  },
  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const body = req.body as CreateDirectCvInput;
      const cv = await cvService.create(candidateId, body);
      res.status(201).json({ success: true, data: cv });

    } catch (err) {
      console.error('[cv.create] error:', err);
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const { cvId } = req.params as { cvId: string };
      const body = req.body as UpdateDirectCvInput;

      const updated = await cvService.update(candidateId, cvId, body);
      if (!updated) {
        throw new AppError(404, 'CV_NOT_FOUND', 'CV not found or already deleted');
      }

      notificationGateway.emitToUser(candidateId, "cv:status-changed", {
        cvId,
        status: updated.status,
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      console.error('[cv.update] error:', err);
      next(err);
    }
  },
  /**
   * POST /cvs/:cvId/analyze — trigger lại CV analysis.
   *
   * Body: rỗng. userId lấy từ req.user.
   *
   * Response: 202 Accepted + CV row (status='pending').
   *
   * FE nhận socket `cv:status-changed` để cập nhật UI realtime khi worker xử lý xong.
   */
  triggerAnalysis: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const { cvId } = req.params as { cvId: string };
      const cv = await cvService.triggerAnalysis(candidateId, cvId);

      res.status(202).json({ success: true, data: cv });
    } catch (err) {
      console.error('[cv.triggerAnalysis] error:', err);
      next(err);
    }
  },

  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
			const { cvId } = req.params as { cvId: string };

			const deleted = await cvService.softDelete(cvId, candidateId);

			if (!deleted) {
				throw new AppError(404, "CV_NOT_FOUND", 'CV not found or already deleted');
			}
			res.json({ success: true, data: deleted });

    } catch (err) {
      console.error('[cv.remove] error:', err);
      next(err);
    }
  },

  /**
   * GET /cvs/:cvId/download-pdf — render CV (chỉ source='direct') sang PDF
   * vector bằng Playwright + Chromium server-side.
   *
   * Lý do dùng Playwright thay html2canvas/jsPDF:
   *   - Đã thử 5+ lần fix bug capture DOM→canvas (position:fixed ancestor,
   *     CORS ảnh, opacity:0 làm canvas trắng, PNG alpha → Chrome PDF viewer
   *     render black, ...) nhưng bản chất DOM→canvas không ổn định.
   *   - Playwright render vector thật, không có nhóm bug cũ, PDF in đẹp hơn
   *     nhiều (text chọn được, scale không vỡ).
   *
   * Auth flow:
   *   1. Bearer JWT verify (middleware auth) → req.user.userId.
   *   2. cvService.getDetail check ownership + status != 'deleted' +
   *      source='direct' (CV upload có fileUrl → dùng /:cvId/download thay).
   *   3. Sign 1 short-lived HMAC token (cvId+expiry+nonce) qua PRINT_TOKEN_SECRET.
   *   4. Playwright navigate tới `${FRONTEND_URL}/print/cv/:cvId?token=...`
   *      — print page không cần Bearer, chỉ cần token để lấy CV render data.
   *   5. Đợi print page set `[data-ready="true"]` → page.pdf() → Buffer.
   *   6. Trả PDF cho client với Content-Disposition: attachment.
   *
   * Lỗi:
   *   - 401: Bearer thiếu/sai → middleware xử lý.
   *   - 403: CV không thuộc candidate / đã deleted / không phải direct.
   *   - 404: CV không tồn tại.
   *   - 502: Playwright/Chromium fail (crashed, timeout, page error).
   */
  downloadPdf: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidateId = requireSelfCandidateId(req);
      const { cvId } = req.params as { cvId: string };

      const cv = await cvService.getDetail(candidateId, cvId);
      if (!cv) {
        throw new AppError(404, 'CV_NOT_FOUND', 'CV not found or already deleted');
      }
      if (cv.source !== 'direct') {
        // CV upload đã có fileUrl — FE dùng endpoint /:cvId/download thay vì
        // render lại. Endpoint này chỉ phục vụ CV direct.
        throw new AppError(
          400,
          'PDF_DOWNLOAD_NOT_SUPPORTED',
          'Chỉ CV direct (tạo từ form) mới hỗ trợ render PDF. CV upload dùng /download.',
        );
      }
      if (!cv.templateId || cv.templateId < 1 || cv.templateId > 5) {
        throw new AppError(
          400,
          'CV_TEMPLATE_INVALID',
          'CV direct chưa có templateId hợp lệ — không thể render PDF.',
        );
      }

      // Ký short-lived token cho print page (TTL = PRINT_TOKEN_TTL_SECONDS).
      const token = signPrintToken(cvId);
      const printUrl = `${env.FRONTEND_URL}/print/cv/${encodeURIComponent(cvId)}?token=${encodeURIComponent(token)}`;

      const pdfBuffer = await renderUrlToPdf({
        url: printUrl,
        format: 'A4',
        landscape: false,
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });

      const filename = buildDownloadFilename(cv.title, cv.templateId);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(pdfBuffer.length));
      const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_');
      const encoded = encodeURIComponent(filename);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(200).end(pdfBuffer);
    } catch (err) {
      console.error('[cv.downloadPdf] error:', err);
      next(err);
    }
  },

  /**
   * GET /cvs/:cvId/render-data?token=... — public endpoint (NO Bearer required),
   * authorize qua HMAC signed token trong query string.
   *
   * Mục đích: FE print page `/print/cv/:cvId` (Playwright navigate tới) gọi
   * endpoint này để lấy parsedData + templateId cho `CVTemplateRenderer`, set
   * `data-ready="true"` để Playwright biết render xong rồi page.pdf().
   *
   * Auth flow:
   *   1. Token trong query → verifyPrintToken (signature HMAC + expiry + cvId match).
   *      Throw 401 nếu sai/hết hạn.
   *   2. cvService.getRenderData(cvId) lấy slim row (id, title, source, templateId, parsedData).
   *      Throw 404 nếu CV không tồn tại / đã soft-delete.
   *      Throw 404 nếu source !== 'direct' (CV upload có file gốc, không qua print page).
   *
   * Khác với các endpoint khác trong cvRouter:
   *   - KHÔNG yêu cầu Bearer (Playwright là internal call, không có user session).
   *   - Mount TRƯỚC `cvRouter.use(auth, candidateOnly)` để bypass auth middleware.
   */
  getRenderData: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { cvId } = req.params as { cvId: string };
      if (!cvId) {
        throw new AppError(400, 'MISSING_CV_ID', 'cvId is required');
      }
      const tokenRaw = req.query.token;
      const token = typeof tokenRaw === 'string' ? tokenRaw : '';
      if (!token) {
        throw new AppError(400, 'MISSING_TOKEN', 'token query param is required');
      }

      // Verify signature + expiry + cvId match — throw AppError(401) on fail.
      verifyPrintToken(token, cvId);

      const row = await cvService.getRenderData(cvId);
      if (!row) {
        throw new AppError(404, 'CV_NOT_FOUND', 'CV not found or already deleted');
      }
      if (row.source !== 'direct') {
        throw new AppError(
          404,
          'CV_NOT_RENDERABLE',
          'Only direct CVs support render',
        );
      }

      res.json({ success: true, data: row });
    } catch (err) {
      console.error('[cv.getRenderData] error:', err);
      next(err);
    }
  },

};