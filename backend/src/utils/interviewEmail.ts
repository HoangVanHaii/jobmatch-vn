import { mailer } from '../config/mail';

/** Format giờ phỏng vấn theo múi giờ Asia/Ho_Chi_Minh: 14:30 ngày 12/10/2026 */
export const formatVietnamDateTime = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  const formatter = new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hourCycle: 'h23',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  const parts = formatter.formatToParts(d);
  const find = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = find('hour');
  const minute = find('minute');
  const day = find('day');
  const month = find('month');
  const year = find('year');
  return `${hour}:${minute} ngày ${day}/${month}/${year}`;
};

export const INTERVIEW_TYPE_LABELS: Record<string, string> = {
  screening: 'Phỏng vấn sơ loại (Screening)',
  technical: 'Phỏng vấn kỹ thuật (Technical)',
  coding: 'Phỏng vấn lập trình (Coding)',
  system_design: 'Thiết kế hệ thống (System Design)',
  hr: 'Phỏng vấn nhân sự (HR Interview)',
  culture_fit: 'Phù hợp văn hóa (Culture Fit)',
  panel: 'Phỏng vấn hội đồng (Panel Interview)',
  final: 'Phỏng vấn vòng cuối (Final Interview)',
  other: 'Phỏng vấn',
};

export const getInterviewTypeLabel = (type?: string | null): string => {
  if (!type) return 'Phỏng vấn chuyên môn';
  return INTERVIEW_TYPE_LABELS[type] || type;
};

export interface SendInterviewFallbackEmailParams {
  candidateEmail: string;
  candidateName: string;
  jobTitle: string;
  companyName: string;
  interviewType?: string | null;
  scheduledAt: Date;
  durationMin: number;
  meetingLink?: string | null;
  location?: string | null;
  notes?: string;
  confirmUrl: string;
}

/**
 * Gửi email mời phỏng vấn trực tiếp bằng Nodemailer khi n8n workflow không khả dụng
 */
export const sendInterviewFallbackEmail = async (params: SendInterviewFallbackEmailParams): Promise<void> => {
  const timeFormatted = formatVietnamDateTime(params.scheduledAt);
  const isOnline = Boolean(params.meetingLink);
  const typeLabel = getInterviewTypeLabel(params.interviewType);

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #1e293b;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: #1769e8; margin: 0; font-size: 22px;">JobMatch VN</h2>
        <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">Cầu nối việc làm thông minh</p>
      </div>

      <p style="font-size: 15px; line-height: 1.6;">Xin chào <strong>${params.candidateName}</strong>,</p>
      <p style="font-size: 15px; line-height: 1.6;">
        Chúc mừng bạn! Công ty <strong>${params.companyName}</strong> trân trọng mời bạn tham dự buổi <strong>${typeLabel}</strong> cho vị trí <strong>${params.jobTitle}</strong>.
      </p>

      <div style="background-color: #f8fafc; border-left: 4px solid #1769e8; padding: 16px; border-radius: 6px; margin: 20px 0;">
        <p style="margin: 0 0 8px 0; font-size: 14px;"><strong>Vòng phỏng vấn:</strong> <span style="background-color: #eff6ff; color: #1d4ed8; padding: 3px 8px; border-radius: 4px; font-weight: 600; font-size: 13px;">${typeLabel}</span></p>
        <p style="margin: 0 0 8px 0; font-size: 14px;"><strong>Thời gian:</strong> ${timeFormatted} (Khoảng ${params.durationMin} phút)</p>
        <p style="margin: 0 0 8px 0; font-size: 14px;"><strong>Hình thức:</strong> ${isOnline ? 'Phỏng vấn Online (Google Meet)' : 'Phỏng vấn trực tiếp'}</p>
        ${params.location ? `<p style="margin: 0 0 8px 0; font-size: 14px;"><strong>Địa điểm:</strong> ${params.location}</p>` : ''}
        ${params.notes ? `<p style="margin: 0; font-size: 14px;"><strong>Ghi chú:</strong> ${params.notes}</p>` : ''}
      </div>

      ${
        isOnline && params.meetingLink
          ? `
      <div style="margin: 20px 0; padding: 12px; background-color: #f1f5f9; border-radius: 8px; text-align: center;">
        <p style="margin: 0 0 6px 0; font-size: 13px; color: #475569;">Phòng họp trực tuyến:</p>
        <a href="${params.meetingLink}" target="_blank" style="color: #1769e8; font-weight: 600; text-decoration: none; word-break: break-all;">${params.meetingLink}</a>
      </div>
      `
          : ''
      }

      <div style="text-align: center; margin: 30px 0 20px 0;">
        <a href="${params.confirmUrl}&action=confirm" target="_blank" style="display: inline-block; background-color: #1769e8; color: #ffffff; padding: 12px 28px; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 8px; margin: 0 6px;">
          Xác nhận tham gia
        </a>
        <a href="${params.confirmUrl}&action=reschedule" target="_blank" style="display: inline-block; background-color: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; padding: 12px 20px; font-size: 14px; font-weight: 500; text-decoration: none; border-radius: 8px; margin: 0 6px;">
          Đề xuất lại lịch
        </a>
      </div>

      <p style="font-size: 14px; line-height: 1.6; color: #475569;">
        Vui lòng sắp xếp thời gian và chuẩn bị thiết bị/kết nối mạng ổn định trước giờ hẹn 5 - 10 phút.
      </p>

      <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
      <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
        Thư này được gửi tự động từ hệ thống JobMatch VN. Nếu bạn có thắc mắc, vui lòng liên hệ nhà tuyển dụng.
      </p>
    </div>
  `;

  await mailer.sendMail({
    from: process.env.SMTP_FROM || `"JobMatch VN" <${process.env.SMTP_USER}>`,
    to: params.candidateEmail,
    subject: `[JobMatch] Thư mời [${typeLabel}] vị trí ${params.jobTitle} - ${params.companyName}`,
    html,
  });
};

