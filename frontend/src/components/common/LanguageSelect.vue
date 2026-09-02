<script setup lang="ts">
/**
 * LanguageSelect — custom combobox cho dropdown chọn ngôn ngữ (UI only, chưa
 * sync backend).
 *
 * Tại sao không dùng `<select>`/`<option>`:
 *   - Panel của native `<select>` được OS render → không control được font,
 *     padding, hover, checked style → UI không nhất quán giữa Chrome/Edge/Firefox
 *     trên Win/macOS/Linux.
 *   - Trên Win/Chrome font chữ + spacing trông xấu và không match design system.
 *
 * Giải pháp:
 *   - Trigger là button custom (Tailwind styled, đồng bộ với input ở form khác).
 *   - Panel là <ul role="listbox"> với <li role="option"> styled Tailwind —
 *     browser không can thiệp nên trông giống UI còn lại.
 *   - Teleport panel ra <body> để escape:
 *       + stacking-context của ancestor (`relative` + transform/filter).
 *       + `overflow: hidden/auto/scroll` của ancestor.
 *       + z-index stacking bị giới hạn.
 *
 * Auto-flip:
 *   - Khi mở, measure `panel.offsetHeight` rồi so với `window.innerHeight`.
 *   - Nếu không đủ chỗ phía dưới VÀ phía trên có nhiều chỗ hơn → flip lên trên.
 *   - Đảm bảo không bị clip ở bất kỳ vị trí nào trên viewport (giữa/cuối/trên).
 *
 * Clamp:
 *   - `left` được clamp vào viewport với padding 8px mỗi bên — khi button ở rìa
 *     (mobile responsive), panel không tràn ra ngoài.
 *
 * A11y:
 *   - button: `aria-haspopup="listbox"`, `aria-expanded`, `aria-label`,
 *     `aria-activedescendant` cho keyboard nav.
 *   - ul: `role="listbox"`.
 *   - li: `role="option"`, `aria-selected`.
 *   - Keyboard: ArrowDown/Up di chuyển, Home/End về đầu/cuối, Enter/Space chọn,
 *     Escape đóng, Tab đóng + nhường focus tự nhiên.
 *
 * Outside click:
 *   - `composedPath()` để click vào option trong Teleport panel không trigger
 *     close trước khi `@click` của option kịp chạy (vì path từ document đến
 *     target đi qua option mới tới document).
 *
 * Scroll/Resize:
 *   - Lắng nghe scroll ở capture phase + resize → reposition nếu đang mở
 *     (panel bị "sticky" theo button khi page scroll).
 */
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { Check, ChevronDown } from 'lucide-vue-next';

export interface LanguageOption {
  code: string;
  label: string;
  flag: string;
}

interface Props {
  /** V-model: code ngôn ngữ đang chọn. */
  modelValue: string;
  /** Danh sách option. Generic đủ để tái sử dụng nếu cần list khác 2 ngôn ngữ. */
  options: LanguageOption[];
  /** aria-label cho button (mặc định "Chọn ngôn ngữ"). */
  ariaLabel?: string;
  /** Wrapper class cho container (vd max-width). */
  wrapperClass?: string;
}

const props = withDefaults(defineProps<Props>(), {
  ariaLabel: 'Chọn ngôn ngữ',
  wrapperClass: 'max-w-sm',
});

const emit = defineEmits<{
  /** V-model update. */
  'update:modelValue': [code: string];
}>();

/* ============================================================================
 * Refs
 * ==========================================================================*/

const open = ref(false);
const buttonRef = ref<HTMLButtonElement | null>(null);
const panelRef = ref<HTMLUListElement | null>(null);
const activeIndex = ref(-1);
interface PanelPos { top: number; left: number; width: number; }
const panelPos = ref<PanelPos>({ top: 0, left: 0, width: 0 });

const listboxId = 'lang-select-listbox';
const optionId = (code: string): string => `${listboxId}-opt-${code}`;

