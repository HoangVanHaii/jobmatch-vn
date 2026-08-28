/**
 * Handler cho intent `general` — câu hỏi ngoài nghiệp vụ JobMatch.
 *
 * Không cần query data → return section rỗng, LLM cuối sẽ tự trả lời tự do.
 */
import type { HandlerContext, HandlerSection } from '../types';

export const generalHandler = async (ctx: HandlerContext): Promise<HandlerSection> => {
  return {
    label: 'general',
    citeData: false,
    content: '',
  };
};
