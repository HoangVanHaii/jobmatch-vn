<script setup lang="ts">
/**
* NotificationsMockupView — Trang Thông báo của Employer Workspace (JobMatch VN).
*
* Giao diện SaaS tuyển dụng hiện đại, tinh tế, dễ đọc và tối ưu hiển thị:
* - Typography chuẩn mực, khoảng trắng thoáng đãng, chiều cao dòng cân đối.
* - Tỷ lệ cột tối ưu (32% tiêu đề, 13% ngày nhận, 35% tóm tắt, 14% trạng thái, 6% thao tác).
* - Palette trắng/xám trung tính, dot + text cho trạng thái, nhấn nhẹ thông báo chưa đọc.
* - Responsive hoàn chỉnh: Desktop giữ table chuẩn, Mobile chuyển sang card list trực quan.
* - Animation mượt mà, hỗ trợ keyboard accessibility (⌘K/Ctrl+K, Enter, Escape).
*/
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useRouter, type RouteLocationRaw } from 'vue-router';
import {
  Search,
  ArrowRight,
  X,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Sparkles,
} from 'lucide-vue-next';
import NotificationDetailModal, { type NotificationDetailItem } from '@components/notify/NotificationDetailModal.vue';
import { useNotificationStore } from '@stores/notification';
import { useAuthStore } from '@stores/auth';
import { useToastStore } from '@stores/toast';
import { getSocket } from '@services/socket';
import type { Notification, NotificationType } from '@/types/notification';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';

dayjs.locale('vi');

const router = useRouter();
const notificationStore = useNotificationStore();
const authStore = useAuthStore();
const toast = useToastStore();

export type { NotificationType };

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  summary: string;
  createdAt: string; // ISO
  readAt: string | null; // null = chưa đọc
  payload: Record<string, unknown>;
  details?: string;
}

type DisplayStatus = 'Reviewed' | 'Unread';

const sanitizeJobTitle = (val?: unknown): string | null => {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^vị\s+trí\s+/i, '').trim();
};

const sanitizeCandidateName = (val?: unknown): string | null => {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^ứng\s+viên\s+/i, '').trim();
};

const sanitizeText = (val?: unknown): string | null => {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed ? trimmed : null;
};

/**
 * Helper trích xuất tóm tắt ngắn từ notification backend.
 * Ưu tiên dùng cột `message` sinh sẵn từ backend (snapshot câu hiển thị).
 * Logic switch-case cũ bên dưới giữ làm fallback cho các dòng cũ chưa được backfill cột message
 * (có thể xoá bỏ sau khi DB chạy xong script backfill).
 */
const formatSummary = (n: Notification): string => {
  if (typeof n.message === 'string' && n.message.trim()) {
    return n.message.trim();
  }

  const p = (n.payload ?? {}) as Record<string, unknown>;
  if (typeof p.summary === 'string' && p.summary.trim()) return p.summary.trim();
  if (typeof p.message === 'string' && p.message.trim()) return p.message.trim();

  const candidateName = sanitizeCandidateName(p.candidateName);
  const jobTitle = sanitizeJobTitle(p.jobTitle);
  const companyName = sanitizeText(p.companyName);

  switch (n.type) {
    case 'application_new': {
      if (candidateName && jobTitle) return `Hồ sơ mới từ ${candidateName} ứng tuyển vị trí ${jobTitle}`;
      if (candidateName) return `Hồ sơ mới từ ${candidateName}`;
      if (jobTitle) return `Hồ sơ ứng tuyển mới cho vị trí ${jobTitle}`;
      return 'Hồ sơ ứng tuyển mới';
    }
    case 'application_withdrawn': {
      if (candidateName && jobTitle) return `Ứng viên ${candidateName} đã rút hồ sơ ứng tuyển vị trí ${jobTitle}`;
      if (candidateName) return `Ứng viên ${candidateName} đã rút hồ sơ ứng tuyển`;
      if (jobTitle) return `Hồ sơ ứng tuyển cho vị trí ${jobTitle} đã được rút`;
      return 'Hồ sơ ứng tuyển đã được rút';
    }
    case 'application_match_ready': {
      const matchPercent = typeof p.matchPercent === 'number' ? p.matchPercent : null;
      if (jobTitle) {
        if (matchPercent !== null) return `AI Matching đã chấm ${matchPercent}% độ phù hợp cho vị trí ${jobTitle}`;
        return `Hồ sơ ứng tuyển đã được ghi nhận, đánh giá AI Matching sẽ được cập nhật sau cho vị trí ${jobTitle}`;
      }
      if (matchPercent !== null) return `AI Matching đã chấm ${matchPercent}% độ phù hợp cho hồ sơ của bạn`;
      return 'Hồ sơ ứng tuyển đã được ghi nhận, đánh giá AI Matching sẽ được cập nhật sau';
    }
    case 'interview_scheduled': {
      if (jobTitle) return `Lịch phỏng vấn mới đã được thiết lập cho vị trí ${jobTitle}`;
      return 'Lịch phỏng vấn mới đã được thiết lập';
    }
    case 'interview_updated': {
      if (jobTitle) return `Lịch phỏng vấn cho vị trí ${jobTitle} đã được cập nhật`;
      return 'Lịch phỏng vấn đã được cập nhật';
    }
    case 'interview_cancelled': {
      const kind = p.kind as string | undefined;
      if (kind === 'interview_declined_by_candidate') {
        if (candidateName && jobTitle) return `Ứng viên ${candidateName} đã từ chối lịch phỏng vấn cho vị trí ${jobTitle}`;
        if (candidateName) return `Ứng viên ${candidateName} đã từ chối lịch phỏng vấn`;
        if (jobTitle) return `Ứng viên đã từ chối lịch phỏng vấn cho vị trí ${jobTitle}`;
        return 'Ứng viên đã từ chối lịch phỏng vấn';
      }
      if (kind === 'interview_cancelled_by_hr') {
        if (jobTitle) return `Lịch phỏng vấn cho vị trí ${jobTitle} đã bị huỷ`;
        return 'Lịch phỏng vấn đã bị huỷ';
      }
      if (candidateName) {
        if (jobTitle) return `Ứng viên ${candidateName} đã từ chối lịch phỏng vấn cho vị trí ${jobTitle}`;
        return `Ứng viên ${candidateName} đã từ chối lịch phỏng vấn`;
      }
      if (jobTitle) return `Lịch phỏng vấn cho vị trí ${jobTitle} đã bị huỷ`;
      return 'Lịch phỏng vấn đã bị huỷ';
    }
    case 'message':
      return 'Bạn có tin nhắn mới trong phòng trao đổi';
    case 'company':
    case 'company_invite': {
      const kind = p.kind as string;
      if (kind === 'company_invite_sent') return companyName ? `Lời mời tham gia công ty ${companyName}` : 'Lời mời tham gia công ty';
      if (kind === 'company_invite_accepted') return companyName ? `Thành viên đã chấp nhận lời mời tham gia ${companyName}` : 'Thành viên đã chấp nhận lời mời tham gia công ty';
      if (kind === 'company_invite_declined') return companyName ? `Lời mời tham gia công ty ${companyName} đã bị từ chối` : 'Lời mời tham gia công ty đã bị từ chối';
      if (kind === 'removed_from_company') return companyName ? `Bạn đã bị xoá khỏi danh sách thành viên của ${companyName}` : 'Bạn đã bị xoá khỏi danh sách thành viên của công ty';
      return n.title || 'Thông báo';
    }
    case 'job_match': {
      if (jobTitle) return `Gợi ý hồ sơ tiềm năng phù hợp tiêu chí tuyển dụng ${jobTitle}`;
      return 'Gợi ý hồ sơ tiềm năng phù hợp';
    }
    case 'system': {
      if (p.planId) return 'Gói dịch vụ tuyển dụng Employer đã được cập nhật';
      if (p.topic === 'terms-2026') return 'Cập nhật tiêu chuẩn an toàn bảo mật dữ liệu 2026';
      if (p.kind === 'invite_auto_cancelled_on_create_company') return 'Lời mời của bạn đã bị huỷ do thành viên đã tạo công ty riêng';
      return n.title || 'Thông báo hệ thống';
    }
    case 'reference_verified': {
      const refereeName = sanitizeText(p.refereeName);
      const isConfirmed = p.confirmed === true;
      const targetPos = jobTitle ? ` cho vị trí ${jobTitle}` : '';
      if (isConfirmed) {
        return refereeName ? `${refereeName} đã xác nhận tham chiếu${targetPos}` : `Tham chiếu đã được xác nhận${targetPos}`;
      }
      return refereeName ? `${refereeName} đã từ chối xác nhận tham chiếu${targetPos}` : `Tham chiếu đã bị từ chối${targetPos}`;
    }
    default:
      return n.title || 'Thông báo';
  }
};