const selected = computed<LanguageOption | null>(
  () => props.options.find((o) => o.code === props.modelValue) ?? null,
);

const activeOptionCode = computed<string | null>(() => {
  if (activeIndex.value < 0) return null;
  return props.options[activeIndex.value]?.code ?? null;
});

/* ============================================================================
 * Positioning (Teleport + fixed → reference `getBoundingClientRect()`)
 * ==========================================================================*/

/**
 * Đo panel.offsetHeight thực tế rồi đặt top/left/width cho panel `position:fixed`.
 *
 * Auto-flip rule: nếu `panelH + GAP` vượt `spaceBelow` VÀ `spaceAbove > spaceBelow`
 * → đặt panel phía trên button. Ngược lại → phía dưới (case bình thường).
 *
 * Horizontal: clamp `left` vào viewport với padding 8px.
 */
const measureAndPosition = (): void => {
  const btn = buttonRef.value;
  const panel = panelRef.value;
  if (!btn || !panel) return;

  const rect = btn.getBoundingClientRect();
  const panelH = panel.offsetHeight;
  const GAP = 6;
  const PAD = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const spaceBelow = vh - rect.bottom - GAP;
  const spaceAbove = rect.top - GAP;

  const flipUp = panelH + GAP > spaceBelow && spaceAbove > spaceBelow;
  let top = flipUp ? rect.top - panelH - GAP : rect.bottom + GAP;

  let left = rect.left;
  const w = rect.width;
  if (left + w > vw - PAD) left = Math.max(PAD, vw - w - PAD);
  if (left < PAD) left = PAD;

  panelPos.value = { top, left, width: w };
};

/**
 * Mở panel + đợi 1 tick để v-if mount xong panel DOM rồi measure.
 */
const openPanel = async (): Promise<void> => {
  // Pre-select option hiện tại để ArrowDown di chuyển "ra khỏi" nó đầu tiên.
  activeIndex.value = Math.max(0, props.options.findIndex((o) => o.code === props.modelValue));
  open.value = true;
  await nextTick();
  measureAndPosition();
};

const closePanel = (): void => {
  open.value = false;
  activeIndex.value = -1;
};

const toggleOpen = (): void => {
  if (open.value) closePanel();
  else void openPanel();
};

/* ============================================================================
 * Selection
 * ==========================================================================*/

const selectOption = (code: string): void => {
  if (code === props.modelValue) {
    // Chọn lại option hiện tại → vẫn đóng panel nhưng không emit (tránh re-render dư).
    closePanel();
    buttonRef.value?.focus();
    return;
  }
  emit('update:modelValue', code);
  closePanel();
  // Return focus về button để keyboard user tiếp tục dùng button sau khi chọn.
  buttonRef.value?.focus();
};

/* ============================================================================
 * Outside click + scroll/resize repositioning
 * ==========================================================================*/

const onDocPointerDown = (e: MouseEvent): void => {
  if (!open.value) return;
  const path = e.composedPath();
  if (buttonRef.value && path.includes(buttonRef.value)) return;
  if (panelRef.value && path.includes(panelRef.value)) return;
  closePanel();
};

const onWindowScrollOrResize = (): void => {
  if (open.value) measureAndPosition();
};

/* ============================================================================
 * Keyboard navigation trên trigger
 * ==========================================================================*/

