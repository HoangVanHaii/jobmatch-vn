<script setup lang="ts">
/**
 * CompanyMembersView — trang quản lý thành viên (điều phối).
 *
 * View giữ: state nghiệp vụ cấp trang (load, query search/filter/sort/paging,
 * fetch, realtime socket, phân quyền, điều phối modal). Phần hiển thị chi tiết
 * được tách sang các component:
 *   - CompanyMembersHeader  : thông tin công ty + card "Thành viên"
 *   - CompanyMembersToolbar : tab lọc + ô tìm kiếm (+ nút X)
 *   - CompanyMembersTable   : bảng/card dữ liệu + phân trang
 *   - InviteMemberModal     : modal mời thành viên
 * Helper hiển thị thuần nằm ở utils/companyMemberDisplay.ts.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  AlertCircle,
  Building2,
  Loader2,
  LogOut,
  MailPlus,
  RefreshCw,
  Trash2,
  UserPlus,
  UserRoundCheck,
  Users,
  XCircle,
} from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { useCompanyStore } from '@stores/company';
import { useCompanyMemberStore } from '@stores/companyMember';
import { useAuthStore } from '@stores/auth';
import { useToastStore } from '@stores/toast';
import { useSocket } from '@composables/useSocket';
import ConfirmModal from '@components/common/ConfirmModal.vue';
import CompanyMembersSkeleton from '@components/employer/CompanyMembersSkeleton.vue';
import CompanyMembersHeader from '@components/employer/CompanyMembersHeader.vue';
import CompanyMembersToolbar from '@components/employer/CompanyMembersToolbar.vue';
import CompanyMembersTable from '@components/employer/CompanyMembersTable.vue';
import InviteMemberModal from '@components/employer/InviteMemberModal.vue';
import TransferOwnershipModal from '@components/employer/TransferOwnershipModal.vue';
import DeleteMemberModal from '@components/employer/DeleteMemberModal.vue';
import type { RowActionItem } from '@/utils/companyMemberDisplay';
import type {
  CompanyMember,
  CompanyMemberListCounts,
  CompanyMemberRole,
  CompanyMemberUserInfo,
} from '@/types/companyMember';

/* ============================================================================
* Stores
* ==========================================================================*/
const route = useRoute();
const router = useRouter();
const companyStore = useCompanyStore();
const { current: company } = storeToRefs(companyStore);
const memberStore = useCompanyMemberStore();
const auth = useAuthStore();
const toast = useToastStore();

/* ============================================================================
* State
* ==========================================================================*/
type LoadState = 'loading' | 'no-company' | 'ready';
const loadState = ref<LoadState>('loading');
const companyId = ref<string | null>(null);
const loadError = ref<string | null>(null);
const inviteOpen = ref(false);
const transferTarget = ref<CompanyMember | null>(null);
const transferSaving = ref(false);
const transferError = ref<string | null>(null);
/** Row sắp được xoá (mở DeleteMemberModal trước khi gọi API thật). */
const removeTarget = ref<CompanyMember | null>(null);
const removeSaving = ref(false);
const removeError = ref<string | null>(null);

/* ============================================================================
* Lifecycle
* ==========================================================================*/
/**
 * Hard ceiling cho tổng thời gian loadData. Nếu vượt quá (vd BE /companies/:id
 * treo do `withLiveJobs` chạy query chậm, hoặc network issue), force chuyển
 * sang ready state để UI không kẹt ở skeleton mãi — user thấy banner lỗi +
 * nút "Thử lại" thay vì spinner vô hạn.
 */
const LOAD_HARD_TIMEOUT_MS = 15_000;

/** Chống race: chỉ lần loadData() mới nhất được ghi state. */
let loadDataSeq = 0;
let loadTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

const loadData = async (): Promise<void> => {
  const seq = ++loadDataSeq;
  loadState.value = 'loading';
  loadError.value = null;
  // Chỉ reset members cache — KHÔNG reset company store vì trang
  // /employer/company (CompanyView) dùng chung state đó.
  memberStore.reset();

  // Safety timer: nếu API treo quá LOAD_HARD_TIMEOUT_MS, force ready để
  // UI hiện banner lỗi + "Thử lại" thay vì spinner vô hạn.
  if (loadTimeoutTimer) clearTimeout(loadTimeoutTimer);
  loadTimeoutTimer = setTimeout(() => {
    if (seq === loadDataSeq && loadState.value === 'loading') {
      loadError.value = 'Tải dữ liệu lâu hơn dự kiến — bạn có thể thử lại.';
      loadState.value = 'ready';
    }
  }, LOAD_HARD_TIMEOUT_MS);

  try {
    // Qua store (fetchCompany): phân biệt "chưa có công ty" (companyNotFound)
    // với lỗi tải thật (companyLoadError) — không gộp chung.
    const okCompany = await companyStore.fetchCompany();
    if (seq !== loadDataSeq) return;
    if (companyStore.companyNotFound) {
      companyId.value = null;
      loadState.value = 'no-company';
      return;
    }
    if (!okCompany || !company.value) {
      loadError.value = companyStore.companyLoadError ?? 'Không thể tải dữ liệu công ty.';
      loadState.value = 'ready';
      return;
    }
    companyId.value = company.value.id;
    await fetchMembers();
    if (seq !== loadDataSeq) return;
    if (memberStore.error) loadError.value = memberStore.error;
    membersLoadedOnce = true;
    loadState.value = 'ready';
  } catch (e) {
    console.error('[CompanyMembersView.loadData] error:', e);
    if (seq === loadDataSeq) {
      loadError.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra.';
      loadState.value = 'ready';
    }
  } finally {
    if (seq === loadDataSeq && loadTimeoutTimer) {
      clearTimeout(loadTimeoutTimer);
      loadTimeoutTimer = null;
    }
  }
};

onMounted(() => {
  void loadData();
});

onBeforeUnmount(() => {
  if (loadTimeoutTimer) clearTimeout(loadTimeoutTimer);
  if (reloadTimer !== null) clearTimeout(reloadTimer);
  if (searchTimer !== null) clearTimeout(searchTimer);
});

