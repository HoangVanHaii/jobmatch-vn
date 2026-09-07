/**
 * JWT helpers — sign + verify + refresh rotation
 */
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { db } from '../config/database';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';

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

  // S4 + S11 FIX: check user còn active không (chưa bị ban / suspend / soft-delete).
  // Trước đây: chỉ check jti tồn tại → admin ban user nhưng user vẫn refresh
  // token thành công, tiếp tục dùng app được.
  const user = await db.query.users.findFirst({
    where: eq(users.id, payload.userId),
    columns: { status: true, deletedAt: true },
  });
  if (!user || user.deletedAt || user.status !== 'active') {
    // User không còn active → revoke refresh token luôn để không tái sử dụng.
    // Bug P2-3 FIX: throw AppError thay vì new Error để errorHandler trả 401 (đúng ngữ nghĩa
    // "auth issue") thay vì 500 ("server error"). Frontend sẽ logout user → redirect /login.
    await redis.del(`refresh:${payload.jti}`);
    if (!user || user.deletedAt) {
      throw new AppError(401, 'USER_DELETED', 'Tài khoản đã bị xóa.');
    }
    if (user.status === 'pending') {
      throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Email chưa được xác thực.');
    }
    throw new AppError(403, 'USER_INACTIVE', 'Tài khoản không còn hoạt động. Vui lòng liên hệ hỗ trợ.');
  }

  return payload;
};

export const revokeRefreshToken = async (token: string): Promise<void> => {
  const payload = jwt.decode(token) as any;
  if (payload?.jti) await redis.del(`refresh:${payload.jti}`);
};