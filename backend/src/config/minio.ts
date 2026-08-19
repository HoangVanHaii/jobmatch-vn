/**
 * MinIO / S3 client — file storage (CV files, avatars, logos)
 */
import { Client as MinioClient } from 'minio';
import { env } from './env';
import { logger } from './logger';

export const s3 = new MinioClient({
  endPoint: env.S3_ENDPOINT,
  port: parseInt(env.S3_PORT, 10),
  useSSL: false,
  accessKey: process.env.S3_ACCESS_KEY || 'jobmatch_minio',
  secretKey: process.env.S3_SECRET_KEY || 'jobmatch_minio_pwd',
});

/**
 * Public-read policy cho bucket — cho phép GET object không cần signature.
 * Cần thiết để iframe / thẻ <img> / trình duyệt GET file trực tiếp qua URL public.
 * Bucket phải ở cùng network nội bộ (dev) hoặc CDN-style (prod) — không expose
 * qua internet public.
 */
const PUBLIC_READ_POLICY = (bucket: string): string => JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: { AWS: ['*'] },
      Action: ['s3:GetObject'],
      Resource: [`arn:aws:s3:::${bucket}/*`],
    },
  ],
});

export const ensureBucket = async (): Promise<void> => {
  const exists = await s3.bucketExists(env.S3_BUCKET).catch(() => false);
  if (!exists) {
    await s3.makeBucket(env.S3_BUCKET, 'us-east-1');
    logger.info({ bucket: env.S3_BUCKET }, 'Created S3 bucket');
  }
  // Set bucket policy public-read (idempotent — set lại nếu đã có).
  // Nếu bucket do service khác quản lý và policy rỗng, lệnh này sẽ tạo mới.
  try {
    await s3.setBucketPolicy(env.S3_BUCKET, PUBLIC_READ_POLICY(env.S3_BUCKET));
  } catch (err) {
    logger.warn({ bucket: env.S3_BUCKET, err }, 'Failed to set bucket public-read policy');
  }
};

/**
 * Tạo public URL cho một object key.
 * - Nếu `S3_PUBLIC_URL` đã trỏ thẳng tới bucket (vd. `http://host:port/bucket`)
 *   → dùng nguyên si, chỉ append key.
 * - Nếu không có → fallback build từ endpoint + bucket.
 *
 * Lưu ý: KHÔNG concat thêm `S3_BUCKET` khi `S3_PUBLIC_URL` đã có bucket — tránh
 * URL bị lặp `bucket/bucket/key`.
 */
export const getPublicUrl = (key: string): string => {
  const publicUrl = process.env.S3_PUBLIC_URL;
  if (publicUrl) {
    return `${publicUrl.replace(/\/+$/, '')}/${key}`;
  }
  return `http://${env.S3_ENDPOINT}:${env.S3_PORT}/${env.S3_BUCKET}/${key}`;
};