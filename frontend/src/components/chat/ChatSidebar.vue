<script setup lang="ts">
/**
 * ChatSidebar — sidebar danh sách hội thoại.
 *
 * Wire phần "Tin nhắn" list từ store.conversations.
 * Emit `select` cho parent xử lý navigation.
 */
import { computed, ref } from 'vue'
import { Search, Loader2 } from 'lucide-vue-next'
import { useChatStore } from '@stores/chat'

const props = defineProps<{
  activeId: string | null
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
}>()

const store = useChatStore()

// ===== State =====
const search = ref('')

// ===== Computed =====
const filteredConversations = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return store.conversations
  return store.conversations.filter((c) =>
    (c.peer.fullName ?? '').toLowerCase().includes(q),
  )
})

// ===== Helpers =====
/** HH:mm nếu hôm nay, dd/mm nếu cũ hơn — pattern từ ConversationItem.vue:29-38 */
const timeLabel = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Cắt preview còn tối đa N ký tự + "…" */
const PREVIEW_MAX = 32
const truncatePreview = (text: string): string =>
  text.length <= PREVIEW_MAX ? text : `${text.slice(0, PREVIEW_MAX)}…`

// ===== Actions =====
const onSelect = (id: string): void => emit('select', id)

const onListScroll = (e: Event): void => {
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) {
    void store.fetchMoreConversations()
  }
}
</script>

