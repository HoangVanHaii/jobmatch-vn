/**
 * Env validation — fail-fast nếu thiếu biến bắt buộc
 */
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.string().default("5000"),
  APP_URL: z.string().url(),
  FRONTEND_URL: z.string().url(),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  ENCRYPTION_KEY: z.string().min(32),

  // AI
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(768),
  /** Single Gemini model cho mọi task (moderation / generation / parsing). */
  GEMINI_CHAT_MODEL: z.string().default("gemini-2.5-flash"),

  // OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  // Storage
  S3_ENDPOINT: z.string().default("localhost"),
  S3_PORT: z.string().default("9000"),
  S3_BUCKET: z.string().default("jobmatch-uploads"),

  // Email
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.string().default("1025"),
  SMTP_FROM: z.string().default("no-reply@jobmatch.vn"),

  // PAYOS
  PAYOS_CLIENT_ID: z.string().min(1),
  PAYOS_API_KEY: z.string().min(1),
  PAYOS_CHECKSUM_KEY: z.string().min(1),
  PAYOS_WEBHOOK_URL: z.string().url(),
  PAYOS_RETURN_URL: z.string().url(),
  PAYOS_CANCEL_URL: z.string().url(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;