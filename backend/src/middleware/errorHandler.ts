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
 * Nếu không map được (edge case chưa cover) → trả thông báo chung tiếng Việt,
 * tránh lộ message nội bộ của Zod ra production UI.
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
    if (field === 'password') return 'Mật khẩu không được để trống';
    if (field === 'newPassword') return 'Mật khẩu mới phải có ít nhất 8 ký tự';
  }

  // String length (too_big)
  if (code === 'too_big') {
    if (field === 'fullName') return 'Họ và tên không được vượt quá 100 ký tự';
    // Bonus polish kèm Bug 1 FIX (emailSchema.max(254)): map too_big cho email
    // để message cụ thể thay vì fall through về 'Dữ liệu không hợp lệ' generic.
    if (field === 'email') return 'Email không được vượt quá 254 ký tự';
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

  return 'Dữ liệu không hợp lệ';
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
      // Bug 5 FIX (audit 2026-09-27): khi client gửi sai Content-Type (vd `text/plain`
      // thay vì `application/json`), express.json() trả về `req.body = {}` rỗng →
      // Zod nhận empty object → throw với path=[] → fieldPath='_root'. Trước fix:
      // translateZodIssue path='_root' + message='Required' → return fieldLabels['_root']
      // → '_root là bắt buộc' (lộ implementation, UX kém).
      // Giờ: nếu fieldPath='_root' + mọi issue đều 'Required' → trả message
      // thân thiện hơn. Detect bằng cách check req.body có empty không.
      if (fieldPath === '_root' && issue.message === 'Required' &&
          (!req.body || (typeof req.body === 'object' && Object.keys(req.body).length === 0))) {
        // Skip — sẽ trả message thân thiện ở ngoài
        continue;
      }
      if (!translatedDetails[fieldPath]) translatedDetails[fieldPath] = [];
      const translated = translateZodIssue(fieldPath, issue.code, issue.message);
      // Tránh duplicate cùng message cho cùng field
      if (!translatedDetails[fieldPath].includes(translated)) {
        translatedDetails[fieldPath].push(translated);
      }
    }
    // Bug 5 FIX (cont.): nếu mọi issue bị skip (req.body rỗng do Content-Type sai),
    // trả message thân thiện thay vì để `details: { _root: [...] }` lủng củng.
    const hasContent = Object.keys(translatedDetails).length > 0;
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: hasContent
          ? 'Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.'
          : 'Định dạng request không hợp lệ. Vui lòng kiểm tra Content-Type và body.',
        details: hasContent ? translatedDetails : undefined,
      },
    });
    return;
  }

  // Custom AppError
  if (err instanceof AppError) {
    // Wrap single `field` thành `details: { [field]: [message] }` để FE dùng
    // cùng một path (getFirstFieldError) cho mọi error envelope — không cần
    // phân biệt ZodError vs AppError. Trước đây field name bị gửi qua property
    // `field` riêng nhưng FE không đọc → silent dead contract.
    const details = err.field ? { [err.field]: [err.message] } : undefined;
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, details },
    });
    return;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token không hợp lệ hoặc đã hết hạn' } });
    return;
  }

  // express.json() body-parser error khi client gửi body không phải JSON hợp lệ
  // (vd: `{not-valid-json`, body trống, thiếu dấu nháy, ...). Trước fix: error
  // rơi xuống catch-all → 500 INTERNAL_ERROR (misleading: là client bug, không
  // phải server bug). Detect qua 2 cách:
  //   1. `err.type === 'entity.parse.failed'` — Express body-parser đánh dấu cụ thể.
  //   2. `err instanceof SyntaxError` — fallback cho các edge case parser khác.
  // Chỉ log warning (không error) vì đây là client mistake, không phải lỗi server.
  // KHÔNG expose vị trí parse (vd "position 5") ra response — tránh leak request shape.
  const isEntityParseFailed = (err as any)?.type === 'entity.parse.failed';
  const isSyntaxError = err instanceof SyntaxError;
  if (isEntityParseFailed || isSyntaxError) {
    logger.warn({ path: req.path, method: req.method }, 'Malformed JSON body');
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Request body không phải JSON hợp lệ. Vui lòng kiểm tra cú pháp.',
      },
    });
    return;
  }

  // Unknown error — log to sentry in prod
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ nội bộ' } });
};