const onTriggerKeydown = async (e: KeyboardEvent): Promise<void> => {
  const max = props.options.length - 1;

  // Đóng: Esc đóng panel, Tab đóng + nhường focus đi tiếp (không preventDefault).
  if (open.value && e.key === 'Escape') {
    e.preventDefault();
    closePanel();
    return;
  }
  if (open.value && e.key === 'Tab') {
    closePanel();
    return;
  }

  // Mở: ArrowDown/Up/Enter/Space đều mở panel.
  if (!open.value && (e.key === 'ArrowDown' || e.key === 'ArrowUp'
        || e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    await openPanel();
    // ArrowUp → set active về option cuối (đi ngược chiều).
    if (e.key === 'ArrowUp') activeIndex.value = max;
    return;
  }

  // Đã mở: điều hướng.
  if (open.value && e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex.value = Math.min(activeIndex.value + 1, max);
  } else if (open.value && e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
  } else if (open.value && e.key === 'Home') {
    e.preventDefault();
    activeIndex.value = 0;
  } else if (open.value && e.key === 'End') {
    e.preventDefault();
    activeIndex.value = max;
  } else if (open.value && (e.key === 'Enter' || e.key === ' ') && activeIndex.value >= 0) {
    e.preventDefault();
    const opt = props.options[activeIndex.value];
    if (opt) selectOption(opt.code);
  }
};

/* ============================================================================
 * Lifecycle
 * ==========================================================================*/

onMounted(() => {
  document.addEventListener('mousedown', onDocPointerDown);
  // capture: true để bắt scroll trên mọi ancestor (vd scrollable list bên trong card)
  // — chỉ cần reposition khi trigger di chuyển khỏi vị trí cũ.
  window.addEventListener('scroll', onWindowScrollOrResize, true);
  window.addEventListener('resize', onWindowScrollOrResize);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocPointerDown);
  window.removeEventListener('scroll', onWindowScrollOrResize, true);
  window.removeEventListener('resize', onWindowScrollOrResize);
});
</script>

<template>
  <div :class="wrapperClass">
    <button
      ref="buttonRef"
      type="button"
      :aria-label="ariaLabel"
      :aria-haspopup="'listbox'"
      :aria-expanded="open"
      :aria-controls="listboxId"
      :aria-activedescendant="open && activeOptionCode ? optionId(activeOptionCode) : undefined"
      class="w-full flex items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
      @click="toggleOpen"
      @keydown="onTriggerKeydown"
    >
      <span class="flex items-center gap-2 truncate">
        <span v-if="selected" class="text-base" aria-hidden="true">{{ selected.flag }}</span>
        <span class="font-medium truncate">{{ selected?.label ?? '—' }}</span>
      </span>
      <ChevronDown
        class="h-4 w-4 shrink-0 text-slate-400 transition-transform"
        :class="{ 'rotate-180 text-primary-600': open }"
        aria-hidden="true"
      />
    </button>

    <Teleport to="body">
      <ul
        v-if="open"
        :id="listboxId"
        ref="panelRef"
        role="listbox"
        :aria-label="ariaLabel"
        :style="{
          top: `${panelPos.top}px`,
          left: `${panelPos.left}px`,
          width: `${panelPos.width}px`,
        }"
        class="fixed z-[1000] max-h-[280px] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 backdrop-blur-sm py-1"
      >
        <li
          v-for="opt in options"
          :id="optionId(opt.code)"
          :key="opt.code"
          role="option"
          :aria-selected="opt.code === modelValue"
          :class="[
            'flex items-center gap-2.5 cursor-pointer px-3 py-2 transition-colors select-none',
            opt.code === modelValue
              ? 'bg-primary-50 text-slate-900'
              : activeIndex >= 0 && props.options[activeIndex]?.code === opt.code
                ? 'bg-primary-50 text-slate-900'
                : 'text-slate-700 hover:bg-slate-50',
          ]"
          @click="selectOption(opt.code)"
          @mouseenter="activeIndex = props.options.findIndex((o) => o.code === opt.code)"
        >
          <span class="text-base" aria-hidden="true">{{ opt.flag }}</span>
          <span class="flex-1 text-sm font-medium">{{ opt.label }}</span>
          <Check
            v-if="opt.code === modelValue"
            class="h-4 w-4 text-primary-600 shrink-0"
            aria-hidden="true"
          />
        </li>
      </ul>
    </Teleport>
  </div>
</template>
