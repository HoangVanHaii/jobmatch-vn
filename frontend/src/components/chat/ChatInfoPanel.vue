<script setup lang="ts">
/**
 * ChatInfoPanel — right panel thông tin hội thoại.
 *
 * Hiển thị:
 *   - Header "Thông tin hội thoại"
 *   - Avatar + tên peer (wire từ store.activeConversation?.peer)
 *   - Images grid (8 items preview, View All toggle) — wire từ chatApi.listAttachments
 *   - Files list (3 items preview, View All toggle) — wire từ chatApi.listAttachments
 *
 * Self-contained: tự fetch attachments khi conversation đổi hoặc panel mở.
 */
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { Loader2, ChevronRight, X } from 'lucide-vue-next'
import { chatApi } from '@services/chat.api'
import { formatFileSize } from '@services/upload.api'
import { fileIconInfo } from '@utils/fileIcon'
import { useChatStore } from '@stores/chat'
import type { ChatAttachmentWithContext, PeerRole } from '@/types/chat'

const props = withDefaults(
  defineProps<{
    /** Conversation id đang active; null nếu chưa chọn */
    conversationId: string | null
    /** Trạng thái mở panel (mặc định true) */
    isOpen?: boolean
  }>(),
  {
    isOpen: true,
  },
)

const emit = defineEmits<{
  (e: 'close'): void
}>()

const closeBtnEl = ref<HTMLButtonElement | null>(null)

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape' && props.isOpen) emit('close')
}

let prevBodyOverflow = ''
const isBelowXl = (): boolean => typeof window !== 'undefined' && window.innerWidth < 1280

watch(
  () => props.isOpen,
  (open) => {
    if (isBelowXl()) {
      if (open) {
        prevBodyOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        void nextTick(() => {
          closeBtnEl.value?.focus()
        })
      } else if (prevBodyOverflow !== undefined) {
        document.body.style.overflow = prevBodyOverflow
      }
    }
  },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  if (props.isOpen && isBelowXl()) {
    prevBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    void nextTick(() => {
      closeBtnEl.value?.focus()
    })
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (isBelowXl() && prevBodyOverflow !== undefined) {
    document.body.style.overflow = prevBodyOverflow
  }
})

// ===== State =====
const images = ref<ChatAttachmentWithContext[]>([])
const fileAttachments = ref<ChatAttachmentWithContext[]>([])
const loadingMedia = ref(false)
const mediaError = ref<string | null>(null)
const showAllImages = ref(false)
const showAllFiles = ref(false)

// Lấy peer từ store (cần thiết cho avatar + name + role)
const store = useChatStore()
const peer = computed(() => store.activeConversation?.peer ?? null)

const roleLabel = (role: PeerRole): string => {
  if (role === 'employer') return 'Nhà tuyển dụng'
  if (role === 'admin') return 'Quản trị viên'
  return 'Ứng viên'
}

// ===== Helpers =====
const fileIcon = (mime: string, name?: string | null) => fileIconInfo(mime, name)

const filenameFromUrl = (url: string): string => {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').pop() ?? ''
    const noExt = last.replace(/\.[^.]+$/, '')
    return noExt.replace(/^[0-9a-f-]{36}-/, '') || last
  } catch {
    return url
  }
}

/**
 * Map `fileIconInfo().color` (Tailwind text class) → bg class.
 * Static map để tránh Tailwind purge risk với dynamic composition.
 */
const FILE_ICON_BG: Record<string, string> = {
  'text-red-500': 'bg-red-50',
  'text-blue-500': 'bg-blue-50',
  'text-emerald-500': 'bg-emerald-50',
  'text-orange-500': 'bg-orange-50',
  'text-yellow-500': 'bg-yellow-50',
  'text-amber-500': 'bg-amber-50',
  'text-gray-500': 'bg-slate-100',
}
const bgForColor = (color: string): string =>
  FILE_ICON_BG[color] ?? 'bg-slate-100'

