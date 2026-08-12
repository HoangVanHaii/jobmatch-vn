/**
 * Company controller — nhận request (đã validate ở middleware) -> gọi service -> trả response.
 * Mỗi hàm tự viết logic (không gộp helper chung) cho dễ đọc.
 * Pattern: try/catch + next(err); response { success, data }.
 */
import { Request, Response, NextFunction } from 'express';
import { companyService } from '../service/company.service';
import { AppError } from '../middleware/errorHandler';
import type {
  CreateCompanyInput,
  UpdateCompanyInput,
  UpdateCompanyStatusInput,
  ListCompaniesQuery,
} from '../interface/company';

export const companyController = {
  /** GET /companies — danh sách + phân trang + filter */
  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await companyService.list(req.query as unknown as ListCompaniesQuery, req.user?.role);
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('[list] error:', { query: req.query, err });
      next(err);
    }
  },

  /** GET /companies/:id — chi tiết theo id */
  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const company = await companyService.getById(id);

      // Không tìm thấy → 404
      if (!company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found');

      // Company banned/removed chỉ admin xem được; người thường thấy → trả 404 (giấu trạng thái)
      if (company.status !== 'active' && req.user?.role !== 'admin') {
        throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found');
      }

      res.json({
          success: true,
          data: company
      });
    } catch (err) {
      console.error('[getById] error:', { id: req.params.id, err });
      next(err);
    }
  },

  /** GET /companies/by-slug/:slug — chi tiết theo slug */
  getBySlug: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const slug = req.params.slug as string;
      const company = await companyService.getBySlug(slug);

      if (!company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found');
      if (company.status !== 'active' && req.user?.role !== 'admin') {
        throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found');
      }

      res.json({
        success: true,
        data: company
      });
    } catch (err) {
      console.error('[getBySlug] error:', { slug: req.params.slug, err });
      next(err);
    }
  },

  /** POST /companies — tạo công ty (createdBy lấy từ token user đăng nhập) */
  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const company = await companyService.create(
        req.body as CreateCompanyInput,
        req.user!.userId, // auth middleware đã đảm bảo có user
      );
      res.status(201).json({
        success: true,
        data: company
      });
    } catch (err) {
      console.error('[create] error:', { body: req.body, userId: req.user?.userId, err });
      next(err);
    }
  },

  /** PATCH /companies/:id — cập nhật thông tin (slug giữ nguyên) */
  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const company = await companyService.update(id, req.body as UpdateCompanyInput);

      if (!company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found');

      res.json({
        success: true,
        data: company
      });
    } catch (err) {
      console.error('[update] error:', { id: req.params.id, body: req.body, err });
      next(err);
    }
  },

  /** PATCH /companies/:id/status — admin đổi lifecycle (active/banned/removed) */
  updateStatus: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const { status } = req.body as UpdateCompanyStatusInput;
      const company = await companyService.updateStatus(id, status);

      if (!company) throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found');

      res.json({
        success: true,
        data: company
      });
    } catch (err) {
      console.error('[updateStatus] error:', { id: req.params.id, body: req.body, err });
      next(err);
    }
  },
};
