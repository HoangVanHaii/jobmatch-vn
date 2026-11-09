<script setup lang="ts">
/**
 * EmployerJobCard — card tin tuyển dụng phía nhà tuyển dụng (trang Tin đã đăng).
 *
 * Phiên bản tinh chỉnh:
 * - Gọn gàng, phẳng, tỉ lệ chuẩn phong cách SaaS tuyển dụng hiện đại.
 * - Chiều cao tổng thể giảm 15–20%, padding 16px (p-4), bo góc rounded-2xl.
 * - Header: Pill trạng thái nhỏ gọn (h-[22px]) và thời gian đăng nằm cùng hàng.
 * - Title: Font text-base vừa vặn, line-clamp 2 dòng, khoảng cách cân đối.
 * - Metadata: Chỉ giữ lại Địa điểm và Nơi làm việc (ví dụ: MapPin TP. Hồ Chí Minh · Tại văn phòng).
 *   Đã xoá hoàn toàn Cấp bậc và Loại hình làm việc.
 * - Mức lương: Box icon Wallet 32x32 gọn gàng, số lương text-base nổi bật vừa đủ.
 * - Khối số liệu: 3 cột gọn px-3 py-2.5, giá trị text-base rõ ràng.
 * - Footer: Chiều cao nút h-[34px], bo góc rounded-lg, khoảng cách pt-3.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  Calendar,
  Clock,
  Eye,
  Loader2,
  MapPin,
  MoreHorizontal,
  Pencil,
  Users,
  Wallet,
} from 'lucide-vue-next';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import relativeTime from 'dayjs/plugin/relativeTime';
import { JOB_STATUS_LABELS } from '@/types/job';
import type { JobListItem, JobStatus } from '@/types/job';

dayjs.extend(relativeTime);
dayjs.locale('vi');

const props = defineProps<{
  job: JobListItem;
}>();

const emit = defineEmits<{
  /** Click nút "Xoá" → emit jobId cho parent xử lý confirm + gọi API. */
  (e: 'delete', jobId: string): void;
  /** Click nút "Sửa" → emit jobId cho parent mở EditJobModal. */
  (e: 'edit', jobId: string): void;
}>();

const router = useRouter();

/* ============================================================================
 * Trạng thái & cấu hình màu sắc (Hiện đại, gọn, phẳng, không viền)
 * ==========================================================================*/
interface StatusConfig {
  label: string;
  pillClass: string;
  dotClass: string;
}

const STATUS_CONFIG: Record<JobStatus, StatusConfig> = {
  live: {
    label: JOB_STATUS_LABELS.live,
    pillClass: 'bg-emerald-50 text-emerald-700',
    dotClass: 'bg-emerald-500',
  },
  pending: {
    label: JOB_STATUS_LABELS.pending,
    pillClass: 'bg-blue-50 text-blue-700',
    dotClass: 'bg-blue-500',
  },
  ai_scanning: {
    label: JOB_STATUS_LABELS.ai_scanning,
    pillClass: 'bg-violet-50 text-violet-700',
    dotClass: 'bg-violet-500',
  },
  ai_flagged: {
    label: JOB_STATUS_LABELS.ai_flagged,
    pillClass: 'bg-amber-50 text-amber-700',
    dotClass: 'bg-amber-500',
  },
  draft: {
    label: JOB_STATUS_LABELS.draft,
    pillClass: 'bg-gray-100 text-gray-600',
    dotClass: 'bg-gray-400',
  },
  expired: {
    label: JOB_STATUS_LABELS.expired,
    pillClass: 'bg-red-50 text-red-700',
    dotClass: 'bg-red-500',
  },
  closed: {
    label: JOB_STATUS_LABELS.closed,
    pillClass: 'bg-slate-100 text-slate-600',
    dotClass: 'bg-slate-400',
  },
};

const statusConfig = computed<StatusConfig>(
  () => STATUS_CONFIG[props.job.status] ?? STATUS_CONFIG.closed,
);

const isInactive = computed(
  () => props.job.status === 'expired' || props.job.status === 'closed',
);

/* ============================================================================
 * Dropdown thao tác (...)
 * ==========================================================================*/
const dropdownRef = ref<HTMLElement | null>(null);
const isMenuOpen = ref(false);

const toggleMenu = (): void => {
  isMenuOpen.value = !isMenuOpen.value;
};

const onDocClick = (e: MouseEvent): void => {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    isMenuOpen.value = false;
  }
};

