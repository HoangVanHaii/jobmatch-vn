<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  AlertCircle,
  Banknote,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  ExternalLink,
  Factory,
  Facebook,
  FileText,
  Github,
  Globe,
  Hash,
  Image as ImageIcon,
  Instagram,
  Inbox,
  Link2,
  Linkedin,
  Loader2,
  Lock,
  MailCheck,
  MailPlus,
  MapPin,
  MapPinOff,
  Pencil,
  Plus,
  Share2,
  Trash2,
  Twitter,
  Users,
  X,
  Youtube,
} from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { useCompanyStore } from '@stores/company';
import { useAuthStore } from '@stores/auth';
import { useToastStore } from '@stores/toast';
import { useSocket } from '@composables/useSocket';
import { companyApi } from '@services/company.api';
import CreateCompanyModal from '@components/employer/CreateCompanyModal.vue';
import ImageUploadField from '@components/employer/ImageUploadField.vue';
import type {
  Company,
  CompanyAddress,
  CompanyInvite,
  CompanySocial,
  UpdateCompanyPayload,
} from '@/types/company';
import { useCompanyMemberStore } from '@stores/companyMember';
import { useLocations } from '@composables/useLocations';

/* ============================================================================
 * Stores
 * ==========================================================================*/
const route = useRoute();
const companyStore = useCompanyStore();
const { current, loading, error } = storeToRefs(companyStore);
const memberStore = useCompanyMemberStore();
const auth = useAuthStore();
const toast = useToastStore();

/* ============================================================================
 * State
 * ==========================================================================*/
/** Có 3 pha: 'loading' | 'no-company' | 'ready'. Dùng cho skeleton/empty/render. */
type LoadState = 'loading' | 'no-company' | 'ready';
const loadState = ref<LoadState>('loading');

const editMode = ref(false);
const saving = ref(false);
const formError = ref<string | null>(null);

/* ============================================================================
 * Pending invites (chỉ dùng khi loadState === 'no-company')
 *
 * Khi user chưa thuộc công ty nào, ta fetch thêm `GET /companies/me/invites`
 * để hiển thị danh sách lời mời đang chờ với nút Chấp nhận/Từ chối. Đây là
 * giải phóng điểm nghẽn UX trước đây (user được mời nhưng không có chỗ nào
 * để accept — chỉ thấy notification trong bell mà không có CTA).
 * ==========================================================================*/
const pendingInvites = ref<CompanyInvite[]>([]);
const invitesLoading = ref(false);
const invitesError = ref<string | null>(null);
const inviteActionId = ref<string | null>(null); // companyId đang xử lý action

/** Fetch invites song song với getMyCompany. Gọi lại mỗi lần reload. */
const fetchPendingInvites = async (): Promise<void> => {
  invitesLoading.value = true;
  invitesError.value = null;
  try {
    const { data } = await companyApi.getMyInvites();
    pendingInvites.value = data.data;
  } catch (e) {
    invitesError.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra.';
    pendingInvites.value = [];
  } finally {
    invitesLoading.value = false;
  }
};

/**
 * Realtime handlers:
 *
 * Notification type dùng cho company-member lifecycle là 'company' (sau refactor
 * 0032) với payload.kind phân biệt. Listener này phải match CẢ type mới lẫn
 * type cũ ('system' / 'company_invite' — rows trước migration 0032) để tránh
 * user phải F5 mới thấy cập nhật realtime.
 *
 * 1. Mời user vào company (`type='company_invite_sent'` legacy + `type='company'`
 *    + kind='company_invite_sent') → user vừa được owner mời, refetch pending
 *    invites để thấy invite mới ngay.
 *
 * 2. User vừa bị xoá / invite pending bị owner huỷ
 *    (kind: 'removed_from_company' / 'invite_cancelled') → reload
 *    getMyCompany() để phát hiện mất membership → state 'no-company' →
 *    show empty state + modal tạo công ty.
 *
 * 3. Member khác rời company hiện tại
 *    (kind: 'company_member_left') → refetch getMyCompany để update member
 *    count + hiển thị ở hero/stats (nếu có).
 *
 * 4. Invite mới bị auto-cancel khi user tạo company mới
 *    (kind: 'invite_auto_cancelled_on_create_company') → invite này không còn
 *    pending nữa, refetch danh sách để cập nhật UI.
 */
useSocket('notification:new', (n: unknown) => {
  const notif = n as {
    type?: string;
    payload?: { kind?: string; companyId?: string };
  };
  if (!notif) return;

  const type = notif.type;
  const kind = notif.payload?.kind;
  const isCompany = type === 'company';
  const isLegacyCompanyInvite = type === 'company_invite';

  // Case 1: có invite mới cho user hiện tại (legacy + type mới).
  if (isLegacyCompanyInvite || (isCompany && kind === 'company_invite_sent')) {
    if (loadState.value === 'no-company') {
      void fetchPendingInvites();
    }
    return;
  }

  // Case 2: user vừa bị xoá / invite pending bị huỷ.
  // Match cả type='company' (mới) lẫn 'system' (rows cũ).
  const isRemovedOrCancelled =
    (isCompany || type === 'system') &&
    (kind === 'removed_from_company' || kind === 'invite_cancelled');
  if (isRemovedOrCancelled) {
    void loadMyCompany();
    return;
  }

  // Case 3: member khác rời company hiện tại (cùng companyId).
  const isMemberLeft =
    (isCompany || type === 'system') &&
    kind === 'company_member_left' &&
    typeof notif.payload?.companyId === 'string' &&
    current.value?.id === notif.payload.companyId;
  if (isMemberLeft) {
    void loadMyCompany();
    return;
  }

  // Case 4: invite tự động bị huỷ khi user tạo company mới →
  // refetch để list pending bám sát server.
  const isAutoCancelled =
    (isCompany || type === 'system') &&
    kind === 'invite_auto_cancelled_on_create_company';
  if (isAutoCancelled) {
    if (loadState.value === 'no-company') {
      void fetchPendingInvites();
    }
  }
});

/** Chấp nhận invite → status='active' → reload full company.
 *
 * BE route `:userId/accept` yêu cầu userId trên URL (controller check
 * self-only) → truyền userId của chính user đang đăng nhập.
 */
