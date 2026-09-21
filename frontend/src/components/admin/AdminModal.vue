<script setup lang="ts">
/**
 * AdminModal — generic modal wrapper cho admin area.
 *
 * Dùng cho view/edit dialog. Có:
 *   - Overlay (backdrop) + ESC + click-outside để đóng
 *   - Header với title + close button
 *   - Body slot (custom content)
 *   - Footer slot (custom actions)
 *
 * Teleport ra body để không bị clip bởi overflow-hidden của parent.
 */
import { ref, watch, onUnmounted, nextTick } from 'vue';
import { X } from 'lucide-vue-next';

const props = defineProps<{
  open: boolean;
  title: string;
  /** max-width Tailwind class, mặc định max-w-lg (512px). */
  size?: 'sm' | 'md' | 'lg' | 'xl';
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'close'): void;
}>();

const dialogEl = ref<HTMLElement | null>(null);

const sizeClass: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
};

function close(): void {
  emit('update:open', false);
  emit('close');
}

function onEsc(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) close();
}

function onOutsideClick(e: MouseEvent): void {
  if (!props.open || !dialogEl.value) return;
  if (dialogEl.value.contains(e.target as Node)) return;
  close();
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      document.addEventListener('keydown', onEsc);
      document.addEventListener('click', onOutsideClick, { capture: true });
    });
  } else {
    document.removeEventListener('keydown', onEsc);
    document.removeEventListener('click', onOutsideClick, { capture: true });
  }
});

onUnmounted(() => {
  document.removeEventListener('keydown', onEsc);
  document.removeEventListener('click', onOutsideClick, { capture: true });
});
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition ease-out duration-150"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition ease-in duration-100"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        @click.self="close"
      >
        <Transition
          enter-active-class="transition ease-out duration-150"
          enter-from-class="opacity-0 scale-95"
          enter-to-class="opacity-100 scale-100"
          leave-active-class="transition ease-in duration-100"
          leave-from-class="opacity-100 scale-100"
          leave-to-class="opacity-0 scale-95"
          appear
        >
          <div
            v-if="open"
            ref="dialogEl"
            class="relative w-full overflow-hidden rounded-xl shadow-2xl"
            :class="sizeClass[size ?? 'lg']"
            style="background-color: var(--admin-surface);"
            role="dialog"
            aria-modal="true"
          >
            <!-- Header -->
            <div
              class="flex items-center justify-between border-b px-6 py-4"
              style="border-color: var(--admin-border-subtle);"
            >
              <h3 class="text-base font-semibold" style="color: var(--admin-text);">
                {{ title }}
              </h3>
              <button
                type="button"
                class="rounded-md p-1 transition hover:bg-gray-100"
                style="color: var(--admin-text-muted);"
                aria-label="Đóng"
                @click="close"
              >
                <X class="h-4 w-4" />
              </button>
            </div>

            <!-- Body -->
            <div class="px-6 py-5">
              <slot />
            </div>

            <!-- Footer (optional) -->
            <div
              v-if="$slots.footer"
              class="flex items-center justify-end gap-2 border-t px-6 py-3"
              style="border-color: var(--admin-border-subtle); background-color: var(--admin-surface-sunken);"
            >
              <slot name="footer" />
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