/**
 * Helper trích xuất nội dung chi tiết từ notification backend.
 * Thứ tự ưu tiên: payload.details -> n.message -> logic fallback bên dưới
 * (có thể xoá bỏ sau khi DB chạy xong script backfill).
 */
const formatDetails = (n: Notification): string => {
  const p = (n.payload ?? {}) as Record<string, unknown>;
  if (typeof p.details === 'string' && p.details.trim()) return p.details.trim();
  if (typeof n.message === 'string' && n.message.trim()) return n.message.trim();

  const candidateName = (p.candidateName as string) || 'Ứng viên';
  const jobTitle = (p.jobTitle as string) || 'vị trí việc làm';
  const companyName = (p.companyName as string) || 'doanh nghiệp';

  switch (n.type) {
    case 'application_new':
      return `Ứng viên ${candidateName} đã gửi hồ sơ ứng tuyển vào vị trí "${jobTitle}". Vui lòng kiểm tra danh sách đơn ứng tuyển để xem CV và đánh giá hồ sơ.`;
    case 'application_withdrawn':
      return `Ứng viên ${candidateName} đã rút đơn ứng tuyển vị trí "${jobTitle}". Hệ thống đã cập nhật trạng thái đơn ứng tuyển.`;
    case 'application_match_ready':
      return `Hệ thống AI Matching đã hoàn thành phân tích độ tương thích giữa ứng viên và yêu cầu tuyển dụng của vị trí "${jobTitle}".`;
    case 'interview_scheduled':
      return `Lịch phỏng vấn cho vị trí "${jobTitle}" đã được lên lịch. Vui lòng kiểm tra mục Lịch phỏng vấn để xem chi tiết thời gian và phòng họp.`;
    case 'message':
      return 'Bạn vừa nhận được tin nhắn mới từ đối tác/ứng viên trong hệ thống trao đổi của JobMatch VN.';
    case 'company':
    case 'company_invite': {
      const kind = p.kind as string;
      if (kind === 'company_invite_sent') return `Bạn nhận được lời mời tham gia quản trị tuyển dụng tại công ty ${companyName}.`;
      return `Thông báo cập nhật quản lý thành viên hoặc phân quyền truy cập tại ${companyName}.`;
    }
    case 'job_match':
      return `Hệ thống gợi ý ứng viên có kỹ năng và kinh nghiệm tương thích cao với tin tuyển dụng "${jobTitle}".`;
    case 'system':
      if (p.planId) return 'Gói dịch vụ đăng tin và tính năng tuyển dụng VIP của doanh nghiệp đã được kích hoạt thành công.';
      if (p.topic === 'terms-2026') return 'JobMatch VN cập nhật chính sách bảo vệ dữ liệu cá nhân theo quy định an toàn bảo mật mới nhất.';
      return formatSummary(n);
    default:
      return formatSummary(n);
  }
};

/** Chuyển đổi Notification backend row sang NotificationItem của view */
const mapToNotificationItem = (n: Notification): NotificationItem => {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    summary: formatSummary(n),
    details: formatDetails(n),
    createdAt: n.createdAt,
    readAt: n.readAt,
    payload: n.payload ?? {},
  };
};

const notifications = computed<NotificationItem[]>(() => {
  return notificationStore.items.map(mapToNotificationItem);
});

/** Sắp xếp theo createdAt giảm dần */
const sortedNotifications = computed(() => {
  return [...notifications.value].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
});

/**
 * Tính trạng thái hiển thị của thông báo:
 * - Đã đọc (readAt !== null) -> "Reviewed"
 * - Chưa đọc (readAt === null) -> "Unread"
 */
const getStatus = (item: NotificationItem): DisplayStatus => {
  return item.readAt !== null ? 'Reviewed' : 'Unread';
};

/**
 * Trả về RouteLocationRaw đích trong Router của Employer dựa trên type và payload.
 * Nếu không có trang đích (như báo cáo, khảo sát), trả về null.
 */
