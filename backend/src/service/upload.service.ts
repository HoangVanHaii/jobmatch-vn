/**
 * Upload service — đẩy file/ảnh lên MinIO rồi trả public URL.
 *
 * Key convention (an toàn + audit):
 *   uploads/{userId}/{folder}/{YYYY-MM}/{uuid}-{safeName}.{ext}
 *
 *   - userId lấy từ JWT (req.user), KHÔNG bao giờ tin client — giúp audit
 *     và enforce ownership khi DELETE.
 *   - folder là segment do client chỉ định (vd. `images`, `logos`, `files`)
 *     nhưng được whitelist + sanitize; tránh path traversal.
 *   - Filename gốc được strip path + slugify ngăn key dài vô tận hoặc
 *     ký tự unicode khó đọc trong dashboard MinIO.
 *   - UUID phía trước đảm bảo không trùng key khi 2 user upload cùng
 *     filename cùng giây.
 *
 * Đảm bảo bucket đã tồn tại trước khi upload: gọi `ensureBucket()` lazy
 * lần đầu trong process (qua `ensureBucketOnce`). Tránh gọi mỗi request.
 *
 * Delete:
 *   - Chỉ cho phép DELETE key bắt đầu bằng `uploads/{callerUserId}/…`
 *     (trừ admin — xoá mọi key).
 *   - `s3.removeObject` không trả lỗi nếu key không tồn tại (idempotent),
 *     nên không cần check exists trước.
 *
 * Public URL:
 *   - `getPublicUrl` ở config/minio.ts trả URL bucket public-style qua
 *     `S3_PUBLIC_URL` hoặc `http://{S3_ENDPOINT}:{S3_PORT}/{bucket}/{key}`.
 *   - Nếu sau này bucket chuyển sang private → đổi sang `presignedGetObject`
 *     ở đây, controller vẫn trả `{ url, key, mime, size }` không đổi shape.
 */
import path from "path";
import { randomUUID } from "crypto";
import { s3, getPublicUrl, ensureBucket } from "../config/minio";
import { env } from "../config/env";
import { AppError } from "../middleware/errorHandler";
import type { UploadInput, UploadResult, ViewerRole } from "../interface/upload";

const ALLOWED_FOLDERS = new Set([
  "images",
  "avatars",
  "logos",
  "covers",
  "cvs",
  "files",
  "general",
  "chat",
]);

const normalizeFolder = (raw?: string): string => {
  if (!raw) {
    return "general";
  }
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned || cleaned.includes("/") || cleaned.includes("\\") || cleaned.includes("..")) {
    throw new AppError(400, "INVALID_FOLDER", `Folder "${raw}" is not allowed`);
  }
  if (!ALLOWED_FOLDERS.has(cleaned)) {
    throw new AppError(400, "INVALID_FOLDER", `Folder must be one of: ${Array.from(ALLOWED_FOLDERS).join(", ")}`);
  }
  return cleaned;
};

const mimeToExt = (mime: string): string => {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "text/plain": "txt",
    "text/csv": "csv",
    "application/zip": "zip",
    "application/x-zip-compressed": "zip",
  };
  return map[mime] ?? "bin";
};

/**
 * Content-Disposition cho header (RFC 6266, chỉ ASCII) — RFD-01.
 * Filename gốc có thể chứa tiếng Việt → dùng filename* (RFC 5987) để
 * giữ Unicode mà vẫn tương thích trình duyệt cũ.
 *
 * disposition CHIA THEO MIME:
 *   - inline (PDF, image/*): browser render trong <object> / <iframe> / <img>
 *     mà KHÔNG tự động tải xuống. Cần thiết cho:
 *       • CvThumbnail — render PDF qua <object data="fileUrl"> (MyResumesView
 *         grid card), ảnh qua <img src="fileUrl">.
 *       • CvPreview modal — iframe preview PDF/ảnh khi user mở chi tiết.
 *     Nếu để `attachment` thì browser ép download ngay khi mount view → user
 *     upload xong vào trang /candidate/resumes là file tự rơi xuống máy.
 *   - attachment (DOCX, DOC, etc.): browser không render được inline, để
 *     `attachment` là đúng semantically — user click "Mở file gốc" mới tải về.
 *     Google Docs Viewer (cho DOCX preview ở modal) tự fetch server-side nên
 *     header này không ảnh hưởng.
 *
 * Lưu ý: file đã upload TRƯỚC fix này vẫn giữ `attachment` cũ trong MinIO.
 * User cần upload lại CV (hoặc re-set header qua script admin) để áp dụng.
 */
