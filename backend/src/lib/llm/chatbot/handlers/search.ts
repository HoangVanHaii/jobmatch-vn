/**
 * Handler cho intent `search` — semantic search jobs bằng pgvector.
 *
 * Theo doc §5: chỉ search theo câu user truyền, KHÔNG bổ sung từ profile.
 * Reuse `searchSimilarJobs` (lib/llm/jobEmbedding.ts) — threshold 0.55, limit 5.
 *
 * Edge case: top-k = 0 → section nói "chưa có job phù hợp" (không tốn LLM nói rỗng).
 */
import type { HandlerContext, HandlerSection } from '../types';
import { searchSimilarJobs } from '../../jobEmbedding';
import { toJobLink } from '../markdown';

type SearchRow = Awaited<ReturnType<typeof searchSimilarJobs>>[number];

export const searchHandler = async (ctx: HandlerContext): Promise<HandlerSection> => {
  const question = ctx.question.trim();
  if (!question) {
    return { label: 'search', citeData: true, content: 'Câu hỏi rỗng — không search được.' };
  }

  let rows: SearchRow[];
  try {
    rows = await searchSimilarJobs(question, { limit: 5, threshold: 0.6 });
  } catch {
    // Fail mềm: trả section "không có kết quả" thay vì ném lỗi đến user.
    return {
      label: 'search',
      citeData: true,
      content: 'Hệ thống search tạm thời không khả dụng. Bạn thử lại sau ít phút nhé.',
    };
  }

  if (!rows.length) {
    return {
      label: 'search',
      citeData: true,
      content: 'Hiện chưa có job nào trên sàn phù hợp với từ khoá "' + question + '". Bạn thử từ khoá khác (VD: thêm địa điểm, loại hình, mức lương).',
    };
  }

  const blocks = rows.map((r, i) => {
    const title = r.title ?? '(không có tiêu đề)';
    const salary =
      !r.salaryMin && !r.salaryMax
        ? 'không nêu'
        : `${r.salaryMin ?? '?'}–${r.salaryMax ?? '?'} ${r.salaryCurrency ?? 'VND'}`;
    const loc = r.location?.city ?? r.location?.address ?? 'không nêu';
    const level = r.jobLevel ?? 'không nêu';
    const sim = typeof r.similarity === 'number' ? ` (độ tương đồng ${r.similarity.toFixed(2)})` : '';
    // Wrap title trong markdown link sang `/jobs/<id>` — frontend `marked.parse()`
    // sẽ render thành `<a>` click được. ID đã embed trong URL nên bỏ dòng "ID:" riêng.
    const titleLink = r.id ? toJobLink(title, r.id) : `"${title}"`;
    return `Top ${i + 1}: ${titleLink}${sim}
- Lương: ${salary}
- Địa điểm: ${loc}
- Cấp độ: ${level}`;
  });

  return {
    label: 'search',
    citeData: true,
    content: `Kết quả semantic search cho "${question}" (top 5):\n\n${blocks.join('\n\n')}`,
  };
};