const getNotificationRoute = (item: NotificationItem): RouteLocationRaw | null => {
  const p = (item.payload ?? {}) as Record<string, string | undefined>;
  const isCandidate = authStore.user?.role === 'candidate';

  if (
    item.type === 'application_new' ||
    item.type === 'application_withdrawn' ||
    item.type === 'application_match_ready'
  ) {
    return isCandidate ? { name: 'candidate-applications' } : { name: 'employer-applications' };
  }
  if (item.type === 'interview_scheduled') {
    return isCandidate ? { name: 'candidate-applications' } : { name: 'employer-interviews' };
  }
  if (item.type === 'message') {
    if (isCandidate) {
      if (p.conversationId) {
        return { name: 'chat', params: { id: p.conversationId } };
      }
      return { name: 'chat' };
    }
    if (p.conversationId) {
      return { name: 'e-chat', params: { id: p.conversationId } };
    }
    return { name: 'e-chat' };
  }
  if (item.type === 'company' || (item.type as string) === 'company_invite') {
    if (isCandidate) return null;
    if (p.kind === 'company_invite' || p.kind === 'company_invite_sent' || p.kind === 'members') {
      return { name: 'employer-company-members' };
    }
    return { name: 'employer-company' };
  }
  if (item.type === 'job_match' || (item.type === 'system' && p.jobId)) {
    if (isCandidate) {
      return { name: 'candidate-jobs' };
    }
    if (p.jobId) {
      return { name: 'employer-job-detail', params: { id: p.jobId } };
    }
    return { name: 'employer-jobs' };
  }
  if (item.type === 'system') {
    if (p.planId) {
      return isCandidate ? { name: 'pricing' } : { name: 'employer-pricing' };
    }
    if (p.topic === 'terms-2026') {
      return { name: 'terms' };
    }
    return null;
  }
  return null;
};

/**
 * Format thời gian:
 * - Trong vòng 24 giờ: hiển thị tương đối ("Vừa xong", "5 phút trước", "3 giờ trước")
 * - Cũ hơn 24 giờ: DD/MM/YYYY
 */
const formatTime = (iso: string): string => {
  const diffMs = Math.max(0, Date.now() - new Date(iso).getTime());
  const hours = diffMs / (1000 * 60 * 60);
  if (hours < 24) {
    if (diffMs < 60000) return 'Vừa xong';
    const m = Math.floor(diffMs / 60000);
    if (m < 60) return `${m} phút trước`;
    const h = Math.floor(hours);
    return `${h} giờ trước`;
  }
  return dayjs(iso).format('DD/MM/YYYY');
};

const formatFullTime = (iso: string): string => {
  return dayjs(iso).format('HH:mm · DD/MM/YYYY');
};

const removeVietnameseTones = (str: string): string => {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
};

// State tìm kiếm và lọc
const searchQuery = ref('');
type FilterType = 'All' | 'Unread' | 'Reviewed';
const activeFilter = ref<FilterType>('All');

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let switchToken = 0;
const viewKey = ref(0);
const isSwitchingTab = ref(false);
const isSearching = ref(false);

// Skeleton có độ trễ: lần đầu hiện ngay, lần sau chỉ hiện nếu > 150ms. Khi dữ liệu về là tắt ngay
const hasLoadedOnce = ref(false);
const showSkeleton = ref(false);
let skeletonDelayTimer: ReturnType<typeof setTimeout> | null = null;

const startDelayedSkeleton = (): void => {
  if (skeletonDelayTimer) {
    clearTimeout(skeletonDelayTimer);
    skeletonDelayTimer = null;
  }

  if (!hasLoadedOnce.value) {
    showSkeleton.value = true;
  } else if (sortedNotifications.value.length === 0) {
    skeletonDelayTimer = setTimeout(() => {
      showSkeleton.value = true;
    }, 150);
  }
};

const stopDelayedSkeleton = (): void => {
  if (skeletonDelayTimer) {
    clearTimeout(skeletonDelayTimer);
    skeletonDelayTimer = null;
  }
  showSkeleton.value = false;
};

const executeSearch = async (term: string): Promise<void> => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  const token = ++switchToken;
  isSearching.value = true;
  startDelayedSkeleton();

  const trimmed = term.trim();
  notificationStore.setQuery({ search: trimmed || undefined });

  try {
    await notificationStore.fetchFirstPage();
    if (token !== switchToken) return;

    // Đặt currentPage = 1 cùng tick với lúc danh sách được thay
    currentPage.value = 1;
    viewKey.value++;
  } finally {
    if (token === switchToken) {
      isSearching.value = false;
      stopDelayedSkeleton();
    }
  }
};

const handleSearchInput = (): void => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void executeSearch(searchQuery.value);
  }, 300);
};

const triggerSearchImmediately = (): void => {
  void executeSearch(searchQuery.value);
};

const clearSearch = (): void => {
  searchQuery.value = '';
  searchInputRef.value?.focus();
  void executeSearch('');
};

const unreadCount = computed(() => notificationStore.unreadCount);

const filterTabs: { label: string; value: FilterType }[] = [
  { label: 'Tất cả', value: 'All' },
  { label: 'Chưa đọc', value: 'Unread' },
  { label: 'Đã đọc', value: 'Reviewed' },
];

// Highlight dòng mới qua Socket.IO (giữ nguyên animation, modifier is-new nền mờ dần sau 1.5s)
const recentNewId = ref<string | null>(null);
let clearRecentNewTimer: ReturnType<typeof setTimeout> | null = null;

const handleSocketNewNotification = (notif: Notification): void => {
  if (!notif || !notif.id) return;

  const isUnread = notif.readAt === null;
  const matchesCurrentFilter =
    activeFilter.value === 'All' ||
    (activeFilter.value === 'Unread' && isUnread) ||
    (activeFilter.value === 'Reviewed' && !isUnread);

  // Chỉ kích hoạt khi đang ở trang 1 và không có từ khóa tìm kiếm (theo đúng điều kiện chèn danh sách của store)
  const isAtFirstPageWithoutSearch =
    currentPage.value === 1 && searchQuery.value.trim().length === 0;

  if (matchesCurrentFilter && isAtFirstPageWithoutSearch) {
    void nextTick(() => {
      // Xác nhận thông báo thực sự đã nằm trong danh sách hiển thị
      const isVisibleInList = paginatedNotifications.value.some((item) => item.id === notif.id);
      if (isVisibleInList) {
        recentNewId.value = notif.id;
        if (clearRecentNewTimer) clearTimeout(clearRecentNewTimer);
        clearRecentNewTimer = setTimeout(() => {
          recentNewId.value = null;
        }, 1500);
      }
    });
  }
};

const handleFilterChange = async (tab: FilterType): Promise<void> => {
  if (activeFilter.value === tab && !notificationStore.loading) return;

  const token = ++switchToken;
  activeFilter.value = tab; // Đổi tab ngay để tab đổi màu active
  isSwitchingTab.value = true;
  startDelayedSkeleton();

  const unreadParam = tab === 'Unread' ? true : tab === 'Reviewed' ? false : undefined;
  notificationStore.setQuery({ unread: unreadParam });

  try {
    await notificationStore.fetchFirstPage();
    if (token !== switchToken) return;

    // Đặt currentPage = 1 cùng tick với lúc danh sách được thay
    currentPage.value = 1;
    viewKey.value++;
  } finally {
    if (token === switchToken) {
      isSwitchingTab.value = false;
      stopDelayedSkeleton();
    }
  }
};

