/**
 * Handler cho intent `cv` — trả lời dựa trên CV user đã gắn vào context.
 *
 * cvIds đã owner-filtered ở service.streamTurn → gọi `cvService.getManyByIds`.
 * Nếu không có CV rỗng hoặc thiếu parsedData → section giải thích cho LLM nói
 * user cần upload CV trước.
 *
 * formatOneCv dump đủ 8 nhóm trường của `cvParsedDataSchema` (xem
 * `backend/src/lib/llm/cvParse.ts`) để LLM cuối trả lời được mọi câu hỏi
 * liên quan CV (kể cả "kể về kinh nghiệm ở công ty X", "có bao nhiêu project",
 * "linkedin của bạn là gì", …). Mô tả dài được cắt ở 300 chars / mục để
 * tránh prompt phình khi user có CV nhiều trang.
 */
import type { HandlerContext, HandlerSection } from '../types';

const trimText = (s: unknown, max = 300): string => {
  if (typeof s !== 'string' || !s.trim()) return '(không có)';
  return s.length > max ? `${s.slice(0, max)}…(rút gọn)` : s;
};

const formatPeriod = (start: unknown, end: unknown): string => {
  const s = typeof start === 'string' && start.trim() ? start : null;
  const e = typeof end === 'string' && end.trim() ? end : '(hiện tại)';
  if (!s && !end) return '(không rõ)';
  return `${s ?? '?'} → ${e}`;
};

const formatExperience = (
  items: Array<{
    company?: string;
    position?: string;
    startDate?: string;
    endDate?: string | null;
    description?: string;
  }> | undefined,
): string => {
  if (!Array.isArray(items) || items.length === 0) return '  (chưa có)';
  return items
    .map((e, i) => {
      const lines: string[] = [];
      lines.push(`  ${i + 1}. ${e.position ?? '(không rõ vị trí)'} @ ${e.company ?? '(không rõ công ty)'}`);
      lines.push(`     - Thời gian: ${formatPeriod(e.startDate, e.endDate)}`);
      lines.push(`     - Mô tả: ${trimText(e.description)}`);
      return lines.join('\n');
    })
    .join('\n');
};

const formatEducation = (
  items: Array<{
    school?: string;
    degree?: string;
    major?: string;
    startYear?: number;
    endYear?: number;
    description?: string;
  }> | undefined,
): string => {
  if (!Array.isArray(items) || items.length === 0) return '  (chưa có)';
  return items
    .map((e, i) => {
      const lines: string[] = [];
      lines.push(`  ${i + 1}. ${e.school ?? '(không rõ trường)'}`);
      if (e.degree || e.major) {
        lines.push(`     - Bằng: ${[e.degree, e.major].filter(Boolean).join(' - ') || '(không rõ)'}`);
      }
      if (e.startYear || e.endYear) {
        lines.push(`     - Thời gian: ${e.startYear ?? '?'} → ${e.endYear ?? '(hiện tại)'}`);
      }
      if (e.description) {
        lines.push(`     - Mô tả: ${trimText(e.description)}`);
      }
      return lines.join('\n');
    })
    .join('\n');
};

const formatProjects = (
  items: Array<{ name?: string; description?: string; link?: string }> | undefined,
): string => {
  if (!Array.isArray(items) || items.length === 0) return '  (chưa có)';
  return items
    .map((p, i) => {
      const lines: string[] = [];
      lines.push(`  ${i + 1}. ${p.name ?? '(không đặt tên)'}`);
      if (p.link) lines.push(`     - Link: ${p.link}`);
      if (p.description) lines.push(`     - Mô tả: ${trimText(p.description)}`);
      return lines.join('\n');
    })
    .join('\n');
};

const formatCertifications = (
  items: Array<{ name?: string; issuer?: string; date?: string }> | undefined,
): string => {
  if (!Array.isArray(items) || items.length === 0) return '  (chưa có)';
  return items
    .map((c, i) => {
      const parts = [c.name ?? '(không đặt tên)'];
      if (c.issuer) parts.push(c.issuer);
      if (c.date) parts.push(c.date);
      return `  ${i + 1}. ${parts.join(' | ')}`;
    })
    .join('\n');
};

const formatLanguages = (
  items: Array<{ language?: string; proficiency?: string }> | undefined,
): string => {
  if (!Array.isArray(items) || items.length === 0) return '  (chưa có)';
  return items
    .map((l) => `  - ${l.language ?? '(không rõ)'}${l.proficiency ? ` (${l.proficiency})` : ''}`)
    .join('\n');
};

const formatOneCv = (cv: HandlerContext['cvs'][number], index: number): string => {
  const data = cv.parsedData ?? {};
  const skills = Array.isArray(data.skills) && data.skills.length > 0 ? data.skills.join(', ') : '(chưa có)';
  const summary = trimText(data.summary, 800);

  const lines: string[] = [];
  lines.push(`CV #${index + 1}:`);
  lines.push(`- Tiêu đề: ${cv.title ?? '(không đặt)'}`);
  lines.push(`- Trạng thái: ${cv.status ?? '(không rõ)'}`);
  if (cv.fileUrl) lines.push(`- File: ${cv.fileUrl}`);
  lines.push(`- Tên: ${data.name ?? '(chưa có)'}`);
  lines.push(`- Email: ${data.email ?? '(chưa có)'}`);
  lines.push(`- Điện thoại: ${data.phone ?? '(chưa có)'}`);
  lines.push(`- Portfolio: ${data.portfolio ?? '(chưa có)'}`);
  lines.push(`- Github: ${data.github ?? '(chưa có)'}`);
  lines.push(`- LinkedIn: ${data.linkedin ?? '(chưa có)'}`);
  lines.push(`- Facebook: ${data.facebook ?? '(chưa có)'}`);
  lines.push(`- Tóm tắt: ${summary}`);
  lines.push(`- Kỹ năng: ${skills}`);
  lines.push(`- Kinh nghiệm làm việc:\n${formatExperience(data.experience)}`);
  lines.push(`- Học vấn:\n${formatEducation(data.education)}`);
  lines.push(`- Dự án:\n${formatProjects(data.projects)}`);
  lines.push(`- Chứng chỉ:\n${formatCertifications(data.certifications)}`);
  lines.push(`- Ngôn ngữ:\n${formatLanguages(data.languages)}`);
  return lines.join('\n');
};

export const cvHandler = async (ctx: HandlerContext): Promise<HandlerSection> => {
  if (ctx.cvIds.length === 0) {
    return {
      label: 'cv',
      citeData: true,
      content: 'User chưa gắn CV nào vào context. Hãy hướng dẫn họ chọn CV ở picker phía trên khung chat.',
    };
  }
  if (ctx.cvs.length === 0) {
    return {
      label: 'cv',
      citeData: true,
      content: 'CV user đã gắn không tìm thấy (có thể đã bị xoá hoặc chưa parse xong). Hãy gợi ý user tải CV mới.',
    };
  }

  const blocks = ctx.cvs.map((cv, i) => formatOneCv(cv, i));
  return {
    label: 'cv',
    citeData: true,
    content: `Dữ liệu CV user đã gắn vào context (tổng ${ctx.cvs.length}/${ctx.cvIds.length} CV — các id còn lại có thể chưa sẵn sàng):\n\n${blocks.join('\n\n')}`,
  };
};
