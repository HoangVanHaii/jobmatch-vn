<script setup lang="ts">
/**
 * LocationAutocomplete — combobox tùy biến thay cho native <datalist>.
 *
 * Vì sao không dùng <datalist>:
 *   - `<option>` trong datalist bị browser/OS style cứng — không control được
 *     font, padding, hover, icon, secondary text, divider, empty state.
 *   - Trên Chrome/Win, macOS, Linux render hoàn toàn khác nhau → UI không
 *     nhất quán.
 *
 * Cấu trúc:
 *   - <input> ở dưới (giữ nguyên behavior: free-text OK, autocomplete="*").
 *   - Dropdown panel absolute phía dưới, hiện khi focus/typing.
 *   - Click option → emit update:modelValue + đóng panel.
 *   - Keyboard nav: ↑/↓ di chuyển, Enter chọn, Esc đóng.
 *
 * Props:
 *   - modelValue: giá trị hiện tại (string).
 *   - options: danh sách gợi ý. Mỗi option có:
 *     + value: chuỗi sẽ fill vào input khi chọn.
 *     + label: (optional) chuỗi phụ hiển thị bên phải (vd tên đầy đủ).
 *     + meta: (optional) dòng meta phía dưới value (vd parent province).
 *     + icon: (optional) LucideIcon component cho leading icon.
 *     + iconClass: (optional) class cho icon wrap (vd brand color).
 *   - placeholder, id, disabled: pass-through cho <input>.
 *   - emptyHint: text khi filter không ra kết quả.
 *   - maxOptions: giới hạn số option hiển thị (mặc định 50 → scroll nếu nhiều hơn).
 *   - inputClass: class override cho input (để caller match style với form khác).
 *
 * Emits:
 *   - update:modelValue: giá trị input thay đổi (gõ hoặc chọn option).
 *   - select: option được chọn từ dropdown (truyền cả object).
 *
 * A11y:
 *   - role="combobox" + aria-expanded + aria-controls cho input.
 *   - role="listbox" cho panel, role="option" cho từng item, aria-selected.
 *   - aria-activedescendant cho keyboard nav.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { ChevronDown, Search, type LucideIcon } from 'lucide-vue-next';

export interface LocationOption {
  value: string;
  label?: string;
  meta?: string;
  icon?: LucideIcon;
  iconClass?: string;
}

interface Props {
  modelValue: string;
  options: LocationOption[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  emptyHint?: string;
  maxOptions?: number;
  inputClass?: string;
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '',
  id: '',
  disabled: false,
  emptyHint: 'Không có kết quả phù hợp',
  maxOptions: 50,
  inputClass: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  select: [option: LocationOption];
}>();

/* ============================================================================
 * State
 * ==========================================================================*/

const isOpen = ref(false);
const highlightedIndex = ref(-1);
const inputEl = ref<HTMLInputElement | null>(null);
/** ID prefix cho option DOM — phục vụ aria-activedescendant. */
const listboxId = `${props.id || 'loc'}-listbox`;
const optionId = (i: number): string => `${listboxId}-opt-${i}`;

/* ============================================================================
 * Filter + visible options
 * ==========================================================================*/

/**
 * Lọc options theo query — match case-insensitive trên `value` lẫn `label`.
 * Empty query → trả full list (giúp user thấy toàn bộ khi vừa focus).
 */
const filteredOptions = computed<LocationOption[]>(() => {
  const q = props.modelValue.trim().toLowerCase();
  if (!q) return props.options;
  return props.options.filter((o) => {
    const inValue = o.value.toLowerCase().includes(q);
    const inLabel = o.label ? o.label.toLowerCase().includes(q) : false;
    return inValue || inLabel;
  });
});

const visibleOptions = computed<LocationOption[]>(() =>
  filteredOptions.value.slice(0, props.maxOptions),
);

/* ============================================================================
 * Handlers
 * ==========================================================================*/

const onInput = (e: Event): void => {
  const target = e.target as HTMLInputElement;
  emit('update:modelValue', target.value);
  isOpen.value = true;
  highlightedIndex.value = -1;
};

const onFocus = (): void => {
  isOpen.value = true;
};

const onBlur = (): void => {
  // Delay để click option kịp register trước khi panel đóng.
  // Nếu đóng ngay → onClick của option không fire vì panel đã unmount.
  window.setTimeout(() => {
    isOpen.value = false;
    highlightedIndex.value = -1;
  }, 150);
};

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    isOpen.value = true;
    highlightedIndex.value = Math.min(
      highlightedIndex.value + 1,
      visibleOptions.value.length - 1,
    );
    scrollIntoView();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlightedIndex.value = Math.max(highlightedIndex.value - 1, 0);
    scrollIntoView();
  } else if (e.key === 'Enter' && highlightedIndex.value >= 0) {
    e.preventDefault();
    const opt = visibleOptions.value[highlightedIndex.value];
    if (opt) selectOption(opt);
  } else if (e.key === 'Escape') {
    isOpen.value = false;
    highlightedIndex.value = -1;
  }
};

const selectOption = (opt: LocationOption): void => {
  emit('update:modelValue', opt.value);
  emit('select', opt);
  isOpen.value = false;
  highlightedIndex.value = -1;
  // Blur để user không phải tự click ra ngoài; giúp panel đóng sạch.
  inputEl.value?.blur();
};

