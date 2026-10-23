<script setup lang="ts">
/**
 * CompanySelect.vue — Dropdown tùy biến thay thế thẻ <select> chuẩn.
 * Tương thích accessibility (combobox/listbox), hỗ trợ phím mũi tên,
 * tự lật lên trên khi ở sát mép dưới viewport, không phụ thuộc thư viện ngoài.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Check, ChevronDown } from 'lucide-vue-next';

/** 1 lựa chọn: value gửi lên model, label hiển thị. String thuần = value === label. */
export interface CompanySelectOption {
  value: string;
  label: string;
}

interface Props {
  modelValue: string;
  options: Array<string | CompanySelectOption>;
  id: string;
  placeholder?: string;
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Chọn...',
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'change', value: string): void;
}>();

/** Normalize: string → { value, label }. */
const opts = computed<CompanySelectOption[]>(() =>
  props.options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)),
);

const isOpen = ref(false);
const activeIdx = ref(-1);
const flipUp = ref(false);

const rootEl = ref<HTMLElement | null>(null);
const btnEl = ref<HTMLButtonElement | null>(null);
const listEl = ref<HTMLUListElement | null>(null);

const buttonClass = computed(() => {
  const base =
    'flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border bg-white px-3.5 py-3 text-left text-sm transition duration-150 focus:outline-none focus:ring-[3px] focus:ring-blue-600/15 motion-reduce:transition-none';
  return isOpen.value
    ? `${base} border-blue-600`
    : `${base} border-slate-200 hover:border-slate-300 focus:border-blue-600`;
});

const listClass = computed(() => {
  const base =
    'absolute left-0 right-0 z-20 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg';
  return flipUp.value ? `${base} bottom-full mb-1.5` : `${base} top-full mt-1.5`;
});

function getOptionClass(i: number, opt: CompanySelectOption): string {
  const isHighlighted = i === activeIdx.value;
  const isSelected = opt.value === props.modelValue;
  const base =
    'flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm select-none transition-colors duration-100 motion-reduce:transition-none';
  const bg = isHighlighted ? 'bg-slate-50' : 'bg-transparent';
  const text = isSelected ? 'font-medium text-blue-600' : 'font-normal text-slate-900';
  return `${base} ${bg} ${text}`;
}

function scrollToActive(): void {
  void nextTick(() => {
    const list = listEl.value;
    if (!list || activeIdx.value < 0) return;
    const el = list.querySelector<HTMLElement>(`#${props.id}-opt-${activeIdx.value}`);
    if (!el) return;
    const elTop = el.offsetTop;
    const elHeight = el.offsetHeight;
    if (elTop < list.scrollTop) {
      list.scrollTop = elTop;
    } else if (elTop + elHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = elTop + elHeight - list.clientHeight;
    }
  });
}

function openMenu(): void {
  if (isOpen.value) return;
  const rect = btnEl.value?.getBoundingClientRect();
  if (rect) {
    const spaceBelow = window.innerHeight - rect.bottom;
    // max-h-60 là 240px, thêm lề khoảng 10px -> 250px
    flipUp.value = spaceBelow < 250 && rect.top > spaceBelow;
  }
  const idx = opts.value.findIndex((o) => o.value === props.modelValue);
  activeIdx.value = idx >= 0 ? idx : 0;
  isOpen.value = true;
  document.addEventListener('pointerdown', onDocPointerDown);
  scrollToActive();
}

function closeMenu(): void {
  if (!isOpen.value) return;
  isOpen.value = false;
  activeIdx.value = -1;
  document.removeEventListener('pointerdown', onDocPointerDown);
}

function toggleMenu(): void {
  if (isOpen.value) closeMenu();
  else openMenu();
}

function selectOption(val: string): void {
  const changed = val !== props.modelValue;
  emit('update:modelValue', val);
  if (changed) {
    emit('change', val);
  }
  closeMenu();
  btnEl.value?.focus();
}

function onDocPointerDown(e: PointerEvent): void {
  if (!rootEl.value?.contains(e.target as Node)) {
    closeMenu();
  }
}

watch(
  () => props.options,
  () => {
    if (activeIdx.value >= opts.value.length) {
      activeIdx.value = Math.max(0, opts.value.length - 1);
    }
    if (isOpen.value) {
      const idx = opts.value.findIndex((o) => o.value === props.modelValue);
      activeIdx.value = idx >= 0 ? idx : 0;
    }
  },
);

function onKeydown(e: KeyboardEvent): void {
  if (opts.value.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!isOpen.value) {
      openMenu();
    } else {
      activeIdx.value = (activeIdx.value + 1) % opts.value.length;
      scrollToActive();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!isOpen.value) {
      openMenu();
    } else {
      activeIdx.value = (activeIdx.value - 1 + opts.value.length) % opts.value.length;
      scrollToActive();
    }
  } else if (e.key === 'Home') {
    if (isOpen.value) {
      e.preventDefault();
      activeIdx.value = 0;
      scrollToActive();
    }
  } else if (e.key === 'End') {
    if (isOpen.value) {
      e.preventDefault();
      activeIdx.value = opts.value.length - 1;
      scrollToActive();
    }
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (!isOpen.value) {
      openMenu();
    } else {
      if (activeIdx.value >= 0 && activeIdx.value < opts.value.length) {
        selectOption(opts.value[activeIdx.value].value);
      } else {
        closeMenu();
      }
    }
  } else if (e.key === 'Escape') {
    if (isOpen.value) {
      e.preventDefault();
      closeMenu();
      btnEl.value?.focus();
    }
  } else if (e.key === 'Tab') {
    if (isOpen.value) {
      closeMenu();
    }
  }
}

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown);
});
</script>

<template>
  <div ref="rootEl" class="relative min-w-0">
    <!-- Nút kích hoạt combobox -->
    <button
      :id="id"
      ref="btnEl"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      :aria-controls="`${id}-listbox`"
      :aria-activedescendant="isOpen && activeIdx >= 0 ? `${id}-opt-${activeIdx}` : undefined"
      :class="buttonClass"
      @click="toggleMenu"
      @keydown="onKeydown"
    >
      <span :class="modelValue ? 'truncate text-slate-900' : 'truncate text-slate-400'">
        {{ modelValue || placeholder }}
      </span>
      <ChevronDown
        :size="16"
        class="shrink-0 text-slate-400 transition-transform duration-150 motion-reduce:transition-none"
        :class="isOpen ? 'rotate-180' : ''"
        aria-hidden="true"
      />
    </button>

    <!-- Danh sách listbox thả xuống / lật lên -->
    <ul
      v-show="isOpen"
      :id="`${id}-listbox`"
      ref="listEl"
      role="listbox"
      tabindex="-1"
      :class="listClass"
    >
      <li
        v-if="options.length === 0"
        class="px-3 py-2 text-center text-xs text-slate-400 select-none"
      >
        Không có lựa chọn
      </li>
      <li
        v-for="(opt, i) in opts"
        :id="`${id}-opt-${i}`"
        :key="opt.value"
        role="option"
        :aria-selected="opt.value === modelValue"
        :class="getOptionClass(i, opt)"
        @mousedown.prevent
        @mouseenter="activeIdx = i"
        @click="selectOption(opt.value)"
      >
        <span class="truncate">{{ opt.label }}</span>
        <Check v-if="opt.value === modelValue" :size="16" class="shrink-0 text-blue-600" aria-hidden="true" />
      </li>
    </ul>
  </div>
</template>