const buildContentDisposition = (originalName: string, mime: string): string => {
  const ext = mimeToExt(mime);
  const asciiName = `${randomUUID()}.${ext}`;
  // UTF-8 percent-encode cho filename* (giữ nguyên dấu tiếng Việt)
  const utf8 = `utf-8''${encodeURIComponent(originalName)}`;
  const disposition =
    mime === 'application/pdf' || mime.startsWith('image/') ? 'inline' : 'attachment';
  return `${disposition}; filename="${asciiName}"; filename*=${utf8}`;
};

const sanitizeName = (original: string): string => {
  const base = path.basename(original);
  // Strip extension — buildKey luôn append ext theo MIME để tránh double
  // extension (vd. "HoangVanHai.pdf.pdf" khi MIME cũng là application/pdf).
  const withoutExt = base.replace(/\.[^.]+$/, "");
  const safe = withoutExt
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return safe || "file";
};

const buildKey = (userId: string, folder: string, mime: string, originalName: string): string => {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  // ext lấy từ MIME là nguồn duy nhất — sanitizeName chỉ lo phần "name".
  return `uploads/${userId}/${folder}/${yyyy}-${mm}/${randomUUID()}-${sanitizeName(originalName)}.${mimeToExt(mime)}`;
};

let bucketReady: Promise<void> | null = null;

const ensureBucketOnce = (): Promise<void> => {
  if (!bucketReady) {
    bucketReady = ensureBucket().catch((err: unknown) => {
      bucketReady = null;
      throw err;
    });
  }
  return bucketReady;
};

const putBuffer = async (input: UploadInput, key: string): Promise<void> => {
  await ensureBucketOnce();
  await s3.putObject(env.S3_BUCKET, key, input.buffer, input.buffer.length, {
    "Content-Type": input.mime,
    "Content-Disposition": buildContentDisposition(input.originalName, input.mime),
    "Cache-Control": "private, max-age=0, no-cache",
  });
};

export const uploadService = {
  uploadImage: async (input: UploadInput): Promise<UploadResult> => {
    const folder = normalizeFolder(input.folder ?? "images");
    const key = buildKey(input.userId, folder, input.mime, input.originalName);
    await putBuffer(input, key);
    return {
      url: getPublicUrl(key),
      key,
      mime: input.mime,
      size: input.buffer.length,
    };
  },

  uploadFile: async (input: UploadInput): Promise<UploadResult> => {
    const folder = normalizeFolder(input.folder ?? "files");
    const key = buildKey(input.userId, folder, input.mime, input.originalName);
    await putBuffer(input, key);
    return {
      url: getPublicUrl(key),
      key,
      mime: input.mime,
      size: input.buffer.length,
    };
  },

  deleteObject: async (key: string, callerUserId: string, callerRole: ViewerRole): Promise<void> => {
    if (!key || typeof key !== "string") {
      throw new AppError(400, "KEY_REQUIRED", "key query param is required");
    }
    if (key.includes("..") || key.startsWith("/")) {
      throw new AppError(400, "INVALID_KEY", "Invalid key");
    }
    const prefix = `uploads/${callerUserId}/`;
    if (callerRole !== "admin" && !key.startsWith(prefix)) {
      throw new AppError(403, "KEY_FORBIDDEN", "You can only delete objects you uploaded");
    }
    await ensureBucketOnce();
    await s3.removeObject(env.S3_BUCKET, key);
  },
};
