    <script setup lang="ts">
    import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
    import {
    AlertCircle,
    ArrowUpDown,
    Building2,
    ArrowDown,
    ArrowUp,
    Crown,
    Link2,
    Loader2,
    Plus,
    RefreshCw,
    Search,
    User as UserIcon,
    UserPlus,
    Users,
    X,
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
    import MemberRowMenu from '@components/employer/MemberRowMenu.vue';
    import { formatDate } from '@/utils/format';
    import type {
    CompanyMember,
    CompanyMemberListCounts,
    CompanyMemberRole,
    CompanyMemberStatus,
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
    /** Row sắp được xoá (mở ConfirmModal trước khi gọi API thật). */
    const removeTarget = ref<CompanyMember | null>(null);
    const removeSaving = ref(false);

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
    // /employer/company (CompanyProfilePage) dùng chung state đó.
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
     * membership của company hiện tại. Các kind được handle:
     *
     *   - `company_invite_accepted`        (user accept → status pending → active)
     *   - `company_invite_declined`       (user decline → status pending → declined)
     *   - `removed_from_company`         (owner xoá member active → user bị xoá)
     *   - `invite_cancelled`             (owner huỷ invite pending)
     *   - `company_member_left`           (member tự rời)
     *   - `company_owner_transferred`     (owner transfer — các member còn lại)
     *   - `company_owner_transferred_to_you`  (chính mình được promote — không
     *                                          cần thiết cho FE này nhưng cũng
     *                                          reload để role hiển thị đúng)
     *
     * Tất cả đều trigger refetch → list + role badges luôn consistent với DB.
     * Filter theo `payload.companyId === companyId.value` để không refetch
     * nhầm khi user đang ở CompanyView khác.
     *
     * Đặc biệt với `removed_from_company` / `invite_cancelled` / `company_member_left`:
     * nếu
     * current user là người bị ảnh hưởng (bị xoá hoặc tự rời), navigate họ
     * ra khỏi trang members → `/employer/company` để thấy empty state + modal
     * tạo công ty. Không navigate nếu user chỉ là người xem (affected ≠ current).
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
    /** Element ô tìm kiếm — dùng trả focus sau khi bấm nút X. */
    const searchInputEl = ref<HTMLInputElement | null>(null);

    /**
     * Nút X trong ô tìm kiếm: chỉ xóa giá trị. Fetch do watcher debounce lo
     * (dedupe `lastQueryKey` chặn request thừa). Trả focus về input sau click
     * (click nút mặc định đánh mất focus ra body).
     */
    const clearSearchInput = (): void => {
    if (!memberSearchEmail.value) return;
    memberSearchEmail.value = '';
    void nextTick(() => searchInputEl.value?.focus());
    };

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
        // Lỗi đã ghi vào memberStore.error → banner "Thử lại" trong template.
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

    /** 2 chữ cái viết tắt cho avatar fallback (tên → email → ID). */
    const initials = (row: CompanyMember): string => {
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

    const avatarColor = (row: CompanyMember): string => {
        // FNV-1a trên userId — đủ phân tán cho phân màu, không cần thư viện.
        let hash = 2166136261;
        for (let i = 0; i < row.userId.length; i++) {
            hash ^= row.userId.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        const palette = AVATAR_PALETTES[Math.abs(hash % AVATAR_PALETTES.length)];
        return `${palette.bg} ${palette.text}`;
    };

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
     * tabs này vốn bị ẩn theo quyền, giữ nguyên hành vi đó. */
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

    /** Điều hướng ←→ giữa các tab (roving focus, giữ nguyên aria-selected). */
    const onTabKeydown = (e: KeyboardEvent, index: number): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const tabs = filterTabs.value;
    if (tabs.length < 2) return;
    const next =
        e.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : (index - 1 + tabs.length) % tabs.length;
    const btn = (e.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
    btn?.focus();
    };

    /* ============================================================================
    * Modals
    * ==========================================================================*/
    /* ---------- Invite modal ---------- */
    const inviteEmail = ref('');
    const inviteRole = ref<CompanyMemberRole>('member');
    const inviteSaving = ref(false);
    const inviteError = ref<string | null>(null);

    /**
     * Validate email format — không quá strict (regex native HTML5 email type
     * đã check basic), chỉ bắt buộc có @ và . sau @. Match với Zod schema ở BE
     * (z.string().email()).
     */
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const inviteEmailEl = ref<HTMLInputElement | null>(null);
    let inviteReturnFocusEl: HTMLElement | null = null;

    const openInvite = (): void => {
    inviteEmail.value = '';
    inviteRole.value = 'member';
    inviteError.value = null;
    inviteReturnFocusEl = document.activeElement as HTMLElement | null;
    inviteOpen.value = true;
    void nextTick(() => inviteEmailEl.value?.focus());
    };
    const closeInvite = (): void => {
    if (inviteSaving.value) return;
    inviteOpen.value = false;
    inviteReturnFocusEl?.focus();
    inviteReturnFocusEl = null;
    };

    /** Khóa cuộn nền khi modal mở. */
    watch(inviteOpen, (open) => {
    document.body.style.overflow = open ? 'hidden' : '';
    });

    const submitInvite = async (): Promise<void> => {
    if (inviteSaving.value) return; // guard double-submit
    inviteError.value = null;
    const email = inviteEmail.value.trim().toLowerCase();
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
        role: inviteRole.value,
        });
        if (result) {
        toast.success(`Đã gửi lời mời tới ${email}.`);
        inviteOpen.value = false;
        // Refetch trang hiện tại để lấy user info (fullName/avatarUrl) của
        // invite mới + cập nhật total/counts đúng.
        await fetchMembers();
        } else {
        inviteError.value = friendlyInviteError(memberStore.error) ?? 'Không thể gửi lời mời.';
        }
    } catch (e) {
        inviteError.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra.';
    } finally {
        inviteSaving.value = false;
    }
    };

    /**
     * Map mã lỗi backend → message thân thiện (ưu tiên Tiếng Việt, fallback message gốc).
     *
     * Sau khi http.ts unwrap BE error → HttpError có `.code` và `.message`. Hiện tại
     * BE messages đã là Tiếng Việt thân thiện, nên mapping chủ yếu là **fallback**
     * cho những code BE chưa customize message.
     *
     * Tương thích ngược: vẫn accept string message (substring match) phòng trường hợp
     * store chỉ lưu string (vd các store chưa update sang HttpError).
     */
    const friendlyInviteError = (raw: string | null): string => {
    if (!raw) return 'Đã có lỗi xảy ra.';
    const upper = raw.toUpperCase();
    if (upper.includes('USER_NOT_FOUND')) return 'Email chưa đăng ký tài khoản trên JobMatch.';
    if (upper.includes('MEMBER_EXISTS')) return 'Người dùng này đã thuộc công ty.';
    if (upper.includes('ALREADY_IN_COMPANY')) return 'Người dùng này đang thuộc một công ty khác.';
    if (upper.includes('USER_ACTIVE_ELSEWHERE')) {
        return 'Người dùng này đang là thành viên active của công ty khác. Họ cần rời trước khi có thể nhận lời mời mới.';
    }
    if (upper.includes('USER_NOT_EMPLOYER')) {
        return 'Email này thuộc tài khoản ứng viên. Chỉ tài khoản nhà tuyển dụng mới có thể tham gia công ty.';
    }
    if (upper.includes('USER_NOT_ACTIVE')) {
        return 'Tài khoản chưa kích hoạt hoặc đang bị tạm khoá — không thể tham gia công ty.';
    }
    if (upper.includes('ALREADY_PENDING')) return 'Đã có lời mời đang chờ user này phản hồi.';
    if (upper.includes('ALREADY_ACTIVE')) return 'Người dùng này đã là thành viên active của công ty.';
    if (upper.includes('CANNOT_INVITE_SELF')) return 'Bạn không thể tự mời chính mình.';
    if (upper.includes('CANNOT_REMOVE_OWNER')) return 'Không thể xoá owner duy nhất của công ty. Hãy chuyển quyền sở hữu trước.';
    if (upper.includes('VALIDATION')) return 'Thông tin không hợp lệ.';
    if (upper.includes('FORBIDDEN')) return 'Bạn không có quyền thực hiện thao tác này.';
    // Fallback: BE message đã là Tiếng Việt thân thiện → trả về luôn.
    return raw;
    };

    /* ============================================================================
    * Inline actions — hard delete + re-invite model
    *
    * Thay đổi từ soft delete sang hard delete:
    *   - "Xoá khỏi công ty" → DELETE row (xoá cứng)
    *   - "Huỷ lời mời" → DELETE row (xoá cứng invite)
    *   - "Mời lại" → mở InviteModal pre-filled với email user (tạo row mới)
    *
    * Permission: chỉ owner mới thấy buttons. Member thường → không có actions.
    *
    * Permission-aware render (max 2 buttons/row):
    *   - Owner row active: KHÔNG button (business rule: owner luôn active, không tự xoá,
    *     không thể transfer cho chính mình).
    *   - Member active (non-owner): [Transfer] + [Xoá khỏi công ty]
    *   - Member pending: [Huỷ lời mời] (xoá invite row, soft delete → status='removed')
    *   - Member non-active (declined/removed/left/auto_cancelled):
    *     [Mời lại] (chỉ khi có email — open InviteModal pre-filled)
    *
    * Nút "Xoá" hiện cho status='active' HOẶC 'pending' (BE chấp nhận cả 2,
    * atomic UPDATE WHERE status IN ('active','pending')). Các status khác đã
    * soft-delete rồi → dùng "Mời lại" (canReinviteMember).
    * ==========================================================================*/

    /** Action item cho 1 mục trong menu "⋯" trên row */
    interface RowActionItem {
    label: string;
    danger?: boolean;
    handler: () => void;
    }

    /**
     * Owner có thể xoá member này không?
     *
     * Điều kiện:
     *   - Caller phải là owner active
     *   - Không xoá owner row active (business rule + BE cũng chặn CANNOT_REMOVE_OWNER)
     *   - Status PHẢI là 'active' hoặc 'pending':
     *       - 'active' → "Xoá khỏi công ty" (xoá member đang hoạt động)
     *       - 'pending' → "Huỷ lời mời" (xoá invite chưa được accept)
     *     Các status khác (declined/removed/left/auto_cancelled) → đã soft-delete
     *     rồi, BE sẽ reject. Dùng button "Mời lại" (canReinviteMember) thay thế.
     *
     * Khớp với BE pre-check ở
     * backend/src/service/companyMember.service.ts (remove() chấp nhận cả
     * status='active' và 'pending' sau khi sửa).
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
     * User hiện tại có thể tự rời công ty từ row này không?
     *
     * Điều kiện:
     *   - Đúng là row của current user (row.userId === auth.user.id)
     *   - Không phải owner (BE sẽ reject — chỉ owner duy nhất mới chặn;
     *     nếu có nhiều owner thì BE vẫn cho leave. Nhưng UX thống nhất:
     *     chỉ member mới thấy nút "Rời công ty").
     *   - Status = 'active' (chỉ member active mới rời được — pending/declined
     *     thì không có gì để "rời"; chỉ cần decline invite thôi).
     */
    const canLeaveCompany = (row: CompanyMember): boolean => {
    if (row.userId !== auth.user?.id) return false;
    if (row.role !== 'member') return false;
    if (row.status !== 'active') return false;
    return true;
    };

    /** Lấy danh sách action cho 1 row (max 2 button). */
    const getRowActions = (row: CompanyMember): RowActionItem[] => {
    const items: RowActionItem[] = [];

    // 1. Transfer ownership — chỉ owner mới thấy + chỉ active non-owner (không phải self)
    if (isCurrentUserOwner.value && canTransferOwnership(row)) {
        items.push({
        label: 'Chuyển quyền',
        handler: () => openTransfer(row),
        });
    }

    // 2. Hard delete — chỉ hiện khi status='active' (khớp BE pre-check).
    //    - status='pending' → button "Huỷ lời mời" (xoá invite row).
    //    - status khác (declined/removed/left/auto_cancelled) → KHÔNG hiện,
    //      vì đã soft-delete rồi — BE sẽ reject 409 NOT_ACTIVE. Dùng button
    //      "Mời lại" (canReinviteMember) thay thế.
    if (canRemoveMember(row)) {
        if (row.status === 'pending') {
        items.push({
            label: 'Hủy lời mời',
            danger: true,
            handler: () => removeMember(row),
        });
        } else {
        // canRemoveMember giờ chỉ true khi status='active' → luôn là "Xoá khỏi công ty"
        items.push({
            label: 'Xóa khỏi công ty',
            danger: true,
            handler: () => removeMember(row),
        });
        }
    }

    // 3. Re-invite — chỉ non-active có email (canReinviteMember đã check
    //    row.status !== 'active' + có email).
    //    Đặt SAU để không hiển thị cùng lúc với "Xoá" (ưu tiên Xoá cho active).
    if (canReinviteMember(row) && row.status !== 'active' && row.status !== 'pending') {
        items.push({
        label: 'Mời lại',
        handler: () => reinviteMember(row),
        });
    }

    // 4. Leave company — chỉ hiện cho CHÍNH current user khi họ là member active.
    //    (Owner thì BE đã enforce; member bình thường mới thấy nút này.)
    if (canLeaveCompany(row)) {
        items.push({
        label: 'Rời công ty',
        danger: true,
        handler: () => openLeave(),
        });
    }

    return items;
    };

    /**
     * Handler: xoá member khỏi công ty (gọi store.remove → DELETE /members/:userId).
     *
     * Hỗ trợ cả 2 case:
     *   - status='active'  → "Xoá khỏi công ty" (xoá member đang active)
     *   - status='pending' → "Huỷ lời mời" (cancel invite chưa accept)
     *
     * BE đã được cập nhật để chấp nhận cả 'active' và 'pending' (atomic UPDATE
     * WHERE status IN ('active','pending')), set ended_at = now().
     */
    /**
     * Handler bước 1: mở ConfirmModal để user xác nhận trước khi xoá.
     * Thực sự xoá được thực hiện bởi `confirmRemoveMember()` sau khi user confirm.
     */
    const removeMember = (row: CompanyMember): void => {
    removeTarget.value = row;
    };

    /** Handler bước 2: gọi API xoá sau khi user đã confirm. */
    const confirmRemoveMember = async (): Promise<void> => {
    const row = removeTarget.value;
    if (!row || !companyId.value || removeSaving.value) {
        if (!removeSaving.value) removeTarget.value = null;
        return;
    }
    removeSaving.value = true;
    try {
        const ok = await memberStore.remove(companyId.value, row.userId);
        if (ok) {
        const name = row.user?.fullName ?? row.user?.email ?? 'thành viên';
        if (row.status === 'pending') {
            toast.success(`Đã huỷ lời mời tới ${name}.`);
        } else {
            toast.success(`Đã xoá ${name} khỏi công ty.`);
        }
        // Refetch trang hiện tại để row biến mất + total/counts cập nhật đúng
        // (BE chỉ notify user bị xoá, không notify owner — nên owner phải tự
        // refetch qua action này). fetchMembers tự kẹp page về phạm vi hợp lệ
        // nếu trang cuối không còn row.
        // (User bị xoá nhận socket notification → listener trong useSocket
        // sẽ navigate họ ra /employer/company.)
        await fetchMembers();
        removeTarget.value = null;
        } else {
        toast.error(memberStore.error ?? 'Không thể xoá thành viên.');
        }
    } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Đã có lỗi xảy ra.');
    } finally {
        removeSaving.value = false;
    }
    };

    /** Đóng modal khi user cancel (click backdrop / ESC / nút Hủy). */
    const cancelRemove = (): void => {
    removeTarget.value = null;
    };

    /** Handler: mở InviteModal pre-fill với email user để mời lại. */
    const reinviteMember = (row: CompanyMember): void => {
    if (!row.user?.email) {
        toast.error('User chưa có email — không thể mời lại.');
        return;
    }
    // Reset các field khác, pre-fill email, mở modal
    inviteEmail.value = row.user.email;
    inviteRole.value = 'member';
    inviteError.value = null;
    inviteOpen.value = true;
    };

    /* ---------- Transfer ownership ----------
    *
    * Modal đơn giản: chỉ cần confirm/cancel qua ConfirmModal. Không yêu cầu user
    * nhập User ID — họ đã chọn đúng row qua action button rồi.
    *
    * BE: atomic swap role (demote caller → member, promote target → owner).
    * Service đã enforce self-check ở caller = active owner của company.
    */
    const transferSaving = ref(false);

    /** Message cho ConfirmModal — chứa tên + email owner mới để user xác nhận đúng người. */
    const transferMessage = computed<string>(() => {
    const t = transferTarget.value;
    if (!t) return '';
    const newOwnerName = t.user?.fullName ?? `User ID ${t.userId.slice(0, 8)}…`;
    const newOwnerEmail = t.user?.email ?? t.userId;
    return `Bạn có chắc chắn muốn chuyển quyền sở hữu cho ${newOwnerName} (${newOwnerEmail}) không? Sau khi chuyển, bạn sẽ trở thành member và không thể hoàn tác.`;
    });

    /**
     * Message cho ConfirmModal xoá member — phân biệt 2 case:
     *   - status='pending' → "Huỷ lời mời tới {name}"
     *   - status='active'  → "Xoá {name} khỏi công ty"
     * Fallback tên khi user chưa cập nhật profile: dùng email → userId (8 ký tự đầu).
     */
    const removeConfirmMessage = computed<string>(() => {
    const t = removeTarget.value;
    if (!t) return '';
    const name = t.user?.fullName ?? t.user?.email ?? `User ID ${t.userId.slice(0, 8)}…`;
    if (t.status === 'pending') {
        return `Bạn có chắc chắn muốn huỷ lời mời đã gửi tới ${name}? Hành động này không thể hoàn tác — nếu muốn mời lại, bạn phải tạo invite mới.`;
    }
    return `Bạn có chắc chắn muốn xoá ${name} khỏi công ty? Họ sẽ mất quyền truy cập vào các tính năng dành cho thành viên. Hành động này không thể hoàn tác.`;
    });

    const openTransfer = (row: CompanyMember): void => {
    transferTarget.value = row;
    };

    /** Đóng modal (khi user click backdrop hoặc ESC). */
    const onTransferModalClose = (open: boolean): void => {
    if (!open && !transferSaving.value) {
        transferTarget.value = null;
    }
    };

    const submitTransfer = async (): Promise<void> => {
    if (!transferTarget.value || !companyId.value || transferSaving.value) return;
    transferSaving.value = true;
    try {
        const result = await memberStore.transferOwner(companyId.value, {
        newOwnerUserId: transferTarget.value.userId,
        });
        if (result) {
        toast.success('Đã chuyển quyền sở hữu công ty.');
        transferTarget.value = null;
        // Refetch trang hiện tại để refresh cache + đảm bảo consistency sau swap.
        // (Owner mới có thể truy cập member view ngay sau khi transfer.)
        await fetchMembers();
        } else {
        toast.error(memberStore.error ?? 'Không thể chuyển quyền sở hữu.');
        }
    } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Đã có lỗi xảy ra.');
    } finally {
        transferSaving.value = false;
    }
    };

    /* ---------- Leave company (self) ----------
    *
    * Member tự rời công ty — soft delete, status active → left, ended_at = now.
    * BE controller check self-only + service chặn last-owner (CANNOT_LEAVE_AS_LAST_OWNER).
    *
    * Sau khi thành công:
    *   - Filter row khỏi cache (store đã syncMember trả về row với status='left')
    *   - Reload company context → chuyển state 'no-company'
    *   - Navigate về /employer/company để user thấy empty state + modal tạo company
    */
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
        }
    } catch (e) {
        leaveError.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra.';
    } finally {
        leaveSaving.value = false;
    }
    };

    /* ============================================================================
    * Display helpers
    * ==========================================================================*/
    const truncateId = (id: string, head = 8, tail = 4): string => {
    if (id.length <= head + tail + 3) return id;
    return `${id.slice(0, head)}…${id.slice(-tail)}`;
    };

    /** Tên hiển thị của 1 row (fallback → ID rút gọn) — dùng cho aria-label. */
    const displayName = (row: CompanyMember): string =>
    row.user?.fullName ?? row.user?.email ?? `ID: ${truncateId(row.userId)}`;

    /**
     * Tên hiển thị dòng 1 (fallback: phần trước @ của email — không dùng chữ
     * "Chưa cập nhật tên"); email luôn là dòng 2.
     */
    const primaryName = (row: CompanyMember): string => {
    if (row.user?.fullName) return row.user.fullName;
    if (row.user?.email) return row.user.email.split('@')[0];
    return truncateId(row.userId);
    };

    /** Ngày chỉ hiện dd/MM/yyyy; giờ đầy đủ đặt trong thuộc tính title. */
    const formatShortDate = (input: string | null | undefined): string => {
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
    const dateMeta = (row: CompanyMember): { label: string; short: string; title: string } => {
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

    const STATUS_LABELS: Record<CompanyMemberStatus, string> = {
    pending: 'Đã mời',
    active: 'Đang hoạt động',
    declined: 'Đã từ chối',
    removed: 'Đã bị xoá',
    left: 'Đã rời công ty',
    auto_cancelled: 'Bị huỷ tự động',
    };

    const ROLE_LABELS: Record<CompanyMemberRole, string> = {
    owner: 'Chủ sở hữu',
    member: 'Thành viên',
    };

    /* ============================================================================
    * Sort — key + dir gửi thẳng lên BE (sort tại database trước LIMIT/OFFSET)
    * ==========================================================================*/
    const toggleSort = (key: SortKey): void => {
    if (sortKey.value === key) {
        sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
    } else {
        sortKey.value = key;
        // Ngày: mặc định mới nhất lên đầu; tên/trạng thái: A→Z.
        sortDir.value = key === 'date' ? 'desc' : 'asc';
    }
    };

    const totalPages = computed<number>(() =>
    Math.max(1, Math.ceil(total.value / PAGE_SIZE)),
    );

    /** Chuyển trang — offset = (page - 1) * PAGE_SIZE (fetchMembers tính từ page). */
    const goToPage = (n: number): void => {
    if (n < 1 || n > totalPages.value || memberStore.loading) return;
    page.value = n;
    void fetchMembers();
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

    /** Badge trạng thái — palette slate, 4 trạng thái kết thúc phân biệt bằng chữ. */
    const STATUS_BADGE: Record<CompanyMemberStatus, { cls: string }> = {
    pending: { cls: 'bg-amber-50 text-amber-700' },
    active: { cls: 'bg-emerald-50 text-emerald-700' },
    declined: { cls: 'bg-slate-100 text-slate-600' },
    removed: { cls: 'bg-red-50 text-red-700' },
    left: { cls: 'bg-white text-slate-800 ring-1 ring-inset ring-slate-300' },
    auto_cancelled: { cls: 'bg-slate-100 text-slate-500' },
    };
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
        <!-- Việc tạo công ty + nhận lời mời đã nằm ở /employer/company (CompanyProfilePage). -->
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
            v-if="loadError || memberStore.error"
            class="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3"
            >
            <AlertCircle :size="16" class="mt-0.5 shrink-0 text-red-500" />
            <p class="m-0 flex-1 text-[13px] leading-[1.6] text-red-700" role="alert">{{ loadError ?? memberStore.error }}</p>
            <button
                type="button"
                class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-700 transition-colors duration-150 hover:border-slate-300 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
                @click="companyId ? fetchMembers() : loadData()"
            >
                <RefreshCw :size="13" aria-hidden="true" />
                Thử lại
            </button>
            </div>

            <!-- ============ Header: thông tin công ty (trái) + card Thành viên (phải) ============ -->
            <div v-if="company" class="c3-fade grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
            <!-- ===== Cột trái: nhận diện công ty ===== -->
            <div class="min-w-0">
                <div class="flex items-start gap-5">
                <!-- Logo -->
                <div
                    class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white md:h-20 md:w-20"
                >
                    <img
                    v-if="company.logoUrl"
                    :src="company.logoUrl"
                    :alt="`${company.name} logo`"
                    class="h-full w-full object-cover"
                    />
                    <Building2 v-else :size="28" class="text-slate-400" />
                </div>

                <div class="min-w-0 flex-1">
                    <!-- Tên + icon actions -->
                    <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <h1 class="m-0 truncate text-2xl font-semibold tracking-[-0.01em] text-slate-900 md:text-[28px]">
                        {{ company.name }}
                    </h1>
                    <span
                        v-if="isCurrentUserOwner"
                        class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                    >
                        <Crown :size="11" aria-hidden="true" />
                        Bạn là chủ sở hữu
                    </span>
                    <span
                        v-else-if="currentUserMember && currentUserMember.status === 'active'"
                        class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
                    >
                        Bạn là thành viên
                    </span>
                    <button
                        v-if="company.website?.trim()"
                        type="button"
                        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
                        aria-label="Sao chép website công ty"
                        :title="company.website.trim()"
                        @click="copyCompanyLink"
                    >
                        <Link2 :size="15" aria-hidden="true" />
                    </button>
                    </div>

                    <!-- Meta: thành viên / đang hoạt động / đang chờ -->
                    <div class="mt-2.5 flex flex-wrap items-center gap-y-1 text-[13px] text-slate-500">
                    <span class="font-medium tabular-nums text-slate-700">{{ counts.all }}</span>&nbsp;thành viên
                    <span class="mx-2.5 h-3.5 w-px bg-slate-200" aria-hidden="true" />
                    <span class="font-medium tabular-nums text-emerald-700">{{ counts.active }}</span>&nbsp;đang hoạt động
                    </div>

                    <!-- Mô tả ngắn (nếu có) -->
                    <p v-if="company.description" :title="company.description" class="mt-2 line-clamp-2 text-[13px] leading-relaxed text-slate-500">
                    {{ company.description }}
                    </p>

                    <!-- Chủ sở hữu: ẩn khi chính người xem là owner (badge "Bạn là chủ sở hữu" đã thể hiện) -->
                    <div v-if="!isCurrentUserOwner && owners.length > 0" class="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span class="text-xs text-slate-500">Chủ sở hữu</span>
                    <template v-for="(owner, i) in owners" :key="owner.userId">
                        <span v-if="i > 0" class="h-5 w-px bg-slate-200" aria-hidden="true" />
                        <span class="inline-flex items-center gap-2" :title="displayName(owner)">
                        <span
                            class="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600"
                        >
                            <img
                            v-if="owner.user?.avatarUrl"
                            :src="owner.user.avatarUrl"
                            :alt="owner.user.fullName || owner.user.email"
                            class="h-full w-full object-cover"
                            />
                            <span v-else-if="owner.user?.fullName">
                            {{ owner.user.fullName.charAt(0).toUpperCase() }}
                            </span>
                            <UserIcon v-else :size="12" class="text-slate-400" />
                        </span>
                        <span class="text-[13px] font-medium text-slate-700">{{ primaryName(owner) }}</span>
                        </span>
                    </template>
                    </div>
                </div>
                </div>
            </div>

            <!-- ===== Cột phải: card "Thành viên" ===== -->
            <aside class="min-w-0">
                <div class="rounded-xl border border-[#e9e5ff] bg-[#f8f7ff] p-5 md:p-6">
                <!-- Tiêu đề + nút Mời -->
                <div class="flex items-center justify-between gap-3">
                    <div class="flex min-w-0 items-center gap-2.5">
                    <h2 class="m-0 text-base font-semibold text-slate-900">Thành viên</h2>
                    <span class="h-4 w-px bg-slate-200" aria-hidden="true" />
                    <span class="text-[13px] text-slate-500">
                        <span class="tabular-nums font-medium">{{ counts.active }}</span> đang hoạt động
                    </span>
                    </div>
                    <button
                    v-if="isCurrentUserOwner"
                    type="button"
                    class="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg border border-transparent bg-[#5b4eea] px-3 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#4839d8] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
                    @click="openInvite"
                    >
                    <Plus :size="14" aria-hidden="true" />
                    Mời
                    </button>
                </div>

                <!-- Hàng avatar thành viên active (tối đa 4, thừa gộp +N) -->
                <div v-if="previewMembers.length > 0" class="mt-4 flex items-center gap-2">
                    <span
                    v-for="row in previewMembers"
                    :key="row.userId"
                    class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-xs font-semibold"
                    :class="avatarColor(row)"
                    :title="displayName(row)"
                    :aria-label="displayName(row)"
                    >
                    <img
                        v-if="row.user?.avatarUrl"
                        :src="row.user.avatarUrl"
                        :alt="row.user.fullName || row.user.email"
                        class="h-full w-full object-cover"
                    />
                    <template v-else>{{ initials(row) }}</template>
                    </span>
                    <span
                    v-if="previewOverflowCount > 0"
                    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-xs font-semibold text-slate-600"
                    :title="`${previewOverflowCount} thành viên khác`"
                    >
                    +{{ previewOverflowCount }}
                    </span>
                </div>
                <p v-else class="mt-4 text-[13px] text-slate-500">Chưa có thành viên active.</p>
                </div>
            </aside>
            </div>

            <!-- ============ Loading list — CHỈ lần tải đầu ============
                 Điều kiện cũ `loading && members.length === 0` khiến khi đang ở
                 trạng thái 0 kết quả search, mọi request tiếp theo đều thay cả
                 khối danh sách (tabs/search/thead) bằng spinner → remount →
                 c3-fade replay → nháy. `!listInit` chặn điều đó; các lần tải
                 sau giữ nguyên bảng, dữ liệu cũ ở lại đến khi response về. -->
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
            <div
            v-else
            class="c3-fade c3-d1 overflow-hidden scroll-mt-6"
            >
            <!-- ===== Cụm điều khiển: tab (chỉ owner) + tìm kiếm (mọi member) ===== -->
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div
                v-if="isCurrentUserOwner"
                role="tablist"
                aria-label="Lọc theo trạng thái"
                class="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-slate-100 p-1"
                >
                <button
                    v-for="(tab, i) in filterTabs"
                    :key="tab.key"
                    type="button"
                    role="tab"
                    :aria-selected="memberFilter === tab.key ? 'true' : 'false'"
                    class="cursor-pointer rounded-md px-3 py-1.5 text-[13px] transition-colors duration-150 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
                    :class="memberFilter === tab.key
                    ? 'bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200'
                    : 'text-slate-500 hover:bg-white/60 hover:text-slate-800'"
                    @click="memberFilter = tab.key"
                    @keydown="onTabKeydown($event, i)"
                >
                    {{ tab.label }}
                    <span
                    class="ml-1.5 text-xs tabular-nums"
                    :class="memberFilter === tab.key ? 'text-[#5b4eea]' : 'text-slate-400'"
                    >{{ tab.count }}</span>
                </button>
                </div>
                <!-- Search box luôn hiển thị (0/1/2/n thành viên đều tìm được) -->
                <label
                class="relative inline-flex items-center"
                >
                <span class="sr-only">Tìm theo email</span>
                <Search :size="14" class="pointer-events-none absolute left-3 text-slate-400" aria-hidden="true" />
                <input
                    ref="searchInputEl"
                    v-model="memberSearchEmail"
                    type="search"
                    placeholder="Tìm email…"
                    class="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 text-[13px] text-slate-700 shadow-sm placeholder:text-slate-400 focus:border-[#5b4eea] focus:outline-none focus:ring-[3px] focus:ring-[#5b4eea]/15 md:w-60"
                    :class="memberSearchEmail ? 'pr-9' : 'pr-3'"
                />
                <!-- Nút X chỉ hiện khi có từ khóa; ẩn nút cancel native của
                     input[type=search] bằng CSS (xem style block) để không có
                     2 nút X chồng nhau. Click chỉ xóa giá trị — fetch do
                     watcher debounce lo (dedupe lastQueryKey chặn request thừa). -->
                <button
                    v-if="memberSearchEmail"
                    type="button"
                    class="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-slate-400 transition-colors duration-150 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
                    aria-label="Xóa từ khóa tìm kiếm"
                    @click="clearSearchInput"
                >
                    <X :size="14" />
                </button>
                </label>
            </div>

            <!-- ===== Desktop table — 5 cột (Vai trò + Ngày tách riêng) ===== -->
            <div class="hidden overflow-x-auto md:block">
                <table class="w-full table-fixed text-sm">
                <colgroup>
                    <col class="w-[44%]">
                    <col class="w-[12%]">
                    <col class="w-[18%]">
                    <col class="w-[16%]">
                    <col class="w-[10%]">
                </colgroup>
                <thead class="border-b border-slate-200">
                    <tr class="text-left text-[11px] uppercase tracking-wider font-medium text-slate-600">
                    <th scope="col" class="px-4 py-2.5 font-medium">Thành viên</th>
                    <th scope="col" class="px-4 py-2.5 font-medium" aria-sort="none">
                        <button
                        type="button"
                        class="inline-flex cursor-pointer items-center gap-1 transition-colors duration-150 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
                        :class="sortKey === 'role' ? 'text-slate-700' : ''"
                        @click="toggleSort('role')"
                        >
                        Vai trò
                        <ArrowUp v-if="sortKey === 'role' && sortDir === 'asc'" :size="12" stroke-width="2.5" class="text-slate-900" aria-hidden="true" />
                        <ArrowDown v-else-if="sortKey === 'role'" :size="12" stroke-width="2.5" class="text-slate-900" aria-hidden="true" />
                        <ArrowUpDown v-else :size="11" class="text-slate-400" aria-hidden="true" />
                        </button>
                    </th>
                    <th scope="col" class="px-4 py-2.5 font-medium" aria-sort="none">
                        <button
                        type="button"
                        class="inline-flex cursor-pointer items-center gap-1 transition-colors duration-150 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
                        :class="sortKey === 'status' ? 'text-slate-700' : ''"
                        @click="toggleSort('status')"
                        >
                        Trạng thái
                        <ArrowUp v-if="sortKey === 'status' && sortDir === 'asc'" :size="12" stroke-width="2.5" class="text-slate-900" aria-hidden="true" />
                        <ArrowDown v-else-if="sortKey === 'status'" :size="12" stroke-width="2.5" class="text-slate-900" aria-hidden="true" />
                        <ArrowUpDown v-else :size="11" class="text-slate-400" aria-hidden="true" />
                        </button>
                    </th>
                    <th scope="col" class="px-4 py-2.5 font-medium" aria-sort="none">
                        <button
                        type="button"
                        class="inline-flex cursor-pointer items-center gap-1 transition-colors duration-150 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
                        :class="sortKey === 'date' ? 'text-slate-700' : ''"
                        @click="toggleSort('date')"
                        >
                        Ngày
                        <ArrowUp v-if="sortKey === 'date' && sortDir === 'asc'" :size="12" stroke-width="2.5" class="text-slate-900" aria-hidden="true" />
                        <ArrowDown v-else-if="sortKey === 'date'" :size="12" stroke-width="2.5" class="text-slate-900" aria-hidden="true" />
                        <ArrowUpDown v-else :size="11" class="text-slate-400" aria-hidden="true" />
                        </button>
                    </th>
                    <th scope="col" class="px-4 py-2.5 text-right font-medium">Thao tác</th>
                    </tr>
                </thead>
                <!-- Khi đổi tab/trang/search, hàng cũ patch tại chỗ (không
                     remount). Cờ `fetchingList` làm mờ tbody trong lúc chờ
                     response (pattern `isPaysPaging` của BillingHistoryView):
                     báo hiệu dữ liệu đang thay thế, không giật layout. -->
                <tbody
                class="transition-opacity duration-150 divide-y divide-slate-100"
                :class="{ 'opacity-60': fetchingList }"
                >
                    <!-- Kết quả lọc/search rỗng — giữ cả khi đang loading:
                         nếu ẩn theo `!loading` thì bấm "Xóa bộ lọc" làm row biến
                         mất ngay → tbody co 0 rồi giãn khi response về = nháy. -->
                    <tr v-if="members.length === 0">
                    <!-- py-6 (không py-12): empty row cao ≈ một hàng data (63px) →
                         chuyển 0↔có kết quả không làm tbody co/giãn đột ngột. -->
                    <td colspan="5" class="px-4 py-6 text-center">
                        <p class="m-0 text-sm text-slate-500">Không có thành viên phù hợp</p>
                        <button
                        type="button"
                        class="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-700 transition-colors duration-150 hover:border-slate-300 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
                        @click="clearFilters"
                        >
                        Xóa bộ lọc
                        </button>
                    </td>
                    </tr>
                    <tr
                    v-for="(row, i) in members"
                    :key="row.userId"
                    class="ml-row transition hover:bg-slate-50/60"
                    :style="{ animationDelay: `${i * 60}ms` }"
                    >
                    <!-- Thành viên (+ vai trò) -->
                    <td class="px-4 py-2.5 align-middle">
                        <div class="flex min-w-0 items-center gap-3">
                        <div
                            class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-600"
                        >
                            <img
                            v-if="row.user?.avatarUrl"
                            :src="row.user.avatarUrl"
                            :alt="row.user.fullName || row.user.email"
                            class="h-full w-full object-cover"
                            />
                            <span v-else-if="row.user?.fullName">
                            {{ row.user.fullName.charAt(0).toUpperCase() }}
                            </span>
                            <UserIcon v-else :size="15" class="text-slate-400" />
                        </div>
                        <div class="min-w-0 flex-1">
                            <p class="m-0 truncate text-sm font-medium text-slate-900">{{ primaryName(row) }}</p>
                            <p class="m-0 mt-0.5 truncate text-[12.5px] text-slate-500">
                            {{ row.user?.email ?? `ID: ${truncateId(row.userId)}` }}
                            </p>
                        </div>
                        </div>
                    </td>

                    <!-- Vai trò: badge owner / text member -->
                    <td class="px-4 py-2.5 align-middle">
                        <span
                        v-if="row.role === 'owner' && row.status === 'active'"
                        class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
                        >
                        <Crown :size="11" aria-hidden="true" />
                        {{ ROLE_LABELS.owner }}
                        </span>
                        <span v-else class="text-[13px] text-slate-500">{{ ROLE_LABELS.member }}</span>
                    </td>

                    <!-- Trạng thái: badge -->
                    <td class="px-4 py-2.5 align-middle">
                        <span
                        class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                        :class="STATUS_BADGE[row.status].cls"
                        >{{ STATUS_LABELS[row.status] }}</span>
                    </td>

                    <!-- Ngày: nhãn theo trạng thái + ngày ngắn (giờ đầy đủ trong title) -->
                    <td class="px-4 py-2.5 align-middle">
                        <span class="text-[13px] text-slate-500" :title="dateMeta(row).title">
                        {{ dateMeta(row).label }} {{ dateMeta(row).short }}
                        </span>
                    </td>

                    <!-- Thao tác — menu "⋯"/"Thao tác" duy nhất -->
                    <td class="px-4 py-3 text-right align-middle">
                        <MemberRowMenu
                        v-if="getRowActions(row).length > 0"
                        :label="displayName(row)"
                        :items="getRowActions(row)"
                        />
                    </td>
                    </tr>
                </tbody>
                </table>
            </div>

            <!-- Mobile cards -->
            <div class="divide-y divide-slate-100 md:hidden">
                <div
                v-for="(row, i) in members"
                :key="row.userId"
                class="ml-row space-y-2 p-4"
                :style="{ animationDelay: `${i * 60}ms` }"
                >
                <div class="flex items-start gap-3">
                    <div
                    class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-600"
                    >
                    <img
                        v-if="row.user?.avatarUrl"
                        :src="row.user.avatarUrl"
                        :alt="row.user.fullName || row.user.email"
                        class="h-full w-full object-cover"
                    />
                    <span v-else-if="row.user?.fullName">
                        {{ row.user.fullName.charAt(0).toUpperCase() }}
                    </span>
                    <UserIcon v-else :size="15" class="text-slate-400" />
                    </div>
                    <div class="min-w-0 flex-1">
                    <p class="m-0 truncate text-sm font-medium text-slate-900">{{ primaryName(row) }}</p>
                    <p class="m-0 mt-0.5 truncate text-[12.5px] text-slate-500">
                        {{ row.user?.email ?? `ID: ${truncateId(row.userId)}` }}
                    </p>
                    </div>
                    <MemberRowMenu
                    v-if="getRowActions(row).length > 0"
                    :label="displayName(row)"
                    :items="getRowActions(row)"
                    />
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <span
                    v-if="row.role === 'owner' && row.status === 'active'"
                    class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
                    >
                    <Crown :size="11" aria-hidden="true" />
                    {{ ROLE_LABELS.owner }}
                    </span>
                    <span
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                    :class="STATUS_BADGE[row.status].cls"
                    >{{ STATUS_LABELS[row.status] }}</span>
                    <span class="text-[11px] text-slate-500" :title="dateMeta(row).title">
                    {{ dateMeta(row).label }} {{ dateMeta(row).short }}
                    </span>
                    <span v-if="!(row.role === 'owner' && row.status === 'active')" class="text-[11px] text-slate-500">
                    · {{ ROLE_LABELS.member }}
                    </span>
                </div>
                </div>
                <!-- Kết quả lọc/search rỗng (mobile) — giữ cả khi loading, lý do như desktop -->
                <div v-if="members.length === 0" class="px-4 py-6 text-center">
                <p class="m-0 text-sm text-slate-500">Không có thành viên phù hợp</p>
                <button
                    type="button"
                    class="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-700 transition-colors duration-150 hover:border-slate-300 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
                    @click="clearFilters"
                >
                    Xóa bộ lọc
                </button>
                </div>
            </div>

            <!-- ===== Phân trang server-side (ẩn khi chỉ 1 trang) ===== -->
            <div
                v-if="total > PAGE_SIZE"
                class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3"
            >
                <p class="m-0 text-[13px] text-slate-500">
                Hiển thị {{ (page - 1) * PAGE_SIZE + 1 }}–{{ Math.min(page * PAGE_SIZE, total) }}
                trong {{ total }} thành viên
                </p>
                <div class="flex items-center gap-2">
                <button
                    type="button"
                    class="inline-flex h-8 cursor-pointer items-center rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 transition-colors duration-150 hover:border-slate-300 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                    :disabled="page <= 1 || memberStore.loading"
                    @click="goToPage(page - 1)"
                >
                    Trước
                </button>
                <span class="text-[13px] text-slate-600">Trang {{ page }} / {{ totalPages }}</span>
                <button
                    type="button"
                    class="inline-flex h-8 cursor-pointer items-center rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 transition-colors duration-150 hover:border-slate-300 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                    :disabled="page >= totalPages || memberStore.loading"
                    @click="goToPage(page + 1)"
                >
                    Sau
                </button>
                </div>
            </div>
            </div>
        </template>
        </div>

        <!-- =================== Invite modal =================== -->
        <Teleport to="body">
        <Transition name="modal">
            <div
            v-if="inviteOpen"
            class="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-modal-title"
            @keydown.escape="closeInvite"
            >
            <!-- Click backdrop (div con che toàn màn) → đóng; .self chỉ với click trực tiếp -->
            <div class="absolute inset-0 bg-black/40 backdrop-blur-[1px]" @click.self="closeInvite" />
            <div
                class="relative z-10 w-full max-w-md rounded-xl bg-white p-5 text-slate-900 shadow-2xl ring-1 ring-slate-200"
                @mousedown.stop
            >
                <button
                v-if="!inviteSaving"
                type="button"
                class="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40"
                title="Đóng"
                aria-label="Đóng"
                @click="closeInvite"
                >
                <X class="h-4 w-4" />
                </button>

                <div class="flex gap-4">
                <div class="shrink-0">
                    <div class="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#5b4eea]/10">
                    <UserPlus class="h-5 w-5 text-[#5b4eea]" />
                    </div>
                </div>
                <div class="min-w-0 flex-1">
                    <h2 id="invite-modal-title" class="text-base font-semibold text-slate-900">
                    Mời thành viên
                    </h2>
                    <p class="mt-1 text-sm text-slate-500">
                    Thêm một thành viên vào công ty bằng email.
                    </p>
                </div>
                </div>

                <div class="mt-4 space-y-3">
                <div>
                    <label for="invite-email" class="mb-1.5 block text-xs font-medium text-slate-700">
                    Email <span class="text-red-500">*</span>
                    </label>
                    <input
                    id="invite-email"
                    ref="inviteEmailEl"
                    v-model="inviteEmail"
                    type="email"
                    placeholder="email@example.com"
                    autocomplete="off"
                    spellcheck="false"
                    class="w-full rounded-lg border bg-white px-3 py-2 text-sm transition focus:outline-none focus:ring-1"
                    :class="inviteError ? 'border-red-300 focus:border-red-500 focus:ring-red-200' : 'border-slate-200 focus:border-[#5b4eea] focus:ring-[#5b4eea]/20'"
                    :disabled="inviteSaving"
                    :aria-invalid="inviteError ? 'true' : undefined"
                    :aria-describedby="inviteError ? 'invite-email-err' : 'invite-email-hint'"
                    @keyup.enter="submitInvite"
                    />
                    <p id="invite-email-hint" class="mt-1 text-[11px] text-slate-500">
                    Email của user đã đăng ký tài khoản trên JobMatch. Hệ thống sẽ gửi thông báo mời.
                    </p>
                </div>

                <div
                    v-if="inviteError"
                    class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2"
                >
                    <AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                    <p id="invite-email-err" class="text-xs text-red-700" role="alert">{{ inviteError }}</p>
                </div>
                </div>

                <div class="mt-5 flex justify-end gap-2">
                <button
                    type="button"
                    class="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[13px] text-slate-700 transition-colors duration-150 hover:border-slate-300 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                    :disabled="inviteSaving"
                    @click="closeInvite"
                >
                    Hủy
                </button>
                <button
                    type="button"
                    class="inline-flex items-center justify-center rounded-lg border border-transparent bg-[#5b4eea] px-3.5 py-2 text-[13px] font-semibold tracking-[0.04em] text-white transition-colors duration-150 hover:bg-[#4839d8] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
                    :disabled="inviteSaving"
                    @click="submitInvite"
                >
                    <Loader2 v-if="inviteSaving" class="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    {{ inviteSaving ? 'Đang gửi...' : 'Gửi lời mời' }}
                </button>
                </div>
            </div>
            </div>
        </Transition>
        </Teleport>

        <!-- =================== Transfer ownership modal =================== -->
        <ConfirmModal
        :open="transferTarget !== null"
        title="Chuyển quyền sở hữu?"
        :message="transferMessage"
        confirm-text="Chuyển quyền sở hữu"
        variant="danger"
        :loading="transferSaving"
        @update:open="onTransferModalClose"
        @confirm="submitTransfer"
        />

        <!-- =================== Remove member confirm modal =================== -->
        <ConfirmModal
        :open="removeTarget !== null"
        :title="removeTarget?.status === 'pending' ? 'Huỷ lời mời?' : 'Xoá thành viên?'"
        :message="removeConfirmMessage"
        :confirm-text="removeTarget?.status === 'pending' ? 'Huỷ lời mời' : 'Xoá'"
        cancel-text="Huỷ"
        variant="danger"
        @update:open="cancelRemove"
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

    <style scoped>
    /* =================== Search input =================== */
    /* Ẩn nút cancel native của input[type=search] (WebKit) — nút X tự tạo bằng
       Lucide đã thay thế; không ẩn thì có 2 nút X chồng nhau góc phải. */
    input[type='search']::-webkit-search-cancel-button {
    -webkit-appearance: none;
    appearance: none;
    }

    /* =================== Modal fade-in/out =================== */
    .modal-enter-active,
    .modal-leave-active {
    transition: opacity 0.18s ease;
    }
    .modal-enter-active > div:last-child,
    .modal-leave-active > div:last-child {
    transition: transform 0.18s ease, opacity 0.18s ease;
    }
    .modal-enter-from,
    .modal-leave-to {
    opacity: 0;
    }
    .modal-enter-from > div:last-child,
    .modal-leave-to > div:last-child {
    transform: scale(0.96);
    opacity: 0;
    }
    </style>
    

    <!-- Style KHÔNG scoped: tái sử dụng hệ animation của trang tham chiếu
         /employer/company (CompanyProfilePage). Định nghĩa trùng tên/timing với
         bên đó vì chunk của CompanyProfilePage không đảm bảo đã load khi user
         truy cập trực tiếp /employer/company/members — quy tắc CSS giống nhau
         nên việc nhân bản là vô hại. -->
    <style>
    /* ==== Ẩn scrollbar dọc của trang trên members (nguyên nhân nháy: skeleton
       cao hơn nội dung thật → scrollbar hiện lúc skeleton rồi mất khi data về).
       Vẫn cuộn bình thường bằng wheel/touchpad/touch — chỉ ẩn phần hiển thị.
       Scope bằng :has(): chỉ áp dụng khi trang members đang mount, navigate
       away là trả lại scrollbar bình thường cho trang khác. Vì scrollbar không
       bao giờ hiển thị nên không cần `scrollbar-gutter: stable` nữa (tránh để
       lại cột trống 10px vĩnh viễn). ==== */
       input[type="search"]::-webkit-search-cancel-button {
  cursor: pointer;
  transition: filter 0.2s ease;
}

input[type="search"]::-webkit-search-cancel-button:hover {
  filter: brightness(0) saturate(100%) invert(18%) sepia(95%)
    saturate(5000%) hue-rotate(350deg) brightness(95%);
}
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
       wheel/shift+wheel/touch. Scope trong #members-page-root — không lan app. ==== */
    #members-page-root .overflow-x-auto {
      scrollbar-width: none; /* Firefox */
    }
    #members-page-root .overflow-x-auto::-webkit-scrollbar {
      width: 0;
      height: 0; /* Chromium/Safari */
    }

    /* Stagger fade-up khi trang xuất hiện — y hệt CompanyProfilePage:
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
       là class global trùng với CompanyProfilePage: sửa trực tiếp sẽ đổi cả trang
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
