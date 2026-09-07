import { redis } from '../config/redis';
import { mailer } from '../config/mail';
import { OtpPurpose } from '../types/otp.type';
import { otpTemplate } from '../templates/otp.html';
import { AppError } from '../middleware/errorHandler';
import crypto from 'crypto';

const OTP_TTL_SECONDS = 5 * 60;        // OTP sống 5 phút
const RESEND_COOLDOWN_SECONDS = 60;    // tối thiểu 60s giữa 2 lần gửi
const MAX_ATTEMPTS = 5;                // tối đa 5 lần nhập sai / OTP

// D3 FIX: Map purpose sang Tiếng Việt cho subject email. Trước đây subject
// `Your ${purpose} OTP` toàn tiếng Anh + lộ purpose type → dễ bị đánh dấu spam
// và attacker biết context flow.
const purposeLabels: Record<OtpPurpose, string> = {
    login: 'đăng nhập',
    register: 'đăng ký tài khoản',
    reset_password: 'đặt lại mật khẩu',
};

export const otpService = {
    requestOtp: async (email: string, purpose: OtpPurpose): Promise<void> => {
        // Cooldown gửi mail — chặn resend liên tiếp / email-bomb
        const cooldownKey = `otp:lastsent:${purpose}:${email}`;
        if (await redis.exists(cooldownKey)) {
            throw new AppError(429, 'RESEND_COOLDOWN', 'Vui lòng đợi trước khi yêu cầu mã mới');
        }

        const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
        const key = `otp:${purpose}:${email}`;
        const attemptsKey = `otp:attempts:${purpose}:${email}`;

        await redis.setex(key, OTP_TTL_SECONDS, code);        // OTP mới
        await redis.del(attemptsKey);                          // reset bộ đếm thử sai
        await redis.setex(cooldownKey, RESEND_COOLDOWN_SECONDS, '1');

        // S5 FIX: wrap mailer.sendMail trong try/catch. Nếu SMTP fail (timeout,
        // network, server down) → OTP đã lưu Redis nhưng user không nhận được mail.
        // Cleanup OTP + cooldown để user retry ngay không bị stuck 60s.
        try {
            await mailer.sendMail({
                from: process.env.SMTP_FROM || 'noreply@yourapp.com',
                to: email,
                subject: `[JobMatch VN] Mã xác thực ${purposeLabels[purpose]} của bạn`,
                html: otpTemplate(code, purpose),
            });
        } catch (mailErr) {
            // Rollback OTP + cooldown khi gửi mail thất bại
            await redis.del(key);
            await redis.del(cooldownKey);
            throw new AppError(
                500,
                'EMAIL_SEND_FAILED',
                'Không thể gửi email. Vui lòng thử lại sau ít phút.',
            );
        }
    },

    verifyOtp: async (email: string, purpose: OtpPurpose, otp: string): Promise<void> => {
        const key = `otp:${purpose}:${email}`;
        const attemptsKey = `otp:attempts:${purpose}:${email}`;

        // Giới hạn thử sai theo email (rate-limit IP là chưa đủ)
        const attempts = await redis.get(attemptsKey);
        if (attempts && parseInt(attempts, 10) >= MAX_ATTEMPTS) {
            await redis.del(key); // vô hiệu hóa OTP khi đã lock
            throw new AppError(429, 'OTP_TOO_MANY_ATTEMPTS', 'Bạn đã nhập sai quá nhiều lần. Vui lòng yêu cầu mã mới.');
        }

        const storedOtp = await redis.get(key);
        if (!storedOtp) {
            throw new AppError(400, 'OTP_EXPIRED', 'OTP đã hết hạn hoặc không tồn tại');
        }

        // Guard độ dài trước timingSafeEqual — nếu lệch độ dài sẽ ném RangeError → 500
        const ok = otp.length === storedOtp.length
            && crypto.timingSafeEqual(Buffer.from(storedOtp), Buffer.from(otp));

        if (!ok) {
            const count = await redis.incr(attemptsKey);
            if (count === 1) await redis.expire(attemptsKey, OTP_TTL_SECONDS);
            throw new AppError(400, 'OTP_INVALID', 'OTP không hợp lệ');
        }

        // Đúng: xóa OTP + bộ đếm
        await redis.del(key);
        await redis.del(attemptsKey);
    },
} as const;