/**
 * Danh sách hiển thị:
 * Backend dùng cursor, không trả tổng số theo filter. Store giữ danh sách đã nạp (nối dần qua fetchNextPage),
 * UI phân trang Trước / Sau trên danh sách đó với pageSize cố định = 6 để giữ chiều cao bảng không bị giật.
 *
 * Lưu ý hành vi: Khi người dùng đang ở tab "Chưa đọc" và click đọc thông báo,
 * ta cố tình KHÔNG tự ẩn dòng ngay trên client để tránh giao diện bị nhảy/giật
 * khi người dùng đang thao tác. Dòng sẽ biến mất ở lần fetch lại kế tiếp từ server.
 */

/* ============================================================================
 * Phân trang Trước / Sau (Cursor-backed Pagination)
 * ==========================================================================*/
const currentPage = ref(1);
const pageSize = 6;
const isPaging = ref(false);

const paginatedNotifications = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  return sortedNotifications.value.slice(start, start + pageSize);
});

const pageStart = computed(() => {
  if (sortedNotifications.value.length === 0) return 0;
  return (currentPage.value - 1) * pageSize + 1;
});

const pageEnd = computed(() => {
  return Math.min(currentPage.value * pageSize, sortedNotifications.value.length);
});

const canGoPrev = computed(() => currentPage.value > 1);

const canGoNext = computed(() => {
  return currentPage.value * pageSize < sortedNotifications.value.length || notificationStore.hasMore;
});

/** Prefetch ngầm trang kế tiếp khi còn không quá 1 trang dữ liệu phía sau (<= pageSize) để bấm Sau mượt mà */
const triggerPrefetch = (): void => {
  const remaining = sortedNotifications.value.length - currentPage.value * pageSize;
  if (
    remaining <= pageSize &&
    notificationStore.hasMore &&
    !notificationStore.loading &&
    !isPaging.value
  ) {
    void notificationStore.fetchNextPage();
  }
};

const goPrev = (): void => {
  if (canGoPrev.value) {
    currentPage.value--;
    viewKey.value++;
  }
};

const goNext = async (): Promise<void> => {
  if (!canGoNext.value || isPaging.value) return;

  const pageAtClick = currentPage.value;
  const querySnapshot = JSON.stringify({
    u: notificationStore.query.unread,
    s: notificationStore.query.search,
  });

  // Nếu trang kế chưa có item (length <= currentPage * pageSize) và store còn cursor
  if (
    sortedNotifications.value.length <= currentPage.value * pageSize &&
    notificationStore.hasMore
  ) {
    isPaging.value = true;
    try {
      // Sẽ chờ cả trường hợp prefetch đang bay dở dang thông qua khóa promise của store
      await notificationStore.fetchNextPage();
    } finally {
      isPaging.value = false;
    }
  }

  // Chống race condition: nếu trong lúc await người dùng đã đổi filter/search hoặc chuyển trang
  const currentQuerySnapshot = JSON.stringify({
    u: notificationStore.query.unread,
    s: notificationStore.query.search,
  });
  if (currentPage.value !== pageAtClick || currentQuerySnapshot !== querySnapshot) {
    return;
  }

  // Chỉ tăng trang nếu trang kế thực sự có ít nhất 1 item
  if (sortedNotifications.value.length > currentPage.value * pageSize) {
    currentPage.value++;
    viewKey.value++;
    triggerPrefetch();
  }
};

/**
 * Cổng chèn realtime (insertGate):
 * Chỉ cho phép Socket.IO chèn dòng trực tiếp vào đầu danh sách khi đang ở trang 1 (currentPage === 1).
 * Khi người dùng đang ở trang >= 2, việc chèn thêm dòng mới vào đầu sẽ làm trôi lệch thứ tự (page drift),
 * khiến các dòng người dùng đang theo dõi bị nhảy sang trang sau. Do đó ở trang >= 2, ta giữ nguyên danh sách
 * và gom thông báo mới vào pendingNew để người dùng chủ động nạp lại khi muốn.
 */
watch(
  currentPage,
  (page) => {
    notificationStore.insertGate = page === 1;
  },
  { immediate: true },
);

// Đảm bảo currentPage luôn hợp lệ khi danh sách co lại sau refetch
watch(
  () => sortedNotifications.value.length,
  (len) => {
    const maxPage = Math.max(1, Math.ceil(len / pageSize));
    if (currentPage.value > maxPage) {
      currentPage.value = maxPage;
    }
  },
);

/** Xử lý khi bấm vào chip thông báo mới đang chờ: đưa về trang 1 và fetch lại danh sách */
const handleViewPendingNew = async (): Promise<void> => {
  currentPage.value = 1;
  viewKey.value++;
  await notificationStore.fetchFirstPage();
};

const hasUnread = computed(() => unreadCount.value > 0);

// Đánh dấu 1 item đã xem qua API backend
const markAsReviewed = async (id: string): Promise<boolean> => {
  const success = await notificationStore.markRead(id);
  if (success && activeModalItem.value && activeModalItem.value.id === id) {
    activeModalItem.value.readAt = new Date().toISOString();
  } else if (!success && notificationStore.error) {
    toast.error(notificationStore.error);
  }
  return success;
};

// Đánh dấu tất cả đã xem qua API backend với phản hồi trực quan
const isJustMarkedAll = ref(false);
let markedTimer: ReturnType<typeof setTimeout> | null = null;

const markAllAsReviewed = async (): Promise<void> => {
  if (!hasUnread.value || notificationStore.loading) return;
  const ok = await notificationStore.markAllRead();
  if (ok) {
    isJustMarkedAll.value = true;
    if (markedTimer) clearTimeout(markedTimer);
    markedTimer = setTimeout(() => {
      isJustMarkedAll.value = false;
    }, 1800);
  }
};

// Modal chi tiết: kết hợp ID và snapshot để phản ánh tức thì trạng thái đọc
const selectedNotificationId = ref<string | null>(null);
const activeModalItem = ref<NotificationItem | null>(null);

const selectedItem = computed<NotificationItem | null>(() => {
  if (!selectedNotificationId.value) return null;
  const fromList = notifications.value.find((n) => n.id === selectedNotificationId.value);
  return fromList ?? activeModalItem.value;
});

const openDetailModal = (item: NotificationItem): void => {
  selectedNotificationId.value = item.id;
  activeModalItem.value = { ...item };

  // Tự động gọi API đánh dấu đã đọc nếu thông báo chưa đọc
  if (item.readAt === null) {
    void markAsReviewed(item.id);
  }
};

const closeDetailModal = (): void => {
  selectedNotificationId.value = null;
  activeModalItem.value = null;
};

const isDeletingNotification = ref(false);

const handleDeleteNotification = async (id: string): Promise<void> => {
  isDeletingNotification.value = true;
  try {
    const success = await notificationStore.removeNotification(id);
    if (success) {
      closeDetailModal();
      toast.success('Đã xóa thông báo');
      triggerPrefetch();
    } else if (notificationStore.error) {
      toast.error(notificationStore.error);
    }
  } finally {
    isDeletingNotification.value = false;
  }
};

