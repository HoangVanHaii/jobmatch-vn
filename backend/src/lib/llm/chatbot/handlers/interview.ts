/**
 * Handler cho intent `interview` — lịch phỏng vấn sắp tới.
 * Phase 1: chỉ candidate-side.
 */
import type { HandlerContext, HandlerSection } from '../types';
import { interviewService } from '../../../../service/interview.service';

type InterviewRow = Awaited<ReturnType<typeof interviewService.listByCandidate>>[number];

export const interviewHandler = async (ctx: HandlerContext): Promise<HandlerSection> => {
  let rows: InterviewRow[];
  try {
    rows = await interviewService.listByCandidate(ctx.userId, { upcoming: true, limit: 10 });
  } catch {
    return {
      label: 'interview',
      citeData: true,
      content: 'Hệ thống tạm thời không truy vấn được lịch phỏng vấn. Bạn thử lại sau.',
    };
  }

  if (!rows.length) {
    return {
      label: 'interview',
      citeData: true,
      content: 'User chưa có lịch phỏng vấn nào sắp tới trên JobMatch.',
    };
  }

  const blocks = rows.map((r, i) => {
    const at = new Date(r.scheduledAt).toLocaleString('vi-VN');
    const dur = r.durationMin ? `${r.durationMin} phút` : '';
    const where = r.meetingLink ? `Link: ${r.meetingLink}` : r.location ? `Tại: ${r.location}` : '';
    return `Lịch #${i + 1}: ${r.jobTitle ?? '(tin đã xoá)'} tại ${r.companyName ?? '(đã xoá)'}
- Thời gian: ${at}${dur ? ' (' + dur + ')' : ''}
- Trạng thái: ${r.status ?? 'pending'}
- ${where || '(chưa có địa điểm)'}`;
  });

  return {
    label: 'interview',
    citeData: true,
    content: `${rows.length} lịch phỏng vấn sắp tới của user:\n\n${blocks.join('\n\n')}`,
  };
};