<template>
  <aside
    class="font-poppins shrink-0 flex-col border-r border-slate-200 bg-white"
    :class="props.activeId ? 'hidden lg:flex lg:w-[340px]' : 'flex w-full flex-1 lg:w-[340px]'"
  >
    <!-- Header title "Tin nhắn" + Unread badge -->
    <div class="flex items-center justify-between px-5 pt-5 pb-2">
      <h2 class="text-base font-bold text-slate-900">
        Tin nhắn
      </h2>

      <span
        v-if="store.totalUnread > 0"
        class="rounded-full bg-blue-500 px-2 py-0.5 text-[11px] font-semibold text-white"
      >
        {{ store.totalUnread > 99 ? '99+' : store.totalUnread }}
      </span>
    </div>

    <!-- Search -->
    <div class="px-5 pb-3">
      <div
        class="flex h-11 items-center gap-3 rounded-xl border border-slate-200 px-4"
      >
        <Search :size="18" class="text-slate-400" />

        <input
          v-model="search"
          type="text"
          placeholder="Tìm kiếm..."
          class="w-full bg-transparent text-sm text-slate-700 border-0 outline-none focus:outline-none focus:ring-0 placeholder:text-slate-400"
        />
      </div>
    </div>

    <!-- Error banner if list fetch failed -->
    <div
      v-if="store.listError"
      class="mx-5 mb-3 flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-600"
    >
      <span class="truncate">{{ store.listError }}</span>

      <button
        type="button"
        class="shrink-0 font-semibold underline hover:text-red-700"
        @click="store.fetchConversations(true)"
      >
        Thử lại
      </button>
    </div>

    <hr class="border-slate-200 mx-5" />

    <!-- Conversations list -->
    <div
      class="scrollbar-hidden flex-1 overflow-y-auto overscroll-contain px-0 py-2"
      @scroll="onListScroll"
    >
      <!-- Skeleton Loading khi tải danh sách lần đầu (Shimmer animation mượt mà) -->
      <div
        v-if="store.loadingList && store.conversations.length === 0"
        class="space-y-1 px-2 py-1"
        aria-label="Đang tải danh sách hội thoại"
      >
        <div
          v-for="i in 5"
          :key="`conv-skel-${i}`"
          class="flex items-center gap-3 rounded-xl p-3"
        >
          <div class="h-11 w-11 shrink-0 rounded-full skeleton-shimmer" />
          <div class="min-w-0 flex-1 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <div class="h-4 w-28 rounded-md skeleton-shimmer" />
              <div class="h-3 w-10 rounded skeleton-shimmer" />
            </div>
            <div class="h-3 w-40 rounded skeleton-shimmer" />
          </div>
        </div>
      </div>

      <p
        v-else-if="filteredConversations.length === 0 && !search"
        class="px-4 py-12 text-center text-sm text-slate-400 animate-in fade-in duration-150"
      >
        Chưa có cuộc hội thoại nào
      </p>

      <p
        v-else-if="filteredConversations.length === 0 && search"
        class="px-4 py-12 text-center text-sm text-slate-400 animate-in fade-in duration-150"
      >
        Không có cuộc hội thoại nào khớp với "{{ search.trim() }}"
      </p>

      <div v-else class="space-y-0.5 px-2">
        <button
          v-for="(conversation, idx) in filteredConversations"
          :key="conversation.id"
          type="button"
          :aria-label="conversation.peer.fullName ?? 'Người dùng'"
          @click="onSelect(conversation.id)"
          class="chat-fade group relative flex w-full items-start gap-3 rounded-xl p-3 text-left transition-all duration-150 ease-out active:scale-[0.99]"
          :style="{ animationDelay: `${Math.min(idx * 35, 210)}ms` }"
          :class="
            props.activeId === conversation.id
              ? 'bg-blue-50/80 shadow-xs'
              : 'hover:bg-slate-50'
          "
        >
          <!-- Active vertical indicator bar -->
          <span
            v-if="props.activeId === conversation.id"
            class="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-blue-600 transition-all duration-200"
            aria-hidden="true"
          />

          <div class="relative shrink-0">
            <img
              v-if="conversation.peer.avatarUrl"
              :src="conversation.peer.avatarUrl"
              :alt="conversation.peer.fullName ?? 'Người dùng'"
              class="h-11 w-11 rounded-full object-cover"
            />

            <img
              v-else
              src="/avatars/peer-default.svg"
              alt="Người dùng"
              class="h-11 w-11 rounded-full object-cover"
            />
          </div>

          <div class="min-w-0 flex-1">
            <div class="mb-1 flex items-center justify-between gap-2">
              <p
                class="truncate text-sm font-semibold transition-colors duration-150"
                :class="props.activeId === conversation.id ? 'text-blue-950 font-bold' : 'text-slate-900 group-hover:text-slate-950'"
              >
                {{ conversation.peer.fullName?.trim() || 'Người dùng' }}
              </p>

              <span
                class="shrink-0 text-[10px] transition-colors"
                :class="props.activeId === conversation.id ? 'text-blue-500 font-medium' : 'text-slate-400'"
              >
                {{ timeLabel(conversation.lastMessageAt) }}
              </span>
            </div>

            <div class="flex items-center justify-between gap-2">
              <p
                class="truncate text-xs transition-colors"
                :class="
                  conversation.unreadCount > 0
                    ? 'font-semibold text-slate-800'
                    : props.activeId === conversation.id
                      ? 'text-slate-600'
                      : 'text-slate-400'
                "
              >
                {{
                  conversation.lastMessagePreview
                    ? truncatePreview(conversation.lastMessagePreview)
                    : 'Chưa có tin nhắn'
                }}
              </p>

              <span
                v-if="conversation.unreadCount > 0"
                class="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[10px] font-semibold text-white shadow-xs animate-in zoom-in-75 duration-150"
              >
                {{ conversation.unreadCount > 99 ? '99+' : conversation.unreadCount }}
              </span>
            </div>
          </div>
        </button>
      </div>

      <div
        v-if="store.loadingList && store.conversations.length > 0"
        class="flex justify-center py-2"
      >
        <Loader2 :size="16" class="animate-spin text-slate-400" />
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* Ẩn thanh cuộn nhưng vẫn cuộn được — cross-browser. */
.scrollbar-hidden {
  scrollbar-width: none;          /* Firefox */
  -ms-overflow-style: none;       /* IE/Edge legacy */
}
.scrollbar-hidden::-webkit-scrollbar {
  display: none;                  /* Chrome/Safari/Opera */
}

/* Hiệu ứng shimmer vệt sáng chạy lướt qua mượt mà */
@keyframes shimmer-sweep {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}
.skeleton-shimmer {
  background: linear-gradient(
    90deg,
    rgba(241, 245, 249, 1) 0%,
    rgba(226, 232, 240, 0.7) 50%,
    rgba(241, 245, 249, 1) 100%
  );
  background-size: 200% 100%;
  animation: shimmer-sweep 1.6s ease-in-out infinite;
}

/* Stagger fade-up khi danh sách xuất hiện (chuẩn CompanyView: 0.35s cubic-bezier(0.22, 1, 0.36, 1)) */
.chat-fade {
  animation: chat-fade-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes chat-fade-up {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  button,
  span,
  img,
  .skeleton-shimmer,
  .chat-fade {
    transition: none !important;
    animation: none !important;
    transform: none !important;
  }
}
</style>