/**
 * Realtime: refetch members list khi có bất kỳ thay đổi nào liên quan đến
 * membership của company hiện tại (accept/decline/remove/leave/transfer...).
 * Filter theo `payload.companyId === companyId.value` để không refetch nhầm
 * khi user đang ở trang khác.
 */
let membersLoadedOnce = false;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Refetch members + kiểm tra current user còn active không.
 * Nếu không (bị xoá / tự rời) → refresh company context rồi đẩy về
 * /employer/company để thấy state 'no-company'.
 */
const reloadMembersAndCheck = async (): Promise<void> => {
  if (!companyId.value) return;
  await fetchMembers();
  const me = currentUserMember.value;
  if (!me || me.status !== 'active') {
    await companyStore.fetchCompany();
    if (route.name !== 'employer-company') {
      await router.push({ name: 'employer-company' });
    }
  }
};

/** Debounce: nhiều socket event dồn → chỉ 1 fetch sau 300ms. */
const onMembershipChange = (payloadCompanyId: string): void => {
  if (!companyId.value || payloadCompanyId !== companyId.value) return;
  if (reloadTimer !== null) return;
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    void reloadMembersAndCheck();
  }, 300);
};

useSocket('notification:new', (n: unknown) => {
  const notif = n as {
    type?: string;
    payload?: { kind?: string; companyId?: string };
  };
  const reloadKinds = new Set([
    'company_invite_accepted',
    'company_invite_declined',
    // User thực sự decline — row chuyển sang 'declined'.
    // Tách riêng với auto-cancelled (xem dưới) — khác về ngữ nghĩa.
    'company_invite_auto_cancelled',
    // User bị xoá khỏi company (case soft delete active row).
    'removed_from_company',
    // Invite pending bị owner huỷ (case soft delete pending row).
    'invite_cancelled',
    'company_member_left',
    'company_owner_transferred',
    'company_owner_transferred_to_you',
    'company_owner_transferred_from_you',
    // userA tạo company mới → các pending invite của userA ở company khác
    // bị auto-cancel → inviter (owner) nhận kind này và cần reload list.
    'invite_auto_cancelled_on_create_company',
  ]);
  // Sau refactor 0032: company-member lifecycle đi qua type='company' + kind.
  // Vẫn accept type='system' cho rows cũ chưa migrate; cùng một handler.
  if (
    (notif?.type === 'system' || notif?.type === 'company') &&
    notif.payload?.kind &&
    reloadKinds.has(notif.payload.kind) &&
    notif.payload?.companyId
  ) {
    onMembershipChange(notif.payload.companyId);
  }
});

/** Mất kết nối rồi nối lại → refetch một lần (bỏ qua lần connect đầu). */
useSocket('connect', () => {
  if (membersLoadedOnce && loadState.value === 'ready') {
    onMembershipChange(companyId.value ?? '');
  }
});

/* ============================================================================
* Danh sách thành viên — server-side pagination + search + filter + sort
* ==========================================================================*/
/** Kích thước trang — BE clamp limit tối đa 100. */
const PAGE_SIZE = 10;

/** Dữ liệu trang hiện tại — chỉ được ghi bởi lần fetchMembers() mới nhất. */
const members = ref<CompanyMember[]>([]);
const total = ref(0);
const counts = ref<CompanyMemberListCounts>({ all: 0, active: 0, pending: 0, ended: 0 });
/** Row membership của chính viewer (từ response `me`) — không phụ thuộc page. */
const meMember = ref<CompanyMember | null>(null);
/** Owner active + avatar preview (4 active đầu) cho header. */
const ownerInfos = ref<CompanyMemberUserInfo[]>([]);
const previewInfos = ref<CompanyMemberUserInfo[]>([]);
/**
 * Đã fetch danh sách ít nhất 1 lần? Spinner trong template chỉ dành cho
 * lần tải đầu; nếu điều kiện spinner là `loading && members.length === 0`
 * thì khi đang ở trạng thái 0 kết quả search, MỌI request tiếp theo đều
 * thay cả khối danh sách (tabs + search + thead) bằng spinner rồi
 * remount → c3-fade replay → nháy. Flag này chặn điều đó.
 */
const listInit = ref(false);
/**
 * Query (search/filter) của lần fetch THÀNH CÔNG gần nhất. Big-empty
 * "Chưa có thành viên" chỉ được hiển thị khi query hiện tại trên UI khớp
 * với query đã xác nhận này — nếu không, khi user xóa từ khóa (search UI
 * = '' trong khi `total` vẫn là 0 của truy vấn trước), big-empty sẽ lóe
 * lên sai trong khoảng debounce + fetch.
 */
const appliedSearch = ref('');
const appliedFilter = ref<'all' | 'active' | 'pending' | 'ended'>('all');
/**
 * Cờ fetch do VIEW sở hữu: bật sync trước request, tắt SAU KHI state
 * (members/total/counts) đã được gán. Không dùng `memberStore.loading`
 * cho điều kiện render vì store tắt `loading` trong `finally` TRƯỚC khi
 * caller gán state mới → kẽ hở 1 microtask khiến Vue render 1 frame với
 * `total` cũ + `!loading` → big-empty card lóe lên rồi biến mất (nháy).
 */
const fetchingList = ref(false);

/** Trạng thái query hiện tại — mọi thay đổi đều kích hoạt fetchMembers(). */
type MemberFilter = 'all' | 'active' | 'pending' | 'ended';
const memberFilter = ref<MemberFilter>('all');
/** Ô tìm kiếm theo email (không phân biệt hoa thường). */
const memberSearchEmail = ref('');
type SortKey = 'name' | 'role' | 'status' | 'date';
const sortKey = ref<SortKey>('date');
const sortDir = ref<'asc' | 'desc'>('desc');
const page = ref(1);

/** Chống race: chỉ response của lần fetch mới nhất được ghi state. */
let fetchSeq = 0;

