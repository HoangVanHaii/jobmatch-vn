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
      <p
        v-if="store.loadingList && store.conversations.length === 0"
        class="flex items-center justify-center gap-2 py-8 text-sm text-slate-400"
      >
        <Loader2 :size="16" class="animate-spin" />

        Đang tải...
      </p>

      <p
        v-else-if="filteredConversations.length === 0 && !search"
        class="px-4 py-12 text-center text-sm text-slate-400"
      >
        Chưa có cuộc hội thoại nào
      </p>

      <p
        v-else-if="filteredConversations.length === 0 && search"
        class="px-4 py-12 text-center text-sm text-slate-400"
      >
        Không có cuộc hội thoại nào khớp với "{{ search.trim() }}"
      </p>

      <button
        v-for="conversation in filteredConversations"
        :key="conversation.id"
        type="button"
        :aria-label="conversation.peer.fullName ?? 'Người dùng'"
        @click="onSelect(conversation.id)"
        class="flex w-full items-start gap-3 p-3 text-left transition"
        :class="
          props.activeId === conversation.id ? 'bg-slate-100' : 'hover:bg-slate-50'
        "
      >
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

          <!-- Chấm xanh online tạm ẩn cho đến khi có presence thật -->
        </div>

        <div class="min-w-0 flex-1">
          <div class="mb-1 flex items-center justify-between gap-2">
            <p class="truncate text-sm font-semibold text-slate-900">
              {{ conversation.peer.fullName?.trim() || 'Người dùng' }}
            </p>

            <span class="shrink-0 text-[10px] text-slate-400">
              {{ timeLabel(conversation.lastMessageAt) }}
            </span>
          </div>

          <div class="flex items-center justify-between gap-2">
            <p
              class="truncate text-xs"
              :class="
                conversation.unreadCount > 0
                  ? 'font-semibold text-slate-700'
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
              class="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[10px] font-semibold text-white"
            >
              {{ conversation.unreadCount > 99 ? '99+' : conversation.unreadCount }}
            </span>
          </div>
        </div>
      </button>

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
</style>