// Click handler trên hàng: mở component xem thông báo
const handleRowClick = (item: NotificationItem, e: MouseEvent): void => {
  const target = e.target as HTMLElement | null;
  if (target?.closest('a') || target?.closest('button')) {
    return;
  }
  openDetailModal(item);
};

const handleEnterKey = (item: NotificationItem): void => {
  openDetailModal(item);
};

// Skeleton loading có độ trễ
const isLoading = computed(() => showSkeleton.value);
const isWaitingNewData = computed(() => (isSwitchingTab.value || isSearching.value) && !showSkeleton.value);
const isListFaded = computed(() => {
  return isPaging.value || ((isSwitchingTab.value || isSearching.value) && hasLoadedOnce.value && sortedNotifications.value.length > 0);
});

const searchInputRef = ref<HTMLInputElement | null>(null);

const handleGlobalKeyDown = (e: KeyboardEvent): void => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
  }
};

onMounted(async () => {
  window.addEventListener('keydown', handleGlobalKeyDown);
  notificationStore.bindSocket();
  notificationStore.insertGate = true;
  notificationStore.pendingNew = 0;
  getSocket().on('notification:new', handleSocketNewNotification);

  if (authStore.isAuthenticated) {
    startDelayedSkeleton();
    notificationStore.setQuery({ limit: 30, unread: undefined, search: searchQuery.value.trim() || undefined });
    try {
      await notificationStore.fetchFirstPage();
    } finally {
      stopDelayedSkeleton();
      hasLoadedOnce.value = true;
    }
  } else {
    hasLoadedOnce.value = true;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeyDown);
  getSocket().off('notification:new', handleSocketNewNotification);
  if (markedTimer) clearTimeout(markedTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
  if (skeletonDelayTimer) clearTimeout(skeletonDelayTimer);
  if (clearRecentNewTimer) clearTimeout(clearRecentNewTimer);
  // Mở lại cổng realtime cho store khi người dùng rời khỏi trang thông báo
  notificationStore.insertGate = true;
});
</script>

<template>
<div class="font-poppins min-h-full bg-white py-6 sm:py-9 px-3 sm:px-6 lg:px-10 font-sans text-gray-800 antialiased">
    <div class="max-w-[1100px] mx-auto space-y-6">

    <!-- ================= 1. Tiêu đề trang ================= -->
    <header class="nt-rise">
        <h1 class="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight leading-tight">
        Trung tâm thông báo
        </h1>
        <p class="text-sm text-gray-500 mt-1 font-normal leading-normal">
        Các cập nhật về tuyển dụng, hồ sơ ứng viên và lịch phỏng vấn sẽ hiển thị tại đây.
        </p>
    </header>


    <!-- ================= 2. Thanh tìm kiếm & Bộ lọc Chips ================= -->
    <div class="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3 nt-rise nt-delay-1">
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full xl:w-auto">
        <!-- Ô tìm kiếm bo góc vừa vặn rounded-lg, pl-9, có nút xóa từ khóa -->
        <div class="relative w-full sm:w-[250px] xl:w-[290px] shrink-0">
            <Search class="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref="searchInputRef"
              v-model="searchQuery"
              type="text"
              aria-label="Tìm kiếm thông báo"
              placeholder="Tìm theo tiêu đề hoặc nội dung thông báo…"
              class="w-full h-9 sm:h-8 pl-9 pr-8 rounded-lg border border-gray-200 bg-white text-xs text-gray-800 placeholder-gray-500 hover:border-gray-300 focus:outline-none focus:border-[#5b4eea] focus:ring-2 focus:ring-[#5b4eea]/15 transition shadow-2xs"
              @input="handleSearchInput"
              @keydown.enter.prevent="triggerSearchImmediately"
            />
            <!-- Nút Xóa nhanh từ khóa tìm kiếm (touch target >= 44px với pseudo-element) -->
            <button
              v-if="searchQuery.length > 0"
              type="button"
              class="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-gray-500 hover:text-red-600 transition rounded cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-300 before:absolute before:-inset-2.5"
              aria-label="Xóa từ khóa tìm kiếm"
              title="Xóa tìm kiếm"
              @click="clearSearch"
            >
              <X class="w-3.5 h-3.5" />
            </button>
        </div>

        <!-- Filter tabs gãy gọn hiện đại (h-9 trên mobile để touch target tốt hơn) -->
        <div class="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none min-w-0">
            <button
            v-for="tab in filterTabs"
            :key="tab.value"
            type="button"
            class="h-9 sm:h-8 px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer select-none inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 border shrink-0"
            :class="[
                tab.value === 'Unread' ? 'min-w-[88px] justify-center' : '',
                activeFilter === tab.value
                ? 'bg-[#5b4eea] text-white border-[#5b4eea] shadow-2xs'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100 hover:text-gray-900 hover:border-gray-300'
            ]"
            @click="handleFilterChange(tab.value)"
            >
            <span>{{ tab.label }}</span>
            <!-- Badge số lượng cho Chưa đọc (nâng lên text-[11px] dễ đọc) -->
            <span
                v-if="tab.value === 'Unread' && unreadCount > 0"
                class="px-1.5 py-0.5 rounded-md text-[11px] font-semibold border leading-tight"
                :class="activeFilter === 'Unread' ? 'bg-white/20 text-white border-transparent' : 'bg-red-50 text-red-600 border-red-100'"
            >
                {{ unreadCount }}
            </span>
            </button>
        </div>
        </div>

        <!-- Nút Đánh dấu tất cả đã đọc (rõ nét, đồng bộ với toolbar, phản hồi mượt mà) -->
        <button
          type="button"
          :disabled="!hasUnread"
          class="h-9 sm:h-8 px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 self-start xl:self-auto select-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 border shrink-0 shadow-2xs group"
          :class="[
            isJustMarkedAll
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 cursor-default'
              : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-100 hover:border-gray-400 hover:text-gray-900 disabled:hover:bg-white disabled:hover:border-gray-300 disabled:hover:text-gray-800 disabled:cursor-not-allowed cursor-pointer'
          ]"
          :title="hasUnread ? 'Đánh dấu tất cả thông báo là đã đọc' : isJustMarkedAll ? 'Đã đánh dấu tất cả thành công' : 'Không có thông báo chưa đọc'"
          :aria-label="hasUnread ? 'Đánh dấu tất cả thông báo là đã đọc' : 'Không có thông báo chưa đọc'"
          @click="markAllAsReviewed"
        >
          <CheckCheck
            class="w-4 h-4 transition-colors duration-150"
            :class="[
              isJustMarkedAll
                ? 'text-emerald-600'
                : 'text-gray-700 group-hover:text-gray-900'
            ]"
          />
          <span>Đánh dấu tất cả đã đọc</span>
        </button>
    </div>

    <!-- Chip thông báo realtime mới (chống trôi dòng / page drift khi ở trang >= 2 hoặc lệch filter) -->
    <div
      v-if="notificationStore.pendingNew > 0"
      role="status"
      aria-live="polite"
      class="flex items-center justify-center nt-rise"
    >
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-[#5b4eea] bg-[#5b4eea]/10 border border-[#5b4eea]/20 hover:bg-[#5b4eea]/15 transition-colors shadow-2xs cursor-pointer select-none"
        @click="handleViewPendingNew"
      >
        <Sparkles class="w-3.5 h-3.5 text-[#5b4eea]" />
        <span>Có {{ notificationStore.pendingNew }} thông báo mới · <span class="font-semibold underline">Xem</span></span>
      </button>
    </div>

    <!-- ================= 3. Card danh sách thông báo ================= -->
    <div class="bg-white rounded-xl border border-gray-200/90 shadow-2xs overflow-hidden nt-panel nt-delay-2">
        <!-- ================= A. Desktop: Table 4 Cột Chuẩn SaaS (Tiêu đề & Nội dung 1 Cột) ================= -->
        <div
          class="hidden lg:block overflow-hidden"
          :class="{ 'pointer-events-none': isListFaded }"
        >
        <table class="w-full min-w-[640px] table-fixed text-left border-collapse">
            <!-- Colgroup cố định chính xác độ rộng từng cột, không xê dịch khi đổi nội dung -->
            <colgroup>
            <col class="w-[62%]" />
            <col class="w-[14%]" />
            <col class="w-[14%]" />
            <col class="w-[10%]" />
            </colgroup>

            <!-- Table Header (Chiều cao cố định 38px) -->
            <thead>
            <tr class="h-[38px] border-b border-gray-100 text-xs font-medium text-gray-600 bg-gray-50/50">
                <th scope="col" class="py-2 px-5">Thông báo</th>
                <th scope="col" class="py-2 px-4">Ngày nhận</th>
                <th scope="col" class="py-2 px-4">Trạng thái</th>
                <th scope="col" class="py-2 px-5 text-right">Thao tác</th>
            </tr>
            </thead>

            <!-- Table Body mượt mà với chuyển động hàng và mờ khi phân trang/lọc -->
            <tbody
              class="divide-y divide-gray-100 text-xs transition-opacity duration-150"
              :class="{ 'opacity-60 pointer-events-none': isListFaded }"
              :aria-busy="isListFaded ? 'true' : undefined"
            >
              <!-- Skeleton Loading (6 dòng, mỗi dòng cố định h-[58px]) -->
              <tr
                  v-if="isLoading"
                  v-for="n in 6"
                  :key="'skel-d-' + n"
                  class="h-[58px] animate-pulse"
              >
                  <td class="h-[58px] py-2 px-5 align-middle">
                  <div class="flex flex-col gap-1.5">
                      <div class="h-3.5 bg-gray-200/70 rounded w-2/5" />
                      <div class="h-3 bg-gray-200/50 rounded w-3/4" />
                  </div>
                  </td>
                  <td class="h-[58px] py-2 px-4 align-middle">
                  <div class="h-3.5 bg-gray-200/70 rounded w-16" />
                  </td>
                  <td class="h-[58px] py-2 px-4 align-middle">
                  <div class="h-3.5 bg-gray-200/70 rounded w-16" />
                  </td>
                  <td class="h-[58px] py-2 px-5 text-right align-middle">
                  <div class="h-3.5 bg-gray-200/70 rounded w-5 ml-auto" />
                  </td>
              </tr>

              <!-- Dữ liệu thông báo thực tế -->
              <template v-else>
                  <tr
                  v-for="(item, index) in paginatedNotifications"
                  :key="item.id"
                  tabindex="0"
                  :aria-label="item.title"
                  class="h-[58px] transition-colors group cursor-pointer hover:bg-gray-100/60 focus-visible:outline-none focus-visible:bg-gray-100/60 focus-visible:ring-1 focus-visible:ring-gray-300 nt-row"
                  :style="{ animationDelay: `${Math.min(300, index * 40)}ms` }"
                  :class="[
                      item.readAt === null
                      ? 'bg-blue-50/20'
                      : 'bg-white',
                      recentNewId === item.id ? 'is-new' : ''
                  ]"
                  @click="handleRowClick(item, $event)"
                  @keydown.enter.prevent="handleEnterKey(item)"
                  @keydown.space.prevent="handleEnterKey(item)"
                  >
                <!-- Tiêu đề ở trên, nội dung tóm tắt ở dưới (trong cùng 1 cột) -->
                <td class="h-[58px] py-2 px-5 align-middle">
                    <div class="flex flex-col gap-0.5 max-w-full">
                    <span
                        class="text-[13px] font-semibold text-gray-900 leading-snug truncate transition-colors group-hover:text-blue-600"
                        :title="item.title"
                    >
                        {{ item.title }}
                    </span>
                    <span
                        v-if="item.summary && item.summary !== '-'"
                        class="text-xs text-gray-500 font-normal truncate group-hover:text-gray-600 leading-tight"
                        :title="item.summary"
                    >
                        {{ item.summary }}
                    </span>
                    </div>
                </td>

                <!-- Ngày nhận (hiển thị tương đối trong 24h, tooltip chi tiết, tương phản chuẩn WCAG AA) -->
                <td class="h-[58px] py-2 px-4 text-gray-600 font-normal truncate align-middle" :title="formatFullTime(item.createdAt)">
                    {{ formatTime(item.createdAt) }}
                </td>

                <!-- Badge trạng thái (Dot + Text tinh tế) -->
                <td class="h-[58px] py-2 px-4 whitespace-nowrap align-middle">
                    <!-- Đã đọc (Xanh lá) -->
                    <span
                    v-if="getStatus(item) === 'Reviewed'"
                    class="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700"
                    >
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    Đã đọc
                    </span>

                    <!-- Chưa đọc (Xanh dương) -->
                    <span
                    v-else
                    class="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700"
                    >
                    <span class="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                    Chưa đọc
                    </span>
                </td>

                <!-- Cột Thao tác: Bấm mũi tên trỏ tới trang tương ứng (tabindex=-1 để tránh double focus stop) -->
                <td class="h-[58px] py-2 px-5 text-right whitespace-nowrap align-middle">
                    <router-link
                    v-if="getNotificationRoute(item)"
                    :to="getNotificationRoute(item)!"
                    tabindex="-1"
                    aria-hidden="true"
                    class="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 group-hover:text-gray-900 hover:text-gray-900 hover:bg-gray-200/60 transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 cursor-pointer"
                    title="Đi đến trang tương ứng"
                    @click.stop="markAsReviewed(item.id)"
                    >
                    <ArrowRight
                        :size="15"
                        :stroke-width="2"
                        class="transition-transform duration-150 ease-out group-hover:translate-x-0.5"
                    />
                    </router-link>

                    <button
                    v-else
                    type="button"
                    tabindex="-1"
                    aria-hidden="true"
                    class="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 group-hover:text-gray-900 hover:text-gray-900 hover:bg-gray-200/60 transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 cursor-pointer"
                    title="Xem chi tiết thông báo"
                    @click.stop="openDetailModal(item)"
                    >
                    <ArrowRight
                        :size="15"
                        :stroke-width="2"
                        class="transition-transform duration-150 ease-out group-hover:translate-x-0.5"
                    />
                    </button>
                </td>
                </tr>

                <!-- Dòng đệm giữ chỗ (Spacer Rows): Đảm bảo bảng luôn cố định 6 dòng, kích thước bằng nhau tuyệt đối giữa các trang -->
                <tr
                v-if="paginatedNotifications.length > 0 && paginatedNotifications.length < pageSize"
                v-for="emptyIdx in (pageSize - paginatedNotifications.length)"
                :key="`spacer-${emptyIdx}`"
                class="h-[58px] pointer-events-none select-none"
                aria-hidden="true"
                >
                <td class="h-[58px] py-2 px-5">&nbsp;</td>
                <td class="h-[58px] py-2 px-4">&nbsp;</td>
                <td class="h-[58px] py-2 px-4">&nbsp;</td>
                <td class="h-[58px] py-2 px-5 text-right">&nbsp;</td>
                </tr>

                <!-- Empty Results Desktop (Chiều cao h-[348px] bảo toàn đúng 6x58px không giật card) -->
                <tr v-if="sortedNotifications.length === 0" class="h-[348px]">
                <td colspan="4" class="h-[348px] py-14 px-4 text-center text-gray-500 align-middle anim-empty-fade">
                    <p class="text-sm font-medium text-gray-700">Không tìm thấy thông báo phù hợp.</p>
                    <p v-if="searchQuery.trim()" class="text-xs text-gray-500 mt-1 break-words max-w-md mx-auto">
                    Không có kết quả khớp với từ khóa "{{ searchQuery.trim() }}".
                    <button
                        type="button"
                        class="text-blue-600 hover:underline font-medium ml-1 cursor-pointer focus-visible:outline-none"
                        @click="clearSearch"
                    >
                        Xóa tìm kiếm
                    </button>
                    </p>
                    <p v-else-if="activeFilter !== 'All'" class="text-xs text-gray-500 mt-1">
                    Không có thông báo nào trong mục này.
                    <button
                        type="button"
                        class="text-blue-600 hover:underline font-medium ml-1 cursor-pointer focus-visible:outline-none"
                        @click="handleFilterChange('All')"
                    >
                        Xem tất cả
                    </button>
                    </p>
                </td>
                </tr>
            </template>
            </tbody>
        </table>
        </div>

        <!-- ================= B. Mobile / Tablet: Responsive Notification Card List ================= -->
        <div
          class="block lg:hidden text-xs overflow-hidden"
          :class="{ 'pointer-events-none': isListFaded }"
          :aria-busy="isListFaded ? 'true' : undefined"
        >
          <!-- Khối mobile chuyển động mượt mà, mờ khi chuyển trang/lọc -->
          <div
            class="divide-y divide-gray-100 transition-opacity duration-150"
            :class="{ 'opacity-60': isListFaded }"
          >
            <!-- Skeleton Loading Mobile (4 cards giảm chiều cao) -->
            <template v-if="isLoading">
              <div
                  v-for="n in 4"
                  :key="'skel-m-' + n"
                  class="p-3.5 sm:p-4 space-y-2.5 animate-pulse"
              >
                  <div class="flex justify-between items-center">
                  <div class="h-3 bg-gray-200 rounded w-20" />
                  <div class="h-3 bg-gray-200 rounded w-16" />
                  </div>
                  <div class="h-4 bg-gray-200 rounded w-3/4" />
                  <div class="h-3 bg-gray-200 rounded w-5/6" />
              </div>
            </template>

            <!-- Empty Results Mobile / Tablet -->
            <div v-else-if="sortedNotifications.length === 0" class="flex flex-col items-center justify-center min-h-[260px] py-12 px-4 text-center text-gray-500 anim-empty-fade">
                <p class="text-sm font-medium text-gray-700">Không tìm thấy thông báo phù hợp.</p>
                <p v-if="searchQuery.trim()" class="text-xs text-gray-500 mt-1 break-words max-w-md mx-auto">
                Không có kết quả khớp với từ khóa "{{ searchQuery.trim() }}".
                <button
                    type="button"
                    class="text-blue-600 hover:underline font-medium ml-1 cursor-pointer focus-visible:outline-none"
                    @click="clearSearch"
                >
                    Xóa tìm kiếm
                </button>
                </p>
                <p v-else-if="activeFilter !== 'All'" class="text-xs text-gray-500 mt-1">
                Không có thông báo nào trong mục này.
                <button
                    type="button"
                    class="text-blue-600 hover:underline font-medium ml-1 cursor-pointer focus-visible:outline-none"
                    @click="handleFilterChange('All')"
                >
                    Xem tất cả
                </button>
                </p>
            </div>

            <!-- Danh sách cards mobile / tablet -->
            <template v-else>
                <div
                v-for="(item, index) in paginatedNotifications"
                :key="`m-${item.id}`"
                tabindex="0"
                role="button"
                :aria-label="item.title"
                class="p-3.5 sm:p-4 transition-colors cursor-pointer hover:bg-gray-100/60 active:bg-gray-100/80 focus-visible:outline-none focus-visible:bg-gray-100/60 nt-row-m"
                :style="{ animationDelay: `${Math.min(300, index * 40)}ms` }"
                :class="[
                    item.readAt === null
                    ? 'bg-blue-50/20'
                    : 'bg-white',
                    recentNewId === item.id ? 'is-new' : ''
                ]"
                @click="handleRowClick(item, $event)"
                @keydown.enter.prevent="handleEnterKey(item)"
                @keydown.space.prevent="handleEnterKey(item)"
                >
                <!-- Hàng trạng thái + Ngày nhận -->
            <div class="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                <!-- Đã đọc -->
                <span
                v-if="getStatus(item) === 'Reviewed'"
                class="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700"
                >
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" /> Đã đọc
                </span>
                <!-- Chưa đọc -->
                <span
                v-else
                class="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700"
                >
                <span class="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" /> Chưa đọc
                </span>

                <span class="text-xs text-gray-600 font-normal">
                {{ formatTime(item.createdAt) }}
                </span>
            </div>

            <!-- Tiêu đề (In đậm đồng nhất) -->
            <h4 class="text-sm font-semibold text-gray-900 leading-snug line-clamp-2 break-words">
                {{ item.title }}
            </h4>

            <!-- Tóm tắt -->
            <p
                v-if="item.summary && item.summary !== '-'"
                class="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed break-words"
            >
                {{ item.summary }}
            </p>

            <!-- Footer mobile: Bấm nút Xem chi tiết trỏ tới trang tương ứng (vùng bấm tối thiểu 40px) -->
            <div class="mt-2.5 flex items-center justify-end">
                <router-link
                v-if="getNotificationRoute(item)"
                :to="getNotificationRoute(item)!"
                class="inline-flex items-center gap-1 min-h-[40px] sm:min-h-[36px] py-1.5 px-3 rounded-lg text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-200/60 font-medium transition cursor-pointer"
                aria-label="Đi đến trang tương ứng"
                @click.stop="markAsReviewed(item.id)"
                >
                <span>Xem chi tiết</span>
                <ArrowRight :size="13" />
                </router-link>
                <button
                v-else
                type="button"
                class="inline-flex items-center gap-1 min-h-[40px] sm:min-h-[36px] py-1.5 px-3 rounded-lg text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-200/60 font-medium transition cursor-pointer"
                aria-label="Xem chi tiết thông báo"
                @click.stop="openDetailModal(item)"
                >
                <span>Xem chi tiết</span>
                <ArrowRight :size="13" />
                </button>
            </div>
            </div>
        </template>
          </div>
        </div>

        <!-- ================= Thanh Chân Card: Phân Trang Trước / Sau ================= -->
        <!-- Vỏ chân card luôn duy trì min-h-[57px] cố định ở mọi trạng thái (skeleton/dữ liệu/empty) -->
        <div
          class="border-t border-gray-100 min-h-[57px] px-3.5 sm:px-5 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs bg-white"
          :class="{ 'pointer-events-none': isListFaded }"
        >
          <!-- Skeleton thanh chân card khi isLoading -->
          <template v-if="isLoading">
            <div class="h-3.5 bg-gray-200/70 rounded w-28 animate-pulse" />
            <div class="flex items-center gap-2">
                <div class="w-7 h-7 bg-gray-200/60 rounded-lg animate-pulse" />
                <div class="h-3.5 bg-gray-200/60 rounded w-14 animate-pulse" />
                <div class="w-7 h-7 bg-gray-200/60 rounded-lg animate-pulse" />
            </div>
          </template>

          <!-- Thanh chân card thực tế khi có thông báo (Desktop & Mobile) -->
          <template v-else-if="sortedNotifications.length > 0">
            <!-- Text trái: Hiển thị {pageStart}-{pageEnd} -->
            <div class="text-center sm:text-left text-gray-600 font-normal">
                Hiển thị <span class="font-medium text-gray-900">{{ pageStart }}</span> -
                <span class="font-medium text-gray-900">{{ pageEnd }}</span>
            </div>

            <!-- Bên phải: Nút Trước, Nhãn Trang, Nút Sau -->
            <div class="flex items-center gap-1.5 select-none text-gray-500">
                <!-- Nút Trước (touch target tối ưu trên mobile) -->
                <button
                type="button"
                class="w-8 h-8 sm:w-7 sm:h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-100 hover:border-gray-300 hover:text-gray-900 disabled:opacity-35 disabled:cursor-not-allowed transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 relative before:absolute before:-inset-1.5"
                :disabled="!canGoPrev"
                aria-label="Trang trước"
                title="Trang trước"
                @click="goPrev"
                >
                <ChevronLeft :size="14" />
                </button>

                <!-- Nhãn Trang hiện tại -->
                <span class="px-2 text-xs font-medium text-gray-700 min-w-[54px] text-center">
                Trang {{ currentPage }}
                </span>

                <!-- Nút Sau (touch target tối ưu trên mobile) -->
                <button
                type="button"
                class="w-8 h-8 sm:w-7 sm:h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-100 hover:border-gray-300 hover:text-gray-900 disabled:opacity-35 disabled:cursor-not-allowed transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 relative before:absolute before:-inset-1.5"
                :disabled="!canGoNext || isPaging"
                aria-label="Trang sau"
                title="Trang sau"
                @click="goNext"
                >
                <RefreshCw v-if="isPaging" :size="12" class="animate-spin text-gray-500" />
                <ChevronRight v-else :size="14" />
                </button>
            </div>
          </template>

          <!-- Khi empty: giữ vỏ với invisible để bảo toàn đúng min-h-[57px], không giật card -->
          <template v-else>
            <div class="invisible select-none" aria-hidden="true">
              Hiển thị 0 - 0
            </div>
            <div class="invisible select-none flex items-center gap-1.5" aria-hidden="true">
              <div class="w-8 h-8 sm:w-7 sm:h-7" />
              <span class="px-2 text-xs min-w-[54px]">Trang 1</span>
              <div class="w-8 h-8 sm:w-7 sm:h-7" />
            </div>
          </template>
        </div>
    </div>

    </div>

    <!-- ================= Component xem thông báo (Detail Modal) ================= -->
    <NotificationDetailModal
      :item="selectedItem"
      :deleting="isDeletingNotification"
      @close="closeDetailModal"
      @delete="handleDeleteNotification"
    />
