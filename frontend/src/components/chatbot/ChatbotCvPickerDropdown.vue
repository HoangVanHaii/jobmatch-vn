<script setup lang="ts">
/**
 * ChatbotCvPickerDropdown
 *
 * Dropdown chọn CV. Tương tự JobPickerDropdown: local pending → confirm → emit 1 lần.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { Loader2, FileText, CheckCircle2, Check } from 'lucide-vue-next';
import { chatbotApi } from '@services/chatbot.api';
import type { PickerCvItem } from '@/types/chatbot';

const props = defineProps<{
  selectedIds: string[];
  totalContext: number;
  locked: boolean;
  lockedTooltip?: string;
}>();

const emit = defineEmits<{
  (e: 'commit', items: PickerCvItem[]): void;
}>();

const items = ref<PickerCvItem[]>([]);
const loading = ref(false);
const pendingIds = ref<string[]>([...props.selectedIds]);

watch(
  () => props.selectedIds,
  (next) => {
    pendingIds.value = [...next];
  },
);

const load = async (): Promise<void> => {
  loading.value = true;
  try {
    items.value = await chatbotApi.listCvsPicker();
  } finally {
    loading.value = false;
  }
};

onMounted(load);

const isPending = (id: string): boolean => pendingIds.value.includes(id);

const pendingNewCount = computed(
  () => pendingIds.value.filter((id) => !props.selectedIds.includes(id)).length,
);

const remainingSlots = computed(() => {
  const willAdd = pendingIds.value.filter((id) => !props.selectedIds.includes(id)).length;
  const willRemove = props.selectedIds.filter((id) => !pendingIds.value.includes(id)).length;
  return Math.max(0, 3 - props.totalContext - willAdd + willRemove);
});

const onItemClick = (id: string): void => {
  if (props.locked) return;
  if (pendingIds.value.includes(id)) {
    pendingIds.value = pendingIds.value.filter((x) => x !== id);
    return;
  }
  if (remainingSlots.value <= 0) return;
  pendingIds.value = [...pendingIds.value, id];
};

const itemDisabled = (id: string): boolean => {
  if (props.locked) return true;
  if (isPending(id)) return false;
  return remainingSlots.value <= 0;
};

const itemTitle = (c: PickerCvItem): string => {
  if (props.locked) return props.lockedTooltip ?? '';
  if (!isPending(c.id) && remainingSlots.value <= 0) {
    return `Bạn đã đạt giới hạn 3 job/CV cùng lúc. Bỏ chọn 1 cái trước.`;
  }
  return '';
};

const buildPendingItems = (): PickerCvItem[] => {
  const byId = new Map(items.value.map((c) => [c.id, c]));
  const result: PickerCvItem[] = [];
  for (const id of pendingIds.value) {
    const it = byId.get(id);
    if (it) result.push(it);
  }
  return result;
};

const onConfirm = (): void => {
  if (props.locked) return;
  emit('commit', buildPendingItems());
};
</script>

<template>
  <div class="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
    <div class="max-h-72 overflow-y-auto rounded-md border border-gray-200 bg-white">
      <div v-if="loading" class="flex items-center justify-center py-6 text-sm text-gray-500">
        <Loader2 class="mr-2 h-4 w-4 animate-spin" />
        Đang tải...
      </div>

      <div v-else-if="!items.length" class="py-6 text-center text-sm text-gray-500">
        Bạn chưa có CV nào.
      </div>

      <ul v-else class="divide-y divide-gray-100">
        <li v-for="c in items" :key="c.id">
          <button
            type="button"
            class="flex w-full items-start gap-3 px-3 py-2 text-left text-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="itemDisabled(c.id)"
            :title="itemTitle(c)"
            @click="onItemClick(c.id)"
          >
            <CheckCircle2
              v-if="isPending(c.id)"
              class="mt-0.5 h-4 w-4 shrink-0 text-purple-600"
            />
            <FileText v-else class="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />

            <div class="min-w-0 flex-1">
              <div class="truncate font-medium text-gray-900">
                {{ c.title || 'CV chính' }}
                <span
                  v-if="c.isPrimary"
                  class="ml-1 rounded bg-purple-200 px-1 text-[10px] font-medium text-purple-800"
                >
                  Primary
                </span>
              </div>
              <div class="mt-0.5 truncate text-xs text-gray-500">
                {{ c.source }} · {{ c.status }}
              </div>
            </div>
          </button>
        </li>
      </ul>
    </div>

    <div class="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <div class="text-xs text-gray-600">
        Đã chọn:
        <span class="font-semibold text-gray-900">{{ pendingIds.length }}/3</span>
        <span v-if="pendingNewCount > 0" class="ml-2 text-purple-600">
          (+{{ pendingNewCount }} mới)
        </span>
      </div>
      <button
        type="button"
        :disabled="props.locked || pendingIds.length === 0"
        class="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        @click="onConfirm"
      >
        <Check class="h-3.5 w-3.5" />
        Đính kèm xong
      </button>
    </div>
  </div>
</template>