const acceptInvite = async (invite: CompanyInvite): Promise<void> => {
  if (!auth.user) {
    toast.error('Phiên đăng nhập đã hết — vui lòng đăng nhập lại.');
    return;
  }
  inviteActionId.value = invite.companyId;
  try {
    const result = await memberStore.acceptInvite(invite.companyId, auth.user.id);
    if (result) {
      toast.success(`Đã chấp nhận lời mời tham gia ${invite.companyName}.`);
      // Reload page để chuyển sang "ready" state với full company view.
      await loadMyCompany();
    } else {
      toast.error(memberStore.error ?? 'Không thể chấp nhận lời mời.');
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Đã có lỗi xảy ra.');
  } finally {
    inviteActionId.value = null;
  }
};

/**
 * Từ chối invite → status='declined' → remove khỏi list.
 *
 * Bug 4 (optimistic + rollback): trước đây đợi server confirm xong mới filter
 * local → user đợi ~200-500ms cho mỗi click. Giờ filter NGAY (optimistic) rồi
 * rollback nếu server fail. UX mượt hơn, an toàn vì rollback đầy đủ.
 *
 * Cùng pattern với acceptInvite — phải truyền userId vì BE check self-only.
 */
const declineInvite = async (invite: CompanyInvite): Promise<void> => {
  if (!auth.user) {
    toast.error('Phiên đăng nhập đã hết — vui lòng đăng nhập lại.');
    return;
  }
  inviteActionId.value = invite.companyId;

  // Optimistic: snapshot + filter NGAY.
  const snapshot = pendingInvites.value;
  pendingInvites.value = pendingInvites.value.filter(
    (i) => i.companyId !== invite.companyId,
  );

  try {
    const result = await memberStore.declineMyInvite(invite.companyId, auth.user.id);
    if (result) {
      toast.success(`Đã từ chối lời mời từ ${invite.companyName}.`);
      // Server đã confirm, snapshot không cần rollback.
    } else {
      // Rollback + toast.
      pendingInvites.value = snapshot;
      toast.error(memberStore.error ?? 'Không thể từ chối lời mời.');
    }
  } catch (e) {
    // Rollback + toast.
    pendingInvites.value = snapshot;
    toast.error(e instanceof Error ? e.message : 'Đã có lỗi xảy ra.');
  } finally {
    inviteActionId.value = null;
  }
};

/**
 * Form state (reactive) — copy từ company khi vào edit, revert khi cancel.
 *
 * Address dùng 3 field chuẩn (provinceCode/district/streetAddress) khớp với
 * CreateCompanyModal pattern. Extra keys (lat/lng/custom...) lưu riêng trong
 * `extraAddress` để không bị mất khi save.
 */
interface FormState {
  name: string;
  logoUrl: string;
  description: string;
  industry: string;
  sizeRange: string;
  website: string;
  social: CompanySocial;
  /** Province code (number) — dùng để lookup district qua useLocations. */
  provinceCode: number | null;
  /** District name — set từ select dựa trên province đã chọn. */
  district: string;
  /** Địa chỉ cụ thể (số nhà, ngõ, đường). */
  streetAddress: string;
  /** Extra address keys không thuộc 3 field chuẩn — preserve khi save. */
  extraAddress: CompanyAddress;
}

const form = reactive<FormState>({
  name: '',
  logoUrl: '',
  description: '',
  industry: '',
  sizeRange: '',
  website: '',
  social: {},
  provinceCode: null,
  district: '',
  streetAddress: '',
  extraAddress: {},
});

/** Locations composable — load provinces/districts cho address select. */
const locations = useLocations();
const locationsLoading = ref(false);

/** KV row helper cho phần social edit (giữ nguyên — chỉ address đổi sang select). */
interface KvRow {
  key: string;
  value: string;
}
const socialRows = ref<KvRow[]>([]);

/** Fold/unfold cho card sections trên mobile. Mặc định mở hết. */
const expanded = reactive<Record<string, boolean>>({
  info: true,
  description: true,
  social: true,
  jobs: true,
});

/* ============================================================================
 * Create Company modal (chỉ hiện khi user chưa thuộc công ty nào)
 * ==========================================================================*/
const createModalOpen = ref(false);
const openCreateModal = (): void => {
  createModalOpen.value = true;
};

/* ============================================================================
 * Address — reactive helpers (khớp với CreateCompanyModal pattern)
 * ==========================================================================*/
/** Province shortName (vd "Hà Nội") được derive từ selectedProvinceCode.
 *  Watch province change → reset district + sync shortName vào form. */
const provinceShortName = computed<string>(() => {
  if (form.provinceCode === null) return '';
  const found = locations.items.value.find((p) => p.code === form.provinceCode);
  return found?.shortName ?? '';
});

/** Districts tương ứng với province đang chọn. */
const currentDistricts = computed(() => {
  if (form.provinceCode === null) return [];
  return locations.getDistricts(form.provinceCode);
});

/** Reset district khi province đổi (giống CreateCompanyModal).
 *  - District cũ có thể không thuộc province mới → reset để tránh bug.
 *  - city (provinceShortName) tự update qua computed. */
watch(
  () => form.provinceCode,
  () => {
    form.district = '';
  },
);

/** Address view mode — parse address Record → hiển thị city/district/address. */
const viewCity = computed<string>(() => {
  const a = current.value?.address;
  return typeof a?.city === 'string' ? a.city : '';
});
const viewDistrict = computed<string>(() => {
  const a = current.value?.address;
  return typeof a?.district === 'string' ? a.district : '';
});
const viewStreet = computed<string>(() => {
  const a = current.value?.address;
  return typeof a?.address === 'string' ? a.address : '';
});
const hasAddressValue = computed<boolean>(
  () => !!(viewCity.value || viewDistrict.value || viewStreet.value),
);
/**
 * BE POST /companies trả full Company + tự insert user tạo làm owner trong cùng
 * tx → sau khi tạo xong, fetchById lại để có jobs[] và đồng bộ state.
 */
/**
 * Khi user tạo công ty mới qua modal:
 *   - Reload full page state (getMyCompany + fetchById) để đảm bảo UI đồng bộ
 *     với BE — fix bug "page không reload sau create" trong một số edge case.
 *   - Toast success.
 *
 * Tham số `created` không dùng trực tiếp — loadMyCompany() tự lấy company.
 */
const onCompanyCreated = async (_created: Company): Promise<void> => {
  await loadMyCompany();
  toast.success('Đã tạo công ty thành công.');
};

/* ============================================================================
 * Permission helpers (UX only — BE vẫn là lớp enforce cuối)
 * ==========================================================================*/
/**
 * Row của current user trong company này (lấy từ memberStore cache).
 * Dùng để check role — chỉ owner mới có quyền edit.
 */
const currentUserMember = computed(() => {
  const cid = current.value?.id;
  const uid = auth.user?.id;
  if (!cid || !uid) return null;
  const list = memberStore.getMembers(cid);
  return list.find((m) => m.userId === uid) ?? null;
});

/** Current user có phải active owner của company không? */
const isCurrentUserOwner = computed<boolean>(() => {
  const m = currentUserMember.value;
  return !!m && m.role === 'owner' && m.status === 'active';
});

/**
 * User có quyền edit company không?
 *
 * Chỉ owner active HOẶC admin mới thấy nút "Chỉnh sửa". BE enforce tương tự
 * qua middleware `requireCompanyOwnerOrAdmin`. Nếu check sai ở FE (vd cache stale
 * sau transfer), BE PATCH sẽ trả 403 → toast lỗi.
 */
const canEdit = computed<boolean>(() => {
  if (!current.value || !auth.user) return false;
  if (auth.user.role === 'admin') return true;
  return isCurrentUserOwner.value;
});

/* ============================================================================
 * Lifecycle
 * ==========================================================================*/
const loadMyCompany = async (): Promise<void> => {
  loadState.value = 'loading';
  companyStore.reset();
  memberStore.reset();
  try {
    // `getMyCompany` không có action trong store (chỉ trả slim id) — gọi trực
    // tiếp service để tránh duplicate logic quản lý state, rồi dùng
    // `store.fetchById` để lấy full Company kèm jobs[].
    const { data } = await companyApi.getMyCompany();
    if (!data.data) {
      // User chưa thuộc công ty nào → fetch pending invites song song.
      // Dù Promise.all để cả 2 chạy parallel — nhanh hơn tuần tự.
      await fetchPendingInvites();
      loadState.value = 'no-company';
      return;
    }
    // Fetch song song company detail + members (cần members để check isOwner).
    await Promise.all([
      companyStore.fetchById(data.data.id),
      memberStore.fetchList(data.data.id),
    ]);
    loadState.value = current.value ? 'ready' : 'no-company';
  } catch {
    loadState.value = current.value ? 'ready' : 'no-company';
  }
};

onMounted(() => {
  void loadMyCompany();
});

/** Re-fetch khi navigate vào lại trang (vd từ tab khác). */
watch(
  () => route.path,
  (newPath) => {
    if (newPath === '/employer/company' && loadState.value === 'ready') {
      void loadMyCompany();
    }
  },
);

/* ============================================================================
 * Helpers
 * ==========================================================================*/
/** Copy `social` (Record) thành rows { key, value } cho UI edit. */
const socialToRows = (social?: CompanySocial | null): KvRow[] => {
  if (!social) return [];
  return Object.entries(social).map(([key, value]) => ({ key, value: String(value) }));
};

/** Convert rows về Record<string, string> cho `social`. Bỏ row trống. */
const rowsToSocial = (rows: KvRow[]): CompanySocial => {
  const out: CompanySocial = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (!k) continue;
    out[k] = r.value.trim();
  }
  return out;
};