/**
 * Gọi API danh sách với query hiện tại (filter + search + sort + page).
 * Frontend KHÔNG filter/sort/slice — mọi thứ xử lý tại backend.
 * Nếu page hiện tại vượt phạm vi (sau xoá/filter), tự clamped về trang hợp lệ.
 */
const fetchMembers = async (): Promise<void> => {
  if (!companyId.value) return;
  const seq = ++fetchSeq;
  memberStore.error = null;
  loadError.value = null;
  // Spinner chỉ dành cho lần tải đầu (trước đó loadState skeleton đã bao);
  // từ fetch thứ 2 trở đi giữ nguyên khối danh sách khi đang loading.
  listInit.value = true;
  const searchUsed = memberSearchEmail.value.trim();
  // Ghi nhận query của request này — debounce callback so sánh để bỏ request
  // thừa trùng khít (vd sau "Xóa bộ lọc" cả 2 watcher đều kích hoạt).
  lastQueryKey = queryKey();
  fetchingList.value = true;
  const result = await memberStore.fetchPage(companyId.value, {
    limit: PAGE_SIZE,
    offset: (page.value - 1) * PAGE_SIZE,
    search: searchUsed || undefined,
    status: memberFilter.value,
    sortBy: sortKey.value,
    sortOrder: sortDir.value,
  });
  if (seq !== fetchSeq) return; // response cũ — bỏ qua
  if (!result) {
    // Lỗi đã ghi vào loadError → banner "Thử lại" trong template.
    loadError.value = memberStore.error ?? 'Không thể tải danh sách thành viên.';
    members.value = [];
    total.value = 0;
    fetchingList.value = false;
    return;
  }
  members.value = result.members;
  total.value = result.total;
  counts.value = result.counts;
  meMember.value = result.me;
  ownerInfos.value = result.owners;
  previewInfos.value = result.preview;
  // Xác nhận query hiện tại đã có dữ liệu — big-empty chỉ dựa trên cặp
  // search/filter ĐÃ XÁC NHẬN này, không dựa trên giá trị UI đang gõ.
  appliedSearch.value = searchUsed;
  appliedFilter.value = memberFilter.value;
  // Chỉ tắt cờ SAU KHI state đã gán xong → không có frame nào render với
  // `total` cũ + cờ tắt (nguồn big-empty lóe lên khi search 0 kết quả).
  // Không remount danh sách theo key: Vue patch theo row.userId → chỉ hàng
  // MỚI mount chạy stagger `.ml-row`, hàng cũ giữ nguyên không nháy (search,
  // tab, phân trang, realtime đều như nhau).
  // List co lại sau xoá/filter → kẹp page vào phạm vi hợp lệ (fetch lại 1 lần).
  const maxPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  if (page.value > maxPage) {
    page.value = maxPage;
    fetchingList.value = false;
    if (result.total > 0) return fetchMembers();
  }
  if (result.total === 0 && page.value !== 1) {
    page.value = 1;
  }
  fetchingList.value = false;
};

/** Member row của current user — từ response `me`, không phụ thuộc page. */
const currentUserMember = computed<CompanyMember | null>(() => meMember.value);

/** Current user là owner active? */
const isCurrentUserOwner = computed<boolean>(() => {
  const m = currentUserMember.value;
  return !!m && m.role === 'owner' && m.status === 'active';
});

/* ============================================================================
* Header — owner list + member avatar preview (card "Thành viên")
* ==========================================================================*/
/** Danh sách owner active — hiển thị ở khối "Chủ sở hữu" dưới mô tả. */
const owners = computed<CompanyMember[]>(() =>
  ownerInfos.value.map((u) => ({ userId: u.id, user: u }) as unknown as CompanyMember),
);

/** Số ô avatar tối đa trong card preview; phần thừa gộp vào chip "+N". */
const PREVIEW_MAX = 4;
const previewMembers = computed<CompanyMember[]>(() =>
  previewInfos.value.map((u) => ({ userId: u.id, user: u }) as unknown as CompanyMember),
);
const previewOverflowCount = computed<number>(() =>
  Math.max(0, counts.value.active - previewMembers.value.length),
);

/**
 * Copy website của công ty (field `company.website`, có thể null).
 * Chuẩn hoá URL: thiếu scheme → thêm https://. Ưu tiên Clipboard API,
 * fallback document.execCommand('copy') cho context không hỗ trợ.
 */
const copyCompanyLink = async (): Promise<void> => {
  const raw = company.value?.website?.trim();
  if (!raw) return;
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      // Fallback cho context không có Clipboard API (http, iframe cũ...)
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    toast.success('Đã sao chép website công ty');
  } catch {
    toast.error('Không thể sao chép liên kết');
  }
};

/* ============================================================================
* Filter tabs — count tổng hợp từ BE (counts), không từ members.length
* ==========================================================================*/

/** Tab hiển thị: LUÔN hiện đủ 4 tab cho owner (kể cả tab 0 mục — empty state
 *  hiển thị trong khu vực nội dung, không ẩn tab làm layout nhảy). Member
 *  thường vẫn chỉ nhận scope active từ BE nên các tab pending/ended luôn 0 —
 *  tabs này vốn bị ẩn theo quyền, giữ nguyên hành vi đó. */
const filterTabs = computed<{ key: MemberFilter; label: string; count: number }[]>(() => {
  if (!isCurrentUserOwner.value) {
    return [
      { key: 'all', label: 'Tất cả', count: counts.value.all },
      { key: 'active', label: 'Đang hoạt động', count: counts.value.active },
    ];
  }
  return [
    { key: 'all', label: 'Tất cả', count: counts.value.all },
    { key: 'active', label: 'Đang hoạt động', count: counts.value.active },
    { key: 'pending', label: 'Chờ chấp nhận', count: counts.value.pending },
    { key: 'ended', label: 'Đã kết thúc', count: counts.value.ended },
  ];
});

