<script setup lang="ts">
/**
 * NotificationDetailModal — Component Modal xem chi tiết thông báo (JobMatch VN).
 *
 * Hiển thị toàn bộ thông tin chi tiết của một thông báo:
 * - Tiêu đề, mã thông báo, ngày nhận (đầy đủ giờ phút), trạng thái (Đã xem / Chưa đọc).
 * - Nội dung chi tiết thông báo.
 * - Nút điều hướng đến trang nghiệp vụ tương ứng (nếu có).
 * - Nút Đánh dấu đã xem và Đóng modal.
 * - Animation mở/đóng mượt mà 180-200ms (fade overlay + slide/scale nhẹ 8px cho panel).
 * - Chống giật layout (layout shift) và triệt tiêu scrollbar nhấp nháy khi đóng/mở.
 * - Hỗ trợ keyboard shortcut (Escape), click backdrop và Teleport to body.
 */
import { ref, nextTick, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRouter, type RouteLocationRaw } from 'vue-router';
import { X, Calendar, ArrowRight, Trash2, Loader2 } from 'lucide-vue-next';
import { useAuthStore } from '@stores/auth';
import dayjs from 'dayjs';

import type { NotificationType } from '@/types/notification';

export interface NotificationDetailItem {
  id: string;
  type: NotificationType;
  title: string;
  summary?: string;
  createdAt: string;
  readAt: string | null;
  payload: Record<string, unknown>;
  details?: string;
}

const props = withDefaults(
  defineProps<{
    item: NotificationDetailItem | null;
    deleting?: boolean;
  }>(),
  {
    deleting: false,
  },
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'delete', id: string): void;
}>();

const router = useRouter();
const authStore = useAuthStore();

const formatFullTime = (iso: string): string => {
  return dayjs(iso).format('HH:mm · DD/MM/YYYY');
};

/**
 * Trả về RouteLocationRaw đích trong Router của Employer dựa trên type và payload.
 * Nếu không có trang đích (như báo cáo, khảo sát), trả về null.
 */
const getNotificationRoute = (notification: NotificationDetailItem): RouteLocationRaw | null => {
  const p = (notification.payload ?? {}) as Record<string, string | undefined>;
  const isCandidate = authStore.user?.role === 'candidate';

  if (
    notification.type === 'application_new' ||
    notification.type === 'application_withdrawn' ||
    notification.type === 'application_match_ready'
  ) {
    return isCandidate ? { name: 'candidate-applications' } : { name: 'employer-applications' };
  }
  if (notification.type === 'interview_scheduled') {
    return isCandidate ? { name: 'candidate-applications' } : { name: 'employer-interviews' };
  }
  if (notification.type === 'message') {
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
  if (notification.type === 'company' || notification.type === 'company_invite') {
    if (isCandidate) return null;
    if (p.kind === 'company_invite' || p.kind === 'company_invite_sent' || p.kind === 'members') {
      return { name: 'employer-company-members' };
    }
    return { name: 'employer-company' };
  }
  if (notification.type === 'job_match' || (notification.type === 'system' && p.jobId)) {
    if (isCandidate) {
      return { name: 'candidate-jobs' };
    }
    if (p.jobId) {
      return { name: 'employer-job-detail', params: { id: p.jobId } };
    }
    return { name: 'employer-jobs' };
  }
  if (notification.type === 'system') {
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

const handleClose = (): void => {
  isConfirmingDelete.value = false;
  emit('close');
};

const isConfirmingDelete = ref(false);
const cancelConfirmButtonRef = ref<HTMLButtonElement | null>(null);

const handleStartDelete = (): void => {
  if (props.deleting) return;
  isConfirmingDelete.value = true;
  nextTick(() => {
    cancelConfirmButtonRef.value?.focus();
  });
};

const handleCancelDelete = (): void => {
  if (props.deleting) return;
  isConfirmingDelete.value = false;
};

const handleConfirmDelete = (): void => {
  if (props.deleting || !props.item) return;
  emit('delete', props.item.id);
};

const handleKeyDown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape' && props.item) {
    e.preventDefault();
    e.stopPropagation();
    if (isConfirmingDelete.value) {
      handleCancelDelete();
    } else {
      handleClose();
    }
  }
};

// Quản lý khóa scroll body an toàn, khôi phục chính xác trạng thái gốc của trang
let originalOverflow = '';
let originalPaddingRight = '';
let isScrollLocked = false;
let previousActiveElement: HTMLElement | null = null;
const closeButtonRef = ref<HTMLButtonElement | null>(null);

const lockScroll = (): void => {
  if (isScrollLocked) return;
  previousActiveElement = document.activeElement as HTMLElement | null;
  originalOverflow = document.body.style.overflow;
  originalPaddingRight = document.body.style.paddingRight;
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  if (scrollbarWidth > 0) {
    document.body.style.paddingRight = `${scrollbarWidth}px`;
  }
  document.body.style.overflow = 'hidden';
  isScrollLocked = true;
};

const unlockScroll = (): void => {
  if (!isScrollLocked) return;
  document.body.style.overflow = originalOverflow;
  document.body.style.paddingRight = originalPaddingRight;
  isScrollLocked = false;
  if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
    previousActiveElement.focus();
  }
};

