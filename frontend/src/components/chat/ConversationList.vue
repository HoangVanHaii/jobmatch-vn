<script setup lang="ts">
/**
 * ConversationList — sidebar trái: search + list conversation HOẶC search results.
 *
 * Search behavior:
 *   - Khi input rỗng → render conversation list bình thường (ConversationItem).
 *   - Khi input có text (≥2 chars) → debounce 300ms, gọi GET /users/search?q=...,
 *     render kết quả search (UserSearchResult) thay vì conversation list.
 *   - AbortSignal được gắn vào request; nếu user gõ tiếp trước khi response
 *     về, request cũ bị cancel → tránh race + flicker.
 *
 *   Click 1 search result → emit 'select-peer' (peerId + peer) để parent
 *   (ChatView) gọi chatStore.createOrGet rồi navigate tới /chat/:conversationId.
 *
 * Lấy data conversation từ chatStore + search users qua userApi.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useChatStore } from '@stores/chat';
import { userApi } from '@services/user.api';
import type { UserSearchResult } from '@services/user.api';
import ConversationItem from './ConversationItem.vue';
import { Search, Loader2, MessageCircle, UserPlus, Briefcase } from 'lucide-vue-next';
import { useDebounceFn } from '@vueuse/core';

const props = defineProps<{
  activeId: string | null;
}>();

const emit = defineEmits<{
  /** Click 1 conversation cũ — truyền conversationId. */
  (e: 'select', id: string): void;
  /**
   * Click 1 search result — peer chưa từng chat.
   * Parent gọi chatStore.createOrGet(peerUserId) → navigate /chat/:id.
   * Truyền cả full peer object để parent upsert cache mà không cần refetch.
   */
  (e: 'select-peer', peer: UserSearchResult): void;
}>();

const store = useChatStore();
const search = ref('');

onMounted(async () => {
  if (store.conversations.length === 0) await store.fetchConversations(true);
});

/* ============================================================================
 * Search logic — fetch /users/search với debounce 300ms + AbortController.
 * ==========================================================================*/

/** Có đang search hay không (search text đã trim ≥ 2 ký tự). */
const isSearching = computed(() => search.value.trim().length >= 2);

/** Kết quả search hiện tại. */
const searchResults = ref<UserSearchResult[]>([]);
const searching = ref(false);
const searchError = ref<string | null>(null);

/** AbortController cho request hiện tại — abort khi user gõ tiếp hoặc unmount. */
let currentAbort: AbortController | null = null;

const cancelInFlight = (): void => {
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }
};

/** Fetch với debounce — mỗi lần input đổi, debounce 300ms rồi mới gọi. */
const runSearch = useDebounceFn(async () => {
  const q = search.value.trim();
  // Nếu không đủ dài (clear input giữa chừng) → reset state, không gọi.
  if (q.length < 2) {
    searchResults.value = [];
    searchError.value = null;
    return;
  }

  cancelInFlight();
  const ac = new AbortController();
  currentAbort = ac;
  searching.value = true;
  searchError.value = null;

  try {
    const { data } = await userApi.search(q, 20, ac.signal);
    // Tránh overwrite nếu user đã clear input trong lúc request chạy.
    if (ac.signal.aborted) return;
    searchResults.value = data.data;
  } catch (e: unknown) {
    // AbortError không phải lỗi thật — bỏ qua.
    if (e instanceof Error && e.name === 'CanceledError') return;
    if (typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'ERR_CANCELED') return;
    searchError.value = e instanceof Error ? e.message : 'Lỗi tìm kiếm';
    searchResults.value = [];
  } finally {
    if (currentAbort === ac) currentAbort = null;
    if (!ac.signal.aborted) searching.value = false;
  }
}, 300);

/** Watch search: gọi debounced search mỗi lần text đổi. */
watch(
  () => search.value,
  () => {
    const q = search.value.trim();
    if (q.length < 2) {
      // Clear → reset state, cancel pending.
      cancelInFlight();
      searchResults.value = [];
      searchError.value = null;
      searching.value = false;
      return;
    }
    void runSearch();
  },
);

/** Cleanup khi component unmount. */
onBeforeUnmount(() => {
  cancelInFlight();
});

const filtered = computed(() => {
  // Khi đang search → không dùng filtered list (results section chiếm chỗ).
  if (isSearching.value) return [];
  const q = search.value.trim().toLowerCase();
  if (!q) return store.conversations;
  return store.conversations.filter((c) =>
    (c.peer.fullName ?? '').toLowerCase().includes(q),
  );
});

/** Click conversation cũ. */
const onSelect = (id: string): void => emit('select', id);

/** Click peer từ search → parent mở/tạo conversation. */
const onSelectPeer = (peer: UserSearchResult): void => emit('select-peer', peer);

const onLoadMore = async (): Promise<void> => {
  await store.fetchMoreConversations();
};

