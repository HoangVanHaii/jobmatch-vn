/**
 * JWT helpers — sign + verify + refresh rotation
 */
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { redis } from '../config/redis';
import { env } from '../config/env';

interface JwtPayload {
  userId: string;
  role: 'candidate' | 'employer' | 'admin';
  email: string;
}

export const signAccessToken = (payload: JwtPayload): string =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRES_IN as any });

export const signRefreshToken = (payload: JwtPayload): string => {
  const jti = crypto.randomBytes(16).toString('hex');
  const token = jwt.sign({ ...payload, jti }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as any,
  });
  // Lưu vào Redis để có thể revoke
  redis.setex(`refresh:${jti}`, 7 * 24 * 3600, payload.userId);
  return token;
};

export const verifyAccessToken = (token: string): JwtPayload =>
  jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;

export const verifyRefreshToken = async (token: string): Promise<JwtPayload> => {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload & { jti: string };
  const exists = await redis.exists(`refresh:${payload.jti}`);
  if (!exists) throw new Error('Refresh token revoked');
  return payload;
};

export const revokeRefreshToken = async (token: string): Promise<void> => {
  const payload = jwt.decode(token) as any;
  if (payload?.jti) await redis.del(`refresh:${payload.jti}`);
};