/* ============================================================================
 * Edit mode
 * ==========================================================================*/
const enterEdit = (): void => {
  if (!current.value) return;
  form.name = current.value.name ?? '';
  form.logoUrl = current.value.logoUrl ?? '';
  form.description = current.value.description ?? '';
  form.industry = current.value.industry ?? '';
  form.sizeRange = current.value.sizeRange ?? '';
  form.website = current.value.website ?? '';
  form.social = { ...(current.value.social ?? {}) };
  socialRows.value = socialToRows(current.value.social);

  // Parse address hiện có → 3 field chuẩn + extras.
  // (DB lưu `address` dạng Record<string, unknown> với keys city/district/address +
  // custom keys như lat/lng. Map 3 keys quen thuộc vào form, các keys khác vào extraAddress.)
  const existingAddress = current.value.address ?? {};
  const existingCity = typeof existingAddress.city === 'string' ? existingAddress.city : '';
  const existingDistrict = typeof existingAddress.district === 'string' ? existingAddress.district : '';
  const existingStreet = typeof existingAddress.address === 'string' ? existingAddress.address : '';

  // Tìm province theo shortName (vd "Hà Nội") để set selectedProvinceCode.
  const foundProvince = existingCity
    ? locations.items.value.find((p) => p.shortName === existingCity)
    : null;
  form.provinceCode = foundProvince?.code ?? null;
  form.district = existingDistrict;
  form.streetAddress = existingStreet;
  // Extras = mọi key không thuộc 3 keys chuẩn.
  form.extraAddress = Object.fromEntries(
    Object.entries(existingAddress).filter(
      ([k]) => k !== 'city' && k !== 'district' && k !== 'address',
    ),
  );

  formError.value = null;
  editMode.value = true;

  // Fetch locations nếu chưa có (giống CreateCompanyModal).
  if (locations.items.value.length === 0) {
    locationsLoading.value = true;
    void locations.fetch().finally(() => {
      locationsLoading.value = false;
    });
  }
};

const cancelEdit = (): void => {
  editMode.value = false;
  formError.value = null;
};

const addSocialRow = (): void => {
  socialRows.value.push({ key: '', value: '' });
};
const removeSocialRow = (idx: number): void => {
  socialRows.value.splice(idx, 1);
};

const buildPayload = (): UpdateCompanyPayload => {
  // Build address Record từ 3 field + extras (giữ backward compatible với DB schema).
  const address: Record<string, unknown> = { ...form.extraAddress };
  const city = form.district ? provinceShortName.value : ''; // sync với district change
  if (city) address.city = city;
  if (form.district) address.district = form.district;
  if (form.streetAddress) address.address = form.streetAddress;

  const payload: UpdateCompanyPayload = {
    name: form.name.trim(),
    logoUrl: form.logoUrl.trim() || undefined,
    description: form.description.trim() || undefined,
    industry: form.industry.trim() || undefined,
    sizeRange: form.sizeRange.trim() || undefined,
    website: form.website.trim() || undefined,
    social: rowsToSocial(socialRows.value),
    address: Object.keys(address).length > 0 ? address : undefined,
  };
  return payload;
};

const save = async (): Promise<void> => {
  if (!current.value) return;
  formError.value = null;

  const name = form.name.trim();
  if (name.length < 2) {
    formError.value = 'Tên công ty phải có ít nhất 2 ký tự.';
    return;
  }

  saving.value = true;
  try {
    const updated = await companyStore.update(current.value.id, buildPayload());
    if (updated) {
      toast.success('Đã lưu thay đổi hồ sơ công ty.');
      editMode.value = false;
    } else {
      // Store đã set error — fallback message.
      formError.value = companyStore.error ?? 'Không thể lưu thay đổi.';
    }
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra.';
  } finally {
    saving.value = false;
  }
};

/* ============================================================================
 * Display helpers
 * ==========================================================================*/
const SIZE_RANGE_OPTIONS = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];

const formatJoinedDate = (iso: string | undefined): string => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
};

const formatJobLocation = (loc: Record<string, unknown> | null | undefined): string => {
  if (!loc) return '';
  const city = (loc as { city?: string }).city;
  const district = (loc as { district?: string }).district;
  const address = (loc as { address?: string }).address;
  const parts = [address, district, city].filter(Boolean);
  return parts.join(', ');
};

const formatSalary = (min: string | null | undefined, max: string | null | undefined): string | null => {
  if (!min && !max) return null;
  const fmt = (v: string): string => {
    const n = Number(v);
    if (Number.isNaN(n)) return v;
    return n.toLocaleString('vi-VN');
  };
  if (min && max) return `${fmt(min)} – ${fmt(max)} đ`;
  return `${fmt(min || max || '')} đ`;
};

const STATUS_META: Record<Company['status'], { label: string; cls: string }> = {
  active: { label: 'Đang hoạt động', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  banned: { label: 'Bị khóa', cls: 'bg-red-50 text-red-700 ring-red-200' },
  removed: { label: 'Đã gỡ', cls: 'bg-gray-100 text-gray-600 ring-gray-200' },
};

const companyStatus = computed(() =>
  current.value ? STATUS_META[current.value.status] : null,
);

/** Map key social → Lucide icon + label. Key lạ → fallback Globe. */
const SOCIAL_META: Record<string, { label: string; icon: typeof Globe }> = {
  linkedin: { label: 'LinkedIn', icon: Linkedin },
  facebook: { label: 'Facebook', icon: Facebook },
  github: { label: 'GitHub', icon: Github },
  twitter: { label: 'X / Twitter', icon: Twitter },
  x: { label: 'X / Twitter', icon: Twitter },
  youtube: { label: 'YouTube', icon: Youtube },
  instagram: { label: 'Instagram', icon: Instagram },
  tiktok: { label: 'TikTok', icon: Globe },
  website: { label: 'Website', icon: Globe },
};

const getSocialMeta = (key: string): { label: string; icon: typeof Globe } => {
  const normalized = key.toLowerCase();
  return SOCIAL_META[normalized] ?? { label: key, icon: Globe };
};

/** Chuẩn hoá URL — nếu thiếu protocol thì thêm https://. */
const normalizeUrl = (raw: string): string => {
  const v = raw.trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
};

const copyToClipboard = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Đã sao chép vào bộ nhớ tạm.');
  } catch {
    toast.error('Không thể sao chép.');
  }
};

/** Social có dữ liệu không. */
const hasSocial = computed<boolean>(() => {
  if (!current.value?.social) return false;
  return Object.keys(current.value.social).length > 0;
});

/* ============================================================================
 * Skeleton blocks (loading state)
 * ==========================================================================*/
const SkeletonLine = (): string => 'animate-pulse bg-gray-200 rounded';

/** Named route object để chuyển trang (dùng cho CTA trong empty state).
 *  Dùng named route thay vì hardcoded path — nếu route path đổi, chỉ cần update router. */
const jobsPath = { name: 'employer-jobs' as const };
</script>



