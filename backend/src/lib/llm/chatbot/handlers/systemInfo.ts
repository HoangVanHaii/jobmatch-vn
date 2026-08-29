/**
 * Handler cho intent `system_info` — FAQ cách dùng sàn.
 *
 * Doc §3.1: chưa có data FAQ → fallback general.
 * Phase 2 sẽ có `system_docs` table + RAG.
 */
import type { HandlerContext, HandlerSection } from '../types';

export const systemInfoHandler = async (ctx: HandlerContext): Promise<HandlerSection> => {
  return {
    label: 'system_info',
    citeData: false,
    content:
      'Phần FAQ "cách dùng JobMatch" hiện đang cập nhật. Trong thời gian này, bạn cứ hỏi tự do — chatbot sẽ cố gắng trả lời dựa trên dữ liệu sẵn có.\n\nMột số thao tác nhanh: tải CV ở menu CV của tôi; rút hồ sơ ở trang Applications; cập nhật hồ sơ ở Cài đặt.',
  };
};
