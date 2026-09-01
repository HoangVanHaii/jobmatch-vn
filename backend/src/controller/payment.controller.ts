import { Request, Response, NextFunction } from "express";
import { paymentService } from "../service/payment.service";
import type { PaymentListQuery } from "../middleware/payment";

export const paymentController = {

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const { planId } = req.body;

      const {
        payment,
        checkoutUrl,
        qrCode,
        accountNumber,
        accountName,
        amount,
        description,
        paymentLinkId,
      } = await paymentService.create(userId, planId);

      res.status(201).json({
        success: true,
        data: {
          payment,
          checkoutUrl,
          qrCode,
          accountNumber,
          accountName,
          amount,
          description,
          paymentLinkId,
        },
        message: "Tạo payment link thành công. Quét QR hoặc mở PayOS để thanh toán.",
      });
    } catch (err) {
      next(err);
    }
  },
  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const userId = req.user!.userId;
      const isAdmin = req.user!.role === "admin";

      const data = await paymentService.getById(id, userId, isAdmin);

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  getByOrderCode: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orderCode = req.params.orderCode as string;
      const userId = req.user!.userId;

      const data = await paymentService.getByOrderCode(orderCode, userId);

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filters = req.query as unknown as PaymentListQuery;
      const offset = (filters.page - 1) * filters.limit;
      const { data, total } = await paymentService.list({
        offset,
        limit: filters.limit,
        userId: filters.userId,
        status: filters.status,
      });

      res.json({
        success: true,
        data,
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total,
          totalPages: Math.ceil(total / filters.limit),
        },
      });
    } catch (err) {
      next(err);
    }
  },
  listMine: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const filters = req.query as unknown as PaymentListQuery;
      const offset = (filters.page - 1) * filters.limit;
      const { data, total } = await paymentService.list({
        offset,
        limit: filters.limit,
        userId,
        status: filters.status,
      });

      res.json({
        success: true,
        data,
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total,
          totalPages: Math.ceil(total / filters.limit),
        },
      });
    } catch (err) {
      next(err);
    }
  },
  cancel: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const userId = req.user!.userId;
      const isAdmin = req.user!.role === "admin";

      const data = await paymentService.cancel(id, userId, isAdmin);

      res.json({
        success: true,
        data,
        message: "Đã hủy payment link",
      });
    } catch (err) {
      next(err);
    }
  },
} as const;
