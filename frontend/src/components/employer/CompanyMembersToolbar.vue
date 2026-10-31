<script setup lang="ts">
/**
 * CompanyMembersToolbar — hàng điều khiển danh sách: tab lọc trạng thái
 * (owner) + ô tìm kiếm email với nút X xóa từ khóa.
 *
 * Props/emit theo mô hình controlled: View sở hữu state search/filter;
 * component phát `update:search` / `update:filter` — KHÔNG tự fetch.
 * Focus sau khi bấm X được giữ trong component (input nằm ở đây).
 */
import { nextTick, ref, watch } from 'vue';
import { Search, X } from 'lucide-vue-next';

export interface CompanyMemberToolbarTab {
  key: 'all' | 'active' | 'pending' | 'ended';
  label: string;
  count: number;
}

const props = defineProps<{
  tabs: CompanyMemberToolbarTab[];
  filter: 'all' | 'active' | 'pending' | 'ended';
  search: string;
  isOwner: boolean;
}>();

const emit = defineEmits<{
  'update:filter': [key: 'all' | 'active' | 'pending' | 'ended'];
  'update:search': [value: string];
  'clear-search': [];
}>();

/** Element ô tìm kiếm — trả focus sau khi bấm nút X. */
const searchInputEl = ref<HTMLInputElement | null>(null);

/**
 * Nút X: chỉ xóa giá trị (emit update:search ''). Fetch do watcher debounce
 * của View lo. Trả focus về input sau click.
 */
const clearSearchInput = (): void => {
  if (!props.search) return;
  emit('update:search', '');
  void nextTick(() => searchInputEl.value?.focus());
};

/** Điều hướng ←→ giữa các tab (roving focus, giữ nguyên aria-selected). */
const onTabKeydown = (e: KeyboardEvent, index: number): void => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  if (props.tabs.length < 2) return;
  const next =
    e.key === 'ArrowRight'
      ? (index + 1) % props.tabs.length
      : (index - 1 + props.tabs.length) % props.tabs.length;
  const btn = (e.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
  btn?.focus();
};

/** Đồng bộ focus input sau khi View clear search (vd qua nút X ở empty-row). */
watch(
  () => props.search,
  (val, old) => {
    if (val === '' && old && old !== '' && document.activeElement === document.body) {
      void nextTick(() => searchInputEl.value?.focus());
    }
  },
);
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div
      v-if="isOwner"
      role="tablist"
      aria-label="Lọc theo trạng thái"
      class="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-slate-100 p-1"
    >
      <button
        v-for="(tab, i) in tabs"
        :key="tab.key"
        type="button"
        role="tab"
        :aria-selected="filter === tab.key ? 'true' : 'false'"
        class="cursor-pointer rounded-md px-3 py-1.5 text-[13px] transition-colors duration-150 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
        :class="filter === tab.key
          ? 'bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200'
          : 'text-slate-500 hover:bg-white/60 hover:text-slate-800'"
        @click="emit('update:filter', tab.key)"
        @keydown="onTabKeydown($event, i)"
      >
        {{ tab.label }}
        <span
          class="ml-1.5 text-xs tabular-nums"
          :class="filter === tab.key ? 'text-[#5b4eea]' : 'text-slate-400'"
        >{{ tab.count }}</span>
      </button>
    </div>
    <!-- Search box luôn hiển thị (0/1/2/n thành viên đều tìm được) -->
    <label
      class="relative inline-flex items-center"
    >
      <span class="sr-only">Tìm theo email</span>
      <Search :size="14" class="pointer-events-none absolute left-3 text-slate-400" aria-hidden="true" />
      <input
        ref="searchInputEl"
        :value="search"
        type="search"
        placeholder="Tìm email…"
        class="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 text-[13px] text-slate-700 shadow-sm placeholder:text-slate-400 focus:border-[#5b4eea] focus:outline-none focus:ring-[3px] focus:ring-[#5b4eea]/15 md:w-60"
        :class="search ? 'pr-9' : 'pr-3'"
        @input="emit('update:search', ($event.target as HTMLInputElement).value)"
      />
      <!-- Nút X chỉ hiện khi có từ khóa; ẩn nút cancel native của
           input[type=search] bằng CSS (xem style block) để không có
           2 nút X chồng nhau. -->
      <button
        v-if="search"
        type="button"
        class="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-slate-400 transition-colors duration-150 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
        aria-label="Xóa từ khóa tìm kiếm"
        @click="clearSearchInput"
      >
        <X :size="14" />
      </button>
    </label>
  </div>
</template>

<style scoped>
/* Ẩn nút cancel native của input[type=search] (WebKit) — nút X tự tạo bằng
   Lucide đã thay thế; không ẩn thì có 2 nút X chồng nhau góc phải. */
input[type='search']::-webkit-search-cancel-button {
  -webkit-appearance: none;
  appearance: none;
}
</style>