onMounted(() => {
  document.addEventListener('click', onDocClick);
});

onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
});

const onCardClick = (): void => {
  router.push(`/employer/jobs/${props.job.slug || props.job.id}`);
};

const onViewDetail = (): void => {
  isMenuOpen.value = false;
  router.push(`/employer/jobs/${props.job.slug || props.job.id}`);
};

const onEditClick = (): void => {
  isMenuOpen.value = false;
  emit('edit', props.job.id);
};

const onDeleteClick = (): void => {
  isMenuOpen.value = false;
  emit('delete', props.job.id);
};

const onApplicants = (): void => {
  router.push({ path: '/employer/applications', query: { jobId: props.job.id } });
};

/* ============================================================================
 * Thời gian đăng
 * ==========================================================================*/
const publishedTimeText = computed((): string => {
  if (props.job.status === 'draft' || props.job.status === 'pending') {
    return 'Chưa đăng';
  }

  // Các trạng thái đã từng xuất bản (live, expired, closed, ai_flagged): hiển thị thời gian đã đăng
  const time = props.job.publishedAt || props.job.createdAt;
  if (time) {
    return `Đăng ${dayjs(time).fromNow()}`;
  }
  return 'Chưa đăng';
});

/* ============================================================================
 * Metadata labels (Chỉ giữ Địa điểm & Nơi làm việc)
 * ==========================================================================*/
const locationCityText = computed((): string => {
  const city = props.job.location?.city;
  if (!city) return '';
  return city;
});

const workTypeLabel = computed((): string => {
  const m: Record<string, string> = {
    onsite: 'Tại văn phòng',
    hybrid: 'Hybrid',
    remote: 'Từ xa',
  };
  return props.job.workType ? m[props.job.workType] ?? props.job.workType : '';
});

/* ============================================================================
 * Mức lương
 * ==========================================================================*/
const isNegotiableSalary = computed((): boolean => {
  if (!props.job.salaryVisible) return true;
  const { salaryMin, salaryMax } = props.job;
  return !salaryMin && !salaryMax;
});

const salaryText = computed((): string => {
  if (isNegotiableSalary.value) return 'Thoả thuận';
  const { salaryMin, salaryMax } = props.job;
  const toMillions = (s: string): string => {
    const val = Number(s) / 1_000_000;
    return Number.isInteger(val) ? `${val}` : `${val.toFixed(1).replace(/\.0$/, '')}`;
  };

  if (salaryMin && salaryMax) {
    return `${toMillions(salaryMin)} – ${toMillions(salaryMax)} triệu`;
  }
  if (salaryMin) return `Từ ${toMillions(salaryMin)} triệu`;
  return `Đến ${toMillions(salaryMax!)} triệu`;
});

/* ============================================================================
 * Khối số liệu (Ứng viên, Lượt xem, Còn lại)
 * ==========================================================================*/
const newAppliesCount = computed((): number => {
  const item = props.job as unknown as Record<string, unknown>;
  const val = item.newAppliesCount ?? item.unreadAppliesCount ?? item.newApplies;
  return typeof val === 'number' ? val : 0;
});

const remainingInfo = computed(() => {
  if (props.job.status !== 'live') {
    return { text: '—', percent: 0 };
  }

  const now = dayjs().startOf('day');
  if (props.job.deadline) {
    const deadlineDate = dayjs(props.job.deadline).startOf('day');
    const days = deadlineDate.diff(now, 'day');
    if (days < 0) {
      return { text: '0 ngày', percent: 100 };
    }

    let percent = 50;
    if (props.job.publishedAt) {
      const startDate = dayjs(props.job.publishedAt).startOf('day');
      const totalDays = deadlineDate.diff(startDate, 'day');
      const usedDays = now.diff(startDate, 'day');
      if (totalDays > 0) {
        percent = Math.min(100, Math.max(5, Math.round((usedDays / totalDays) * 100)));
      }
    }
    return { text: `${days} ngày`, percent };
  }

  if (props.job.publishedAt) {
    const startDate = dayjs(props.job.publishedAt).startOf('day');
    const usedDays = now.diff(startDate, 'day');
    const remaining = Math.max(0, 30 - usedDays);
    const percent = Math.min(100, Math.max(5, Math.round((usedDays / 30) * 100)));
    return { text: `${remaining} ngày`, percent };
  }

  return { text: '—', percent: 0 };
});

/* ============================================================================
 * Nút chính Footer
 * ==========================================================================*/