/**
 * Xóa bộ lọc → reset về mặc định + FETCH NGAY (không qua debounce).
 *
 * Vì sao phải fetch ngay: sau reset, `total` vẫn giữ giá trị cũ (0 nếu
 * đang 0 kết quả) và `loading` chưa bật (debounce 300ms chưa tới) →
 * điều kiện big-empty `total === 0 && !loading && search === ''` thỏa →
 * cả khối danh sách bị thay bằng big-empty card rồi swap lại khi
 * fetch chạy = nháy 2 lần. Fetch đồng bộ ở đây bật `loading` ngay, giữ
 * list block (empty-row trong bảng) ổn định xuyên suốt.
 */
const clearFilters = (): void => {
  if (searchTimer !== null) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  memberFilter.value = 'all';
  memberSearchEmail.value = '';
  void fetchMembers();
};

/* ============================================================================
* Modals — điều phối mở/đóng; nội dung modal nằm ở component riêng
* ==========================================================================*/
/* ---------- Invite modal (InviteMemberModal) ---------- */
const inviteInitialEmail = ref('');
const inviteSaving = ref(false);
const inviteError = ref<string | null>(null);
let inviteReturnFocusEl: HTMLElement | null = null;

/**
 * Validate email format — không quá strict, chỉ bắt buộc có @ và . sau @.
 * Match với Zod schema ở BE (z.string().email()).
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const openInvite = (): void => {
  inviteInitialEmail.value = '';
  inviteError.value = null;
  inviteSaving.value = false;
  memberStore.error = null;
  inviteReturnFocusEl = document.activeElement as HTMLElement | null;
  inviteOpen.value = true;
};

const closeInvite = (): void => {
  inviteOpen.value = false;
  inviteError.value = null;
  inviteSaving.value = false;
  memberStore.error = null;
  inviteReturnFocusEl?.focus();
  inviteReturnFocusEl = null;
};

/** Watcher đồng bộ: khi modal đóng bằng bất kỳ cách nào, dọn sạch error và loading. */
watch(inviteOpen, (open) => {
  if (!open) {
    inviteError.value = null;
    inviteSaving.value = false;
    memberStore.error = null;
  }
});

let inviteSeq = 0;

/**
 * Nhận submit từ InviteMemberModal (đã trim/lowercase ở component).
 * Validate + gọi store + toast; lỗi hiển thị lại trong modal qua prop.
 */
const submitInvite = async (payload: {
  email: string;
  role: CompanyMemberRole;
}): Promise<void> => {
  if (inviteSaving.value) return; // guard double-submit
  const seq = ++inviteSeq;
  inviteError.value = null;
  memberStore.error = null;
  const email = payload.email;
  if (!email) {
    inviteError.value = 'Vui lòng nhập email.';
    return;
  }
  if (!EMAIL_REGEX.test(email)) {
    inviteError.value = 'Email không hợp lệ.';
    return;
  }
  if (!companyId.value) {
    inviteError.value = 'Không xác định được công ty.';
    return;
  }

  inviteSaving.value = true;
  try {
    const result = await memberStore.add(companyId.value, {
      email,
      role: payload.role,
    });
    if (seq !== inviteSeq) return;
    if (result) {
      toast.success(`Đã gửi lời mời tới ${email}.`);
      inviteOpen.value = false;
      inviteError.value = null;
      memberStore.error = null;
      // Refetch trang hiện tại để lấy user info (fullName/avatarUrl) của
      // invite mới + cập nhật total/counts đúng.
      await fetchMembers();
    } else {
      inviteError.value = friendlyInviteError(memberStore.error) ?? 'Không thể gửi lời mời.';
      // Dọn sạch memberStore.error để không rò rỉ sang banner trang cha hoặc các thao tác khác
      memberStore.error = null;
    }
  } catch (e) {
    if (seq !== inviteSeq) return;
    inviteError.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra.';
    memberStore.error = null;
  } finally {
    if (seq === inviteSeq) {
      inviteSaving.value = false;
    }
  }
};

/**
 * Chuẩn hoá lỗi invite hiển thị trong modal.
 *
 * Vì sao không map theo error code: http.ts bọc lỗi BE thành HttpError với
 * `code` ở field RIÊNG, còn memberStore.error (string) chỉ giữ `e.message` —
 * tức là View chỉ nhận được message tiếng Việt thân thiện đã viết sẵn ở
 * backend/src/service/companyMember.service.ts (USER_NOT_FOUND,
 * ALREADY_PENDING, ALREADY_ACTIVE_ELSEWHERE... đều có message riêng).
 * Các nhánh map theo code cũ (MEMBER_EXISTS, ALREADY_IN_COMPANY,
 * USER_ACTIVE_ELSEWHERE...) vì thế không bao giờ khớp — đã xoá để không
 * ảo tưởng rằng mapping đang chạy. Chỉ cần fallback message gốc.
 */
const friendlyInviteError = (raw: string | null): string => {
  if (!raw) return 'Đã có lỗi xảy ra.';
  return raw;
};

/* ============================================================================
* Inline actions — hard delete + re-invite model (menu trên từng row)
* ==========================================================================*/

/**
 * Owner có thể xoá member này không? (active/pending; không xoá owner active)
 */
const canRemoveMember = (row: CompanyMember): boolean => {
  if (!isCurrentUserOwner.value) return false;
  if (row.role === 'owner' && row.status === 'active') return false;
  if (row.status !== 'active' && row.status !== 'pending') return false;
  return true;
};

/** Owner có thể mời lại user này không? — Cần email để pre-fill invite. */
const canReinviteMember = (row: CompanyMember): boolean => {
  if (!isCurrentUserOwner.value) return false;
  if (row.status === 'active') return false; // Đã active, không cần mời lại
  if (!row.user?.email) return false; // Cần email để pre-fill
  return true;
};

/** Có thể transfer ownership sang row này không? */
const canTransferOwnership = (row: CompanyMember): boolean => {
  if (!isCurrentUserOwner.value) return false;
  if (row.userId === auth.user?.id) return false;
  if (row.role === 'owner') return false;
  if (row.status !== 'active') return false;
  return true;
};

