<script setup lang="ts">
/**
 * JobCard — card job cho trang listing (dùng grid `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3`).
 *
 * Layout (top → bottom):
 *   ┌──────────────────────────────────────┐
 *   │ [Logo/Initial]  Company · City    ⭐ │ ← header strip
 *   ├──────────────────────────────────────┤
 *   │ Job Title (2-line clamp)             │ ← main
 *   │ [level chip] [type chip] [salary]    │
 *   │ [remote chip]                        │
 *   ├──────────────────────────────────────┤
 *   │ 👁 1.2k   📄 25   · 2 ngày trước  │ ← footer meta
 *   └──────────────────────────────────────┘
 *
 * Hover:
 *   - Lift nhẹ (`hover:-translate-y-0.5`) + shadow bump
 *   - Save icon (Bookmark) xuất hiện ở góc phải title (opacity-0 → 100)
 *
 * Click → navigate `/candidate/viec-lam/<id>` (route mới trong candidate layout).
 * Save button: emit event `save` lên parent, parent toggle local state (chưa gọi API).
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  Bookmark,
  BookmarkCheck,
  Briefcase,
  Building2,
  Eye,
  FileText,
  Loader2,
  MapPin,
  Wallet,
} from 'lucide-vue-next';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { JobListItem } from '@/types/job';

dayjs.extend(relativeTime);
dayjs.locale('vi');

const props = defineProps<{
  job: JobListItem;
  /** Job đã được lưu chưa — bind từ savedJobStore.savedIds. */
  saved?: boolean;
  /** Đang trong quá trình gọi API save/unsave — disable nút + show spinner. */
  pending?: boolean;
}>();

const emit = defineEmits<{
  (e: 'save', jobId: string): void;
}>();

const router = useRouter();

/**
 * Format salary theo locale vi_VN:
 *  - Cả min + max → "X-Y triệu"
 *  - Chỉ 1 trong 2  → "Từ X triệu" / "Đến Y triệu"
 *  - Cả 2 null + salaryVisible=false → "Thoả thuận"
 *  - salaryVisible=false → "Thoả thuận" (ưu tiên privacy)
 *
 * Salary đã là VND (NUMERIC ở DB) → chia 1_000_000 để ra "triệu". Nếu sau này
 * có multi-currency → đổi sang convert qua salaryCurrency.
 */
const salaryLabel = computed((): string => {
  if (!props.job.salaryVisible) return 'Thoả thuận';
  const { salaryMin, salaryMax } = props.job;
  if (!salaryMin && !salaryMax) return 'Thoả thuận';
  const toMillions = (s: string): string =>
    `${(Number(s) / 1_000_000).toFixed(0)} triệu`;
  if (salaryMin && salaryMax) return `${toMillions(salaryMin)} – ${toMillions(salaryMax)}`;
  if (salaryMin) return `Từ ${toMillions(salaryMin)}`;
  return `Đến ${toMillions(salaryMax!)}`;
});

/** JobLevel label tiếng Việt (enum tiếng Anh → label UI). */
const jobLevelLabel = computed((): string => {
  const m: Record<string, string> = {
    intern: 'Intern',
    fresher: 'Fresher',
    junior: 'Junior',
    mid: 'Mid-level',
    senior: 'Senior',
    lead: 'Lead',
    manager: 'Manager',
  };
  return props.job.jobLevel ? m[props.job.jobLevel] ?? props.job.jobLevel : '';
});

/** JobType label tiếng Việt. */
const jobTypeLabel = computed((): string => {
  const m: Record<string, string> = {
    'full-time': 'Toàn thời gian',
    'part-time': 'Bán thời gian',
    contract: 'Hợp đồng',
    internship: 'Thực tập',
    freelance: 'Freelance',
  };
  return props.job.jobType ? m[props.job.jobType] ?? props.job.jobType : '';
});

/** Initials để làm fallback khi không có logo. */
const companyInitial = computed((): string => {
  const name = props.job.companyName;
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  // Lấy chữ cái đầu của từ đầu tiên (Vietnamese-friendly: giữ nguyên dấu).
  return trimmed.charAt(0).toUpperCase();
});

/** Format compact: 1234 → "1.2k", 999 → "999", 1500000 → "1.5M". */
const compactNumber = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
};

/** Relative time cho publishedAt — "2 ngày trước", "1 tháng trước", ... */
const publishedLabel = computed((): string => {
  if (!props.job.publishedAt) return '';
  return dayjs(props.job.publishedAt).fromNow();
});

