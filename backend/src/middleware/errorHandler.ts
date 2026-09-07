/**
 * Global error handler — convert error → JSON response chuẩn
 */
import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodIssueCode } from 'zod';
import { logger } from '../config/logger';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Map field name + Zod issue code → Vietnamese error message.
 * Dùng cho ZodError.flatten().fieldErrors (trả về { field: [msg1, msg2] }).
 *
 * Nếu không map được (edge case chưa cover) → fallback message EN để dev debug,
 * KHÔNG dùng cho production UI.
 */
const translateZodIssue = (path: string, code: ZodIssueCode, originalMessage: string): string => {
  const field = path.split('.').pop() ?? path;

  // Required (missing field)
  if (code === 'invalid_type' && originalMessage === 'Required') {
    const fieldLabels: Record<string, string> = {
      email: 'Email',
      password: 'Mật khẩu',
      newPassword: 'Mật khẩu mới',
      currentPassword: 'Mật khẩu hiện tại',
      otp: 'Mã OTP',
      fullName: 'Họ và tên',
      role: 'Vai trò',
      agreedToTerms: 'Đồng ý điều khoản',
    };
    return `${fieldLabels[field] ?? field} là bắt buộc`;
  }

  // Email format
  if (code === 'invalid_string' && originalMessage === 'Invalid email') {
    return 'Email không đúng định dạng';
  }

  // Password complexity (regex fail)
  if (field === 'password' || field === 'newPassword') {
    if (originalMessage.includes('at least 8 character')) return 'Mật khẩu phải có ít nhất 8 ký tự';
    if (originalMessage.includes('chữ hoa')) return 'Mật khẩu phải có ít nhất 1 chữ hoa';
    if (originalMessage.includes('chữ thường')) return 'Mật khẩu phải có ít nhất 1 chữ thường';
    if (originalMessage.includes('chữ số')) return 'Mật khẩu phải có ít nhất 1 chữ số';
    if (originalMessage.includes('at least 8')) return 'Mật khẩu phải có ít nhất 8 ký tự';
  }

  // String length (too_small)
  if (code === 'too_small') {
    if (field === 'fullName') return 'Họ và tên phải có ít nhất 2 ký tự';
    if (field === 'otp') return 'Mã OTP phải gồm 6 chữ số';
    if (field.includes('Password')) return `${field === 'newPassword' ? 'Mật khẩu mới' : 'Mật khẩu'} phải có ít nhất 8 ký tự`;
  }

  // String length (too_big)
  if (code === 'too_big') {
    if (field === 'fullName') return 'Họ và tên không được vượt quá 100 ký tự';
  }

  // Enum invalid (role, agreedToTerms)
  if (code === 'invalid_enum_value') {
    if (field === 'role') return 'Vai trò không hợp lệ';
    if (field === 'agreedToTerms') return 'Bạn phải đồng ý với Điều khoản và Chính sách bảo mật';
  }

  // Literal mismatch (agreedToTerms !== true)
  if (code === 'invalid_literal') {
    if (field === 'agreedToTerms') return 'Bạn phải đồng ý với Điều khoản và Chính sách bảo mật';
  }

  // Fallback: giữ message gốc (EN) cho dev debug
  return originalMessage;
};

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  // Zod validation — translate field errors sang VN.
  if (err instanceof ZodError) {
    const translatedDetails: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const fieldPath = issue.path.join('.') || '_root';
      if (!translatedDetails[fieldPath]) translatedDetails[fieldPath] = [];
      const translated = translateZodIssue(fieldPath, issue.code, issue.message);
      // Tránh duplicate cùng message cho cùng field
      if (!translatedDetails[fieldPath].includes(translated)) {
        translatedDetails[fieldPath].push(translated);
      }
    }
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.',
        details: translatedDetails,
      },
    });
    return;
  }

  // Custom AppError
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, field: err.field },
    });
    return;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token không hợp lệ hoặc đã hết hạn' } });
    return;
  }

  // Unknown error — log to sentry in prod
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ nội bộ' } });
};