/**
 * User hiện tại có thể tự rời công ty từ row này không? (đúng row của mình,
 * role member, status active)
 */
const canLeaveCompany = (row: CompanyMember): boolean => {
  if (row.userId !== auth.user?.id) return false;
  if (row.role !== 'member') return false;
  if (row.status !== 'active') return false;
  return true;
};

/** Lấy danh sách action cho 1 row (max 2 button) — truyền xuống Table. */
const getRowActions = (row: CompanyMember): RowActionItem[] => {
  const items: RowActionItem[] = [];

  // 1. Transfer ownership — chỉ owner mới thấy + chỉ active non-owner (không phải self)
  if (isCurrentUserOwner.value && canTransferOwnership(row)) {
    items.push({
      label: 'Chuyển quyền',
      icon: UserRoundCheck,
      handler: () => openTransfer(row),
    });
  }

  // 2. Delete — status='pending' → "Hủy lời mời"; status='active' → "Xóa khỏi công ty".
  //    Status khác (đã soft-delete) → BE reject, dùng "Mời lại" thay thế.
  if (canRemoveMember(row)) {
    if (row.status === 'pending') {
      items.push({
        label: 'Hủy lời mời',
        danger: true,
        icon: XCircle,
        handler: () => removeMember(row),
      });
    } else {
      items.push({
        label: 'Xóa khỏi công ty',
        danger: true,
        icon: Trash2,
        handler: () => removeMember(row),
      });
    }
  }

  // 3. Re-invite — chỉ non-active có email. Đặt SAU để không trùng "Xoá".
  if (canReinviteMember(row) && row.status !== 'active' && row.status !== 'pending') {
    items.push({
      label: 'Mời lại',
      icon: MailPlus,
      handler: () => reinviteMember(row),
    });
  }

  // 4. Leave company — chỉ hiện cho CHÍNH current user khi họ là member active.
  if (canLeaveCompany(row)) {
    items.push({
      label: 'Rời công ty',
      danger: true,
      icon: LogOut,
      handler: () => openLeave(),
    });
  }

  return items;
};

let removeSeq = 0;

/** Handler bước 1: mở DeleteMemberModal để user xác nhận trước khi xoá. */
const removeMember = (row: CompanyMember): void => {
  removeTarget.value = row;
  removeError.value = null;
  removeSaving.value = false;
  memberStore.error = null;
};

/** Handler bước 2: gọi API xoá sau khi user đã confirm. */
const confirmRemoveMember = async (): Promise<void> => {
  const row = removeTarget.value;
  if (!row || !companyId.value || removeSaving.value) {
    if (!removeSaving.value) removeTarget.value = null;
    return;
  }
  const seq = ++removeSeq;
  removeSaving.value = true;
  removeError.value = null;
  memberStore.error = null;
  try {
    const ok = await memberStore.remove(companyId.value, row.userId);
    if (seq !== removeSeq) return;
    if (ok) {
      const name = row.user?.fullName ?? row.user?.email ?? 'thành viên';
      if (row.status === 'pending') {
        toast.success(`Đã huỷ lời mời tới ${name}.`);
      } else {
        toast.success(`Đã xoá ${name} khỏi công ty.`);
      }
      removeTarget.value = null;
      removeError.value = null;
      memberStore.error = null;
      // Refetch trang hiện tại để row biến mất + total/counts cập nhật đúng.
      // fetchMembers tự kẹp page về phạm vi hợp lệ nếu trang cuối không còn row.
      await fetchMembers();
    } else {
      removeError.value = memberStore.error ?? 'Không thể xoá thành viên.';
      memberStore.error = null;
    }
  } catch (e) {
    if (seq !== removeSeq) return;
    removeError.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra.';
    memberStore.error = null;
  } finally {
    if (seq === removeSeq) {
      removeSaving.value = false;
    }
  }
};

/** Đóng modal khi user cancel (click backdrop / ESC / nút Hủy). */
const cancelRemove = (): void => {
  if (removeSaving.value) return;
  removeTarget.value = null;
  removeError.value = null;
  removeSaving.value = false;
  memberStore.error = null;
};

/** Watcher đồng bộ: khi modal xoá đóng bằng bất kỳ cách nào, dọn sạch error và loading. */
watch(removeTarget, (target) => {
  if (!target) {
    removeError.value = null;
    removeSaving.value = false;
    memberStore.error = null;
  }
});

/** Handler: mở InviteModal pre-fill với email user để mời lại. */
const reinviteMember = (row: CompanyMember): void => {
  if (!row.user?.email) {
    toast.error('User chưa có email — không thể mời lại.');
    return;
  }
  inviteInitialEmail.value = row.user.email;
  inviteError.value = null;
  inviteSaving.value = false;
  memberStore.error = null;
  inviteOpen.value = true;
};

/* ---------- Transfer ownership ---------- */
/** Email owner mới hiển thị trong modal (fallback userId nếu user chưa có email). */
const transferEmail = computed<string>(() => {
  const t = transferTarget.value;
  if (!t) return '';
  return t.user?.email ?? t.userId;
});

let transferSeq = 0;

const openTransfer = (row: CompanyMember): void => {
  transferTarget.value = row;
  transferError.value = null;
  transferSaving.value = false;
  memberStore.error = null;
};

/**
 * Nội dung DeleteMemberModal — phân biệt 2 case:
 *   - status='active' → mặc định của modal ("Xoá thành viên?" + email trong mô tả)
 *   - status='pending' → ghi đè title/description/confirmText thành huỷ lời mời
 * Fallback tên khi user chưa có email: dùng userId (8 ký tự đầu).
 */
const removeEmail = computed<string>(() => {
  const t = removeTarget.value;
  if (!t) return '';
  return t.user?.email ?? t.userId;
});

const removeTitle = computed<string>(() =>
  removeTarget.value?.status === 'pending' ? 'Huỷ lời mời?' : 'Xóa thành viên?',
);

