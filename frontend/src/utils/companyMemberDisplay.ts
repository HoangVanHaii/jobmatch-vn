/**
 * Helper hiển thị thuần cho danh sách thành viên — dùng chung bởi
 * CompanyMembersView và các component con (header, toolbar, table).
 * Không chứa state/logic nghiệp vụ — chỉ format dữ liệu CompanyMember.
 */
import { formatDate } from './format';
import type {
  CompanyMember,
  CompanyMemberRole,
  CompanyMemberStatus,
} from '@/types/companyMember';

/** Action item cho menu "⋯" trên mỗi row — handler do View cung cấp. */
export interface RowActionItem {
  label: string;
  danger?: boolean;
  handler: () => void;
}

/** Rút gọn ID: 8 ký tự đầu + … + 4 ký tự cuối. */
export const truncateId = (id: string, head = 8, tail = 4): string => {
  if (id.length <= head + tail + 3) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
};

/** Tên hiển thị đầy đủ (fallback → ID rút gọn) — dùng cho aria-label/title. */
export const displayName = (row: CompanyMember): string =>
  row.user?.fullName ?? row.user?.email ?? `ID: ${truncateId(row.userId)}`;

/** Tên hiển thị dòng 1 (fallback: phần trước @ của email). */
export const primaryName = (row: CompanyMember): string => {
  if (row.user?.fullName) return row.user.fullName;
  if (row.user?.email) return row.user.email.split('@')[0];
  return truncateId(row.userId);
};

/** Ngày ngắn dd/MM/yyyy. */
export const formatShortDate = (input: string | null | undefined): string => {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

/**
 * Nhãn + ngày theo trạng thái:
 *   - active   → "Tham gia" (respondedAt, fallback invitedAt)
 *   - pending  → "Mời" (invitedAt)
 *   - lịch sử  → "Kết thúc" (endedAt, fallback invitedAt)
 */
export const dateMeta = (
  row: CompanyMember,
): { label: string; short: string; title: string } => {
  let iso = row.invitedAt;
  let label = 'Mời';
  if (row.status === 'active') {
    label = 'Tham gia';
    iso = row.respondedAt ?? row.invitedAt;
  } else if (row.status !== 'pending') {
    label = 'Kết thúc';
    iso = row.endedAt ?? row.invitedAt;
  }
  const title = formatDate(iso);
  return { label, short: formatShortDate(iso) || title, title };
};

/** 2 chữ cái viết tắt cho avatar fallback (tên → email → ID). */
export const initials = (row: CompanyMember): string => {
  const name = row.user?.fullName ?? row.user?.email ?? '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return truncateId(row.userId).charAt(0).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

/**
 * Bảng màu pastel cho avatar không có ảnh — nền 100 + chữ 700 cùng tông
 * (đủ tương phản, cùng phong cách). Màu được chọn **ổn định theo userId**
 * (hash FNV-1a đơn giản): cùng thành viên luôn cùng màu qua mọi lần
 * render/chuyển tab, các thành viên khác nhau phân bổ đa dạng.
 */
const AVATAR_PALETTES: ReadonlyArray<{ bg: string; text: string }> = [
  { bg: 'bg-violet-100', text: 'text-violet-700' },
  { bg: 'bg-blue-100', text: 'text-blue-700' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  { bg: 'bg-teal-100', text: 'text-teal-700' },
  { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  { bg: 'bg-rose-100', text: 'text-rose-700' },
  { bg: 'bg-amber-100', text: 'text-amber-700' },
];

export const avatarColor = (row: CompanyMember): string => {
  // FNV-1a trên userId — đủ phân tán cho phân màu, không cần thư viện.
  let hash = 2166136261;
  for (let i = 0; i < row.userId.length; i++) {
    hash ^= row.userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const palette = AVATAR_PALETTES[Math.abs(hash % AVATAR_PALETTES.length)];
  return `${palette.bg} ${palette.text}`;
};

export const STATUS_LABELS: Record<CompanyMemberStatus, string> = {
  pending: 'Đã mời',
  active: 'Đang hoạt động',
  declined: 'Đã từ chối',
  removed: 'Đã bị xoá',
  left: 'Đã rời công ty',
  auto_cancelled: 'Bị huỷ tự động',
};

export const ROLE_LABELS: Record<CompanyMemberRole, string> = {
  owner: 'Chủ sở hữu',
  member: 'Thành viên',
};

/** Badge trạng thái — palette slate, 4 trạng thái kết thúc phân biệt bằng chữ. */
export const STATUS_BADGE: Record<CompanyMemberStatus, { cls: string }> = {
  pending: { cls: 'bg-amber-50 text-amber-700' },
  active: { cls: 'bg-emerald-50 text-emerald-700' },
  declined: { cls: 'bg-slate-100 text-slate-600' },
  removed: { cls: 'bg-red-50 text-red-700' },
  left: { cls: 'bg-white text-slate-800 ring-1 ring-inset ring-slate-300' },
  auto_cancelled: { cls: 'bg-slate-100 text-slate-500' },
};
