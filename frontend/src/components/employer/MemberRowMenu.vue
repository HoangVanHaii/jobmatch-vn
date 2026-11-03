<script lang="ts">
/** Giữ closer của menu đang mở trên toàn trang để đảm bảo duy nhất 1 menu mở tại một thời điểm */
let activeMenuCloser: (() => void) | null = null;
</script>

<script setup lang="ts">
/**
 * MemberRowMenu.vue — nút "⋯" mở menu nổi các hành động trên 1 hàng thành viên.
 *
 * Menu render qua Teleport + position: fixed để không bị `overflow` của bảng
 * cắt; tự lật lên trên khi sát đáy viewport; tự đóng khi cuộn trang hoặc resize.
 * Đóng khi click ngoài / Esc / Tab / chọn mục; điều hướng ↑↓ / Home / End;
 * trả focus về nút khi đóng. Đảm bảo chỉ 1 menu mở trên toàn bảng tại 1 thời điểm.
 */
import { nextTick, onBeforeUnmount, ref, type Component } from 'vue';
import { MoreHorizontal } from 'lucide-vue-next';
import { onClickOutside, useEventListener } from '@vueuse/core';

export interface MemberRowMenuItem {
  label: string;
  danger?: boolean;
  icon?: Component;
  handler: () => void;
}

const props = defineProps<{
  /** Nhãn cho aria-label của nút ("Thao tác cho {tên}"). */
  label: string;
  items: MemberRowMenuItem[];
}>();

const btnEl = ref<HTMLButtonElement | null>(null);
const open = ref(false);
const menuEl = ref<HTMLDivElement | null>(null);
const menuStyle = ref<{ top: string; left: string }>({ top: '0px', left: '0px' });
const placement = ref<'top' | 'bottom'>('bottom');
const activeIndex = ref(-1);

/** Thời điểm mở menu (ms) để chặn đóng nhầm do scroll event phát sinh khi browser focus() */
let openedAt = 0;

/** Tính toán vị trí ban đầu nhanh để tránh menu nhấp nháy tại (0, 0) trước transition */
const estimateInitialPosition = (): void => {
  const btn = btnEl.value;
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const estWidth = 180;
  const estHeight = Math.max(40, props.items.length * 36 + 10);
  const below = window.innerHeight - r.bottom;
  const above = r.top;
  const isFlipped = below < estHeight + 8 && above > below;
  placement.value = isFlipped ? 'top' : 'bottom';
  const top = isFlipped
    ? Math.max(8, r.top - estHeight - 6)
    : Math.min(window.innerHeight - estHeight - 8, r.bottom + 6);
  const rawLeft = r.right - estWidth;
  const left = Math.max(8, Math.min(rawLeft, window.innerWidth - estWidth - 8));
  menuStyle.value = { top: `${top}px`, left: `${left}px` };
};

/** Căn chỉnh chính xác vị trí theo kích thước thực tế của menu element */
const placeMenu = (): void => {
  const btn = btnEl.value;
  const menu = menuEl.value;
  if (!btn || !menu) return;
  const r = btn.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) {
    close(false);
    return;
  }
  const h = menu.offsetHeight;
  const w = menu.offsetWidth;
  const below = window.innerHeight - r.bottom;
  const above = r.top;
  // Sát đáy viewport và phía trên thoáng hơn → lật lên trên
  const isFlipped = below < h + 8 && above > below;
  placement.value = isFlipped ? 'top' : 'bottom';

  const top = isFlipped
    ? Math.max(8, r.top - h - 6)
    : Math.min(window.innerHeight - h - 8, r.bottom + 6);
  const rawLeft = r.right - w;
  const left = Math.max(8, Math.min(rawLeft, window.innerWidth - w - 8));
  menuStyle.value = { top: `${top}px`, left: `${left}px` };
};

const close = (refocus = true): void => {
  if (!open.value) return;
  open.value = false;
  activeIndex.value = -1;
  if (activeMenuCloser === closeSelf) {
    activeMenuCloser = null;
  }
  if (refocus) {
    btnEl.value?.focus({ preventScroll: true });
  }
};

const closeSelf = (): void => {
  close(false);
};

const toggle = (): void => {
  if (open.value) {
    close();
    return;
  }
  // Đóng bất kỳ menu nào đang mở trên toàn bảng
  if (activeMenuCloser && activeMenuCloser !== closeSelf) {
    activeMenuCloser();
  }
  activeMenuCloser = closeSelf;

  estimateInitialPosition();
  open.value = true;
  openedAt = Date.now();
  activeIndex.value = 0;
  void nextTick(() => {
    placeMenu();
    // Focus vào mục đầu tiên với preventScroll: true để không làm cuộn trang
    const firstItem = menuEl.value?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    firstItem?.focus({ preventScroll: true });
  });
};