const removeDescription = computed<string>(() => {
  const t = removeTarget.value;
  if (!t || t.status !== 'pending') return '';
  const name = t.user?.fullName ?? t.user?.email ?? `User ID ${t.userId.slice(0, 8)}…`;
  return `Bạn có chắc chắn muốn huỷ lời mời đã gửi tới ${name}? Hành động này không thể hoàn tác — nếu muốn mời lại, bạn phải tạo invite mới.`;
});

const removeConfirmText = computed<string>(() =>
  removeTarget.value?.status === 'pending' ? 'Huỷ lời mời' : 'Xóa thành viên',
);

/** Đóng modal (nút Hủy / nút X / backdrop / ESC — component tự chặn khi loading). */
const onTransferModalClose = (): void => {
  if (!transferSaving.value) {
    transferTarget.value = null;
    transferError.value = null;
    transferSaving.value = false;
    memberStore.error = null;
  }
};

/** Watcher đồng bộ: khi modal chuyển quyền đóng bằng bất kỳ cách nào, dọn sạch error và loading. */
watch(transferTarget, (target) => {
  if (!target) {
    transferError.value = null;
    transferSaving.value = false;
    memberStore.error = null;
  }
});

const submitTransfer = async (): Promise<void> => {
  if (!transferTarget.value || !companyId.value || transferSaving.value) return;
  const seq = ++transferSeq;
  transferSaving.value = true;
  transferError.value = null;
  memberStore.error = null;
  try {
    const result = await memberStore.transferOwner(companyId.value, {
      newOwnerUserId: transferTarget.value.userId,
    });
    if (seq !== transferSeq) return;
    if (result) {
      toast.success('Đã chuyển quyền sở hữu công ty.');
      transferTarget.value = null;
      transferError.value = null;
      memberStore.error = null;
      // Refetch trang hiện tại để refresh cache + đảm bảo consistency sau swap.
      await fetchMembers();
    } else {
      transferError.value = memberStore.error ?? 'Không thể chuyển quyền sở hữu.';
      memberStore.error = null;
    }
  } catch (e) {
    if (seq !== transferSeq) return;
    transferError.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra.';
    memberStore.error = null;
  } finally {
    if (seq === transferSeq) {
      transferSaving.value = false;
    }
  }
};

/* ---------- Leave company (self) ---------- */
const leaveOpen = ref(false);
const leaveSaving = ref(false);
const leaveError = ref<string | null>(null);

const openLeave = (): void => {
  if (!companyId.value || !auth.user) return;
  leaveError.value = null;
  leaveOpen.value = true;
};

const submitLeave = async (): Promise<void> => {
  if (!companyId.value || !auth.user || leaveSaving.value) return;
  leaveSaving.value = true;
  leaveError.value = null;
  try {
    const result = await memberStore.leaveCompany(companyId.value, auth.user.id);
    if (result) {
      toast.success('Đã rời công ty.');
      leaveOpen.value = false;
      // Reload company context → state 'no-company' sẽ tự động.
      await companyStore.fetchById(companyId.value, { includeJobs: false });
      // Navigate về /employer/company để thấy empty state + modal tạo company.
      // (Không navigate nếu đang ở đúng route đó.)
      if (route.name !== 'employer-company') {
        await router.push({ name: 'employer-company' });
      }
    } else {
      leaveError.value = memberStore.error ?? 'Không thể rời công ty.';
      memberStore.error = null;
    }
  } catch (e) {
    leaveError.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra.';
    memberStore.error = null;
  } finally {
    leaveSaving.value = false;
  }
};

/* ============================================================================
* Pagination + sort — điều phối qua events từ CompanyMembersTable
* ==========================================================================*/
const totalPages = computed<number>(() =>
  Math.max(1, Math.ceil(total.value / PAGE_SIZE)),
);

/** Chuyển trang — offset = (page - 1) * PAGE_SIZE (fetchMembers tính từ page). */
const goToPage = (n: number): void => {
  if (n < 1 || n > totalPages.value || memberStore.loading) return;
  page.value = n;
  void fetchMembers();
};

const toggleSort = (key: 'role' | 'status' | 'date'): void => {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = key;
    // Ngày: mặc định mới nhất lên đầu; tên/trạng thái: A→Z.
    sortDir.value = key === 'date' ? 'desc' : 'asc';
  }
};

/**
 * Debounce 300ms cho ô tìm kiếm: mỗi keystroke reset timer; chỉ sau 300ms
 * không có thay đổi mới gọi API (với giá trị đã trim, về trang 1). Timer
 * được clear khi unmount (xem onBeforeUnmount) — không rò rỉ timer.
 *
 * Dedupe: nếu query sau debounce TRÙNG KHÍT với request cuối cùng (vd
 * "Xóa bộ lọc" vừa reset filter+search và filter-watcher đã fetch), bỏ qua
 * để không phát sinh request thừa. Realtime refetch gọi fetchMembers()
 * trực tiếp, không qua đường này → không bị chặn.
 */
let searchTimer: ReturnType<typeof setTimeout> | null = null;
const queryKey = () =>
  `${memberFilter.value}|${sortKey.value}|${sortDir.value}|${(page.value - 1) * PAGE_SIZE}|${memberSearchEmail.value.trim()}`;
let lastQueryKey = '';
watch(memberSearchEmail, () => {
  if (searchTimer !== null) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTimer = null;
    page.value = 1;
    if (queryKey() === lastQueryKey && listInit.value) return;
    void fetchMembers();
  }, 300);
});

/** Đổi tab filter hoặc sort → về trang 1 + fetch lại (server-side).
 *  Guard lastQueryKey: sau "Xóa bộ lọc" (fetch trực tiếp), watcher filter
 *  vẫn fire nhưng query trùng khít → bỏ qua, không fetch/request thừa. */
watch([memberFilter, sortKey, sortDir], () => {
  page.value = 1;
  if (queryKey() === lastQueryKey && listInit.value) return;
  void fetchMembers();
});
</script>

