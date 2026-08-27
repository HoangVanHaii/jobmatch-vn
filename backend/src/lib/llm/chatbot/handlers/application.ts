/**
 * Handler cho intent `application` — hồ sơ user đã nộp.
 * Phase 1: chỉ candidate-side, list 10 hồ sơ gần nhất.
 */
import type { HandlerContext, HandlerSection } from '../types';
import { jobApplicationService } from '../../../../service/jobApplication.service';

type ApplicationRow = Awaited<ReturnType<typeof jobApplicationService.listByCandidate>>[number];

export const applicationHandler = async (ctx: HandlerContext): Promise<HandlerSection> => {
  let rows: ApplicationRow[];
  try {
    rows = await jobApplicationService.listByCandidate(ctx.userId, 10);
  } catch {
    return {
      label: 'application',
      citeData: true,
      content: 'Hệ thống tạm thời không truy vấn được hồ sơ. Bạn thử lại sau.',
    };
  }

  if (!rows.length) {
    return {
      label: 'application',
      citeData: true,
      content: 'User chưa nộp hồ sơ nào trên JobMatch. Gợi ý họ tìm job ở trang chủ và bấm "Nộp hồ sơ".',
    };
  }

  const blocks = rows.map((r, i) => {
    const applied = new Date(r.appliedAt).toLocaleDateString('vi-VN');
    const viewed = r.viewedAt ? new Date(r.viewedAt).toLocaleDateString('vi-VN') : 'chưa xem';
    const match = r.aiMatchScore != null ? `${r.aiMatchScore}%` : 'chưa chấm';
    return `Hồ sơ #${i + 1}: ${r.jobTitle ?? '(tin đã xoá)'} tại ${r.companyName ?? '(đã xoá)'}
- Trạng thái: ${r.status}${r.stage ? ` (giai đoạn: ${r.stage})` : ''}
- AI match: ${match}
- Ngày nộp: ${applied}
- Nhà tuyển dụng xem: ${viewed}
- Application ID: ${r.applicationId}
- Job ID: ${r.jobId}`;
  });

  return {
    label: 'application',
    citeData: true,
    content: `${rows.length} hồ sơ gần nhất của user:\n\n${blocks.join('\n\n')}`,
  };
};
