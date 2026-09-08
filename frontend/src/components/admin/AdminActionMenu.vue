<script setup lang="ts">
/**
 * AdminActionMenu — per-row dropdown menu (⋯ button).
 *
 * Pattern:
 *   - Trigger button (MoreHorizontal icon)
 *   - Click toggles menu
 *   - Click outside / ESC / chọn action → đóng
 *   - Auto-close sau khi action được chọn
 *   - Dropdown dùng <Teleport to="body"> để KHÔNG bị clip bởi parent
 *     overflow-hidden (table card, row cell) — vẫn render tại vị trí trigger
 *     qua fixed positioning với toạ độ tính từ getBoundingClientRect().
 */
import { ref, onUnmounted, nextTick, onBeforeUnmount, watch, type Component } from 'vue';
import { MoreHorizontal, Check } from 'lucide-vue-next';

interface ActionItem {
  label?: string;
  onClick?: () => void;
  /** Tone: 'default' | 'danger'. Danger dùng đỏ cho destructive actions. */
  tone?: 'default' | 'danger';
  /** Disable (vd đang pending). */
  disabled?: boolean;
  /** Nếu true → render đường kẻ ngang thay vì button (nhóm action). */
  separator?: boolean;
  /** Icon Lucide hiển thị bên trái label. */
  icon?: Component;
  /** Nếu true → đánh dấu item này là "current state" (show ✓ bên phải). */
  active?: boolean;
  /** Nếu true → render dòng section header (chữ nhỏ, muted, không click). */
  header?: boolean;
}

const props = defineProps<{ actions: ActionItem[] }>();

const open = ref(false);
const triggerEl = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);

/** Vị trí của dropdown (tính từ trigger) khi mở. */
const menuPos = ref<{ top: number; right: number }>({ top: 0, right: 0 });

function recalcPos(): void {
  if (!triggerEl.value) return;
  const r = triggerEl.value.getBoundingClientRect();
  // Đặt menu ở góc phải dưới trigger. Dùng `right` so với viewport
  // (right = viewport_width - r.right) để menu nằm trong màn hình.
  menuPos.value = {
    top: r.bottom + 4, // mt-1 = 4px
    right: window.innerWidth - r.right,
  };
}

function toggle(): void {
  if (open.value) {
    close();
    return;
  }
  recalcPos();
  open.value = true;
  nextTick(() => {
    document.addEventListener('click', onOutsideClick, { capture: true });
    document.addEventListener('keydown', onEsc);
    document.addEventListener('scroll', close, { capture: true });
    window.addEventListener('resize', close);
  });
}

function close(): void {
  open.value = false;
  cleanup();
}

function cleanup(): void {
  document.removeEventListener('click', onOutsideClick, { capture: true });
  document.removeEventListener('keydown', onEsc);
  document.removeEventListener('scroll', close, { capture: true });
  window.removeEventListener('resize', close);
}

function onOutsideClick(e: MouseEvent): void {
  const target = e.target as Node;
  // Click trong trigger hoặc trong menu → KHÔNG đóng
  if (triggerEl.value?.contains(target)) return;
  if (menuEl.value?.contains(target)) return;
  close();
}

function onEsc(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
}

function runAction(a: ActionItem): void {
  if (a.disabled || !a.onClick) return;
  close();
  // Slight delay để animation close chạy trước khi action side-effect.
  setTimeout(() => a.onClick!(), 0);
}

onUnmounted(cleanup);
onBeforeUnmount(cleanup);
</script>

<template>
  <button
    ref="triggerEl"
    type="button"
    class="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
    :class="{ 'bg-gray-100 text-gray-700': open }"
    aria-label="Mở menu hành động"
    @click.stop="toggle"
  >
    <MoreHorizontal class="w-4 h-4" />
  </button>

  <!-- Teleport ra body để KHÔNG bị clip bởi overflow-hidden của table card / cell. -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition ease-out duration-100"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="open"
        ref="menuEl"
        class="fixed z-50 w-48 origin-top-right rounded-lg border border-gray-200 bg-white py-1 shadow-lg ring-1 ring-black/[0.04] focus:outline-none"
        :style="{ top: `${menuPos.top}px`, right: `${menuPos.right}px` }"
        role="menu"
      >
        <template v-for="(a, i) in actions" :key="i">
          <div
            v-if="a.separator"
            class="my-1 h-px mx-2"
            style="background-color: var(--admin-border-subtle);"
          />
          <div
            v-else-if="a.header"
            class="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider"
            style="color: var(--admin-text-subtle);"
          >
            {{ a.label }}
          </div>
          <button
            v-else
            type="button"
            role="menuitem"
            class="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40"
            :class="a.tone === 'danger'
              ? 'text-red-600 hover:bg-red-50'
              : 'text-gray-700 hover:bg-gray-50'"
            :disabled="a.disabled"
            @click="runAction(a)"
          >
            <component
              v-if="a.icon"
              :is="a.icon"
              class="h-3.5 w-3.5 shrink-0"
              :class="a.tone === 'danger' ? 'text-red-500' : 'text-gray-400'"
            />
            <span class="flex-1 truncate">{{ a.label }}</span>
            <Check
              v-if="a.active"
              class="h-3.5 w-3.5 shrink-0 text-emerald-500"
            />
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>