<template>
  <div id="members-page-root" class="font-poppins min-h-screen bg-white p-5 text-slate-900 antialiased md:p-8">
    <div class="mx-auto max-w-6xl space-y-6">
      <!-- =================== Header =================== -->
      <!-- Skeleton placeholder cho toàn khối header khi loading -->
      <div v-if="loadState === 'loading'" class="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div class="flex items-start gap-4">
          <div class="h-20 w-20 shrink-0 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />
          <div class="min-w-0 flex-1 space-y-2 pt-1">
            <div class="h-7 w-56 animate-pulse rounded-md bg-slate-100 motion-reduce:animate-none" />
            <div class="h-4 w-72 animate-pulse rounded-md bg-slate-100 motion-reduce:animate-none" />
          </div>
        </div>
        <div class="h-48 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />
      </div>

      <!-- No company: giữ tiêu đề đơn giản như cũ -->
      <header v-else-if="loadState === 'no-company'" class="flex flex-wrap items-center justify-between gap-4">
        <div class="min-w-0">
          <h1 class="text-lg font-semibold tracking-[-0.01em] text-slate-900">Thành viên công ty</h1>
          <p class="mt-0.5 text-[13px] text-slate-500">
            Quản lý thành viên và quyền truy cập của công ty.
          </p>
        </div>
      </header>

      <!-- =================== Loading state (skeleton) =================== -->
      <CompanyMembersSkeleton v-if="loadState === 'loading'" />

      <!-- =================== No company =================== -->
      <div v-else-if="loadState === 'no-company'" class="rounded-xl border border-slate-200 bg-white">
        <div class="flex flex-col items-center justify-center px-6 py-16 text-center">
          <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#5b4eea]/10">
            <Building2 class="h-7 w-7 text-[#5b4eea]" />
          </div>
          <h2 class="text-base font-semibold text-slate-900">Bạn chưa thuộc công ty nào</h2>
          <p class="mt-2 max-w-md text-sm text-slate-500">
            Bạn cần thuộc một công ty để mời và quản lý thành viên.
          </p>
          <RouterLink
            :to="{ name: 'employer-company' }"
            class="mt-5 inline-flex items-center justify-center gap-2 rounded-lg border border-transparent bg-[#5b4eea] px-5 py-[11px] text-[13px] font-semibold tracking-[0.04em] text-white no-underline transition-colors duration-150 hover:bg-[#4839d8] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
          >
            <Building2 :size="15" aria-hidden="true" />
            Đến hồ sơ công ty
          </RouterLink>
        </div>
      </div>

      <!-- =================== Ready =================== -->
      <template v-else>
        <!-- ============ Error banner ============ -->
        <div
          v-if="loadError"
          class="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3"
        >
          <AlertCircle :size="16" class="mt-0.5 shrink-0 text-red-500" />
          <p class="m-0 flex-1 text-[13px] leading-[1.6] text-red-700" role="alert">{{ loadError }}</p>
          <button
            type="button"
            class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-700 transition-colors duration-150 hover:border-slate-300 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
            @click="companyId ? fetchMembers() : loadData()"
          >
            <RefreshCw :size="13" aria-hidden="true" />
            Thử lại
          </button>
        </div>

        <!-- ============ Header: thông tin công ty + card Thành viên ============ -->
        <CompanyMembersHeader
          v-if="company"
          :company="company"
          :counts="counts"
          :is-owner="isCurrentUserOwner"
          :current-user-is-active="currentUserMember?.status === 'active'"
          :owners="owners"
          :preview-members="previewMembers"
          :preview-overflow-count="previewOverflowCount"
          @invite="openInvite"
          @copy-website="copyCompanyLink"
        />

        <!-- ============ Loading list — CHỈ lần tải đầu ============ -->
        <div
          v-if="memberStore.loading && !listInit"
          class="flex items-center justify-center py-12"
          aria-busy="true"
        >
          <Loader2 class="h-5 w-5 animate-spin text-slate-400" />
        </div>

        <!-- ============ Empty (chỉ khi không có filter/search nào) ============ -->
        <div
          v-else-if="total === 0 && !fetchingList && memberFilter === 'all' && memberSearchEmail.trim() === '' && appliedSearch === '' && appliedFilter === 'all'"
          class="rounded-xl border border-slate-200 bg-white"
        >
          <div class="flex flex-col items-center justify-center px-6 py-14 text-center">
            <div class="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#5b4eea]/10">
              <Users class="h-6 w-6 text-[#5b4eea]" />
            </div>
            <h3 class="text-sm font-semibold text-slate-900">Chưa có thành viên</h3>
            <p class="mt-1 max-w-sm text-xs text-slate-500">
              Mời đồng đội tham gia để cùng quản lý công ty.
            </p>
            <button
              v-if="isCurrentUserOwner"
              type="button"
              class="mt-4 inline-flex items-center justify-center gap-2 rounded-lg border border-transparent bg-[#5b4eea] px-4 py-2.5 text-[13px] font-semibold tracking-[0.04em] text-white transition-colors duration-150 hover:bg-[#4839d8] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
              @click="openInvite"
            >
              <UserPlus :size="15" aria-hidden="true" /> Mời thành viên
            </button>
          </div>
        </div>

        <!-- ============ Members table (một bảng duy nhất, mọi trạng thái) ============ -->
        <!-- Tabpanel của tab lọc trạng thái ở Toolbar: id/label trùng khớp với
             `aria-controls` của các tab (company-members-tab-*). ID tĩnh an toàn
             vì route này chỉ mount đúng 1 instance View + Toolbar. -->
        <div
          v-else
          id="company-members-content"
          role="tabpanel"
          :aria-labelledby="isCurrentUserOwner ? `company-members-tab-${memberFilter}` : undefined"
          class="c3-fade c3-d1 overflow-hidden scroll-mt-6"
        >
          <CompanyMembersToolbar
            :tabs="filterTabs"
            :filter="memberFilter"
            :search="memberSearchEmail"
            :is-owner="isCurrentUserOwner"
            @update:filter="memberFilter = $event"
            @update:search="memberSearchEmail = $event"
          />

          <CompanyMembersTable
            :members="members"
            :fetching="fetchingList"
            :total="total"
            :page="page"
            :page-size="PAGE_SIZE"
            :total-pages="totalPages"
            :sort-key="sortKey"
            :sort-dir="sortDir"
            :actions-for="getRowActions"
            @page-change="goToPage"
            @clear-filters="clearFilters"
            @sort="toggleSort"
          />
        </div>
      </template>
    </div>

    <!-- =================== Invite modal =================== -->
    <InviteMemberModal
      :open="inviteOpen"
      :saving="inviteSaving"
      :error="inviteError"
      :initial-email="inviteInitialEmail"
      @close="closeInvite"
      @submit="submitInvite"
    />

    <!-- =================== Transfer ownership modal =================== -->
    <TransferOwnershipModal
      :open="transferTarget !== null"
      :email="transferEmail"
      :error="transferError"
      :loading="transferSaving"
      @close="onTransferModalClose"
      @confirm="submitTransfer"
    />

    <!-- =================== Remove member confirm modal =================== -->
    <DeleteMemberModal
      :open="removeTarget !== null"
      :email="removeEmail"
      :error="removeError"
      :title="removeTitle"
      :description="removeDescription || undefined"
      :confirm-text="removeConfirmText"
      :loading="removeSaving"
      @close="cancelRemove"
      @confirm="confirmRemoveMember"
    />

    <!-- =================== Leave company modal =================== -->
    <ConfirmModal
      :open="leaveOpen"
      title="Rời công ty?"
      :message="leaveError ? leaveError : `Sau khi rời, bạn sẽ mất quyền truy cập vào các tính năng dành cho thành viên của công ty này. Nếu muốn quay lại, bạn cần được owner mời lại.`"
      confirm-text="Rời công ty"
      variant="danger"
      :loading="leaveSaving"
      @update:open="leaveOpen = $event"
      @confirm="submitLeave"
    />
  </div>
