/**
 * Handler cho intent `account` — hỗ trợ tài khoản cá nhân (đổi email, xoá TK, cài đặt).
 *
 * Doc §2: ngoài phạm vi phase 1 → static fallback, không gọi LLM.
 * Nếu cần self-service ở phase 2 sẽ build flow riêng.
 */
import type { HandlerContext, HandlerSection } from '../types';

export const accountHandler = async (ctx: HandlerContext): Promise<HandlerSection> => {
  return {
    label: 'account',
    citeData: false,
    content:
      'Yêu cầu về tài khoản (đổi email, đổi mật khẩu, xoá tài khoản, bật thông báo…) hiện không xử lý tự động qua chatbot.\n\nHướng dẫn: liên hệ support@jobmatch.vn hoặc mở Cài đặt → Tài khoản trong menu.',
  };
};
