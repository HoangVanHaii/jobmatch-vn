/**
 * Handler cho intent `jd` — trả lời dựa trên Job user đã gắn vào context.
 *
 * Doc §4.3: job bị đóng sau khi user attach → vẫn trả lời dựa trên snapshot,
 * kèm warning `"Job này hiện ở trạng thái 'closed' — dưới đây là data lúc bạn attach"`.
 */
import type { HandlerContext, HandlerSection } from '../types';
import { toJobLink } from '../markdown';

const formatSalary = (j: HandlerContext['jobs'][number]): string => {
  if (!j.salaryVisible) return 'Nhà tuyển dụng không công khai';
  if (!j.salaryMin && !j.salaryMax) return 'Không nêu';
  const min = j.salaryMin ?? '?';
  const max = j.salaryMax ?? '?';
  return `${min}–${max} ${j.salaryCurrency ?? 'VND'}`;
};

const formatLocation = (j: HandlerContext['jobs'][number]): string => {
  const loc = j.location ?? {};
  return loc.city || loc.district || loc.address ? `${loc.city ?? ''}${loc.district ? ', ' + loc.district : ''}` : 'Không nêu';
};

const formatOneJob = (j: HandlerContext['jobs'][number], index: number): string => {
  // Wrap title trong markdown link sang `/jobs/<id>` — frontend render qua
  // `marked.parse()` thành `<a>` click được. Job ID đã có trong URL nên không
  // hiển thị riêng trong section.
  const titleLink = toJobLink(j.title, j.id);
  return `Job #${index + 1}:
- Tiêu đề: ${titleLink}
- Trạng thái: ${j.status} ${j.status === 'closed' ? '⚠️' : ''}
- Cấp độ: ${j.jobLevel ?? 'Không nêu'}
- Loại hình: ${j.jobType ?? 'Không nêu'}
- Ngành: ${j.industry ?? 'Không nêu'}
- Lương: ${formatSalary(j)}
- Địa điểm: ${formatLocation(j)} ${j.remoteOk ? '(remote OK)' : ''}
- Kinh nghiệm tối thiểu: ${j.experienceYearsMin ?? 'Không nêu'} năm
- Kỹ năng bắt buộc: ${j.requiredSkills?.length ? j.requiredSkills.join(', ') : 'Không nêu'}
- Kỹ năng ưu tiên: ${j.niceToHaveSkills?.length ? j.niceToHaveSkills.join(', ') : 'Không nêu'}
- Yêu cầu: ${j.requirements?.slice(0, 800) ?? '(chưa có)'}${(j.requirements?.length ?? 0) > 800 ? '…(rút gọn)' : ''}
- Phúc lợi: ${j.benefits?.slice(0, 400) ?? '(chưa có)'}${(j.benefits?.length ?? 0) > 400 ? '…(rút gọn)' : ''}
- Hạn nộp: ${j.deadline ? new Date(j.deadline).toLocaleDateString('vi-VN') : 'Không nêu'}
- Ngày đăng: ${j.publishedAt
    ? new Date(j.publishedAt).toLocaleDateString('vi-VN')
    : j.createdAt
    ? `${new Date(j.createdAt).toLocaleDateString('vi-VN')} (tạo lúc)`
    : 'Không nêu'}
- Lượt xem: ${typeof j.viewsCount === 'number' ? j.viewsCount.toLocaleString('vi-VN') : 'Không nêu'}
- Lượt nộp hồ sơ: ${typeof j.appliesCount === 'number' ? j.appliesCount.toLocaleString('vi-VN') : 'Không nêu'}`;
};

export const jdHandler = async (ctx: HandlerContext): Promise<HandlerSection> => {
  if (ctx.jobIds.length === 0) {
    return {
      label: 'jd',
      citeData: true,
      content: 'User chưa gắn job nào vào context. Hãy hướng dẫn họ chọn job ở picker phía trên khung chat.',
    };
  }
  if (ctx.jobs.length === 0) {
    return {
      label: 'jd',
      citeData: true,
      content: 'Job user đã gắn không tìm thấy (có thể đã đóng/expired). Gợi ý user chọn lại job khác.',
    };
  }

  const hasClosed = ctx.jobs.some((j) => j.status === 'closed');
  const blocks = ctx.jobs.map((j, i) => formatOneJob(j, i));
  const warning = hasClosed
    ? '⚠️ Cảnh báo: có job trong context hiện đã ở trạng thái "closed". Dữ liệu dưới đây là bản ghi tại thời điểm attach — user nên cân nhắc.\n\n'
    : '';

  return {
    label: 'jd',
    citeData: true,
    content: `${warning}Dữ liệu Job user đã gắn vào context (tổng ${ctx.jobs.length}/${ctx.jobIds.length} job — id chưa tìm thấy có thể đã bị xoá):\n\n${blocks.join('\n\n')}`,
  };
};