/** Cuộn option đang highlight vào viewport khi keyboard nav. */
const scrollIntoView = (): void => {
  void nextTick(() => {
    const el = document.getElementById(optionId(highlightedIndex.value));
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
};

/** Highlight text match trong option (basic substring highlight). */
const highlightMatch = (text: string): { before: string; match: string; after: string } | null => {
  const q = props.modelValue.trim();
  if (!q) return null;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return null;
  return {
    before: text.slice(0, idx),
    match: text.slice(idx, idx + q.length),
    after: text.slice(idx + q.length),
  };
};

/* ============================================================================
 * Re-sync highlight khi filter thay đổi
 * ==========================================================================*/

watch(filteredOptions, () => {
  // Reset highlight khi filter thay đổi — tránh trỏ vào option không tồn tại.
  highlightedIndex.value = -1;
});
</script>

<template>
  <div class="relative">
    <!-- Input wrapper — relative để chevron icon absolute bên phải -->
    <div class="relative">
      <input
        :id="id"
        ref="inputEl"
        :value="modelValue"
        type="text"
        role="combobox"
        :aria-expanded="isOpen"
        :aria-controls="listboxId"
        :aria-activedescendant="highlightedIndex >= 0 ? optionId(highlightedIndex) : undefined"
        :aria-autocomplete="isOpen ? 'list' : 'none'"
        :placeholder="placeholder"
        :disabled="disabled"
        autocomplete="off"
        :class="[
          'block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 pr-9 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition',
          'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30',
          'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400',
          inputClass,
        ]"
        @input="onInput"
        @focus="onFocus"
        @blur="onBlur"
        @keydown="onKeydown"
      />
      <ChevronDown
        class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition"
        :class="{ 'rotate-180 text-primary-600': isOpen }"
        aria-hidden="true"
      />
    </div>

    <!-- Dropdown panel — Teleport để tránh stacking-context + overflow clipping -->
    <Teleport to="body">
      <div
        v-if="isOpen && visibleOptions.length > 0"
        :id="listboxId"
        role="listbox"
        class="fixed z-[200] max-h-[280px] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 backdrop-blur-sm"
        :style="{
          top: inputEl ? `${inputEl.getBoundingClientRect().bottom + 6}px` : '0',
          left: inputEl ? `${inputEl.getBoundingClientRect().left}px` : '0',
          width: inputEl ? `${inputEl.getBoundingClientRect().width}px` : 'auto',
        }"
      >
        <!-- Hint header -->
        <div
          class="sticky top-0 z-10 flex items-center gap-1.5 border-b border-slate-100 bg-slate-50/80 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500 backdrop-blur"
        >
          <Search class="h-3 w-3" aria-hidden="true" />
          {{ filteredOptions.length }} kết quả
        </div>

        <ul class="py-1">
          <li
            v-for="(opt, i) in visibleOptions"
            :id="optionId(i)"
            :key="`${opt.value}-${i}`"
            role="option"
            :aria-selected="highlightedIndex === i"
            :class="[
              'flex items-center gap-2.5 cursor-pointer px-3 py-2 transition-colors',
              highlightedIndex === i
                ? 'bg-primary-50 text-slate-900'
                : 'text-slate-700 hover:bg-slate-50',
            ]"
            @mousedown.prevent="selectOption(opt)"
            @mouseenter="highlightedIndex = i"
          >
            <!-- Leading icon (optional) -->
            <span
              v-if="opt.icon"
              :class="[
                'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1',
                opt.iconClass ?? 'bg-slate-100 ring-slate-200 text-slate-600',
              ]"
              aria-hidden="true"
            >
              <component :is="opt.icon" class="h-3.5 w-3.5" />
            </span>

            <!-- Text block -->
            <div class="flex-1 min-w-0">
              <p class="truncate text-sm font-medium leading-snug">
                <template v-if="highlightMatch(opt.value)">
                  <span class="text-slate-500">{{ highlightMatch(opt.value)!.before }}</span><mark class="bg-amber-100 text-amber-900 rounded px-0.5">{{ highlightMatch(opt.value)!.match }}</mark><span class="text-slate-500">{{ highlightMatch(opt.value)!.after }}</span>
                </template>
                <template v-else>{{ opt.value }}</template>
              </p>
              <p
                v-if="opt.meta"
                class="mt-0.5 truncate text-xs text-slate-500"
              >
                {{ opt.meta }}
              </p>
            </div>

            <!-- Right secondary label (vd full province name) -->
            <span
              v-if="opt.label"
              class="hidden sm:inline shrink-0 text-[11px] text-slate-400 truncate max-w-[40%]"
            >
              {{ opt.label }}
            </span>
          </li>
        </ul>

        <!-- Footer hint khi có nhiều hơn maxOptions -->
        <div
          v-if="filteredOptions.length > maxOptions"
          class="border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 text-[11px] text-slate-500 text-center"
        >
          Hiển thị {{ maxOptions }} / {{ filteredOptions.length }} — gõ thêm để lọc
        </div>
      </div>
    </Teleport>
  </div>
</template>