interface PrimaryButtonConfig {
  label: string;
  icon?: unknown;
  classes: string;
  badge?: number;
  badgeClass?: string;
  disabled?: boolean;
  onClick?: () => void;
}

const primaryButtonConfig = computed<PrimaryButtonConfig>(() => {
  switch (props.job.status) {
    case 'live':
      return {
        label: 'Xem ứng viên',
        icon: Users,
        classes: 'bg-primary-600 text-white hover:bg-primary-700',
        badge: props.job.appliesCount,
        badgeClass: 'bg-white/20 text-white',
        disabled: false,
        onClick: onApplicants,
      };

    case 'pending':
      if (props.job.appliesCount === 0) {
        return {
          label: 'Xem ứng viên',
          icon: Users,
          classes: 'bg-gray-100 text-gray-400 cursor-not-allowed',
          badge: 0,
          badgeClass: 'bg-gray-200 text-gray-600',
          disabled: true,
        };
      }
      return {
        label: 'Xem ứng viên',
        icon: Users,
        classes: 'bg-primary-600 text-white hover:bg-primary-700',
        badge: props.job.appliesCount,
        badgeClass: 'bg-white/20 text-white',
        disabled: false,
        onClick: onApplicants,
      };

    case 'draft':
      return {
        label: 'Đăng tin',
        classes: 'bg-primary-600 text-white hover:bg-primary-700',
        disabled: false,
        onClick: () => emit('edit', props.job.id),
      };

    case 'expired':
      return {
        label: 'Gia hạn',
        classes: 'bg-primary-600 text-white hover:bg-primary-700',
        disabled: false,
        onClick: () => emit('edit', props.job.id),
      };

    case 'closed':
      return {
        label: 'Mở lại',
        classes: 'border border-primary-600 text-primary-600 bg-white hover:bg-primary-50',
        disabled: false,
        onClick: () => emit('edit', props.job.id),
      };

    case 'ai_flagged':
      return {
        label: 'Xem lý do',
        classes: 'bg-amber-700 text-white hover:bg-amber-800',
        disabled: false,
        onClick: onViewDetail,
      };

    case 'ai_scanning':
      return {
        label: JOB_STATUS_LABELS.ai_scanning,
        icon: Loader2,
        classes: 'bg-violet-50 text-violet-600 border border-violet-200 cursor-not-allowed',
        disabled: true,
      };

    default:
      return {
        label: 'Xem ứng viên',
        icon: Users,
        classes: 'bg-primary-600 text-white hover:bg-primary-700',
        badge: props.job.appliesCount,
        badgeClass: 'bg-white/20 text-white',
        disabled: false,
        onClick: onApplicants,
      };
  }
});
</script>

