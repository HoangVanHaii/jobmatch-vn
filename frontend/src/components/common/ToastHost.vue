<script setup lang="ts">
/**
 * ToastHost — render global toast queue (useToastStore).
 *
 * Hiển thị ở góc trên-phải (cùng vị trí NotificationBell nhưng thấp hơn 1 chút
 * để không đè bell). Mỗi toast là 1 card:
 *   - Avatar (fallback peer-default.svg nếu null)
 *   - Title + body preview
 *   - Nút close (×)
 *   - Click vào body → gọi onClick (vd navigate /chat/:id)
 *   - Hover → pause auto-dismiss
 *
 * Position fixed z-index cao hơn bell để chồng lên. Slide-in animation từ
 * phải (Tailwind transition utility).
 */
import { MessageCircle, X } from 'lucide-vue-next';
import { useToastStore } from '@stores/toast';

const store = useToastStore();

const onBodyClick = (id: string): void => {
  const t = store.items.find((x) => x.id === id);
  if (!t?.onClick) return;
  t.onClick();
  store.dismiss(id);
};

const onActionClick = (id: string, e: Event): void => {
  e.stopPropagation();
  const t = store.items.find((x) => x.id === id);
  const cb = t?.action?.onClick;
  store.dismiss(id);
  cb?.();
};

const onClose = (id: string, e: Event): void => {
  e.stopPropagation();
  store.dismiss(id);
};

const onMouseEnter = (id: string): void => store.pause(id);
const onMouseLeave = (id: string): void => store.resume(id);
</script>

<template>
  <!-- Container cố định — top-right, dưới NotificationBell (top: ~60px). -->
  <Teleport to="body">
    <div
      v-if="store.items.length > 0"
      class="fixed top-[60px] right-2 z-[60] flex flex-col gap-2 max-w-[calc(100vw-1rem)] pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      <div
        v-for="t in store.items"
        :key="t.id"
        class="pointer-events-auto w-[360px] max-w-full bg-white shadow-2xl rounded-xl border border-gray-200 overflow-hidden transition-all duration-200 ease-out cursor-pointer hover:shadow-3xl hover:border-primary-300"
        role="status"
        @click="onBodyClick(t.id)"
        @mouseenter="onMouseEnter(t.id)"
        @mouseleave="onMouseLeave(t.id)"
      >
        <div class="flex items-start gap-3 p-3">
          <!-- Avatar: peer-default khi null. -->
          <div class="shrink-0 w-10 h-10 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center">
            <img
              v-if="t.avatarUrl"
              :src="t.avatarUrl"
              :alt="t.title"
              class="w-full h-full object-cover"
            />
            <img
              v-else-if="t.variant === 'chat'"
              src="/avatars/peer-default.svg"
              alt=""
              class="w-full h-full object-cover"
            />
            <MessageCircle
              v-else
              class="w-5 h-5 text-primary-500"
            />
          </div>

          <!-- Content -->
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-gray-900 truncate">{{ t.title }}</p>
            <p
              v-if="t.body"
              class="text-xs text-gray-600 mt-0.5 line-clamp-2"
            >{{ t.body }}</p>
            <button
              v-if="t.action?.label"
              type="button"
              class="mt-1.5 text-[11px] font-medium text-primary-600 hover:text-primary-700 hover:underline"
              @click="onActionClick(t.id, $event)"
            >
              {{ t.action.label }}
            </button>
          </div>

          <!-- Close button -->
          <button
            type="button"
            class="shrink-0 -mt-1 -mr-1 p-1 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
            aria-label="Đóng"
            @click="onClose(t.id, $event)"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
