/**
 * Helper dựng câu hiển thị tiếng Việt (snapshot lúc thông báo xảy ra) cho notification.
 * Đồng bộ với formatSummary ở frontend.
 *
 * Quy tắc:
 * - Không dùng các từ mặc định chung chung kiểu 'vị trí việc làm', 'Ứng viên', 'doanh nghiệp'.
 * - Dựng câu dựa trên các dữ liệu thực có; thiếu dữ liệu thì tinh gọn câu, không ghép rác.
 * - Chuẩn hóa tránh lặp từ "vị trí vị trí" hoặc "Ứng viên Ứng viên".
 */

export const sanitizeJobTitle = (val?: unknown): string | null => {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^vị\s+trí\s+/i, '').trim();
};

export const sanitizeCandidateName = (val?: unknown): string | null => {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^ứng\s+viên\s+/i, '').trim();
};

export const sanitizeText = (val?: unknown): string | null => {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed ? trimmed : null;
};

export function buildNotificationMessage(
  type: string,
  payload: Record<string, unknown> = {},
  fallbackTitle: string = 'Thông báo'
): string {
  const p = payload ?? {};
  if (typeof p.summary === 'string' && p.summary.trim()) return p.summary.trim();
  if (typeof p.message === 'string' && p.message.trim()) return p.message.trim();

  const candidateName = sanitizeCandidateName(p.candidateName);
  const jobTitle = sanitizeJobTitle(p.jobTitle);
  const companyName = sanitizeText(p.companyName);

  switch (type) {
    case 'application_new': {
      if (candidateName && jobTitle) {
        return `Hồ sơ mới từ ${candidateName} ứng tuyển vị trí ${jobTitle}`;
      }
      if (candidateName) {
        return `Hồ sơ mới từ ${candidateName}`;
      }
      if (jobTitle) {
        return `Hồ sơ ứng tuyển mới cho vị trí ${jobTitle}`;
      }
      return 'Hồ sơ ứng tuyển mới';
    }

    case 'application_withdrawn': {
      if (candidateName && jobTitle) {
        return `Ứng viên ${candidateName} đã rút hồ sơ ứng tuyển vị trí ${jobTitle}`;
      }
      if (candidateName) {
        return `Ứng viên ${candidateName} đã rút hồ sơ ứng tuyển`;
      }
      if (jobTitle) {
        return `Hồ sơ ứng tuyển cho vị trí ${jobTitle} đã được rút`;
      }
      return 'Hồ sơ ứng tuyển đã được rút';
    }

    case 'application_match_ready': {
      const matchPercent = typeof p.matchPercent === 'number' ? p.matchPercent : null;
      if (jobTitle) {
        if (matchPercent !== null) {
          return `AI Matching đã chấm ${matchPercent}% độ phù hợp cho vị trí ${jobTitle}`;
        }
        return `Hồ sơ ứng tuyển đã được ghi nhận, đánh giá AI Matching sẽ được cập nhật sau cho vị trí ${jobTitle}`;
      }
      if (matchPercent !== null) {
        return `AI Matching đã chấm ${matchPercent}% độ phù hợp cho hồ sơ của bạn`;
      }
      return 'Hồ sơ ứng tuyển đã được ghi nhận, đánh giá AI Matching sẽ được cập nhật sau';
    }

    case 'interview_scheduled': {
      if (jobTitle) {
        return `Lịch phỏng vấn mới đã được thiết lập cho vị trí ${jobTitle}`;
      }
      return 'Lịch phỏng vấn mới đã được thiết lập';
    }

    case 'interview_updated': {
      if (jobTitle) {
        return `Lịch phỏng vấn cho vị trí ${jobTitle} đã được cập nhật`;
      }
      return 'Lịch phỏng vấn đã được cập nhật';
    }

    case 'interview_cancelled': {
      const kind = p.kind as string | undefined;
      if (kind === 'interview_declined_by_candidate') {
        if (candidateName && jobTitle) {
          return `Ứng viên ${candidateName} đã từ chối lịch phỏng vấn cho vị trí ${jobTitle}`;
        }
        if (candidateName) {
          return `Ứng viên ${candidateName} đã từ chối lịch phỏng vấn`;
        }
        if (jobTitle) {
          return `Ứng viên đã từ chối lịch phỏng vấn cho vị trí ${jobTitle}`;
        }
        return 'Ứng viên đã từ chối lịch phỏng vấn';
      }
      if (kind === 'interview_cancelled_by_hr') {
        if (jobTitle) {
          return `Lịch phỏng vấn cho vị trí ${jobTitle} đã bị huỷ`;
        }
        return 'Lịch phỏng vấn đã bị huỷ';
      }

      // Fallback cho dòng cũ (không có kind) — heuristic qua candidateName
      if (candidateName) {
        if (jobTitle) {
          return `Ứng viên ${candidateName} đã từ chối lịch phỏng vấn cho vị trí ${jobTitle}`;
        }
        return `Ứng viên ${candidateName} đã từ chối lịch phỏng vấn`;
      }
      if (jobTitle) {
        return `Lịch phỏng vấn cho vị trí ${jobTitle} đã bị huỷ`;
      }
      return 'Lịch phỏng vấn đã bị huỷ';
    }

    case 'message':
      return 'Bạn có tin nhắn mới trong phòng trao đổi';

    case 'company':
    case 'company_invite': {
      const kind = p.kind as string;
      if (kind === 'company_invite_sent') {
        return companyName
          ? `Lời mời tham gia công ty ${companyName}`
          : 'Lời mời tham gia công ty';
      }
      if (kind === 'company_invite_accepted') {
        return companyName
          ? `Thành viên đã chấp nhận lời mời tham gia ${companyName}`
          : 'Thành viên đã chấp nhận lời mời tham gia công ty';
      }
      if (kind === 'company_invite_declined') {
        return companyName
          ? `Lời mời tham gia công ty ${companyName} đã bị từ chối`
          : 'Lời mời tham gia công ty đã bị từ chối';
      }
      if (kind === 'removed_from_company') {
        return companyName
          ? `Bạn đã bị xoá khỏi danh sách thành viên của ${companyName}`
          : 'Bạn đã bị xoá khỏi danh sách thành viên của công ty';
      }
      return fallbackTitle;
    }

    case 'job_match': {
      if (jobTitle) {
        return `Gợi ý hồ sơ tiềm năng phù hợp tiêu chí tuyển dụng ${jobTitle}`;
      }
      return 'Gợi ý hồ sơ tiềm năng phù hợp';
    }

    case 'system': {
      if (p.planId) return 'Gói dịch vụ tuyển dụng Employer đã được cập nhật';
      if (p.topic === 'terms-2026') return 'Cập nhật tiêu chuẩn an toàn bảo mật dữ liệu 2026';
      if (p.kind === 'invite_auto_cancelled_on_create_company') {
        return 'Lời mời của bạn đã bị huỷ do thành viên đã tạo công ty riêng';
      }
      return (typeof fallbackTitle === 'string' && fallbackTitle.trim()) || 'Thông báo hệ thống';
    }

    case 'reference_verified': {
      const refereeName = sanitizeText(p.refereeName);
      const isConfirmed = p.confirmed === true;
      const targetPos = jobTitle ? ` cho vị trí ${jobTitle}` : '';

      if (isConfirmed) {
        if (refereeName) {
          return `${refereeName} đã xác nhận tham chiếu${targetPos}`;
        }
        return `Tham chiếu đã được xác nhận${targetPos}`;
      } else {
        if (refereeName) {
          return `${refereeName} đã từ chối xác nhận tham chiếu${targetPos}`;
        }
        return `Tham chiếu đã bị từ chối${targetPos}`;
      }
    }

    default:
      return (typeof fallbackTitle === 'string' && fallbackTitle.trim()) || 'Thông báo';
  }
}
