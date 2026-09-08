/**
 * Format utilities dùng chung cho admin pages.
 *
 * Không có sẵn trong project (các file .vue hiện tại tự format inline).
 * Gom lại để 3 admin pages dùng chung — tránh lặp code.
 */

export type UserRole = 'candidate' | 'employer' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'pending' | 'banned';

/** Role → label tiếng Việt cho admin UI. */
export const roleLabel = (role: UserRole): string => {
  switch (role) {
    case 'candidate': return 'Ứng viên';
    case 'employer': return 'Nhà tuyển dụng';
    case 'admin': return 'Quản trị viên';
  }
};

/** Status → label tiếng Việt. */
export const userStatusLabel = (status: UserStatus | string): string => {
  switch (status) {
    case 'active': return 'Đang hoạt động';
    case 'suspended': return 'Tạm khoá';
    case 'pending': return 'Chờ kích hoạt';
    case 'banned': return 'Đã cấm';
    default: return status;
  }
};

/** Job status → label tiếng Việt. Dùng cho toast, modal, badge — đồng bộ toàn app. */
export const jobStatusLabel = (status: string): string => {
  switch (status) {
    case 'draft': return 'Bản nháp';
    case 'pending': return 'Chờ duyệt';
    case 'ai_scanning': return 'AI đang quét';
    case 'ai_flagged': return 'AI cảnh báo';
    case 'live': return 'Đang tuyển';
    case 'expired': return 'Hết hạn';
    case 'closed': return 'Đã đóng';
    default: return status;
  }
};

/**
 * Format ngày kiểu "07/09/2026" — dùng cho joined/last activity columns.
 * Trả '—' nếu invalid.
 */
export const formatDate = (iso: string | Date | null | undefined): string => {
  if (!iso) return '—';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
};

/**
 * Relative time tiếng Việt — "vừa xong", "5 phút trước", "3 giờ trước",
 * "2 ngày trước", "1 tháng trước". Dùng cho last activity.
 */
export const relativeTime = (iso: string | Date | null | undefined): string => {
  if (!iso) return '—';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 30) return 'vừa xong';
  if (sec < 60) return `${sec} giây trước`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} phút trước`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} giờ trước`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} ngày trước`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} tháng trước`;
  const year = Math.floor(month / 12);
  return `${year} năm trước`;
};

/** Initials cho avatar fallback — lấy 1-2 chữ cái đầu của tên. */
export const initialsFromName = (name: string | null | undefined, email?: string): string => {
  const src = (name ?? '').trim() || (email ?? '').split('@')[0];
  if (!src) return '?';
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

/**
 * Bỏ dấu tiếng Việt (và các dấu combining khác) — cho search tolerant.
 * "Nguyễn Văn A" → "Nguyen Van A", cho phép user gõ "nguyen" match "Nguyễn".
 *
 * Cách: tách ký tự gốc + combining mark (NFD), rồi strip mark.
 * Đơn giản, không cần thư viện như `unidecode` — chỉ xử lý diacritics Latin cơ bản
 * (đủ cho tên + email tiếng Việt). Ký tự ngoài Latin (Hán Nôm, v.v.) sẽ giữ nguyên.
 */
export const removeDiacritics = (str: string): string =>
  str.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * "Hôm nay" / "Hôm qua" / formatted date — dùng cho metric "Mới trong X ngày".
 * Trả true nếu date rơi vào last N ngày.
 */
export const isWithinDays = (iso: string | Date | null | undefined, days: number): boolean => {
  if (!iso) return false;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return d.getTime() >= cutoff;
};
