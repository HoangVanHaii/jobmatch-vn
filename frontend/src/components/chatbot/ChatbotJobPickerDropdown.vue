<script setup lang="ts">
/**
 * ChatbotJobPickerDropdown
 *
 * Dropdown chọn job để gắn vào context.
 *
 * Flow:
 *  - Mở dropdown → load list → items.value lưu full PickerJobItem
 *  - Click item → toggle trong local `pendingIds` (KHÔNG commit ngay)
 *  - Footer "Đính kèm xong (N)" → emit `commit` với array full items → parent PATCH 1 lần + đóng dropdown
 *
 * Emit full items (không chỉ IDs) để parent có metadata render chip mà không cần lookup lại.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { Loader2, MapPin, Briefcase, CheckCircle2, Search, Check, X } from 'lucide-vue-next';
import { useDebounceFn } from '@vueuse/core';
import { chatbotApi } from '@services/chatbot.api';
import type { PickerJobItem, PickerJobSource } from '@/types/chatbot';

const props = defineProps<{
  /** IDs đã gắn vào context (server-side state). */
  selectedIds: string[];
  /**
   * Full metadata của items đã gắn ở context. Dropdown dùng làm fallback khi
   * `items.value` (list load theo tab hiện tại) không chứa id đó — tránh
   * "đè mất" attached items khi user mở picker ở tab khác.
   * VD: attached ở tab "all" rồi mở lại tab "saved" → jobA không có trong
   * items.value nhưng vẫn cần resolve được từ selectedItems.
   */
  selectedItems: PickerJobItem[];
  /** Tổng context hiện tại (job + cv). Để validate cap 3 khi confirm. */
  totalContext: number;
  locked: boolean;
  lockedTooltip?: string;
}>();

const emit = defineEmits<{
  (e: 'commit', items: PickerJobItem[]): void;
}>();

const source = ref<PickerJobSource>('all');
const search = ref('');
const items = ref<PickerJobItem[]>([]);
const loading = ref(false);

/** Local pending selection — chưa commit. Diff với selectedIds sẽ là patch cuối. */
const pendingIds = ref<string[]>([...props.selectedIds]);

// Nếu parent selectedIds đổi (do PATCH khác), đồng bộ pending (không làm mất chọn của user nếu không liên quan).
watch(
  () => props.selectedIds,
  (next) => {
    pendingIds.value = [...next];
  },
);

const load = async (): Promise<void> => {
  loading.value = true;
  try {
    items.value = await chatbotApi.listJobsPicker(source.value, search.value || undefined, 30);
  } finally {
    loading.value = false;
  }
};

const debouncedSearch = useDebounceFn(() => {
  void load();
}, 300);

onMounted(load);
watch(source, load);
watch(search, () => debouncedSearch());

const isPending = (id: string): boolean => pendingIds.value.includes(id);

const pendingNewCount = computed(
  () => pendingIds.value.filter((id) => !props.selectedIds.includes(id)).length,
);

/** Còn bao nhiêu slot trống (tính cả những cái đang remove). */
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

const itemTitle = (j: PickerJobItem): string => {
  if (props.locked) return props.lockedTooltip ?? '';
  if (!isPending(j.id) && remainingSlots.value <= 0) {
    return `Bạn đã đạt giới hạn 3 job/CV cùng lúc. Bỏ chọn 1 cái trước.`;
  }
  return '';
};

const formatSalary = (j: PickerJobItem): string => {
  if (!j.salaryVisible) return 'Thoả thuận';
  if (!j.salaryMin && !j.salaryMax) return 'Thoả thuận';
  const cur = j.salaryCurrency ?? 'VND';
  return `${j.salaryMin ?? '?'}–${j.salaryMax ?? '?'} ${cur}`;
};

/**
 * Lấy ra các full items theo `pendingIds` thứ tự, giữ nguyên thứ tự pending
 * để hiển thị chip theo đúng thứ tự user đã chọn.
 *
 * Lookup 2 tầng:
 *   1. `items.value` (list load theo tab hiện tại) — ưu tiên vì có data tươi
 *   2. `props.selectedItems` (items đã attach từ session trước) — fallback khi
 *      pendingIds chứa id không có trong tab hiện tại (user attached ở tab khác)
 *      Không fallback → các items đó bị skip → emit thiếu → `attachJobs` REPLACE
 *      thành list rỗng hoặc thiếu → "đè mất" attached items.
 */
const buildPendingItems = (): PickerJobItem[] => {
  const byId = new Map<string, PickerJobItem>();
  for (const j of items.value) byId.set(j.id, j);
  for (const j of props.selectedItems) byId.set(j.id, j); // fallback
  const result: PickerJobItem[] = [];
  for (const id of pendingIds.value) {
    const it = byId.get(id);
    if (it) result.push(it);
  }
  return result;
};

/**
 * Items đã attach ở context nhưng KHÔNG có trong tab hiện tại của picker — dùng
 * để render pill "Đã gắn" phía trên list. Giúp user biết job cũ vẫn còn, không
 * phải do họ vô tình bỏ check.
 */
const attachedOutsideView = computed(() => {
  const inView = new Set(items.value.map((j) => j.id));
  return props.selectedItems.filter((j) => !inView.has(j.id));
});