/** Label role cho display. */
const roleLabel = (role: UserSearchResult['role']): string => {
  if (role === 'employer') return 'Nhà tuyển dụng';
  if (role === 'admin') return 'Quản trị viên';
  return 'Ứng viên';
};
</script>

<template>
  <aside
    class="flex h-full min-h-0 w-full flex-col border-r border-gray-200 bg-white md:w-80 lg:w-96 scrollbar-visible"
  >
    <!-- Header -->
    <header class="px-4 py-3 border-b border-gray-100">
      <h2 class="font-semibold text-gray-800 mb-2">Tin nhắn</h2>
      <div class="relative">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          v-model="search"
          type="text"
          placeholder="Tìm người..."
          class="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-primary-400 focus:bg-white"
          aria-label="Tìm người để nhắn tin"
        />
        <!-- Loading indicator nhỏ bên phải search box khi đang fetch. -->
        <Loader2
          v-if="isSearching && searching"
          class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary-500 animate-spin"
        />
      </div>
    </header>

    <!--
      List area:
        - Search mode (q ≥ 2 chars): show SearchResults hoặc empty/error state.
        - Default: show ConversationItem list + Load more.
      Mỗi section v-if chiếm full height; section kia ẩn hoàn toàn.
    -->
    <div class="flex-1 min-h-0 overflow-y-auto">
      <!-- =========== SEARCH RESULTS =========== -->
      <template v-if="isSearching">
        <p class="px-4 pt-2 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
          Kết quả tìm kiếm
        </p>

        <p
          v-if="searching && searchResults.length === 0"
          class="text-center text-gray-400 py-8 text-sm"
        >
          <Loader2 class="w-5 h-5 animate-spin inline mr-1" /> Đang tìm...
        </p>
        <p
          v-else-if="searchError"
          class="text-center text-red-500 py-8 text-sm"
        >
          {{ searchError }}
        </p>
        <p
          v-else-if="!searching && searchResults.length === 0"
          class="text-center text-gray-400 py-12 text-sm"
        >
          <UserPlus class="w-10 h-10 mx-auto mb-2 opacity-50" />
          Không tìm thấy người nào
        </p>

        <!-- Result rows — same visual pattern với ConversationItem nhưng đơn giản hơn
             (không có preview/time/unread) — phân biệt rõ "đây là user chưa chat". -->
        <button
          v-for="peer in searchResults"
          :key="peer.id"
          type="button"
          class="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition text-left hover:bg-primary-50 focus:bg-primary-50 focus:outline-none"
          @click="onSelectPeer(peer)"
        >
          <div class="shrink-0 w-12 h-12 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center">
            <img
              v-if="peer.avatarUrl"
              :src="peer.avatarUrl"
              :alt="peer.fullName ?? ''"
              class="w-full h-full object-cover"
            />
            <img
              v-else
              src="/avatars/peer-default.svg"
              alt=""
              class="w-full h-full object-cover"
            />
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-medium text-gray-900 truncate text-sm">
              {{ peer.fullName ?? 'Người dùng' }}
            </p>
            <p class="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
              <Briefcase v-if="peer.role === 'employer'" class="w-3 h-3" />
              {{ roleLabel(peer.role) }}
            </p>
          </div>
          <span class="shrink-0 text-[10px] text-primary-600 font-medium">Bắt đầu chat</span>
        </button>
      </template>

      <!-- =========== CONVERSATION LIST (default) =========== -->
      <template v-else>
        <p class="px-4 pt-2 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
          Cuộc hội thoại
        </p>
        <div class="px-2 py-2 space-y-1">
          <p
            v-if="store.loadingList && store.conversations.length === 0"
            class="text-center text-gray-400 py-8 text-sm"
          >
            <Loader2 class="w-5 h-5 animate-spin inline mr-1" /> Đang tải...
          </p>
          <p
            v-else-if="filtered.length === 0 && !search"
            class="text-center text-gray-400 py-12 text-sm"
          >
            <MessageCircle class="w-10 h-10 mx-auto mb-2 opacity-50" />
            Chưa có cuộc hội thoại nào
          </p>
          <p
            v-else-if="filtered.length === 0 && search"
            class="text-center text-gray-400 py-12 text-sm"
          >
            Không có cuộc hội thoại nào khớp với "{{ search.trim() }}"
          </p>
          <ConversationItem
            v-for="c in filtered"
            :key="c.id"
            :conversation="c"
            :active="c.id === activeId"
            @click="onSelect"
          />
          <button
            v-if="store.conversationsCursor"
            class="w-full py-2 text-xs text-gray-500 hover:bg-gray-50 rounded"
            :disabled="store.loadingList"
            @click="onLoadMore"
          >
            {{ store.loadingList ? 'Đang tải...' : 'Tải thêm' }}
          </button>
        </div>
      </template>
    </div>
  </aside>
</template>