</template>

<!-- Style KHÔNG scoped: animation global áp cho cả các component con
     (header grid, tbody rows...). Định nghĩa trùng tên/timing với
     CompanyView vì chunk bên đó không đảm bảo đã load — quy tắc CSS
     giống nhau nên việc nhân bản là vô hại. -->
<style>
/* ==== Ẩn scrollbar dọc của trang trên members (nguyên nhân nháy: skeleton
   cao hơn nội dung thật → scrollbar hiện lúc skeleton rồi mất khi data về).
   Vẫn cuộn bình thường bằng wheel/touchpad/touch — chỉ ẩn phần hiển thị.
   Scope bằng :has(): chỉ áp dụng khi trang members đang mount, navigate
   away là trả lại scrollbar bình thường cho trang khác. ==== */
html:has(#members-page-root) {
  scrollbar-width: none; /* Firefox */
}
html:has(#members-page-root)::-webkit-scrollbar {
  width: 0;
  height: 0; /* Chromium/Safari — ẩn cả thanh ngang viewport nếu lóe */
}

/* ==== Ẩn scrollbar CỦA WRAPPER BẢNG desktop (lỗi chính user báo):
   trước đây `ml-list-fade` translateY(4px) làm tbody tạm cao hơn → wrapper
   (overflow-x-auto → computed overflow-y: auto) vẽ scrollbar dọc ~2-3 frame
   rồi biến mất khi animation xong → bảng giật 15px (đo thực tế: tableW
   1121 → 1136). Hiệu ứng hàng hiện chỉ dùng opacity nên không còn tạo
   overflow, giữ rule này làm bảo vệ (mobile/viewport hẹp vẫn có thể tràn).
   Cuộn ngang khi bảng hẹp hơn nội dung vẫn hoạt động bằng
   wheel/shift+wheel/touch. Scope trong #members-page-root — không lan app.
   Lưu ý: selector trúng cả input search trong Toolbar con — action ẩn
   scrollbar không ảnh hưởng hành vi gõ/phóng lớn của input. ==== */
#members-page-root .overflow-x-auto {
  scrollbar-width: none; /* Firefox */
}
#members-page-root .overflow-x-auto::-webkit-scrollbar {
  width: 0;
  height: 0; /* Chromium/Safari */
}

/* Stagger fade-up khi trang xuất hiện — y hệt CompanyView:
   0.35s cubic-bezier(0.22,1,0.36,1), translateY(10px) → none, delay 60/120ms. */
.c3-fade {
  animation: c3-fade-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.c3-d1 {
  animation-delay: 60ms;
}
@keyframes c3-fade-up {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    /* `none` (không phải translateY(0)) để fill-mode `both` không giữ lại
       transform tồn dư — tránh tạo containing block lệch layout. */
    transform: none;
  }
}
/* Tinh chỉnh dễ nhìn hơn — scope trong #members-page-root vì .c3-fade/.c3-d1
   là class global trùng với CompanyView: sửa trực tiếp sẽ đổi cả trang
   tham khảo khi cả 2 chunk đã load. Chỉ đổi duration/delay, giữ hướng chạy,
   easing, trạng thái cuối. */
#members-page-root .c3-fade {
  animation-duration: 0.5s;
}
#members-page-root .c3-d1 {
  animation-delay: 100ms;
}

/* Stagger theo từng hàng (tham khảo bm-row của BillingHistoryView):
   chỉ opacity — không đổi hình học hàng → không đẩy layout, không sinh
   scrollbar trong wrapper. Danh sách KHÔNG remount theo key: Vue patch theo
   row.userId → chỉ hàng mới mount chạy stagger; hàng cũ giữ nguyên không
   nháy (search, tab, phân trang, realtime như nhau).
   Delay 60ms/hàng binding qua :style trên từng phần tử (không dùng JS timer). */
.ml-row {
  animation: ml-row-fade 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes ml-row-fade {
  from {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .c3-fade,
  .ml-row {
    animation: none;
  }
}
</style>
