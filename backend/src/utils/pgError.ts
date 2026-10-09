/**
 * Trích Postgres error code từ error có thể bị bọc nhiều lớp (M-01 fix).
 *
 * drizzle-orm 0.45 bọc driver error trong `DrizzleQueryError` — mã Postgres
 * thật ('23505' unique_violation, '23503' foreign_key_violation, ...) nằm ở
 * `err.cause.code`, không phải `err.code`. Đọc `err.code` trực tiếp sẽ miss →
 * rơi xuống catch-all 500 thay vì 409/404.
 *
 * Duyệt chain `.cause` tối đa `maxDepth` cấp (mặc định 5), trả về `code`
 * đầu tiên là chuỗi đúng 5 ký tự (format mã lỗi Postgres). Không có → undefined.
 */
export const getPgErrorCode = (err: unknown, maxDepth = 5): string | undefined => {
  let cur: unknown = err;
  for (let depth = 0; depth <= maxDepth && cur != null; depth += 1) {
    if (typeof cur === 'object' && cur !== null) {
      const code = (cur as { code?: unknown }).code;
      if (typeof code === 'string' && code.length === 5) return code;
      cur = (cur as { cause?: unknown }).cause ?? null;
    } else {
      break;
    }
  }
  return undefined;
};
