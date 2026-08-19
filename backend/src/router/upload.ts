/**
 * Upload router — endpoints dùng chung cho upload ảnh/file lên MinIO.
 *
 * Mount tại /uploads (xem ghi chú mount trong router/index.ts).
 *
 * Endpoints:
 *   POST   /uploads/image         — multipart, field `file` (image only)
 *   POST   /uploads/file          — multipart, field `file` (PDF/DOCX/image)
 *   DELETE /uploads?key=...       — xoá theo key (owner hoặc admin)
 *
 * Auth:
 *   - Tất cả endpoint yêu cầu JWT (`auth` middleware).
 *   - userId LUÔN lấy từ `req.user.userId` (set bởi `auth`); service
 *     không bao giờ nhận userId từ body/query → chống IDOR.
 *
 * Validation:
 *   - `uploadImage`: chỉ nhận image/jpeg | image/png | image/webp | image/gif,
 *     tối đa 5MB (xem middleware/upload.ts).
 *   - `uploadMiddleware` (cho /file): PDF/DOCX + image, 10MB.
 *   - `validateDeleteKey`: Zod cho query.key (string, non-empty, max 512).
 *
 * Middleware order theo convention project:
 *   auth → multer.single('file') → controller
 *   auth → validateQuery → controller
 */
import { Router } from "express";
import { z } from "zod";
import { auth } from "../middleware/auth";
import { uploadImage, uploadMiddleware, wrapUpload } from "../middleware/upload";
import { validate } from "../middleware/validate";
import { uploadController } from "../controller/upload.controller";

export const uploadRouter = Router();

// --- Tất cả endpoint đều cần đăng nhập ---
uploadRouter.use(auth);

/**
 * Zod schema cho query `DELETE /uploads?key=...`.
 * - key: string 1..512 (key MinIO thực tế thường < 256, để buffer cho các
 *   tên rất dài).
 * - Refuse mọi path traversal / slash-leading (defense-in-depth; service
 *   cũng có check, nhưng fail sớm ở middleware vẫn rẻ hơn).
 */
const deleteKeySchema = z.object({
  key: z.string().min(1).max(512).refine((s) => !s.includes("..") && !s.startsWith("/"), { message: "Invalid key" }),
});

const validateDeleteKey = validate(deleteKeySchema, "query");

// --- POST /uploads/image (image-only, 5MB) ---
uploadRouter.post("/image", wrapUpload(uploadImage.single("file")), uploadController.uploadImage);

// --- POST /uploads/file (PDF/DOCX/image, 10MB) ---
uploadRouter.post("/file", wrapUpload(uploadMiddleware.single("file")), uploadController.uploadFile);

// --- DELETE /uploads?key=... ---
uploadRouter.delete("/", validateDeleteKey, uploadController.remove);
