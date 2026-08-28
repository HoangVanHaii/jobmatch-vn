/**
 * Dispatcher cho chatbot handlers: map type → handler function.
 * Phase 1: 1 file = 1 handler, đăng ký ở đây.
 */
import type { ChatType, HandlerContext, HandlerFn, HandlerSection } from '../types';

import { cvHandler } from './cv';
import { jdHandler } from './jd';
import { cvMatchHandler } from './cvMatch';
import { searchHandler } from './search';
import { billingPlanHandler } from './billingPlan';
import { applicationHandler } from './application';
import { interviewHandler } from './interview';
import { accountHandler } from './account';
import { systemInfoHandler } from './systemInfo';
import { generalHandler } from './general';

export const HANDLERS: Record<ChatType, HandlerFn> = {
  cv: cvHandler,
  jd: jdHandler,
  cv_jd_match: cvMatchHandler,
  search: searchHandler,
  billing_plan: billingPlanHandler,
  application: applicationHandler,
  interview: interviewHandler,
  account: accountHandler,
  system_info: systemInfoHandler,
  general: generalHandler,
};

/**
 * Chạy tuần tự tất cả handlers trong `types[]`.
 * Handler throw → section fallback với content giải thích lỗi.
 */
export const dispatchHandlers = async (
  ctx: HandlerContext,
  types: ChatType[],
): Promise<HandlerSection[]> => {
  const sections: HandlerSection[] = [];
  for (const t of types) {
    const fn = HANDLERS[t];
    if (!fn) continue;
    try {
      const section = await fn(ctx);
      if (section && section.content.trim().length > 0) {
        sections.push(section);
      }
    } catch (err) {
      sections.push({
        label: t,
        citeData: true,
        content: `(Lỗi khi truy vấn dữ liệu cho intent "${t}". Bot sẽ trả lời dựa trên phần còn lại.)`,
      });
    }
  }
  // Luôn có 1 section general ở cuối nếu rỗng — đảm bảo LLM cuối biết phần tự do cần trả lời.
  if (!sections.some((s) => s.label === 'general')) {
    sections.push({ label: 'general', citeData: false, content: '' });
  }
  return sections;
};
