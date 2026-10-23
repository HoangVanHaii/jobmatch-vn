/**
 * companyProfileUtils.ts — Các hàm tiện ích và kiểu dữ liệu thuần cho hồ sơ công ty.
 * Không phụ thuộc DOM hay Vue reactivity.
 */
import {
  Facebook,
  Github,
  Globe,
  Instagram,
  Linkedin,
  Twitter,
  Youtube,
} from 'lucide-vue-next';
import type { Company, UpdateCompanyPayload } from '@/types/company';

export interface CompanyProfile {
  name: string;
  industry: string;
  size: string;
  website: string;
  province: string;
  district: string;
  address: string;
  description: string;
  logoUrl: string | null;
  /** Object key/value giống `CompanySocial` trong CompanyView.vue. */
  social: Record<string, string>;
}

/** Chuyển response Company sang shape dùng riêng cho giao diện hồ sơ công ty. */
export const companyToProfile = (company: Company): CompanyProfile => {
  const address = company.address ?? {};
  return {
    name: company.name,
    industry: company.industry ?? '',
    size: company.sizeRange ?? '',
    website: company.website ?? '',
    province: typeof address.city === 'string' ? address.city : '',
    district: typeof address.district === 'string' ? address.district : '',
    address: typeof address.address === 'string' ? address.address : '',
    description: company.description ?? '',
    logoUrl: company.logoUrl ?? null,
    social: { ...(company.social ?? {}) },
  };
};

/** Chuẩn hóa profile thành payload PATCH, giữ logo hiện có nếu không upload mới. */
export const profileToUpdatePayload = (profile: CompanyProfile): UpdateCompanyPayload => ({
  name: profile.name.trim(),
  industry: profile.industry.trim(),
  sizeRange: profile.size.trim(),
  website: profile.website.trim() || undefined,
  description: profile.description.trim(),
  social: { ...profile.social },
  address: {
    city: profile.province,
    district: profile.district,
    address: profile.address.trim(),
  },
});

/** Sao chép sâu 1 mức, tách tham chiếu `social` để draft không mutate profile. */
export const cloneProfile = (p: CompanyProfile): CompanyProfile => ({
  ...p,
  social: { ...p.social },
});

/** Lấy 1–2 chữ cái đầu làm viết tắt logo, bỏ các tiền tố pháp nhân phổ biến. */
export const NAME_PREFIXES = [
  'công ty cổ phần',
  'công ty tnhh',
  'công ty',
  'cổ phần',
  'trách nhiệm hữu hạn',
  'tnhh',
];

export function getInitials(name: string): string {
  let n = name.trim();
  let stripped = true;
  while (stripped) {
    stripped = false;
    const lower = n.toLowerCase();
    for (const p of NAME_PREFIXES) {
      if (lower.startsWith(p)) {
        n = n.slice(p.length).trim();
        stripped = true;
        break;
      }
    }
  }
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

export const SOCIAL_META: Record<string, { label: string; icon: typeof Globe }> = {
  linkedin: { label: 'LinkedIn', icon: Linkedin },
  facebook: { label: 'Facebook', icon: Facebook },
  github: { label: 'GitHub', icon: Github },
  twitter: { label: 'X / Twitter', icon: Twitter },
  x: { label: 'X / Twitter', icon: Twitter },
  youtube: { label: 'YouTube', icon: Youtube },
  instagram: { label: 'Instagram', icon: Instagram },
  website: { label: 'Website', icon: Globe },
};

export const getSocialMeta = (key: string): { label: string; icon: typeof Globe } => {
  const normalized = key.toLowerCase().trim();
  return SOCIAL_META[normalized] ?? { label: key, icon: Globe };
};

/**
 * Chuẩn hóa URL mockup:
 * - rỗng hoặc chứa khoảng trắng → '' (không hợp lệ)
 * - đã có http(s):// → giữ nguyên
 * - scheme khác (javascript:, data:, mailto:…) → '' (chặn link lạ);
 *   "host:port" (vd localhost:3000) không bị coi là scheme vì port là chữ số.
 * - còn lại thêm https://
 */
export const normalizeUrl = (raw: string): string => {
  const v = raw.trim();
  if (!v || /\s/.test(v)) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(v)) return '';
  return `https://${v}`;
};

/** URL hợp lệ: normalizeUrl OK, protocol http/https, hostname có "." hoặc localhost. */
export const isValidUrl = (raw: string): boolean => {
  const u = normalizeUrl(raw);
  if (!u) return false;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return parsed.hostname.includes('.') || parsed.hostname === 'localhost';
  } catch {
    return false;
  }
};

export interface KvRow {
  id: number;
  key: string;
  value: string;
}

let kvIdCounter = 0;

export function nextKvId(): number {
  return ++kvIdCounter;
}

/** Object social → rows cho form nhập liệu. */
export const socialToRows = (social?: Record<string, string> | null): KvRow[] =>
  Object.entries(social ?? {}).map(([key, value]) => ({ id: nextKvId(), key, value }));

/**
 * Rows → object social: key trim + lowercase; bỏ hàng key rỗng HOẶC value rỗng;
 * key trùng thì hàng sau ghi đè hàng trước.
 */
export const rowsToSocial = (rows: KvRow[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const k = r.key.trim().toLowerCase();
    if (!k || !r.value.trim()) continue;
    out[k] = r.value.trim();
  }
  return out;
};