</div>
</template>

<style scoped>
.scrollbar-none::-webkit-scrollbar {
display: none;
}
.scrollbar-none {
-ms-overflow-style: none;
scrollbar-width: none;
}

/* ============================================================================
 * Animations chuyển động mượt mà SaaS (chỉ transform và opacity)
 * ==========================================================================*/
@media (prefers-reduced-motion: no-preference) {
  .nt-rise {
    animation: nt-rise 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .nt-delay-1 { animation-delay: 70ms; }
  .nt-delay-2 { animation-delay: 140ms; }

  .nt-panel {
    animation: nt-rise-sm 0.2s ease-out both;
  }

  .nt-row {
    animation: nt-fade 0.25s ease-out both;
  }

  .nt-row-m {
    animation: nt-rise-sm 0.25s ease-out both;
  }
}

@keyframes nt-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes nt-rise-sm {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes nt-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* Modifier highlight dòng thông báo mới (nền #5b4eea/8%, mờ dần sau 1.5s, không animation/transform) */
.is-new {
  background-color: rgba(91, 78, 234, 0.08) !important;
  transition: background-color 700ms ease;
}

/* Hiệu ứng fade nhẹ 150ms cho empty state khi xuất hiện */
@keyframes emptyFade {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}

.anim-empty-fade {
  animation: emptyFade 150ms ease-out forwards;
}

@media (prefers-reduced-motion: reduce) {
  .nt-rise,
  .nt-panel,
  .nt-row,
  .nt-row-m,
  .anim-empty-fade {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
  .is-new {
    transition: none !important;
  }
  .animate-pulse {
    animation: none !important;
  }
}
</style>
