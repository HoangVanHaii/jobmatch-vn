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

export const ensureBucket = async (): Promise<void> => {
  const exists = await s3.bucketExists(env.S3_BUCKET).catch(() => false);
  if (!exists) {
    await s3.makeBucket(env.S3_BUCKET, 'us-east-1');
    logger.info({ bucket: env.S3_BUCKET }, 'Created S3 bucket');
  }
};

export const getPublicUrl = (key: string): string =>
  `${process.env.S3_PUBLIC_URL || `http://${env.S3_ENDPOINT}:${env.S3_PORT}`}/${env.S3_BUCKET}/${key}`;