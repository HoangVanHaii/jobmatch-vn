/**
 * Job controller — HTTP layer.
 * Validate/body đã được middleware/validate() chuẩn hóa; controller chỉ
 * destructure req.user, gọi service, trả JSON shape `{success, data?, message?}`.
 */
import { Request, Response, NextFunction } from 'express';
import { jobService } from '../service/job.service';
import { jobFeedbackService } from '../service/jobFeedback.service';
import { applicationService } from '../service/application.service';
import { companyMemberService } from '../service/companyMember.service';
import { JobListQuery, JobSemanticSearchQuery } from '../middleware/job';
import { AppError } from '../middleware/errorHandler';

export const jobController = {
  listIndustries: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await jobService.listIndustries();
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filters = req.query as unknown as JobListQuery;
      const { data, total } = await jobService.list(filters);
      res.json({
        success: true,
        data,
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total,
          totalPages: Math.ceil(total / filters.limit),
        }
      });
    } catch (err) { next(err); }
  },

  listOfCompany: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filters = req.query as unknown as JobListQuery;
      const userId = req.user!.userId;
      // Resolve companyId từ session user. Employer có thể thuộc nhiều
      // company khác nhau qua companyMembers → lấy active membership đầu tiên.
      // Nếu user chưa thuộc company nào → trả list rỗng.
      const membership = await companyMemberService.findMembershipByUserId(userId);
      if (!membership) {
        res.json({
          success: true,
          data: [],
          pagination: {
            page: filters.page,
            limit: filters.limit,
            total: 0,
            totalPages: 1,
          },
        });
        return;
      }
      const { data, total } = await jobService.list(filters, membership.companyId);
      res.json({
        success: true,
        data,
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total,
          totalPages: Math.ceil(total / filters.limit),
        }
      });
    } catch (err) { next(err); }
  },

  searchByKeyWord: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const keyword = req.query.keyword as string;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const { data, total } = await jobService.searchByKeyWord(keyword, page, limit);
      res.json({
        success: true,
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) { next(err); }
  },

  searchSemantic: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filters = req.query as unknown as JobSemanticSearchQuery;
      const { data } = await jobService.searchSemantic(filters);
      res.json({
        success: true,
        data,
        // semantic search không có "total" chính xác (threshold-based ranking)
        // nên chỉ trả data + limit
        meta: { query: filters.query, threshold: filters.threshold },
      });
    } catch (err) { next(err); }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await jobService.getById(req.params.id as string);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  /**
   * GET /jobs/by-slug/:slug — Job detail bằng slug (SEO-friendly URL).
   * Mirror getById nhưng nhận `slug` thay vì UUID.
   */
  getBySlug: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await jobService.getBySlug(req.params.slug as string);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  /**
   * GET /jobs/by-slug/:slug/application-status — status application của
   * candidate hiện tại cho job này. Endpoint riêng để giữ `by-slug` public
   * (không chứa PII applicant), candidate chỉ mất 1 round-trip song song.
   *
   * Auth: candidateOnly. Trả `status: null` nếu chưa apply.
   */
  getMyApplicationStatus: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const slug = req.params.slug as string;
      // Resolve jobId từ slug (1 query nhẹ — không full join).
      const job = await jobService.getIdBySlug(slug);
      if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found');
      const data = await applicationService.getStatusForCandidate(userId, job.id);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const data = await jobService.create(userId, req.body);
      res.status(201).json({ success: true, data });
    } catch (err) { next(err); }
  },

  generate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const draft = await jobService.generateDraft(req.user!.userId, req.body);
      res.json({ success: true, data: draft });
    } catch (err) { next(err); }
  },

  submit: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const jobId = req.params.id as string;
      await jobService.submit(userId, jobId);
      res.json({ success: true, message: 'Job submitted for AI scan' });
    } catch (err) { next(err); }
  },

  resubmit: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const jobId = req.params.id as string;
      // Admin force re-scan (no ownership check needed)
      await jobService.forceScan(jobId);
      res.json({ success: true, message: 'Job queued for re-scan' });
    } catch (err) { next(err); }
  },

  getScanResult: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const role = req.user!.role;
      const jobId = req.params.id as string;
      const data = await jobService.getScanResult(userId, jobId, role);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const data = await jobService.update(userId, req.params.id as string, req.body);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  delete: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      await jobService.softDelete(userId, req.params.id as string);
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  /**
   * POST /jobs/:id/reopen — owner mở lại job đã đóng (closed → draft).
   * Backend tự gate status='closed'; không cho reopen job ở status khác.
   */
  reopen: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const jobId = req.params.id as string;
      await jobService.reopen(userId, jobId);
      res.json({ success: true, message: 'Job đã chuyển về bản nháp' });
    } catch (err) { next(err); }
  },

  getMatches: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const data = await jobService.getMatches(userId, req.params.id as string);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  },

  requestExportApplications: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      await jobService.requestExportApplications(req.params.id as string, userId);
      res.status(202).json({
        success: true,
        message: 'Export is processing. You will be notified upon completion.',
      });
    } catch (err) { next(err); }
  },

  listFeedbacks: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const jobId = req.params.id as string;
      const viewerId = req.user?.userId;
      const result = await jobFeedbackService.listForJob(jobId, viewerId);
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  },

  createFeedback: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const jobId = req.params.id as string;
      const { rating, comment } = req.body as { rating: number; comment?: string | null };
      const feedback = await jobFeedbackService.upsert(jobId, userId, rating, comment ?? null);
      res.status(200).json({ success: true, data: feedback });
    } catch (err) { next(err); }
  },

  /**
   * GET /jobs/:id/feedbacks/me — feedback của chính candidate đang request.
   * Trả null nếu chưa rate.
   */
  getMyFeedback: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const jobId = req.params.id as string;
      const feedback = await jobFeedbackService.getMine(jobId, userId);
      res.json({ success: true, data: feedback });
    } catch (err) { next(err); }
  },
} as const;
