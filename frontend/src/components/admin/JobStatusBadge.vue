<script setup lang="ts">
/**
 * JobStatusBadge — Badge cho job status.
 * Bảng màu semantic theo workflow job:
 *   draft       → xám (bản nháp, chưa submit)
 *   pending     → amber (chờ AI scan)
 *   ai_scanning → indigo (AI đang quét)
 *   ai_flagged  → red (AI phát hiện vấn đề)
 *   live        → emerald (đang hiển thị)
 *   expired     → slate (hết hạn)
 *   closed      → gray (đã đóng)
 */
import { computed } from 'vue';
import type { JobStatus } from '@/types/job';

const props = defineProps<{ status: JobStatus | string }>();

const label = computed(() => {
  switch (props.status) {
    case 'draft':       return 'Bản nháp';
    case 'pending':     return 'Chờ duyệt';
    case 'ai_scanning': return 'AI đang quét';
    case 'ai_flagged':  return 'AI cảnh báo';
    case 'live':        return 'Đang tuyển';
    case 'expired':     return 'Hết hạn';
    case 'closed':      return 'Đã đóng';
    default:            return String(props.status);
  }
});

const tone = computed(() => {
  switch (props.status) {
    case 'draft':       return 'slate';
    case 'pending':     return 'amber';
    case 'ai_scanning': return 'indigo';
    case 'ai_flagged':  return 'red';
    case 'live':        return 'emerald';
    case 'expired':     return 'slate-dark';
    case 'closed':      return 'gray';
    default:            return 'slate';
  }
});

const dotCls: Record<string, string> = {
  slate: 'bg-slate-400',
  'slate-dark': 'bg-slate-600',
  amber: 'bg-amber-500',
  indigo: 'bg-indigo-500',
  red: 'bg-red-500',
  emerald: 'bg-emerald-500',
  gray: 'bg-gray-400',
};

const badgeCls: Record<string, string> = {
  slate: 'bg-slate-50 text-slate-600 ring-slate-200/70',
  'slate-dark': 'bg-slate-100 text-slate-700 ring-slate-300/70',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200/70',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200/70',
  red: 'bg-red-50 text-red-700 ring-red-200/70',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200/70',
  gray: 'bg-gray-100 text-gray-600 ring-gray-200/70',
};
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap"
    :class="badgeCls[tone]"
  >
    <span
      class="h-1.5 w-1.5 rounded-full"
      :class="dotCls[tone]"
    />
    {{ label }}
  </span>
</template>
