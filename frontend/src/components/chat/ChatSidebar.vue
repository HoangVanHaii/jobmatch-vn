<script setup lang="ts">
/**
 * MockupChatSidebar — sidebar dùng riêng cho mockup 3-column chat.
 *
 * So với ConversationList.vue (production chat):
 *   - Có thêm "Khám phá" tab + "Đoạn chat mới" button + Groups section (decorative)
 *   - Wire chỉ phần "Tin nhắn" list từ store.conversations
 *   - Emit `select` cho parent xử lý navigation
 */
import { computed, ref } from 'vue'
import { Search, Inbox, Compass, Plus, Loader2 } from 'lucide-vue-next'
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
const activeTab = ref<'inbox' | 'explore'>('inbox')

// Static decoration (no API)
const inboxCount = ref(24)
const exploreCount = ref(10)

const staticGroups = [
  {
    id: 'g-design',
    name: 'Design Team',
    avatar: 'https://i.pravatar.cc/100?img=23',
    lastMessage: 'I will have a look today...',
    time: '1 min',
  },
  {
    id: 'g-hr',
    name: 'Human Resource Department',
    avatar: 'https://i.pravatar.cc/100?img=52',
    lastMessage: 'We just published the...',
    time: '2 mins',
  },
  {
    id: 'g-campaigns',
    name: 'Campaigns',
    avatar: 'https://i.pravatar.cc/100?img=8',
    lastMessage: 'New campaign released!',
    time: '10 mins',
  },
]

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
</script>

<template>
  <aside
    class="font-poppins hidden w-[340px] shrink-0 flex-col border-r border-slate-200 bg-white lg:flex"
  >
    <!-- Search -->
    <div class="px-5 pt-5 pb-3">
      <div
        class="flex h-11 items-center gap-3 rounded-xl border border-slate-200 px-4"
      >
        <Search :size="18" class="text-slate-400" />

        <input
          v-model="search"
          type="text"
          placeholder="Search"
          class="w-full bg-transparent text-sm text-slate-700 border-0 outline-none focus:outline-none focus:ring-0 placeholder:text-slate-400"
        />
      </div>
    </div>

    <!-- Tabs (decorative — no API) -->
    <div class="flex items-center gap-2 px-5 pb-4">
      <button
        @click="activeTab = 'inbox'"
        class="flex h-10 flex-1 items-center justify-center gap-2 rounded-md text-xs font-medium transition"
        :class="
          activeTab === 'inbox'
            ? 'border border-slate-200 bg-white text-slate-900'
            : 'text-slate-500 hover:bg-slate-50'
        "
      >
        <Inbox :size="16" />

        Tin nhắn

        <span
          class="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-semibold text-white"
        >
          {{ inboxCount }}
        </span>
      </button>

      <button
        @click="activeTab = 'explore'"
        class="flex h-10 flex-1 items-center justify-center gap-2 rounded-md text-xs font-medium transition"
        :class="
          activeTab === 'explore'
            ? 'border border-slate-200 bg-white text-slate-900'
            : 'text-slate-500 hover:bg-slate-50'
        "
      >
        <Compass :size="16" />

        Khám phá

        <span
          class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
        >
          {{ exploreCount }}
        </span>
      </button>
    </div>

    <hr class="border-slate-200 mx-5" />

    <!-- Messages — WIRED -->
    <div class="px-5 pb-2 pt-3">
      <h2 class="text-sm font-semibold text-slate-900">
        Tin nhắn
      </h2>
    </div>

    <div class="scrollbar-hidden flex-1 overflow-y-auto px-0 pb-3">
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
        @click="onSelect(conversation.id)"
        class=" flex w-full items-start gap-3 p-3 text-left transition"
        :class="
          props.activeId === conversation.id ? 'bg-slate-100' : 'hover:bg-slate-50'
        "
      >
        <div class="relative shrink-0">
          <img
            v-if="conversation.peer.avatarUrl"
            :src="conversation.peer.avatarUrl"
            class="h-11 w-11 rounded-full object-cover"
          />

          <img
            v-else
            src="/avatars/peer-default.svg"
            alt=""
            class="h-11 w-11 rounded-full object-cover"
          />

          <span
            class="absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500"
          />
        </div>

        <div class="min-w-0 flex-1">
          <div class="mb-1 flex items-center justify-between gap-2">
            <p class="truncate text-sm font-semibold text-slate-900">
              {{ conversation.peer.fullName ?? 'Người dùng' }}
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
