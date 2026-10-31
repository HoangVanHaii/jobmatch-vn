<script setup lang="ts">
/**
 * MemberRowMenu.vue — nút "⋯" mở menu nổi các hành động trên 1 hàng thành viên.
 *
 * Menu render qua Teleport + position: fixed để không bị `overflow` của bảng
 * cắt; tự lật lên trên khi sát đáy viewport. Đóng khi click ngoài / Esc /
 * chọn mục; điều hướng ↑↓; trả focus về nút khi đóng.
 */
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { MoreHorizontal } from 'lucide-vue-next';

export interface MemberRowMenuItem {
  label: string;
  danger?: boolean;
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
const activeIndex = ref(-1);

const placeMenu = (): void => {
  const btn = btnEl.value;
  const menu = menuEl.value;
  if (!btn || !menu) return;
  const r = btn.getBoundingClientRect();
  const h = menu.offsetHeight;
  // Sát đáy viewport → lật lên trên
  const below = window.innerHeight - r.bottom;
  const top = below < h + 8 ? r.top - h - 6 : r.bottom + 6;
  const left = Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
  menuStyle.value = { top: `${top}px`, left: `${left}px` };
};

const toggle = (): void => {
  if (open.value) {
    close();
    return;
  }
  open.value = true;
  activeIndex.value = -1;
  void nextTick(() => {
    placeMenu();
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKeydown, true);
  });
};

const close = (refocus = true): void => {
  if (!open.value) return;
  open.value = false;
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKeydown, true);
  if (refocus) btnEl.value?.focus();
};

const onOutside = (e: MouseEvent): void => {
  const t = e.target as Node;
  if (menuEl.value?.contains(t) || btnEl.value?.contains(t)) return;
  close(false);
};

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') {
    e.stopPropagation();
    close();
    return;
  }
  if (!open.value || props.items.length === 0) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = props.items.length;
    activeIndex.value =
      e.key === 'ArrowDown'
        ? (activeIndex.value + 1) % n
        : (activeIndex.value - 1 + n) % n;
    menuEl.value
      ?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
      [activeIndex.value]?.focus();
  }
};

const pick = (item: MemberRowMenuItem): void => {
  close(false);
  item.handler();
};

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKeydown, true);
});
</script>

<template>
  <button
    ref="btnEl"
    type="button"
    title="Thao tác"
    class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
    :aria-label="`Thao tác cho ${label}`"
    aria-haspopup="menu"
    :aria-expanded="open ? 'true' : 'false'"
    @click.stop="toggle"
  >
    <MoreHorizontal :size="16" aria-hidden="true" />
  </button>

  <Teleport to="body">
    <div
      v-if="open"
      ref="menuEl"
      role="menu"
      :aria-label="`Thao tác cho ${label}`"
      class="fixed z-[60] min-w-[176px] rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg"
      :style="menuStyle"
    >
      <button
        v-for="(item, i) in items"
        :key="item.label"
        type="button"
        role="menuitem"
        tabindex="-1"
        class="block w-full cursor-pointer px-3.5 py-2 text-left text-[13px] transition-colors duration-150 focus:outline-none focus-visible:bg-slate-100 hover:bg-slate-100 motion-reduce:transition-none"
        :class="item.danger ? 'text-red-600 hover:bg-red-50 focus-visible:bg-red-50' : 'text-slate-700'"
        @click="pick(item)"
      >
        {{ item.label }}
      </button>
    </div>
  </Teleport>
</template>
