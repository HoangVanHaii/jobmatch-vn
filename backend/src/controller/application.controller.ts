import { Request, Response, NextFunction } from 'express';
import { applicationService } from '../service/application.service';
import { AppError } from '../middleware/errorHandler';

export const applicationController = {
  /**
   * POST /applications — candidate apply job.
   * Body: { jobId, cvId?, coverLetter? }
   *
   * Trả 201 với application vừa tạo (id + status='pending').
   * Backend side-effect:
   *   - notify employer (application_new, best-effort)
   *   - enqueue cv-match worker (nếu có CV snapshot)
   *
   * Errors:
   *   - 404 JOB_NOT_FOUND — jobId không tồn tại
   *   - 400 JOB_NOT_APPLYABLE — job.status !== 'live'
   *   - 400 JOB_EXPIRED — job.deadline < now
   *   - 404 CV_NOT_FOUND / 403 CV_FORBIDDEN — cvId không tồn tại hoặc không thuộc candidate
   *   - 409 ALREADY_APPLIED — duplicate (candidate đã apply job này)
   */
  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { jobId, cvId, coverLetter } = req.body as {
        jobId: string;
        cvId?: string;
        coverLetter?: string;
      };
      const result = await applicationService.create({ jobId, cvId, coverLetter }, userId);
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  /**
   * GET /applications/me — candidate list applications của mình.
   * Query: ?status=&page=&limit=
   */
  listMine: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { status, page, limit } = req.query as {
        status?: string;
        page?: number;
        limit?: number;
      };
      const result = await applicationService.listMine(userId, {
        status: status as any,
        page,
        limit,
      });
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  /**
   * GET /applications/:id — xem full detail 1 application.
   *
   * Trả `ApplicationDetail` (xem `interface/application.ts`) gồm:
   *   - Job context (location, deadline)
   *   - Full coverLetter (không truncate)
   *   - CV snapshot đầy đủ (title, url, parsedData, template)
   *   - AI match reasoning (strengths, missing, concerns, rationale)
   *
   * Auth scoping tại service: candidate chỉ xem của mình; employer chỉ xem
   * nếu owns job (postedBy); admin xem hết. Tất cả sai → 404 (không leak).
   *
   * Đặt SAU các route cụ thể (`/me`, `/job/:jobId`, `/company`, `/:id/...`)
   * để Express match đúng — đã đặt cuối file router để đảm bảo thứ tự.
   */
  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      const role = req.user?.role;
      if (!userId || !role) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { id } = req.params as { id: string };
      const result = await applicationService.getById(id, userId, role);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  /**
   * GET /applications/job/:jobId — employer list applications cho 1 job.
   * Auth: employer phải là postedBy của job, hoặc admin.
   */
  listByJob: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      const role = req.user?.role;
      if (!userId || !role) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { jobId } = req.params as { jobId: string };
      const { status, page, limit } = req.query as {
        status?: string;
        page?: number;
        limit?: number;
      };
      const result = await applicationService.listByJob(jobId, userId, role as any, {
        status: status as any,
        page,
        limit,
      });
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  /**
   * GET /applications/company — employer list applications của TẤT CẢ
   * companies user là active member. Query: ?status=&jobId=&page=&limit=
   *
   * Auth: employer (member active của ≥1 company) hoặc admin (xem tất cả).
   */
  listByCompany: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      const role = req.user?.role;
      if (!userId || !role) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { status, jobId, page, limit } = req.query as {
        status?: string;
        jobId?: string;
        page?: number;
        limit?: number;
      };
      const result = await applicationService.listByCompany(userId, role as any, {
        status: status as any,
        jobId,
        page,
        limit,
      });
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  /**
   * PATCH /applications/:id/status — employer update status application.
   * Body: { status, stage? }
   *
   * Auth: employer phải là postedBy của job chứa application, hoặc admin.
   */
  updateStatus: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      const role = req.user?.role;
      if (!userId || !role) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { id } = req.params as { id: string };
      const { status, stage } = req.body as { status: string; stage?: string };
      const result = await applicationService.updateStatus(id, userId, role as any, status as any, stage);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  /**
   * POST /applications/:id/recompute-match — employer yêu cầu chấm lại AI match.
   * Body: rỗng (chỉ cần applicationId từ URL).
   *
   * Use case: application có `aiMatchScore = NULL` (candidate hết quota lúc apply,
   * hoặc queue down lúc đó) → employer bấm "So khớp AI" để retry.
   *
   * Auth: employer phải là postedBy của job, hoặc admin.
   *
   * Trả 202 (Accepted) vì matching chạy async — response ngay không có điểm mới.
   * Client poll application detail hoặc listen socket `application:match-ready`
   * để biết khi worker xong.
   */
  recomputeMatch: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      const role = req.user?.role;
      if (!userId || !role) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { id } = req.params as { id: string };
      const result = await applicationService.recomputeMatch(id, userId, role as any);
      res.status(202).json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  /**
   * PATCH /applications/:id/withdraw — candidate rút đơn ứng tuyển.
   * Body: rỗng.
   *
   * Quy tắc (xem service.application.withdraw):
   *   - Chỉ rút được khi status='pending' hoặc 'viewed'.
   *   - Sau screening/interview/offered/hired/rejected → không rút được (409).
   *   - Idempotent: nếu đã withdrawn → trả success.
   *
   * Side-effect: notify employer (application_withdrawn) realtime.
   */
  withdraw: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized');
      const { id } = req.params as { id: string };
      const result = await applicationService.withdraw(id, userId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },
};