watch(
  () => props.item,
  (newItem) => {
    isConfirmingDelete.value = false;
    if (newItem) {
      lockScroll();
      nextTick(() => {
        closeButtonRef.value?.focus();
      });
    }
  },
  { immediate: true },
);

// Chỉ mở lại scroll sau khi hiệu ứng leave transition đã hoàn tất 100%
const onAfterLeave = (): void => {
  unlockScroll();
};

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown);
  unlockScroll();
});

const handleNavigateDestination = (): void => {
  if (!props.item) return;
  const target = getNotificationRoute(props.item);
  handleClose();
  if (target) {
    void router.push(target);
  }
};
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade" @after-leave="onAfterLeave">
      <div
        v-if="item"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-modal-title"
        class="font-poppins fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
        @click.self="handleClose"
      >
        <!-- Overlay Backdrop mờ dần tự nhiên (pointer-events-none để click rơi vào container cha @click.self) -->
        <div class="fixed inset-0 bg-black/40 backdrop-blur-2xs pointer-events-none" aria-hidden="true" />

        <!-- Khung Panel chi tiết thông báo (max-h và overflow-y-auto chống tràn trên màn hình nhỏ) -->
        <div
          class="modal-panel relative z-10 bg-white rounded-2xl max-w-lg w-full max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col p-4 sm:p-6 shadow-2xl border border-gray-100 text-xs antialiased will-change-transform"
          @click.stop
        >
          <!-- Modal Header (cố định trên cùng) -->
          <div class="flex items-start justify-between gap-3 shrink-0 pb-3 border-b border-gray-100">
            <div class="min-w-0 flex-1">
              <span class="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
                THÔNG BÁO
              </span>
              <h3 id="notification-modal-title" class="text-base sm:text-lg font-bold text-gray-900 mt-0.5 leading-snug break-words">
                {{ item.title }}
              </h3>
            </div>
            <button
              ref="closeButtonRef"
              type="button"
              class="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 shrink-0 relative before:absolute before:-inset-1.5"
              aria-label="Đóng"
              title="Đóng (Escape)"
              @click="handleClose"
            >
              <X class="w-4 h-4" />
            </button>
          </div>

          <!-- Metadata & Nội dung chi tiết (vùng cuộn độc lập) -->
          <div class="space-y-3.5 py-3 overflow-y-auto flex-1 min-h-0 pr-0.5">
            <!-- Ngày nhận và Trạng thái trên 1 hàng -->
            <div class="flex items-center justify-between flex-wrap gap-2 text-xs">
              <div class="flex items-center gap-1.5 text-gray-600">
                <Calendar class="w-3.5 h-3.5 text-gray-500" />
                <span>Ngày nhận: <strong class="text-gray-900 font-medium" :title="formatFullTime(item.createdAt)">{{ formatFullTime(item.createdAt) }}</strong></span>
              </div>

              <div class="flex items-center gap-1.5">
                <span class="text-gray-600">Trạng thái:</span>
                <!-- Đã đọc (Xanh lá) -->
                <span
                  v-if="item.readAt !== null"
                  class="inline-flex items-center gap-1.5 font-medium text-emerald-700"
                >
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" /> Đã đọc
                </span>
                <!-- Chưa đọc (Xanh dương) -->
                <span
                  v-else
                  class="inline-flex items-center gap-1.5 font-medium text-blue-700"
                >
                  <span class="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" /> Chưa đọc
                </span>
              </div>
            </div>

            <!-- Nội dung chi tiết -->
            <div class="p-3.5 sm:p-4 bg-gray-50 rounded-xl border border-gray-100 text-gray-700 leading-relaxed text-xs sm:text-sm break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
              <p class="font-semibold text-gray-900 mb-1.5">Nội dung chi tiết:</p>
              {{ item.details || item.summary }}
            </div>
          </div>

          <!-- Modal Footer (cố định dưới cùng) -->
          <div class="pt-3 border-t border-gray-100 shrink-0">
            <!-- Bước 2: Khối xác nhận xóa 2 bước -->
            <div
              v-if="isConfirmingDelete"
              role="alertdialog"
              aria-label="Xác nhận xóa thông báo"
              class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 p-2.5 bg-red-50/60 rounded-xl border border-red-100"
            >
              <span class="text-xs font-medium text-red-800 text-center sm:text-left">
                Xóa thông báo này?
              </span>
              <div class="flex items-center justify-end gap-2 shrink-0">
                <button
                  ref="cancelConfirmButtonRef"
                  type="button"
                  :disabled="deleting"
                  class="flex-1 sm:flex-initial px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
                  @click="handleCancelDelete"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  :disabled="deleting"
                  class="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 shadow-xs"
                  @click="handleConfirmDelete"
                >
                  <Loader2 v-if="deleting" class="w-3.5 h-3.5 animate-spin" />
                  <span>{{ deleting ? 'Đang xóa...' : 'Xóa' }}</span>
                </button>
              </div>
            </div>

            <!-- Bước 1: Footer thông thường -->
            <div
              v-else
              class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5"
            >
              <!-- Nút Xóa thông báo bên trái (cách xa nút chính) -->
              <div>
                <button
                  type="button"
                  :disabled="deleting"
                  class="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg border border-red-200/80 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
                  title="Xóa thông báo này"
                  aria-label="Xóa thông báo"
                  @click="handleStartDelete"
                >
                  <Trash2 class="w-3.5 h-3.5 shrink-0" />
                  <span>Xóa thông báo</span>
                </button>
              </div>

              <!-- Nút điều hướng liên quan & Nút Đóng bên phải -->
              <div class="flex items-center justify-end flex-wrap gap-2.5 sm:gap-3">
                <button
                  v-if="getNotificationRoute(item)"
                  type="button"
                  class="inline-flex items-center justify-center gap-1.5 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 rounded group select-none"
                  @click="handleNavigateDestination"
                >
                  <span class="link-underline leading-none">Mở trang liên quan</span>
                  <ArrowRight :size="13" class="shrink-0 relative top-px transition-transform duration-150 group-hover:translate-x-0.5" />
                </button>

                <button
                  type="button"
                  class="text-center px-4 py-2 sm:py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 hover:text-gray-900 hover:border-gray-300 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 min-h-[36px] sm:min-h-0"
                  @click="handleClose"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/*
 * Transition mở / đóng modal tinh tế (180ms - 200ms) chuẩn SaaS:
 * - Backdrop: Fade-in / Fade-out mượt mà
 * - Panel: Fade kết hợp dịch chuyển dọc nhẹ 8px và scale siêu nhẹ 0.98 -> 1
 */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .modal-panel {
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-fade-leave-active .modal-panel {
  transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s ease-in;
}

.modal-fade-enter-from .modal-panel {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}
.modal-fade-leave-to .modal-panel {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}

/* Underline animation giống trang login/quên mật khẩu */
.link-underline {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.link-underline::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -2px;
  height: 1px;
  background: currentColor;
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 0.25s ease-out;
}
.group:hover .link-underline::after,
.link-underline:hover::after {
  transform: scaleX(1);
}

@media (prefers-reduced-motion: reduce) {
  .modal-fade-enter-active,
  .modal-fade-leave-active,
  .modal-fade-enter-active .modal-panel,
  .modal-fade-leave-active .modal-panel {
    transition: none !important;
  }
  .modal-fade-enter-from .modal-panel,
  .modal-fade-leave-to .modal-panel {
    transform: none !important;
  }
  .link-underline::after {
    transition: none !important;
  }
}
</style>