/** Đóng menu khi người dùng cuộn bất kỳ container nào hoặc resize màn hình */
const onScrollOrResize = (): void => {
  if (!open.value) return;
  // Bỏ qua scroll kích hoạt trong 120ms đầu sau khi mở (chống lag/focus scroll)
  if (Date.now() - openedAt < 120) return;
  close(false);
};

/** VueUse: Đóng menu khi click ra ngoài menuEl và không click vào nút trigger btnEl */
onClickOutside(menuEl, () => {
  if (open.value) {
    close(false);
  }
}, { ignore: [btnEl] });

/** VueUse: Lắng nghe phím trên document */
useEventListener(document, 'keydown', (e: KeyboardEvent) => {
  if (!open.value) return;

  if (e.key === 'Escape') {
    e.stopPropagation();
    e.preventDefault();
    close(true);
    return;
  }
  if (e.key === 'Tab') {
    // Đóng menu và cho phép focus tiếp tục theo luồng tự nhiên
    close(false);
    return;
  }
  if (props.items.length === 0) return;

  const n = props.items.length;
  const getButtons = () =>
    menuEl.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex.value =
      e.key === 'ArrowDown'
        ? (activeIndex.value + 1) % n
        : (activeIndex.value - 1 + n) % n;
    getButtons()?.[activeIndex.value]?.focus({ preventScroll: true });
  } else if (e.key === 'Home') {
    e.preventDefault();
    activeIndex.value = 0;
    getButtons()?.[0]?.focus({ preventScroll: true });
  } else if (e.key === 'End') {
    e.preventDefault();
    activeIndex.value = n - 1;
    getButtons()?.[n - 1]?.focus({ preventScroll: true });
  }
});

/** VueUse: Lắng nghe scroll (capture: true) và resize */
useEventListener(window, 'scroll', onScrollOrResize, { capture: true, passive: true });
useEventListener(window, 'resize', onScrollOrResize, { passive: true });

const pick = (item: MemberRowMenuItem): void => {
  close(false);
  item.handler();
};

/** Hiển thị divider phân tách khi chuyển từ nhóm thường sang nhóm danger */
const shouldShowDividerBefore = (index: number): boolean => {
  if (index === 0) return false;
  const current = props.items[index];
  const prev = props.items[index - 1];
  return Boolean(current?.danger && !prev?.danger);
};

onBeforeUnmount(() => {
  if (activeMenuCloser === closeSelf) {
    activeMenuCloser = null;
  }
});
</script>

<template>
  <button
    ref="btnEl"
    type="button"
    title="Thao tác"
    class="inline-flex h-8 w-8 min-h-[32px] min-w-[32px] shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#5b4eea] focus-visible:outline-none motion-reduce:transition-none"
    :class="{ 'bg-slate-100 text-slate-800 ring-1 ring-slate-200': open }"
    :aria-label="`Thao tác cho ${label}`"
    aria-haspopup="menu"
    :aria-expanded="open ? 'true' : 'false'"
    @click.stop="toggle"
  >
    <MoreHorizontal :size="16" aria-hidden="true" />
  </button>

  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="open"
        ref="menuEl"
        role="menu"
        :aria-label="`Thao tác cho ${label}`"
        class="fixed z-[60] min-w-[180px] w-max max-w-[240px] rounded-xl border border-slate-200/90 bg-white p-1 shadow-lg shadow-slate-900/5 focus:outline-none"
        :class="placement === 'top' ? 'origin-bottom-right' : 'origin-top-right'"
        :style="menuStyle"
      >
        <template v-for="(item, i) in items" :key="item.label">
          <div
            v-if="shouldShowDividerBefore(i)"
            class="my-1 border-t border-slate-100"
            role="separator"
            aria-orientation="horizontal"
          />
          <button
            type="button"
            role="menuitem"
            tabindex="-1"
            class="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-normal transition-colors duration-150 focus:outline-none motion-reduce:transition-none"
            :class="
              item.danger
                ? 'text-red-600 hover:bg-red-50/80 focus:bg-red-50/80 focus-visible:bg-red-50/80'
                : 'text-slate-700 hover:bg-slate-100/80 focus:bg-slate-100/80 focus-visible:bg-slate-100/80'
            "
            @click="pick(item)"
          >
            <component
              :is="item.icon"
              v-if="item.icon"
              :size="16"
              class="shrink-0 transition-colors"
              :class="item.danger ? 'text-red-500' : 'text-slate-400 group-hover:text-slate-600'"
              aria-hidden="true"
            />
            <span class="truncate">{{ item.label }}</span>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>