// ===== Fetch =====
const fetchMedia = async (): Promise<void> => {
  const id = props.conversationId
  if (!id) {
    images.value = []
    fileAttachments.value = []
    return
  }
  loadingMedia.value = true
  mediaError.value = null
  try {
    const [imgRes, fileRes] = await Promise.all([
      chatApi.listAttachments(id, { kind: 'image' }),
      chatApi.listAttachments(id, { kind: 'file' }),
    ])
    images.value = imgRes.data.data.items
    fileAttachments.value = fileRes.data.data.items
  } catch (e: unknown) {
    mediaError.value = e instanceof Error ? e.message : 'Không tải được ảnh & file'
  } finally {
    loadingMedia.value = false
  }
}

// Reset toggle và fetch media khi đổi conv hoặc khi mở panel
watch(
  () => [props.conversationId, props.isOpen],
  ([convId, open]) => {
    if (open && convId) {
      showAllImages.value = false
      showAllFiles.value = false
      void fetchMedia()
    }
  },
  { immediate: true },
)
</script>

<template>
  <div>
    <!-- Backdrop mờ (dành cho mobile/tablet khi panel mở toàn phần) -->
    <div
      v-if="props.isOpen"
      class="fixed inset-0 z-30 bg-black/25 backdrop-blur-xs transition-opacity duration-200 xl:hidden"
      aria-hidden="true"
      @click="emit('close')"
    />

    <!-- Panel dạng overlay position absolute + translateX trên cả desktop và mobile (0 reflow, không co giãn khung chat) -->
    <aside
      role="dialog"
      aria-modal="true"
      aria-label="Thông tin hội thoại"
      class="font-poppins absolute inset-y-0 right-0 z-30 flex h-full w-80 max-w-[85vw] flex-col border-l border-slate-200 bg-white shadow-xl transition-all duration-200 ease-out"
      :class="
        props.isOpen
          ? 'translate-x-0 opacity-100'
          : 'translate-x-full opacity-0 pointer-events-none'
      "
    >
      <!-- Title + Close button (hiển thị trên cả desktop và mobile để đóng) -->
      <div class="flex items-center justify-between border-b border-slate-200 px-6 py-5">
        <h2 class="text-sm font-semibold text-slate-900">
          Thông tin hội thoại
        </h2>

        <button
          ref="closeBtnEl"
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition active:scale-95"
          aria-label="Đóng"
          @click="emit('close')"
        >
          <X :size="18" />
        </button>
      </div>

    <div class="panel-scroll flex-1 overflow-y-auto px-6 py-5">
      <!-- Avatar + name (wire to peer) -->
      <div class="mb-5 flex flex-col items-center text-center">
        <img
          v-if="peer?.avatarUrl"
          :src="peer.avatarUrl"
          :alt="peer.fullName ?? 'Người dùng'"
          class="mb-3 h-20 w-20 rounded-full object-cover"
        />

        <img
          v-else
          src="/avatars/peer-default.svg"
          alt="Người dùng"
          class="mb-3 h-20 w-20 rounded-full object-cover"
        />

        <h3
          class="max-w-full truncate px-2 text-base font-semibold text-slate-900"
          :title="conversationId ? (peer?.fullName?.trim() || 'Người dùng') : 'Chưa chọn hội thoại'"
        >
          {{
            conversationId
              ? (peer?.fullName?.trim() || 'Người dùng')
              : 'Chưa chọn hội thoại'
          }}
        </h3>

        <p
          v-if="peer"
          class="mt-1 text-xs text-slate-400"
        >
          {{ roleLabel(peer.role) }}
        </p>
      </div>

      <!-- Loading state -->
      <div
        v-if="loadingMedia && images.length === 0 && fileAttachments.length === 0"
        class="flex justify-center py-12"
      >
        <Loader2 class="h-6 w-6 animate-spin text-slate-400" />
      </div>

      <p
        v-else-if="mediaError"
        class="py-12 text-center text-sm text-red-500"
      >
        {{ mediaError }}
      </p>

      <template v-else>
        <!-- Images — WIRED -->
        <div class="mb-6">
          <div class="mb-3 flex items-center justify-between">
            <h4 class="text-sm font-semibold text-slate-900">
              Hình ảnh
            </h4>

            <button
              class="flex items-center gap-1 text-xs text-blue-500 disabled:cursor-default disabled:opacity-50"
              :disabled="images.length <= 8"
              :aria-label="showAllImages ? 'Thu gọn' : 'Xem tất cả'"
              @click="showAllImages = !showAllImages"
            >
              {{ showAllImages ? 'Thu gọn' : 'Xem tất cả' }}

              <ChevronRight
                :size="14"
                :class="showAllImages ? 'rotate-90' : ''"
              />
            </button>
          </div>

          <p
            v-if="images.length === 0"
            class="py-6 text-center text-xs text-slate-400"
          >
            Chưa có ảnh nào trong cuộc trò chuyện này
          </p>

          <div v-else class="grid grid-cols-4 gap-2">
            <a
              v-for="att in (showAllImages ? images : images.slice(0, 8))"
              :key="att.messageId + att.url"
              :href="att.url"
              target="_blank"
              rel="noopener noreferrer"
              class="block aspect-square overflow-hidden rounded-lg bg-slate-200 transition hover:opacity-90"
              :title="att.name ?? att.mime"
            >
              <img
                :src="att.url"
                :alt="att.name ?? att.mime"
                class="aspect-square h-full w-full rounded-lg object-cover"
                loading="lazy"
              />
            </a>
          </div>
        </div>

        <!-- Files — WIRED -->
        <div class="mb-6">
          <div class="mb-3 flex items-center justify-between">
            <h4 class="text-sm font-semibold text-slate-900">
              Tệp đính kèm
            </h4>

            <button
              class="flex items-center gap-1 text-xs text-blue-500 disabled:cursor-default disabled:opacity-50"
              :disabled="fileAttachments.length <= 3"
              :aria-label="showAllFiles ? 'Thu gọn' : 'Xem tất cả'"
              @click="showAllFiles = !showAllFiles"
            >
              {{ showAllFiles ? 'Thu gọn' : 'Xem tất cả' }}

              <ChevronRight
                :size="14"
                :class="showAllFiles ? 'rotate-90' : ''"
              />
            </button>
          </div>

          <p
            v-if="fileAttachments.length === 0"
            class="py-6 text-center text-xs text-slate-400"
          >
            Chưa có file nào trong cuộc trò chuyện này
          </p>

          <div v-else class="space-y-3">
            <div
              v-for="att in (showAllFiles ? fileAttachments : fileAttachments.slice(0, 3))"
              :key="att.messageId + att.url"
              class="flex items-center gap-3"
            >
              <div
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                :class="bgForColor(fileIcon(att.mime, att.name).color)"
              >
                <component
                  :is="fileIcon(att.mime, att.name).icon"
                  :size="18"
                  :class="fileIcon(att.mime, att.name).color"
                />
              </div>

              <div class="min-w-0">
                <a
                  :href="att.url"
                  :download="att.name ?? true"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="block truncate text-sm font-medium text-slate-900 hover:text-blue-500"
                  :title="att.name ?? att.mime"
                >
                  {{ att.name ?? filenameFromUrl(att.url) }}
                </a>

                <p class="text-[11px] text-slate-400">
                  {{ formatFileSize(att.sizeBytes) }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </aside>
  </div>
</template>

<style scoped>
/* Thanh cuộn mỏng cho panel body. */
.panel-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgb(203 213 225) transparent;
}
.panel-scroll::-webkit-scrollbar {
  width: 6px;
}
.panel-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.panel-scroll::-webkit-scrollbar-thumb {
  background-color: rgb(203 213 225);
  border-radius: 3px;
}
.panel-scroll::-webkit-scrollbar-thumb:hover {
  background-color: rgb(148 163 184);
}

@media (prefers-reduced-motion: reduce) {
  .chat-info-panel-root,
  aside {
    transition: none !important;
  }
}
</style>
