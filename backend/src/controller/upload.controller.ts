/**
 * Upload controller — nhận multipart/upload từ multer (đã whitelist MIME)
 * rồi gọi service để đẩy lên MinIO.
 *
 * Pattern: try/catch + next(err), response chuẩn `{ success, data }`.
 *
 * Quy ước ownership:
 *   - `userId` LUÔN lấy từ `req.user.userId` (do middleware `auth` set) —
 *     KHÔNG BAO GIỜ nhận từ body/query/params (tránh IDOR).
 *   - `folder` là optional trong form-data (text field); service whitelist
 *     và sanitize.
 *
 * Lỗi multer:
 *   - fileFilter reject (sai MIME) → AppError 400 INVALID_FILE_TYPE.
 *   - limit vượt → wrapped thành AppError 413 FILE_TOO_LARGE (xem
 *     middleware/upload.ts → wrapUpload).
 */
import { Request, Response, NextFunction } from "express";
import { uploadService } from "../service/upload.service";
import { AppError } from "../middleware/errorHandler";

const requireFile = (req: Request): Express.Multer.File => {
  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    throw new AppError(400, "NO_FILE", "No file uploaded");
  }
  return req.file;
};

export const uploadController = {
  uploadImage: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const file = requireFile(req);
      const folder = typeof req.body?.folder === "string" ? req.body.folder : undefined;
      const data = await uploadService.uploadImage({
        buffer: file.buffer,
        mime: file.mimetype,
        originalName: file.originalname,
        userId: req.user!.userId,
        folder,
      });
      res.status(201).json({ success: true, data });
    } catch (err) {
      console.error("[upload.uploadImage] error:", { err });
      next(err);
    }
  },

  uploadFile: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const file = requireFile(req);
      const folder = typeof req.body?.folder === "string" ? req.body.folder : undefined;
      const data = await uploadService.uploadFile({
        buffer: file.buffer,
        mime: file.mimetype,
        originalName: file.originalname,
        userId: req.user!.userId,
        folder,
      });
      res.status(201).json({ success: true, data });
    } catch (err) {
      console.error("[upload.uploadFile] error:", { err });
      next(err);
    }
  },

  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { key } = req.query as { key?: string };
      if (!key) {
        throw new AppError(400, "KEY_REQUIRED", "key query param is required");
      }
      await uploadService.deleteObject(key, req.user!.userId, req.user!.role);
      res.json({ success: true, data: { key } });
    } catch (err) {
      console.error("[upload.remove] error:", { key: req.query.key, err });
      next(err);
    }
  },
};
