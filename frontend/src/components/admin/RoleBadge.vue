<script setup lang="ts">
/**
 * RoleBadge — small pill cho user role.
 *
 * Tone (semantic, không dùng accent để tránh nhầm với status active):
 *   - candidate: indigo accent (cho khớp tone "ứng viên" với hệ thống)
 *   - employer:  violet nhạt (phân biệt candidate)
 *   - admin:     slate đậm (admin là role đặc biệt, tone trung tính)
 */
import { computed } from 'vue';
import { roleLabel, type UserRole } from '@/utils/format';

const props = defineProps<{ role: UserRole }>();

const cls = computed(() => {
  switch (props.role) {
    case 'candidate':
      return 'bg-indigo-50 text-indigo-700 ring-indigo-200/70';
    case 'employer':
      return 'bg-violet-50 text-violet-700 ring-violet-200/70';
    case 'admin':
      return 'bg-slate-900 text-white ring-slate-900';
  }
});
</script>

<template>
  <span
    class="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset"
    :class="cls"
  >
    {{ roleLabel(props.role) }}
  </span>
</template>
