
import multer from "multer";
import { AppError } from "./errorHandler";

const RESUME_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const storage = multer.memoryStorage();

export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!RESUME_MIME.includes(file.mimetype)) {
      return cb(new AppError(400, "INVALID_FILE_TYPE", `File type ${file.mimetype} not allowed`));
    }
    cb(null, true);
  },
});


export const uploadImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
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
