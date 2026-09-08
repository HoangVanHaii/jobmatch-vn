<script setup lang="ts">
/**
 * UserStatusBadge — small pill cho user status, semantic colors.
 *
 * Bảng màu theo NGỮ NGHĨA (cố định, không tự chọn):
 *   - active    → xanh lá   (trạng thái tích cực, nổi bật)
 *   - pending   → xám       (chờ, trung tính)
 *   - suspended → vàng cam  (cảnh báo, tạm dừng)
 *   - banned    → đỏ        (nguy hiểm, cấm)
 *
 * Mỗi badge: pill bo tròn + dot nhỏ cùng tông + label.
 */
import { computed } from 'vue';
import { userStatusLabel, type UserStatus } from '@/utils/format';

const props = defineProps<{ status: UserStatus | string }>();

const tone = computed(() => {
  switch (props.status) {
    case 'active':    return 'success';
    case 'suspended': return 'warning';
    case 'pending':   return 'neutral';
    case 'banned':    return 'danger';
    default:          return 'neutral';
  }
});

const cls = computed(() => {
  switch (tone.value) {
    case 'success': return 'bg-emerald-50 text-emerald-700 ring-emerald-200/70';
    case 'warning': return 'bg-amber-50 text-amber-700 ring-amber-200/70';
    case 'danger':  return 'bg-red-50 text-red-700 ring-red-200/70';
    case 'neutral':
    default:        return 'bg-slate-50 text-slate-600 ring-slate-200/70';
  }
});

const dotCls = computed(() => {
  switch (tone.value) {
    case 'success': return 'bg-emerald-500';
    case 'warning': return 'bg-amber-500';
    case 'danger':  return 'bg-red-500';
    case 'neutral':
    default:        return 'bg-slate-400';
  }
});
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset"
    :class="cls"
  >
    <span
      class="h-1.5 w-1.5 rounded-full"
      :class="dotCls"
    />
    {{ userStatusLabel(props.status) }}
  </span>
</template>
