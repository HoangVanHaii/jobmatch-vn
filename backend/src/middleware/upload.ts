
import multer from "multer";
import { AppError } from "./errorHandler";

/**
 * MIME whitelist cho `/uploads/file` — dùng cho cả CV upload và chat attachment
 * (file không phải ảnh).
 *
 * PDF/DOCX cho CV; XLSX/ZIP/TXT/CSV cho chat attachment. Endpoint không phân
 * biệt context — FE chọn `folder='cvs'|'chat'` để bucket admin biết nguồn.
 */
const FILE_MIME = [
  // Document
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Text / data
  "text/plain",
  "text/csv",
  // Archive
  "application/zip",
  "application/x-zip-compressed",
  // Image — cho phép upload ảnh qua endpoint file (chat chọn image vẫn dùng
  // /uploads/image, nhưng nếu FE gửi nhầm route vẫn pass)
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const storage = multer.memoryStorage();

export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!FILE_MIME.includes(file.mimetype)) {
      return cb(new AppError(400, "INVALID_FILE_TYPE", `File type ${file.mimetype} not allowed. Allowed: PDF, DOC/DOCX, XLS/XLSX, PPT, TXT, CSV, ZIP, image/*`));
    }
    cb(null, true);
  },
});


/**
 * uploadImage — image-only endpoint. Limit nâng từ 5MB → 10MB để cover use
 * case chat (ảnh từ clipboard/mobile screenshot HEIC thường 5-8MB). Avatar/
 * logo vẫn ổn vì các flow đó đã nén trước khi upload. Endpoint /uploads/image
 * phục vụ nhiều ngữ cảnh (chat, avatar, JD cover) → tăng limit ở đây là
 * cách đơn giản nhất. Khi cần giới hạn riêng cho từng folder → tách middleware
 * hoặc thêm validation theo `req.body.folder` (sau này).
 */
export const uploadImage = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!IMAGE_MIME.includes(file.mimetype)) {
      return cb(new AppError(400, "INVALID_FILE_TYPE", `Image type ${file.mimetype} not allowed. Allowed: jpeg, png, webp, gif`));
    }
    cb(null, true);
  },
});

/**
 * Wrap multer.single() để convert lỗi MulterError thành AppError.
 * - LIMIT_FILE_SIZE → 413 FILE_TOO_LARGE
 * - Lỗi khác → 400 UPLOAD_ERROR
 */
export const wrapUpload = (fn: import("express").RequestHandler) => (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void => {
  fn(req, res, (err: unknown) => {
    if (!err) {
      return next();
    }
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: string }).code : undefined;
    const field = typeof err === "object" && err !== null && "field" in err ? (err as { field?: string }).field : undefined;
    if (code === "LIMIT_FILE_SIZE") {
      return next(new AppError(413, "FILE_TOO_LARGE", "File exceeds size limit", field));
    }
    return next(new AppError(400, "UPLOAD_ERROR", err instanceof Error ? err.message : "Upload failed"));
  });
};