<template>
  <div class="min-h-screen bg-gray-50/50 p-5 md:p-8">
    <div class="max-w-6xl mx-auto space-y-6">
      <!-- Loading state -->
      <template v-if="loadState === 'loading'">
        <header class="flex items-center justify-between gap-4 flex-wrap">
          <div class="flex items-center gap-3">
            <div :class="SkeletonLine()" class="h-10 w-10 rounded-xl" />
            <div class="space-y-2">
              <div :class="SkeletonLine()" class="h-5 w-44" />
              <div :class="SkeletonLine()" class="h-4 w-72" />
            </div>
          </div>
          <div :class="SkeletonLine()" class="h-10 w-32" />
        </header>
        <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 sm:p-6 md:p-7">
          <div class="flex flex-col md:flex-row md:items-center gap-4 md:gap-5">
            <div :class="SkeletonLine()" class="w-20 h-20 md:w-24 md:h-24 rounded-2xl shrink-0" />
            <div class="flex-1 space-y-2.5">
              <div :class="SkeletonLine()" class="h-7 w-56" />
              <div :class="SkeletonLine()" class="h-4 w-72" />
              <div :class="SkeletonLine()" class="h-4 w-40" />
            </div>
          </div>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
          <div v-for="i in 3" :key="i" class="bg-white rounded-2xl border border-gray-200 p-4 md:p-5 space-y-2">
            <div :class="SkeletonLine()" class="h-3 w-16" />
            <div :class="SkeletonLine()" class="h-6 w-24" />
          </div>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-5">
          <div class="lg:col-span-7 space-y-4 md:space-y-5">
            <div class="bg-white rounded-2xl border border-gray-200 p-5 md:p-6 space-y-4">
              <div :class="SkeletonLine()" class="h-4 w-32" />
              <div v-for="j in 4" :key="j" class="space-y-1.5">
                <div :class="SkeletonLine()" class="h-3 w-24" />
                <div :class="SkeletonLine()" class="h-4 w-full" />
              </div>
            </div>
            <div class="bg-white rounded-2xl border border-gray-200 p-5 md:p-6 space-y-2">
              <div :class="SkeletonLine()" class="h-4 w-32 mb-3" />
              <div :class="SkeletonLine()" class="h-3 w-full" />
              <div :class="SkeletonLine()" class="h-3 w-11/12" />
              <div :class="SkeletonLine()" class="h-3 w-10/12" />
            </div>
          </div>
          <div class="lg:col-span-5 space-y-4 md:space-y-5">
            <div class="bg-white rounded-2xl border border-gray-200 p-5 md:p-6 space-y-3">
              <div :class="SkeletonLine()" class="h-4 w-24" />
              <div v-for="k in 3" :key="k" class="space-y-1">
                <div :class="SkeletonLine()" class="h-3 w-20" />
                <div :class="SkeletonLine()" class="h-4 w-full" />
              </div>
            </div>
            <div class="bg-white rounded-2xl border border-gray-200 p-5 md:p-6 space-y-2">
              <div :class="SkeletonLine()" class="h-4 w-28 mb-3" />
              <div v-for="k in 3" :key="`s-${k}`" :class="SkeletonLine()" class="h-10 w-full" />
            </div>
          </div>
        </div>
      </template>

      <!-- Empty state -->
      <template v-else-if="loadState === 'no-company'">
        <header class="flex items-center gap-3">
          <div class="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900 shrink-0">
            <Building2 class="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 class="text-xl font-semibold text-gray-900 tracking-tight">Hồ sơ công ty</h1>
            <p class="text-sm text-gray-500 mt-0.5">Quản lý thông tin, thương hiệu và hình ảnh doanh nghiệp của bạn.</p>
          </div>
        </header>

        <!-- Hero card: chưa có công ty (giữ nguyên như cũ) -->
        <div class="bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div class="flex flex-col items-center justify-center py-12 sm:py-16 text-center px-6 relative overflow-hidden">
            <div class="absolute inset-0 opacity-[0.035] pointer-events-none" aria-hidden="true"
                 style="background-image: radial-gradient(circle at 1px 1px, rgb(15 23 42) 1px, transparent 0); background-size: 22px 22px;" />
            <div class="relative">
              <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-50 to-primary-100 ring-1 ring-primary-200/60 flex items-center justify-center mb-4">
                <Building2 class="w-7 h-7 text-primary-600" />
              </div>
              <h2 class="text-base font-semibold text-gray-900">Bạn chưa thuộc công ty nào</h2>
              <p class="text-sm text-gray-500 mt-1.5 max-w-md">
                Tạo hồ sơ công ty để bắt đầu đăng tuyển, hoặc chấp nhận lời mời bên dưới.
              </p>
              <button
                v-if="auth.user?.role === 'employer' || auth.user?.role === 'admin'"
                type="button"
                class="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl bg-gray-900 text-white hover:bg-gray-800 hover:shadow-md transition focus:outline-none focus:ring-2 focus:ring-gray-700 focus:ring-offset-2"
                @click="openCreateModal"
              >
                <Plus class="w-4 h-4" />
                Tạo công ty mới
              </button>
              <p v-else class="text-xs text-gray-400 mt-4 italic max-w-sm">
                Chỉ tài khoản nhà tuyển dụng mới có thể tạo công ty.
              </p>
            </div>
          </div>
        </div>

        <!-- Pending invites section — chỉ render khi có invite hoặc đang loading/error -->
        <section v-if="invitesLoading || invitesError || pendingInvites.length > 0">
          <header class="mb-3 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <div class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                <MailPlus class="w-4 h-4" />
              </div>
              <div>
                <h3 class="text-sm font-semibold text-gray-900">
                  Lời mời đang chờ
                  <span v-if="!invitesLoading && pendingInvites.length > 0" class="text-gray-500 font-normal">
                    ({{ pendingInvites.length }})
                  </span>
                </h3>
                <p class="text-xs text-gray-500">Chấp nhận để tham gia ngay, hoặc từ chối nếu không phù hợp.</p>
              </div>
            </div>
          </header>

          <!-- Loading state -->
          <div v-if="invitesLoading" class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div v-for="i in 2" :key="i" class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
              <div class="flex items-start gap-3">
                <div :class="SkeletonLine()" class="w-12 h-12 rounded-xl shrink-0" />
                <div class="flex-1 space-y-2">
                  <div :class="SkeletonLine()" class="h-4 w-32" />
                  <div :class="SkeletonLine()" class="h-3 w-24" />
                </div>
              </div>
              <div class="flex justify-end gap-2">
                <div :class="SkeletonLine()" class="h-8 w-20" />
                <div :class="SkeletonLine()" class="h-8 w-28" />
              </div>
            </div>
          </div>

          <!-- Error state -->
          <div
            v-else-if="invitesError"
            class="bg-white rounded-2xl border border-red-200/80 bg-red-50/40 px-4 py-3 flex items-center gap-3"
          >
            <AlertCircle class="w-4 h-4 text-red-500 shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-red-900">Không tải được danh sách lời mời</p>
              <p class="text-xs text-red-700 mt-0.5">{{ invitesError }}</p>
            </div>
            <button
              type="button"
              class="text-xs font-medium text-red-700 hover:text-red-900 underline shrink-0"
              @click="fetchPendingInvites"
            >
              Thử lại
            </button>
          </div>

          <!-- Invites list -->
          <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <article
              v-for="invite in pendingInvites"
              :key="invite.companyId"
              class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 hover:border-amber-200 hover:shadow-md transition"
            >
              <div class="flex items-start gap-3">
                <!-- Logo / placeholder -->
                <div class="shrink-0 w-12 h-12 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center overflow-hidden">
                  <img
                    v-if="invite.companyLogoUrl"
                    :src="invite.companyLogoUrl"
                    :alt="`${invite.companyName} logo`"
                    class="w-full h-full object-cover"
                  />
                  <Building2 v-else class="w-6 h-6 text-gray-300" />
                </div>

                <!-- Info -->
                <div class="flex-1 min-w-0">
                  <h4 class="text-sm font-semibold text-gray-900 truncate">{{ invite.companyName }}</h4>
                  <p class="text-xs text-gray-500 mt-0.5 truncate">
                    <span v-if="invite.invitedBy?.fullName">Mời bởi {{ invite.invitedBy.fullName }}</span>
                    <span v-else-if="invite.invitedBy?.email">Mời bởi {{ invite.invitedBy.email }}</span>
                    <span v-else>Lời mời vào công ty</span>
                    <span class="text-gray-300 mx-1">·</span>
                    <span>{{ invite.role === 'owner' ? 'Chủ sở hữu' : 'Thành viên' }}</span>
                  </p>
                  <p
                    v-if="invite.companyIndustry || invite.companySizeRange"
                    class="text-xs text-gray-500 mt-0.5 truncate"
                  >
                    <span v-if="invite.companyIndustry">{{ invite.companyIndustry }}</span>
                    <span v-if="invite.companyIndustry && invite.companySizeRange" class="text-gray-300 mx-1">·</span>
                    <span v-if="invite.companySizeRange">{{ invite.companySizeRange }} nhân viên</span>
                  </p>
                </div>
              </div>

              <!-- Actions -->
              <div class="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="inviteActionId !== null"
                  @click="declineInvite(invite)"
                >
                  <X class="w-3.5 h-3.5" />
                  Từ chối
                </button>
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 hover:shadow-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
                  :disabled="inviteActionId !== null"
                  @click="acceptInvite(invite)"
                >
                  <Loader2 v-if="inviteActionId === invite.companyId" class="w-3.5 h-3.5 animate-spin" />
                  <Check v-else class="w-3.5 h-3.5" />
                  {{ inviteActionId === invite.companyId ? 'Đang xử lý...' : 'Chấp nhận' }}
                </button>
              </div>
            </article>
          </div>
        </section>
      </template>

      <!-- Ready state -->
      <template v-else-if="current">
        <header class="flex items-start justify-between gap-4 flex-wrap">
          <div class="flex items-center gap-3 min-w-0">
            <div class="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900 shrink-0">
              <Building2 class="w-5 h-5 text-white" />
            </div>
            <div class="min-w-0">
              <h1 class="text-xl font-semibold text-gray-900 tracking-tight">Hồ sơ công ty</h1>
              <p class="text-sm text-gray-500 mt-0.5">Quản lý thông tin, thương hiệu và hình ảnh doanh nghiệp của bạn.</p>
            </div>
          </div>
          <div v-if="!editMode" class="flex items-center gap-2 shrink-0">
            <button v-if="canEdit" type="button"
                    class="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-xl bg-gray-900 text-white hover:bg-gray-800 hover:shadow-md transition focus:outline-none focus:ring-2 focus:ring-gray-700 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    :disabled="loading" @click="enterEdit">
              <Pencil class="w-4 h-4" /> Chỉnh sửa
            </button>
            <span v-else class="text-xs text-gray-600 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100"
                  title="Chỉ người tạo công ty hoặc admin mới có quyền chỉnh sửa.">
              <Lock class="w-3.5 h-3.5 text-gray-500" />
              Chỉ chủ sở hữu mới có thể chỉnh sửa.
            </span>
          </div>
          <div v-else class="flex items-center gap-2 shrink-0">
            <button type="button"
                    class="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-xl border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    :disabled="saving" @click="cancelEdit">Hủy</button>
            <button type="button"
                    class="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-xl bg-gray-900 text-white hover:bg-gray-800 hover:shadow-md transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-gray-700 focus:ring-offset-2"
                    :disabled="saving" @click="save">
              <Loader2 v-if="saving" class="w-3.5 h-3.5 animate-spin" />
              <Check v-else class="w-3.5 h-3.5" />
              {{ saving ? 'Đang lưu...' : 'Lưu thay đổi' }}
            </button>
          </div>
        </header>

        <div v-if="error && loadState === 'ready'"
             class="rounded-xl border border-red-200 bg-red-50/70 px-4 py-3 flex items-start gap-3">
          <AlertCircle class="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-red-900">Không thể tải hồ sơ công ty</p>
            <p class="text-xs text-red-700 mt-0.5">{{ error }}</p>
          </div>
          <button type="button" class="text-xs font-medium text-red-700 hover:text-red-900 underline shrink-0" @click="loadMyCompany">
            Thử lại
          </button>
        </div>

        <!-- HERO -->
        <section class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 sm:p-6 md:p-7">
          <div class="flex flex-col md:flex-row md:items-center gap-4 md:gap-5">
            <!-- Logo -->
            <div class="shrink-0 w-20 h-20 md:w-24 md:h-24 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center overflow-hidden">
              <img v-if="current.logoUrl" :src="current.logoUrl" :alt="`${current.name} logo`"
                   class="w-full h-full object-cover" loading="lazy" />
              <Building2 v-else class="w-10 h-10 text-gray-300" />
            </div>

            <!-- Name + meta + status -->
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-3 flex-wrap">
                <div class="min-w-0">
                  <h2 class="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight break-words">{{ current.name }}</h2>
                  <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-gray-600">
                    <span v-if="current.industry" class="inline-flex items-center gap-1.5">
                      <Factory class="w-3.5 h-3.5 text-gray-400" />{{ current.industry }}
                    </span>
                    <span v-if="current.sizeRange" class="inline-flex items-center gap-1.5">
                      <Users class="w-3.5 h-3.5 text-gray-400" />{{ current.sizeRange }} nhân viên
                    </span>
                    <a v-if="current.website" :href="normalizeUrl(current.website)" target="_blank" rel="noopener noreferrer"
                       class="inline-flex items-center gap-1.5 text-primary-600 hover:text-primary-700 hover:underline truncate max-w-[280px]">
                      <Globe class="w-3.5 h-3.5" />
                      <span class="truncate">{{ current.website.replace(/^https?:\/\//, '') }}</span>
                      <ExternalLink class="w-3 h-3 opacity-70 shrink-0" />
                    </a>
                  </div>
                </div>
                <span v-if="companyStatus"
                      class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ring-1 ring-inset shrink-0"
                      :class="companyStatus.cls">
                  <span class="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
                  {{ companyStatus.label }}
                </span>
              </div>
            </div>
          </div>
        </section>

        <!-- STATS -->
        <section class="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
          <div class="bg-white rounded-2xl border border-gray-200 p-4 md:p-5 shadow-sm">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex flex-col gap-2">
                <p class="text-[11px] uppercase tracking-wider font-semibold text-gray-500">Việc đang tuyển</p>
                <p class="text-2xl font-bold text-gray-900 tabular-nums">{{ current.jobs?.length ?? 0 }}</p>
                <p class="text-xs text-gray-500">vị trí đang mở</p>
              </div>
              <div class="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                <BriefcaseBusiness class="w-5 h-5" />
              </div>
            </div>
          </div>
          <div class="bg-white rounded-2xl border border-gray-200 p-4 md:p-5 shadow-sm">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex flex-col gap-2">
                <p class="text-[11px] uppercase tracking-wider font-semibold text-gray-500">Quy mô</p>
                <p class="text-lg md:text-xl font-bold text-gray-900 truncate">
                  <span v-if="current.sizeRange">{{ current.sizeRange }}</span>
                  <span v-else class="text-gray-400 italic text-base font-normal">—</span>
                </p>
                <p class="text-xs text-gray-500">
                  <span v-if="current.sizeRange">nhân viên</span>
                  <span v-else>chưa cập nhật</span>
                </p>
              </div>
              <div class="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <Users class="w-5 h-5" />
              </div>
            </div>
          </div>
          <div class="bg-white rounded-2xl border border-gray-200 p-4 md:p-5 shadow-sm col-span-2 md:col-span-1">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex flex-col gap-2">
                <p class="text-[11px] uppercase tracking-wider font-semibold text-gray-500">Ngày tạo công ty</p>
                <p class="text-lg md:text-xl font-bold text-gray-900 truncate">
                  <span v-if="formatJoinedDate(current.createdAt)">{{ formatJoinedDate(current.createdAt) }}</span>
                  <span v-else class="text-gray-400 italic text-base font-normal">—</span>
                </p>
                <p class="text-xs text-gray-500">trên JobMatch</p>
              </div>
              <div class="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <CalendarDays class="w-5 h-5" />
              </div>
            </div>
          </div>
        </section>

        <!-- EDIT MODE -->
        <template v-if="editMode">
          <section class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 md:p-6">
            <header class="mb-5 flex items-start gap-3">
              <div class="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                <ImageIcon class="w-4 h-4" />
              </div>
              <div>
                <h3 class="text-sm font-semibold text-gray-900">Hình ảnh thương hiệu</h3>
                <p class="text-xs text-gray-500 mt-0.5">Logo hiển thị vuông ở hồ sơ công ty.</p>
              </div>
            </header>
            <div class="max-w-[240px]">
              <div class="flex items-center gap-2 mb-2">
                <Building2 class="w-3.5 h-3.5 text-gray-500" />
                <span class="text-sm font-medium text-gray-900">Logo công ty</span>
                <span class="text-[11px] text-gray-400">tỉ lệ 1:1</span>
              </div>
              <ImageUploadField v-model:url="form.logoUrl" folder="logos" shape="square" label="" hide-label :disabled="saving" />
            </div>
          </section>

          <section class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 md:p-6">
            <header class="mb-5 flex items-start gap-3">
              <div class="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                <Building2 class="w-4 h-4" />
              </div>
              <div>
                <h3 class="text-sm font-semibold text-gray-900">Thông tin cơ bản</h3>
                <p class="text-xs text-gray-500 mt-0.5">Thông tin chính hiển thị cho ứng viên khi xem hồ sơ công ty.</p>
              </div>
            </header>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="md:col-span-2">
                <label class="text-sm font-medium text-gray-900 mb-1.5 inline-flex items-center gap-1.5">
                  <Building2 class="w-3.5 h-3.5 text-gray-500" />Tên công ty <span class="text-red-500">*</span>
                </label>
                <input v-model="form.name" type="text" maxlength="200"
                       class="w-full h-11 px-3.5 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 transition" />
              </div>
              <div>
                <label class="text-sm font-medium text-gray-900 mb-1.5 inline-flex items-center gap-1.5">
                  <Hash class="w-3.5 h-3.5 text-gray-500" />Slug
                </label>
                <div class="relative">
                  <Link2 class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input :value="current.slug" type="text" disabled
                         class="w-full h-11 pl-10 pr-3.5 text-sm rounded-xl border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed font-mono" />
                </div>
                <p class="text-[11px] text-gray-500 mt-1.5">Slug được giữ nguyên để không gãy liên kết cũ.</p>
              </div>
              <div>
                <label class="text-sm font-medium text-gray-900 mb-1.5 inline-flex items-center gap-1.5">
                  <Factory class="w-3.5 h-3.5 text-gray-500" />Ngành nghề
                </label>
                <input v-model="form.industry" type="text" maxlength="100" placeholder="VD: Công nghệ thông tin"
                       class="w-full h-11 px-3.5 text-sm rounded-xl border border-gray-200 bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 transition" />
              </div>
              <div>
                <label class="text-sm font-medium text-gray-900 mb-1.5 inline-flex items-center gap-1.5">
                  <Users class="w-3.5 h-3.5 text-gray-500" />Quy mô
                </label>
                <select v-model="form.sizeRange"
                        class="w-full h-11 pl-3.5 pr-9 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 transition appearance-none bg-no-repeat bg-right"
                        style="background-image: url('data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22fit%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpolyline points=%226 9 12 15 18 9%22/%3E%3C/svg%3E'); background-position: right 12px center; background-size: 14px;">
                  <option value="">— Chọn quy mô —</option>
                  <option v-for="opt in SIZE_RANGE_OPTIONS" :key="opt" :value="opt">{{ opt }} nhân viên</option>
                </select>
              </div>
              <div>
                <label class="text-sm font-medium text-gray-900 mb-1.5 inline-flex items-center gap-1.5">
                  <Globe class="w-3.5 h-3.5 text-gray-500" />Website
                </label>
                <div class="relative">
                  <Globe class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input v-model="form.website" type="url" maxlength="500" placeholder="https://example.com"
                         class="w-full h-11 pl-10 pr-3.5 text-sm rounded-xl border border-gray-200 bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 transition" />
                </div>
              </div>
            </div>
          </section>

          <section class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 md:p-6">
            <header class="mb-5 flex items-start gap-3">
              <div class="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                <FileText class="w-4 h-4" />
              </div>
              <div class="flex-1">
                <h3 class="text-sm font-semibold text-gray-900">Giới thiệu công ty</h3>
                <p class="text-xs text-gray-500 mt-0.5">Chia sẻ về văn hoá, sản phẩm và đội ngũ của bạn.</p>
              </div>
              <span class="text-[11px] tabular-nums text-gray-400 shrink-0">{{ form.description.length }} / 5.000</span>
            </header>
            <textarea v-model="form.description" rows="6" maxlength="5000"
                      placeholder="Mô tả về công ty, văn hoá, sản phẩm, đội ngũ..."
                      class="w-full px-3.5 py-2.5 text-sm rounded-xl border border-gray-200 bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 transition resize-y" />
          </section>

          <section class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 md:p-6">
            <header class="mb-5 flex items-start justify-between gap-3">
              <div class="flex items-start gap-3">
                <div class="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                  <Share2 class="w-4 h-4" />
                </div>
                <div>
                  <h3 class="text-sm font-semibold text-gray-900">Mạng xã hội</h3>
                  <p class="text-xs text-gray-500 mt-0.5">Mỗi dòng là một liên kết (LinkedIn, Facebook, GitHub...).</p>
                </div>
              </div>
              <button type="button" class="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition" @click="addSocialRow">
                <Plus class="w-3.5 h-3.5" /> Thêm liên kết
              </button>
            </header>
            <div v-if="socialRows.length === 0" class="text-xs text-gray-400 italic">Chưa có liên kết mạng xã hội nào.</div>
            <div v-else class="space-y-2.5">
              <div v-for="(row, idx) in socialRows" :key="`social-${idx}`" class="flex items-center gap-2">
                <div class="relative w-1/3">
                  <component :is="getSocialMeta(row.key || '').icon" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input v-model="row.key" type="text" placeholder="linkedin"
                         class="w-full h-10 pl-9 pr-3 text-sm rounded-lg border border-gray-200 bg-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300 focus:border-gray-300 transition" />
                </div>
                <input v-model="row.value" type="text" placeholder="https://..."
                       class="flex-1 h-10 px-3 text-sm rounded-lg border border-gray-200 bg-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300 focus:border-gray-300 transition" />
                <button type="button" class="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition" title="Xoá dòng" :aria-label="`Xoá liên kết ${row.key || idx + 1}`" @click="removeSocialRow(idx)">
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
            </div>
          </section>

          <section class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 md:p-6">
            <header class="mb-5 flex items-start justify-between gap-3">
              <div class="flex items-start gap-3">
                <div class="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                  <MapPin class="w-4 h-4" />
                </div>
                <div>
                  <h3 class="text-sm font-semibold text-gray-900">Địa chỉ</h3>
                  <p class="text-xs text-gray-500 mt-0.5">Chọn tỉnh/thành → quận/huyện → địa chỉ cụ thể. Đồng bộ với form tạo công ty.</p>
                </div>
              </div>
            </header>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <!-- Province -->
              <div>
                <label class="text-sm font-medium text-gray-900 mb-1.5 inline-flex items-center gap-1.5">
                  <MapPin class="w-3.5 h-3.5 text-gray-500" />Tỉnh/Thành phố
                </label>
                <select
                  v-model="form.provinceCode"
                  :disabled="locations.loading.value && locations.items.value.length === 0"
                  class="w-full h-11 pl-3.5 pr-9 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 transition disabled:opacity-60 disabled:cursor-not-allowed appearance-none bg-no-repeat bg-right"
                  style="background-image: url('data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236b7280%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpolyline points=%226 9 12 15 18 9%22/%3E%3C/svg%3E'); background-position: right 12px center; background-size: 14px;"
                >
                  <option :value="null">
                    {{ locations.loading.value && locations.items.value.length === 0 ? 'Đang tải...' : 'Chọn tỉnh/thành' }}
                  </option>
                  <option v-for="p in locations.items.value" :key="p.code" :value="p.code">
                    {{ p.name }}
                  </option>
                </select>
              </div>

              <!-- District -->
              <div>
                <label class="text-sm font-medium text-gray-900 mb-1.5 inline-flex items-center gap-1.5">
                  <MapPin class="w-3.5 h-3.5 text-gray-500" />Quận/Huyện
                </label>
                <select
                  v-model="form.district"
                  :disabled="form.provinceCode === null || currentDistricts.length === 0"
                  class="w-full h-11 pl-3.5 pr-9 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 transition disabled:opacity-60 disabled:cursor-not-allowed appearance-none bg-no-repeat bg-right"
                  style="background-image: url('data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236b7280%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpolyline points=%226 9 12 15 18 9%22/%3E%3C/svg%3E'); background-position: right 12px center; background-size: 14px;"
                >
                  <option value="">
                    <span v-if="form.provinceCode === null">Chọn tỉnh trước</span>
                    <span v-else-if="currentDistricts.length === 0">Không có dữ liệu</span>
                    <span v-else>Chọn quận/huyện</span>
                  </option>
                  <option v-for="d in currentDistricts" :key="d.code" :value="d.name">
                    {{ d.name }}
                  </option>
                </select>
              </div>
            </div>

            <!-- Street address -->
            <div class="mt-4">
              <label class="text-sm font-medium text-gray-900 mb-1.5 inline-flex items-center gap-1.5">
                <MapPin class="w-3.5 h-3.5 text-gray-500" />Địa chỉ cụ thể
                <span class="text-[11px] text-gray-400 font-normal">— số nhà, ngõ, đường...</span>
              </label>
              <input
                v-model="form.streetAddress"
                type="text"
                maxlength="500"
                placeholder="VD: 123 Nguyễn Văn Cừ, Phường Ngọc Lâm"
                class="w-full h-11 px-3.5 text-sm rounded-xl border border-gray-200 bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 transition"
              />
            </div>

            <!-- Helper / current selection summary -->
            <div
              v-if="provinceShortName || form.district || form.streetAddress"
              class="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100"
            >
              <MapPin class="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
              <p class="text-xs text-gray-600 break-words min-w-0">
                <span v-if="form.streetAddress">{{ form.streetAddress }}</span>
                <span v-if="form.district"> <span v-if="form.streetAddress">·</span> {{ form.district }}</span>
                <span v-if="provinceShortName"> <span v-if="form.district || form.streetAddress">·</span> {{ provinceShortName }}</span>
              </p>
            </div>
          </section>

          <div v-if="formError" class="rounded-xl border border-red-200/80 bg-red-50/70 px-4 py-3 flex items-start gap-3" role="alert">
            <div class="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full bg-red-100">
              <AlertCircle class="w-3.5 h-3.5 text-red-600" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-red-900">Không thể lưu thay đổi</p>
              <p class="text-xs text-red-700 mt-0.5">{{ formError }}</p>
            </div>
          </div>
        </template>

        <!-- VIEW MODE -->
        <template v-else>
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-5">
            <div class="lg:col-span-7 space-y-4 md:space-y-5">
              <!-- Information -->
              <section class="bg-white rounded-2xl border border-gray-200 shadow-sm">
                <header class="px-5 md:px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <div class="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                      <Building2 class="w-3.5 h-3.5" />
                    </div>
                    <h3 class="text-sm font-semibold text-gray-900">Thông tin công ty</h3>
                  </div>
                  <button type="button" class="md:hidden inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
                          :title="expanded.info ? 'Thu gọn' : 'Mở rộng'" @click="expanded.info = !expanded.info">
                    <ChevronUp v-if="expanded.info" class="w-4 h-4" />
                    <ChevronDown v-else class="w-4 h-4" />
                  </button>
                </header>
                <div v-show="expanded.info" class="p-5 md:p-6">
                  <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                    <div>
                      <dt class="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5 inline-flex items-center gap-1.5">
                        <Building2 class="w-3 h-3" />Tên công ty
                      </dt>
                      <dd class="text-sm text-gray-900 font-medium">{{ current.name }}</dd>
                    </div>
                    <div>
                      <dt class="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5 inline-flex items-center gap-1.5">
                        <Link2 class="w-3 h-3" />Slug
                      </dt>
                      <dd class="text-sm text-gray-700 inline-flex items-center gap-1.5">
                        <code class="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-700 font-mono">{{ current.slug }}</code>
                        <button type="button" class="text-gray-400 hover:text-gray-700 transition" title="Sao chép" :aria-label="`Sao chép slug ${current.slug}`" @click="copyToClipboard(current.slug)">
                          <Copy class="w-3.5 h-3.5" />
                        </button>
                      </dd>
                    </div>
                    <div>
                      <dt class="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5 inline-flex items-center gap-1.5">
                        <Factory class="w-3 h-3" />Ngành nghề
                      </dt>
                      <dd class="text-sm text-gray-900">
                        <span v-if="current.industry">{{ current.industry }}</span>
                        <span v-else class="text-gray-400 italic">Chưa cập nhật</span>
                      </dd>
                    </div>
                    <div>
                      <dt class="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5 inline-flex items-center gap-1.5">
                        <Users class="w-3 h-3" />Quy mô
                      </dt>
                      <dd class="text-sm text-gray-900">
                        <span v-if="current.sizeRange">{{ current.sizeRange }} nhân viên</span>
                        <span v-else class="text-gray-400 italic">Chưa cập nhật</span>
                      </dd>
                    </div>
                    <div class="sm:col-span-2">
                      <dt class="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5 inline-flex items-center gap-1.5">
                        <Globe class="w-3 h-3" />Website
                      </dt>
                      <dd class="text-sm">
                        <a v-if="current.website" :href="normalizeUrl(current.website)" target="_blank" rel="noopener noreferrer"
                           class="inline-flex items-center gap-1.5 text-primary-600 hover:text-primary-700 hover:underline truncate max-w-full">
                          <span class="truncate">{{ current.website.replace(/^https?:\/\//, '') }}</span>
                          <ExternalLink class="w-3 h-3 opacity-70 shrink-0" />
                        </a>
                        <span v-else class="text-gray-400 italic">Chưa cập nhật</span>
                      </dd>
                    </div>
                    <div class="sm:col-span-2 flex flex-col gap-2">
                      <dt class="text-[11px] uppercase tracking-wider font-semibold text-gray-500 inline-flex items-center gap-1.5">
                        <CalendarDays class="w-3 h-3" />Ngày tạo công ty
                      </dt>
                      <dd class="text-sm text-gray-900">
                        <span v-if="formatJoinedDate(current.createdAt)">{{ formatJoinedDate(current.createdAt) }}</span>
                        <span v-else class="text-gray-400 italic">—</span>
                      </dd>
                    </div>
                  </dl>
                </div>
              </section>

              <!-- Description -->
              <section class="bg-white rounded-2xl border border-gray-200 shadow-sm">
                <header class="px-5 md:px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <div class="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                      <FileText class="w-3.5 h-3.5" />
                    </div>
                    <h3 class="text-sm font-semibold text-gray-900">Giới thiệu công ty</h3>
                  </div>
                  <button type="button" class="md:hidden inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
                          :title="expanded.description ? 'Thu gọn' : 'Mở rộng'" @click="expanded.description = !expanded.description">
                    <ChevronUp v-if="expanded.description" class="w-4 h-4" />
                    <ChevronDown v-else class="w-4 h-4" />
                  </button>
                </header>
                <div v-show="expanded.description" class="p-5 md:p-6">
                  <p v-if="current.description" class="text-sm text-gray-700 leading-7 whitespace-pre-wrap">{{ current.description }}</p>
                  <div v-else class="flex flex-col items-center justify-center py-6 text-center">
                    <div class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-2">
                      <FileText class="w-5 h-5 text-gray-400" />
                    </div>
                    <p class="text-sm font-medium text-gray-700">Chưa có mô tả công ty</p>
                    <p class="text-xs text-gray-500 mt-1 max-w-xs">Thêm thông tin về văn hoá, sản phẩm và đội ngũ để ứng viên hiểu rõ hơn.</p>
                    <button v-if="canEdit" type="button"
                            class="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition"
                            @click="enterEdit">
                      <Pencil class="w-3.5 h-3.5" />Thêm mô tả
                    </button>
                  </div>
                </div>
              </section>

              <!-- Jobs -->
              <section class="bg-white rounded-2xl border border-gray-200 shadow-sm">
                <header class="px-5 md:px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <div class="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                      <BriefcaseBusiness class="w-3.5 h-3.5" />
                    </div>
                    <h3 class="text-sm font-semibold text-gray-900">Việc làm đang tuyển</h3>
                    <span v-if="current.jobs?.length" class="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full bg-gray-100 text-gray-700">{{ current.jobs.length }} vị trí</span>
                  </div>
                  <button type="button" class="md:hidden inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
                          :title="expanded.jobs ? 'Thu gọn' : 'Mở rộng'" @click="expanded.jobs = !expanded.jobs">
                    <ChevronUp v-if="expanded.jobs" class="w-4 h-4" />
                    <ChevronDown v-else class="w-4 h-4" />
                  </button>
                </header>
                <div v-show="expanded.jobs" class="p-5 md:p-6">
                  <div v-if="!current.jobs || current.jobs.length === 0" class="flex flex-col items-center justify-center py-8 text-center">
                    <div class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-2">
                      <BriefcaseBusiness class="w-5 h-5 text-gray-400" />
                    </div>
                    <p class="text-sm font-medium text-gray-700">Chưa có việc làm đang tuyển</p>
                    <p class="text-xs text-gray-500 mt-1 max-w-xs">Các vị trí tuyển dụng của công ty sẽ hiển thị ở đây.</p>
                    <router-link v-if="canEdit" :to="jobsPath" class="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition">
                      <Plus class="w-3.5 h-3.5" />Đăng tin tuyển dụng
                    </router-link>
                  </div>
                  <ul v-else class="space-y-2.5">
                    <li v-for="job in current.jobs" :key="job.id"
                        class="group flex items-start gap-3 p-3 rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-sm transition cursor-pointer">
                      <div class="shrink-0 w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center">
                        <BriefcaseBusiness class="w-4 h-4 text-primary-600" />
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-start justify-between gap-2">
                          <p class="text-sm font-semibold text-gray-900 truncate">{{ job.title }}</p>
                          <ChevronRight class="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition shrink-0 mt-0.5" />
                        </div>
                        <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                          <span v-if="job.jobType" class="inline-flex items-center gap-1">
                            <BriefcaseBusiness class="w-3 h-3" />{{ job.jobType }}
                          </span>
                          <span v-if="job.jobLevel" class="inline-flex items-center gap-1">
                            <span class="text-gray-300">·</span>{{ job.jobLevel }}
                          </span>
                          <span v-if="formatJobLocation(job.location)" class="inline-flex items-center gap-1">
                            <MapPin class="w-3 h-3" />{{ formatJobLocation(job.location) }}
                          </span>
                          <template v-if="formatSalary(job.salaryMin, job.salaryMax)">
                            <span class="inline-flex items-center gap-1">
                              <span class="text-gray-300">·</span>
                              <Banknote class="w-3 h-3" />
                              <span class="text-emerald-700 font-medium">{{ formatSalary(job.salaryMin, job.salaryMax) }}</span>
                            </span>
                          </template>
                        </div>
                      </div>
                    </li>
                  </ul>
                </div>
              </section>
            </div>

            <div class="lg:col-span-5 space-y-4 md:space-y-5">
              <!-- Address -->
              <section class="bg-white rounded-2xl border border-gray-200 shadow-sm">
                <header class="px-5 md:px-6 py-4 border-b border-gray-100 flex items-center gap-2">
                  <div class="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                    <MapPin class="w-3.5 h-3.5" />
                  </div>
                  <h3 class="text-sm font-semibold text-gray-900">Địa chỉ</h3>
                </header>
                <div class="p-5 md:p-6">
                  <div v-if="hasAddressValue" class="flex flex-col gap-3.5">
                    <div v-if="viewStreet" class="flex items-start gap-2.5">
                      <div class="shrink-0 mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-gray-100 text-gray-500">
                        <MapPin class="w-3.5 h-3.5" />
                      </div>
                      <div class="min-w-0 flex-1">
                        <p class="text-[11px] uppercase tracking-wider font-semibold text-gray-500">Địa chỉ</p>
                        <p class="text-sm text-gray-900 break-words mt-0.5">{{ viewStreet }}</p>
                      </div>
                    </div>
                    <div v-if="viewDistrict" class="flex items-start gap-2.5">
                      <div class="shrink-0 mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-gray-100 text-gray-500">
                        <MapPin class="w-3.5 h-3.5" />
                      </div>
                      <div class="min-w-0 flex-1">
                        <p class="text-[11px] uppercase tracking-wider font-semibold text-gray-500">Quận/Huyện</p>
                        <p class="text-sm text-gray-900 break-words mt-0.5">{{ viewDistrict }}</p>
                      </div>
                    </div>
                    <div v-if="viewCity" class="flex items-start gap-2.5">
                      <div class="shrink-0 mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-gray-100 text-gray-500">
                        <MapPin class="w-3.5 h-3.5" />
                      </div>
                      <div class="min-w-0 flex-1">
                        <p class="text-[11px] uppercase tracking-wider font-semibold text-gray-500">Tỉnh/Thành phố</p>
                        <p class="text-sm text-gray-900 break-words mt-0.5">{{ viewCity }}</p>
                      </div>
                    </div>
                  </div>
                  <div v-else class="flex flex-col items-center justify-center py-6 text-center">
                    <div class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-2">
                      <MapPinOff class="w-5 h-5 text-gray-400" />
                    </div>
                    <p class="text-sm font-medium text-gray-700">Chưa cập nhật địa chỉ</p>
                    <p class="text-xs text-gray-500 mt-1 max-w-xs">Thêm địa chỉ giúp ứng viên biết nơi làm việc.</p>
                  </div>
                </div>
              </section>

              <!-- Social -->
              <section v-if="hasSocial" class="bg-white rounded-2xl border border-gray-200 shadow-sm">
                <header class="px-5 md:px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <div class="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                      <Share2 class="w-3.5 h-3.5" />
                    </div>
                    <h3 class="text-sm font-semibold text-gray-900">Mạng xã hội</h3>
                  </div>
                  <button type="button" class="md:hidden inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
                          :title="expanded.social ? 'Thu gọn' : 'Mở rộng'" @click="expanded.social = !expanded.social">
                    <ChevronUp v-if="expanded.social" class="w-4 h-4" />
                    <ChevronDown v-else class="w-4 h-4" />
                  </button>
                </header>
                <div v-show="expanded.social" class="p-5 md:p-6">
                  <ul class="flex flex-col gap-2">
                    <li v-for="(url, key) in (current.social as Record<string, string>)" :key="String(key)">
                      <a :href="normalizeUrl(String(url))" target="_blank" rel="noopener noreferrer"
                         class="group flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-200 hover:border-primary-200 hover:bg-primary-50/40 transition">
                        <div class="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-600 group-hover:bg-white group-hover:text-primary-600 transition">
                          <component :is="getSocialMeta(String(key)).icon" class="w-4 h-4" />
                        </div>
                        <div class="min-w-0 flex-1">
                          <p class="text-sm font-medium text-gray-900 truncate">{{ getSocialMeta(String(key)).label }}</p>
                          <p class="text-[11px] text-gray-500 truncate">{{ String(url).replace(/^https?:\/\//, '') }}</p>
                        </div>
                        <ExternalLink class="w-3.5 h-3.5 text-gray-400 group-hover:text-primary-600 transition shrink-0" />
                      </a>
                    </li>
                  </ul>
                </div>
              </section>
            </div>
          </div>
        </template>
      </template>
    </div>

    <CreateCompanyModal v-model:open="createModalOpen" @created="onCompanyCreated" />
  </div>
</template>
