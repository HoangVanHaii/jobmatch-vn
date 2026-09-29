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
  const key = `refresh:${payload.jti}`;

  // Audit 2026-09-28 follow-up (A3b FIX): atomic GET+DEL qua Lua script.
  // Trước fix: redis.exists + (DB user check) + revokeRefreshToken (redis.del)
  // là 2+ round-trip tách biệt → race window. 5 concurrent refresh cùng T1 →
  // tất cả pass exists check trước khi bất kỳ DEL nào fire → tất cả đều tạo
  // token mới, rotation/reuse detection vô hiệu.
  //
  // Sau fix: Lua `GETDEL` (Redis 6.2+) chạy atomic trong 1 round-trip:
  //   - Nếu key tồn tại → trả value + xóa key
  //   - Nếu key không tồn tại → trả nil
  // Race: chỉ request đầu tiên nhận value; 4 còn lại nhận nil → TOKEN_REVOKED.
  //
  // Lua fallback (Redis <6.2):
  //   local v = redis.call("GET", KEYS[1])
  //   if v then redis.call("DEL", KEYS[1]) end
  //   return v
  const lua = `
    local v = redis.call("GET", KEYS[1])
    if v then
      redis.call("DEL", KEYS[1])
    end
    return v
  `;
  const ownerId = (await redis.eval(lua, 1, key)) as string | null;

  // Bug 2 FIX (audit 2026-09-27): trước đây throw plain Error → errorHandler không
  // nhận diện được, rơi vào nhánh INTERNAL_ERROR 500. Giờ throw AppError 401
  // để FE unwrap đúng HttpError + interceptor 401 flow (clear localStorage +
  // redirect /login) chạy đồng nhất với các case auth khác (USER_DELETED ở
  // line dưới, USER_INACTIVE ở line dưới).
  //
  // Case thực tế trigger nhánh này:
  //   - User login → T1/J1 → refresh → T2/J2, J1 đã bị del (atomic ở đây).
  //   - Concurrent request trước rotation vẫn dùng T1 → 401 ngay.
  //     Hoặc T1 bị attacker replay giữa rotation → 401 ngay.
  //   - Token bị admin revoke thủ công.
  if (!ownerId) {
    throw new AppError(401, 'TOKEN_REVOKED', 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.');
  }

  // S4 + S11 FIX: check user còn active không (chưa bị ban / suspend / soft-delete).
  // Trước đây: chỉ check jti tồn tại → admin ban user nhưng user vẫn refresh
  // token thành công, tiếp tục dùng app được.
  // Lưu ý: sau A3b fix, key đã bị DEL ngay khi atomic GET+DEL — không cần DEL lại.
  const user = await db.query.users.findFirst({
    where: eq(users.id, payload.userId),
    columns: { status: true, deletedAt: true },
  });
  if (!user || user.deletedAt || user.status !== 'active') {
    // Token đã DEL trong Lua ở trên. Chỉ phân loại error cho FE.
    // Bug P2-3 FIX: throw AppError thay vì new Error để errorHandler trả 401 (đúng ngữ nghĩa
    // "auth issue") thay vì 500 ("server error"). Frontend sẽ logout user → redirect /login.
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