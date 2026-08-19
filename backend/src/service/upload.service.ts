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
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "doc",
  };
  return map[mime] ?? "bin";
};

const sanitizeName = (original: string): string => {
  const base = path.basename(original);
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
  return safe || "file";
};

const buildKey = (userId: string, folder: string, mime: string, originalName: string): string => {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
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
