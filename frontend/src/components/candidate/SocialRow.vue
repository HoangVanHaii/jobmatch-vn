<script setup lang="ts">
/**
 * SocialRow — render 1 row cho social link (LinkedIn / GitHub / Portfolio)
 * trong view mode của ProfileView.
 *
 * Tại sao tách thành component riêng:
 *   - 3 row (LinkedIn / GitHub / Portfolio) share cùng markup → DRY.
 *   - File ProfileView.vue đã lớn (~700 dòng) — tách giúp dễ đọc.
 *
 * Props:
 *   - icon: 'linkedin' | 'github' | 'portfolio' → chọn brand icon + wrap color.
 *   - label: text hiển thị (vd 'LinkedIn').
 *   - value: URL thật (string). Khi undefined → render CTA "+ Thêm ...".
 *   - emptyCta: text cho nút CTA khi value rỗng (vd 'Thêm LinkedIn').
 *
 * Emits:
 *   - add: parent xử lý → chuyển sang edit mode + focus field tương ứng.
 *
 * Khi có value:
 *   - Hiển thị link rút gọn (bỏ protocol + trailing slash) + ExternalLink icon.
 *   - Click mở tab mới (target="_blank" + rel="noopener noreferrer").
 */
import {
  Linkedin,
  Github,
  Globe,
  Plus,
  ChevronRight,
  ExternalLink,
} from 'lucide-vue-next';

interface Props {
  icon: 'linkedin' | 'github' | 'portfolio';
  label: string;
  value?: string | undefined;
  emptyCta: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{ add: [] }>();

/** Map brand → lucide icon component. */
const BRAND_ICON: Record<Props['icon'], typeof Linkedin> = {
  linkedin: Linkedin,
  github: Github,
  portfolio: Globe,
};

/** Màu wrap theo brand — tone nhẹ để không cạnh tranh với primary JobMatch. */
const BRAND_WRAP: Record<Props['icon'], string> = {
  linkedin: 'bg-sky-50 ring-sky-100 text-sky-700',
  github: 'bg-slate-100 ring-slate-200 text-slate-900',
  portfolio: 'bg-emerald-50 ring-emerald-100 text-emerald-700',
};

/** Rút gọn URL để hiển thị gọn (bỏ protocol, bỏ trailing slash). */
const shortUrl = (url: string): string =>
  url.replace(/^https?:\/\//, '').replace(/\/$/, '');
</script>

<template>
  <div
    :class="[
      'group flex items-center gap-3.5 rounded-xl border border-slate-200/70 bg-white p-3.5 transition-all',
      value
        ? 'hover:border-primary-300 hover:shadow-sm'
        : 'hover:border-primary-200',
    ]"
  >
    <!-- Brand icon container -->
    <span
      :class="[
        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1',
        BRAND_WRAP[icon],
      ]"
    >
      <component :is="BRAND_ICON[icon]" class="h-5 w-5" />
    </span>

    <!-- Label + value/CTA -->
    <div class="flex-1 min-w-0">
      <p class="text-sm font-semibold text-slate-900">{{ label }}</p>

      <a
        v-if="value"
        :href="value"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-0.5 inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 hover:underline max-w-full"
      >
        <span class="truncate">{{ shortUrl(value) }}</span>
        <ExternalLink class="h-3 w-3 shrink-0" />
      </a>

      <button
        v-else
        type="button"
        class="mt-0.5 inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700 transition"
        @click="emit('add')"
      >
        <Plus class="h-3.5 w-3.5" />
        {{ emptyCta }}
      </button>
    </div>

    <!-- Trailing chevron — subtle hint of interactivity -->
    <ChevronRight
      class="h-4 w-4 text-slate-400 transition group-hover:text-primary-600 group-hover:translate-x-0.5 shrink-0"
    />
  </div>
</template>