const onCardClick = (): void => {
  router.push(`/candidate/viec-lam/${props.job.id}`);
};

const onSaveClick = (e: MouseEvent): void => {
  e.stopPropagation();
  emit('save', props.job.id);
};
</script>

<template>
  <div
    class="group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md"
    @click="onCardClick"
  >
    <!--
      Header strip: logo + company info + (featured | save).
      - Logo: img nếu có companyLogoUrl, fallback chữ cái đầu trong circle gradient.
      - Save: Bookmark icon, opacity 0 → 100 khi hover card HOẶC đã saved.
      - Featured: ⭐ vàng, always visible nếu job.featured.
    -->
    <div class="flex items-start gap-3">
      <div
        class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-primary-50 to-primary-100 text-sm font-semibold text-primary-700"
      >
        <img
          v-if="job.companyLogoUrl"
          :src="job.companyLogoUrl"
          :alt="job.companyName ?? ''"
          class="h-full w-full object-cover"
        />
        <span v-else>{{ companyInitial }}</span>
      </div>
      <div class="min-w-0 flex-1">
        <p class="flex items-center gap-1.5 text-sm font-medium text-gray-900">
          <Building2 v-if="!job.companyLogoUrl" class="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <span class="truncate">{{ job.companyName ?? 'Công ty ẩn danh' }}</span>
        </p>
        <p v-if="job.location?.city" class="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
          <MapPin class="h-3 w-3 shrink-0" />
          <span class="truncate">{{ job.location.city }}</span>
        </p>
      </div>

      <!-- Action cluster: save only (featured chỉ có ở detail, không có ở list) -->
      <div class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 opacity-0 transition hover:bg-primary-50 hover:text-primary-600 group-hover:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed"
          :class="{ 'opacity-100 text-primary-600': props.saved }"
          :title="props.saved ? 'Bỏ lưu' : 'Lưu job'"
          :aria-label="props.saved ? 'Bỏ lưu job' : 'Lưu job'"
          :disabled="props.pending"
          @click="onSaveClick"
        >
          <Loader2 v-if="props.pending" class="h-4 w-4 animate-spin" />
          <BookmarkCheck v-else-if="props.saved" class="h-4 w-4" />
          <Bookmark v-else class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!--
      Main: title + chips.
      - Title clamp 2 dòng để card đều nhau khi grid.
    -->
    <h3 class="mt-3 line-clamp-2 text-[15px] font-semibold leading-snug text-gray-900 group-hover:text-primary-700">
      {{ job.title }}
    </h3>

    <div class="mt-3 flex flex-wrap gap-1.5">
      <span
        v-if="job.jobLevel"
        class="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700"
      >
        <Briefcase class="h-3 w-3" />
        {{ jobLevelLabel }}
      </span>
      <span
        v-if="job.jobType"
        class="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700"
      >
        {{ jobTypeLabel }}
      </span>
      <span
        class="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700"
      >
        <Wallet class="h-3 w-3" />
        {{ salaryLabel }}
      </span>
      <span
        v-if="job.remoteOk"
        class="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700"
      >
        Remote OK
      </span>
    </div>

    <!--
      Footer: views + applies + published time.
      - mt-auto đẩy xuống đáy card để các card trong 1 row có chiều cao đều.
    -->
    <div class="mt-auto flex items-center gap-3 border-t border-gray-100 pt-3 text-[11px] text-gray-500">
      <span
        class="inline-flex items-center gap-1 cursor-help"
        :title="`Lượt xem: ${job.viewsCount.toLocaleString('vi-VN')}`"
      >
        <Eye class="h-3 w-3" />
        {{ compactNumber(job.viewsCount) }}
      </span>
      <span
        class="inline-flex items-center gap-1 cursor-help"
        :title="`Số hồ sơ ứng tuyển: ${job.appliesCount.toLocaleString('vi-VN')}`"
      >
        <FileText class="h-3 w-3" />
        {{ compactNumber(job.appliesCount) }}
      </span>
      <span
        v-if="publishedLabel"
        class="ml-auto cursor-help"
        :title="job.publishedAt ? `Đăng ngày ${dayjs(job.publishedAt).format('DD/MM/YYYY HH:mm')}` : ''"
      >
        {{ publishedLabel }}
      </span>
    </div>
  </div>
</template>

<style scoped>
/*
 * line-clamp utility (Tailwind plugin `@tailwindcss/line-clamp` đã được load qua
 * tailwind.config.js plugins? — chưa load. Define manual để không phụ thuộc
 * plugin. 2 dòng + ellipsis.
 */
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>