<template>
  <article
    class="font-poppins group relative flex h-full flex-col rounded-2xl border border-gray-200/90 p-4 sm:p-5 xl:p-6 transition duration-150 hover:border-gray-300 hover:shadow-sm cursor-pointer select-none"
    :class="isInactive ? 'bg-gray-50/60' : 'bg-white'"
    @click="onCardClick"
  >
    <!-- =====================================================================
     * NHÓM 1: THÔNG TIN JOB (Header, Tiêu đề, Chip địa điểm, Mức lương)
     * =================================================================== -->
    <div class="flex flex-col">
      <!-- 1. Header (status badge bên trái, thời gian & action nút '...' bên phải) -->
      <div class="flex items-center justify-between gap-1.5 sm:gap-2">
        <!-- Status badge: h-6 (24px), rounded-md (6px), py-1 px-2, text-xs font-medium, không viền -->
        <span
          class="inline-flex h-6 shrink-0 whitespace-nowrap items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium leading-none"
          :class="statusConfig.pillClass"
        >
          <span
            class="h-1.5 w-1.5 shrink-0 rounded-full"
            :class="statusConfig.dotClass"
            aria-hidden="true"
          />
          {{ statusConfig.label }}
        </span>

        <!-- Thời gian + menu ...: Nhãn nhỏ 12px (text-xs) font-medium leading-normal -->
        <div class="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <span
            class="inline-flex shrink-0 whitespace-nowrap items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs font-medium text-gray-500 leading-normal"
            :title="job.status === 'pending' ? 'Đang chờ duyệt' : undefined"
          >
            <Clock class="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
            {{ publishedTimeText }}
          </span>

          <div ref="dropdownRef" class="relative shrink-0">
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 transition duration-150"
              aria-label="Tuỳ chọn"
              @click.stop="toggleMenu"
            >
              <MoreHorizontal class="h-4 w-4" aria-hidden="true" />
            </button>

            <!-- Dropdown menu -->
            <div
              v-if="isMenuOpen"
              class="absolute right-0 top-full mt-1.5 z-20 w-36 rounded-xl border border-gray-200 bg-white p-1 shadow-lg"
              @click.stop
            >
              <button
                type="button"
                class="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 transition"
                @click="onViewDetail"
              >
                Xem chi tiết
              </button>
              <button
                type="button"
                class="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 transition"
                @click="onEditClick"
              >
                Chỉnh sửa
              </button>
              <div class="my-1 h-px bg-gray-100" />
              <button
                type="button"
                class="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-red-600 hover:bg-red-50 transition"
                @click="onDeleteClick"
              >
                Xoá tin
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Tiêu đề (Header -> Tiêu đề: 16px mt-4, cỡ chữ 16px (text-base) font-semibold line-clamp-2) -->
      <h3
        class="mt-4 text-base font-semibold tracking-tight line-clamp-2 leading-snug transition duration-150 group-hover:text-primary-600"
        :class="job.status === 'closed' ? 'text-gray-500' : isInactive ? 'text-gray-600' : 'text-gray-900'"
      >
        {{ job.title }}
      </h3>

      <!-- 3. Metadata (Tiêu đề -> Chip: 12px mt-3; padding chip: 4px 10px px-2.5 py-1, rounded-md không viền) -->
      <div v-if="locationCityText || workTypeLabel" class="mt-3 flex items-center">
        <span class="inline-flex items-center gap-1.5 rounded-md bg-gray-100/80 px-2.5 py-1 text-xs font-medium text-gray-600 leading-normal">
          <MapPin class="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
          <span v-if="locationCityText">{{ locationCityText }}</span>
          <span v-if="locationCityText && workTypeLabel" class="text-gray-300">·</span>
          <span v-if="workTypeLabel">{{ workTypeLabel }}</span>
        </span>
      </div>

      <!-- 4. Mức lương (Chip địa điểm -> Mức lương: 16px mt-4) -->
      <div class="mt-4 flex items-center gap-3">
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
          :class="isNegotiableSalary ? 'bg-gray-100 text-gray-500' : 'bg-primary-50 text-primary-600'"
        >
          <Wallet class="h-4 w-4" aria-hidden="true" />
        </div>
        <div class="flex flex-col gap-0.5 leading-tight">
          <!-- Nhãn nhỏ: 11px, màu text-gray-500, leading-tight -->
          <p class="text-[11px] font-normal text-gray-500 leading-tight">Mức lương</p>
          <div v-if="!isNegotiableSalary" class="flex items-baseline gap-1 whitespace-nowrap">
            <span class="text-[13px] font-medium tracking-tight text-gray-800 leading-tight whitespace-nowrap">
              {{ salaryText }}
            </span>
            <span class="text-[11px] font-normal text-gray-400">/tháng</span>
          </div>
          <p v-else class="text-[13px] font-medium text-gray-800 tracking-tight leading-tight whitespace-nowrap">
            Thoả thuận
          </p>
        </div>
      </div>
    </div>

    <!-- =====================================================================
     * NHÓM 2: SỐ LIỆU (Căn giữa từng ô, chia đều 3 cột divide-x, thẳng hàng ngang)
     * =================================================================== -->
    <div class="mt-5 grid grid-cols-3 divide-x divide-gray-200/60 rounded-xl bg-gray-50/60 py-3.5 border border-gray-100/90">
      <!-- Cột 1: Ứng viên -->
      <div class="flex flex-col items-center text-center px-1.5 xl:px-3 min-w-0">
        <div class="flex items-center justify-center gap-1 xl:gap-1.5 text-[11px] xl:text-xs font-medium text-gray-600 leading-normal whitespace-nowrap">
          <Users class="h-3 w-3 xl:h-3.5 xl:w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
          <span class="whitespace-nowrap">Ứng viên</span>
        </div>
        <!-- Nhãn nhỏ -> số bên dưới: 6px mt-1.5, số 16px font-bold, căn giữa -->
        <div class="mt-1.5 flex items-baseline justify-center gap-1 flex-wrap">
          <span
            class="text-base font-bold tracking-tight leading-none"
            :class="job.status === 'closed' ? 'text-gray-500' : job.appliesCount === 0 ? 'text-gray-400' : 'text-gray-900'"
          >
            {{ job.appliesCount }}
          </span>
          <span
            v-if="newAppliesCount > 0"
            class="rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 leading-none whitespace-nowrap"
          >
            +{{ newAppliesCount }} mới
          </span>
        </div>
      </div>

      <!-- Cột 2: Lượt xem -->
      <div class="flex flex-col items-center text-center px-1.5 xl:px-3 min-w-0">
        <div class="flex items-center justify-center gap-1 xl:gap-1.5 text-[11px] xl:text-xs font-medium text-gray-600 leading-normal whitespace-nowrap">
          <Eye class="h-3 w-3 xl:h-3.5 xl:w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
          <span class="whitespace-nowrap">Lượt xem</span>
        </div>
        <!-- Nhãn nhỏ -> số bên dưới: 6px mt-1.5, số 16px font-bold, căn giữa -->
        <p
          class="mt-1.5 text-base font-bold tracking-tight leading-none"
          :class="job.status === 'closed' ? 'text-gray-500' : 'text-gray-900'"
        >
          {{ (job.viewsCount ?? 0).toLocaleString('vi-VN') }}
        </p>
      </div>

      <!-- Cột 3: Còn lại -->
      <div class="flex flex-col items-center text-center px-1.5 xl:px-3 min-w-0">
        <div class="flex items-center justify-center gap-1 xl:gap-1.5 text-[11px] xl:text-xs font-medium text-gray-600 leading-normal whitespace-nowrap">
          <Calendar class="h-3 w-3 xl:h-3.5 xl:w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
          <span class="whitespace-nowrap">Còn lại</span>
        </div>
        <!-- Nhãn nhỏ -> số bên dưới: 6px mt-1.5, giá trị 13px font-semibold, căn giữa -->
        <template v-if="job.status === 'live'">
          <p class="mt-1.5 text-[13px] font-semibold tracking-tight text-gray-900 leading-none whitespace-nowrap">
            {{ remainingInfo.text }}
          </p>
        </template>
        <template v-else-if="job.status === 'expired'">
          <p class="mt-1.5 text-[13px] font-semibold tracking-tight text-red-600 leading-none whitespace-nowrap">
            {{ JOB_STATUS_LABELS.expired }}
          </p>
        </template>
        <template v-else-if="job.status === 'closed'">
          <p class="mt-1.5 text-[13px] font-semibold tracking-tight text-gray-500 leading-none whitespace-nowrap">
            {{ JOB_STATUS_LABELS.closed }}
          </p>
        </template>
        <template v-else>
          <p class="mt-1.5 text-[13px] font-semibold tracking-tight text-gray-300 leading-none">
            —
          </p>
        </template>
      </div>
    </div>

    <!-- =====================================================================
     * NHÓM 3: HÀNH ĐỘNG (Khối số liệu -> Hàng nút: 20-24px pt-5 mt-auto; khoảng cách 2 nút: 12px gap-3; font 13px font-semibold)
     * =================================================================== -->
    <div class="mt-auto border-t border-gray-100 pt-5 flex items-center gap-2.5 sm:gap-3">
      <button
        type="button"
        class="h-9 shrink-0 px-3 sm:px-4 rounded-lg border border-gray-200 bg-white text-[13px] font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 transition inline-flex items-center justify-center gap-1.5"
        @click.stop="onEditClick"
      >
        <Pencil class="h-3.5 w-3.5 text-gray-500 shrink-0" aria-hidden="true" />
        <span>Sửa</span>
      </button>

      <button
        type="button"
        class="h-9 flex-1 min-w-0 px-2.5 sm:px-3 rounded-lg text-[13px] font-semibold transition inline-flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 whitespace-nowrap"
        :class="primaryButtonConfig.classes"
        :disabled="primaryButtonConfig.disabled"
        @click.stop="primaryButtonConfig.onClick?.()"
      >
        <component
          :is="primaryButtonConfig.icon"
          v-if="primaryButtonConfig.icon"
          class="h-3.5 w-3.5 shrink-0"
          :class="job.status === 'ai_scanning' ? 'animate-spin' : ''"
          aria-hidden="true"
        />
        <span class="whitespace-nowrap">{{ primaryButtonConfig.label }}</span>
        <span
          v-if="primaryButtonConfig.badge !== undefined"
          class="ml-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none shrink-0"
          :class="primaryButtonConfig.badgeClass"
        >
          {{ primaryButtonConfig.badge }}
        </span>
      </button>
    </div>
  </article>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