const onConfirm = (): void => {
  if (props.locked) return;
  emit('commit', buildPendingItems());
};

/**
 * Remove 1 attached item khỏi pending (chỉ dùng từ pill "Đã gắn" cho items
 * không có trong tab hiện tại). Bỏ id khỏi pendingIds → khi confirm, id đó
 * không còn trong emit → store replace sẽ xóa item.
 */
const onRemoveAttached = (id: string): void => {
  if (props.locked) return;
  pendingIds.value = pendingIds.value.filter((x) => x !== id);
};
</script>

<template>
  <div class="flex w-[28rem] max-w-[calc(100vw-2rem)] flex-col gap-2">
    <!-- Tabs -->
    <div class="flex items-center gap-1 rounded-md bg-gray-100 p-0.5 text-xs">
      <button
        v-for="src in (['all', 'saved', 'applied'] as PickerJobSource[])"
        :key="src"
        type="button"
        class="flex-1 rounded px-2 py-1 font-medium capitalize transition"
        :class="
          source === src
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-600 hover:text-gray-900'
        "
        @click="source = src"
      >
        {{ src === 'all' ? 'Tất cả' : src === 'saved' ? 'Đã lưu' : 'Đã ứng tuyển' }}
      </button>
    </div>

    <!-- Search (chỉ tab 'all') -->
    <div v-if="source === 'all'" class="relative">
      <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
      <input
        v-model="search"
        type="search"
        placeholder="Tìm job theo tiêu đề..."
        class="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900/10"
      />
    </div>

    <!--
      Items đã attach nhưng không có trong tab hiện tại — pill giúp user biết
      những job này VẪN được giữ (sẽ không bị mất khi confirm). Click pill để
      remove (đồng thời bỏ khỏi pendingIds → confirm sẽ replace).
    -->
    <div
      v-if="attachedOutsideView.length > 0"
      class="flex flex-wrap items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[11px] text-gray-600"
    >
      <span class="shrink-0 font-medium">Đã gắn:</span>
      <span
        v-for="j in attachedOutsideView"
        :key="j.id"
        class="inline-flex max-w-[180px] items-center gap-1 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-medium text-blue-800"
      >
        <Briefcase class="h-3 w-3 shrink-0 text-blue-500" />
        <span class="truncate">{{ j.title }}</span>
        <button
          type="button"
          class="shrink-0 text-blue-500 hover:text-blue-900"
          :disabled="props.locked"
          :title="props.locked ? props.lockedTooltip : 'Bỏ gắn job này'"
          aria-label="Bỏ gắn job này"
          @click="onRemoveAttached(j.id)"
        >
          <X class="h-3 w-3" />
        </button>
      </span>
      <span class="ml-auto text-[10px] text-gray-400">(không hiện trong tab này)</span>
    </div>

    <!-- List -->
    <div class="max-h-72 overflow-y-auto rounded-md border border-gray-200 bg-white">
      <div v-if="loading" class="flex items-center justify-center py-6 text-sm text-gray-500">
        <Loader2 class="mr-2 h-4 w-4 animate-spin" />
        Đang tải...
      </div>

      <div v-else-if="!items.length" class="py-6 text-center text-sm text-gray-500">
        Không có job nào.
      </div>

      <ul v-else class="divide-y divide-gray-100">
        <li v-for="j in items" :key="j.id">
          <button
            type="button"
            class="flex w-full items-start gap-3 px-3 py-2 text-left text-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="itemDisabled(j.id)"
            :title="itemTitle(j)"
            @click="onItemClick(j.id)"
          >
            <CheckCircle2
              v-if="isPending(j.id)"
              class="mt-0.5 h-4 w-4 shrink-0 text-gray-900"
            />
            <div v-else class="mt-0.5 h-4 w-4 shrink-0" />

            <div class="min-w-0 flex-1">
              <div class="truncate font-medium text-gray-900">{{ j.title }}</div>
              <div class="truncate text-xs text-gray-600">{{ j.companyName ?? '—' }}</div>
              <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                <span class="inline-flex items-center gap-1">
                  <MapPin class="h-3 w-3" />
                  {{ j.location?.city ?? '—' }}
                </span>
                <span class="inline-flex items-center gap-1">
                  <Briefcase class="h-3 w-3" />
                  {{ j.jobType || j.jobLevel || '—' }}
                </span>
                <span>{{ formatSalary(j) }}</span>
                <span
                  v-if="j.status === 'closed'"
                  class="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-700"
                >
                  closed
                </span>
              </div>
            </div>
          </button>
        </li>
      </ul>
    </div>

    <!-- Footer: confirm button -->
    <div class="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <div class="text-xs text-gray-600">
        Đã chọn:
        <span class="font-semibold text-gray-900">{{ pendingIds.length }}/3</span>
        <span v-if="pendingNewCount > 0" class="ml-2 text-gray-700">
          (+{{ pendingNewCount }} mới)
        </span>
      </div>
      <button
        type="button"
        :disabled="props.locked || pendingIds.length === 0"
        class="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
        @click="onConfirm"
      >
        <Check class="h-3.5 w-3.5" />
        Đính kèm xong
      </button>
    </div>
  </div>
</template>