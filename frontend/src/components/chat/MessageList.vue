<script setup lang="ts">
/**
 * MessageList — scrollable list of messages với load older (scroll-up).
 *
 * Auto-scroll xuống cuối khi có message mới. Load older khi scroll
 * tới đỉnh (cần chat: còn trang tiếp theo).
 *
 * Phase chat_attachments: render ảnh inline trong bubble. Ảnh hiển thị dạng
 * thumbnail (max-w ~200px), nếu >1 ảnh → grid 2 cột. Click → mở lightbox
 * (chỉ plain `<a target="_blank">` cho phase 1; phase 2 có thể làm modal
 * với zoom/swipe).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  Check,
  CheckCheck,
  Download,
  Loader2,
} from 'lucide-vue-next';
import { formatFileSize } from '@services/upload.api';
import { fileIconInfo } from '@utils/fileIcon';
import type { ChatMessage } from '@/types/chat';

const props = defineProps<{
  messages: ChatMessage[];
  currentUserId: string;
  /**
   * Avatar của peer — hiển thị nhỏ ở tin cuối cùng của mình đã được đọc (style
   * Messenger). Null nếu peer chưa set avatar → không render img slot.
   */
  peerAvatar: string | null;
  /**
   * Tên hiển thị của peer — chèn vào empty state ("Hãy bắt đầu cuộc trò
   * chuyện với {name}!") để user biết đang chuẩn bị chat với ai, nhất là khi
   * conversation được mở từ notification/JobDetailView mà user chưa thấy ở
   * sidebar. Null → fallback "ai đó".
   */
  peerName?: string | null;
  hasMore: boolean;
  loading: boolean;
  peerTyping: boolean;
  /**
   * Conversation key (id) — khi đổi conv, force scroll xuống cuối bỏ qua
   * `stickToBottom`. Dùng cho initial load / reload / switch conversation.
   * Nếu không truyền → fallback watch messages.length như cũ.
   */
  scrollKey?: string | null;
}>();

const emit = defineEmits<{
  (e: 'loadMore'): void;
}>();

const scrollEl = ref<HTMLElement | null>(null);
const stickToBottom = ref(true);

/**
 * Track xem đã scroll initial cho conversation hiện tại chưa. Khi conversation
 * đổi → reset flag → watcher messages.length sẽ scroll khi messages populate
 * (length 0 → N).
 *
 * Vấn đề trước đây: watcher fire ngay khi mount (immediate), scrollToBottom
 * chạy khi messages.length === 0 → scrollHeight = 0 (chỉ loading spinner) →
 * scroll về 0 → khi messages load sau, scroll không auto-reset vì
 * stickToBottom = distance(0 - 0 - 0) < 100 = true nhưng scrollToBottom đã
 * chạy với vị trí sai trước đó.
 *
 * Fix: chỉ scroll khi messages.length > 0 (i.e. đã load xong).
 */
const initialScrolledFor = ref<string | null>(null);

/**
 * Scroll xuống cuối. `instant=true` dùng cho initial load (reload / deep-link /
 * đổi conversation) — instant jump thay vì animate, tránh smooth-scroll kẹt ở
 * giữa khi scrollHeight tăng trong lúc animation chạy (images load, layout
 * settle). `instant=false` cho realtime append (UX mượt).
 */
const scrollToBottom = async (instant = false): Promise<void> => {
  await nextTick();
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  if (!scrollEl.value) return;
  scrollEl.value.scrollTo({
    top: scrollEl.value.scrollHeight,
    behavior: instant ? 'auto' : 'smooth',
  });
};

/**
 * ResizeObserver trên scrollEl — bắt MỌI content height change (image load,
 * date separator thêm vào, peerTyping dots xuất hiện, ...) và auto-scroll lại
 * nếu user đang ở cuối. Đây là safety net cho initial load: dù scrollToBottom
 * chạy trước khi images load xong → scrollHeight tăng sau → ResizeObserver
 * catch và scroll lại về bottom. Cleanup khi unmount.
 */
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return;
  const el = scrollEl.value;
  if (!el) return;
  resizeObserver = new ResizeObserver(() => {
    if (!stickToBottom.value || !el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
  });
  resizeObserver.observe(el);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

/**
 * Watch (scrollKey, messages.length) cùng lúc — đây là single source of truth
 * cho "khi nào cần force-scroll":
 *   - Đổi conversation (scrollKey khác) → reset flag, chờ messages populate.
 *   - Messages populate lần đầu cho conv này → smooth scroll xuống cuối.
 *   - Tin nhắn MỚI từ mình gửi → INSTANT scroll xuống cuối (force, kể cả
 *     user đang scroll lên đọc history).
 *   - Tin nhắn MỚI từ peer + user đang ở cuối → smooth scroll.
 */
const lastMessageId = ref<string | null>(null);

watch(
  () => [props.scrollKey, props.messages.length] as const,
  async ([key, len]) => {
    if (!key) return;
    // Đổi conversation → reset, chờ messages load
    if (key !== initialScrolledFor.value) {
      stickToBottom.value = true;
      initialScrolledFor.value = key;
      lastMessageId.value = null;
      return; // Đợi watcher fire lần kế (khi len > 0)
    }
    if (len === 0) return;

    const last = props.messages[props.messages.length - 1];
    const isNewMsg = last && last.id !== lastMessageId.value;

    // Tin nhắn mới từ MÌNH gửi → force scroll xuống cuối (smooth), kể cả
    // user đang ở trên đọc history — UX "đã gửi thì phải thấy".
    if (isNewMsg && last.senderId === props.currentUserId) {
      lastMessageId.value = last.id;
      stickToBottom.value = true;
      await scrollToBottom(false);
      return;
    }

    // Initial load (lastMessageId null) HOẶC tin từ peer + ở cuối → smooth.
    if (isNewMsg) lastMessageId.value = last.id;
    if (stickToBottom.value) {
      await scrollToBottom(false);
    }
  },
  { immediate: true },
);

/**
 * Watch peerTyping — khi peer bắt đầu/dừng gõ, scroll container thay đổi
 * scrollHeight (typing dots xuất hiện/biến mất ở cuối). Nếu user đang ở cuối
 * (stickToBottom=true), phải scroll lại để dots visible — không thì dots
 * render ở dưới viewport và bị MessageInput che.
 */
watch(
  () => props.peerTyping,
  () => {
    if (stickToBottom.value) void scrollToBottom(false);
  },
);

/** Detect user có ở gần đáy không — nếu có thì stick to bottom. */
const onScroll = (): void => {
  const el = scrollEl.value;
  if (!el) return;
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  stickToBottom.value = distance < 100;

  // Scroll lên đỉnh → load older
  if (el.scrollTop < 50 && props.hasMore && !props.loading) {
    emit('loadMore');
  }
};

/** Format HH:mm cho message. */
const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * Tooltip cho icon "đã xem" — hiển thị giờ peer đọc tới message này (giờ local).
 * Pattern: Messenger/Telegram đều show "Seen HH:mm" khi hover vào ✓✓.
 */
const readTooltip = (readAt: string | null): string => {
  if (!readAt) return '';
  const t = fmtTime(readAt);
  return `Đã xem lúc ${t}`;
};

/**
 * ID của message cuối cùng (mới nhất theo thời gian) của mình đã được peer đọc.
 * Avatar peer chỉ hiện ở message này — Messenger/Telegram đều dùng pattern
 * này: avatar peer đứng ngay dưới/gần message cuối mình gửi mà peer đã seen,
 * tạo cảm giác "seen here" thay vì hiện avatar ở mọi own message đã đọc
 * (gây nhiễu khi user scroll lên đọc lịch sử).
 */
const lastOwnReadId = computed<string | null>(() => {
  const me = props.currentUserId;
  if (!me) return null;
  for (let i = props.messages.length - 1; i >= 0; i--) {
    const m = props.messages[i];
    if (m.senderId === me && m.readAt) return m.id;
  }
  return null;
});

/** Render nội dung an toàn (escape HTML cơ bản). */
const safe = (s: string): string => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/\n/g, '<br>');

/** Nhóm messages theo ngày cho header "Hôm nay", "Hôm qua", ... */
const grouped = computed(() => {
  const groups: { date: string; items: ChatMessage[] }[] = [];
  let current = '';
  for (const m of props.messages) {
    const day = new Date(m.createdAt).toDateString();
    if (day !== current) {
      groups.push({ date: day, items: [m] });
      current = day;
    } else {
      groups[groups.length - 1].items.push(m);
    }
  }
  return groups;
});

/**
 * Helper: lọc attachment theo kind. Attachment không có `kind` được coi như
 * image (legacy data phase 1 chỉ có ảnh).
 */
const imageAttachments = (atts: ChatMessage['attachments']) =>
  (atts ?? []).filter((a) => a.kind !== 'file' && a.mime.startsWith('image/'));

const fileAttachments = (atts: ChatMessage['attachments']) =>
  (atts ?? []).filter((a) => a.kind === 'file' || !a.mime.startsWith('image/'));

/**
 * Map MIME → icon + màu + label. Centralized ở utils/fileIcon để MessageInput
 * (preview) và MessageList (render) dùng chung → đồng bộ visual.
 */
const fileIcon = (mime: string, name?: string | null) => fileIconInfo(mime, name);

/** Lấy tên file từ URL MinIO (fallback khi `att.name` không có). */
const filenameFromUrl = (url: string): string => {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop() ?? '';
    // Key format: {uuid}-{safeName}.{ext} → strip uuid prefix + extension
    const noExt = last.replace(/\.[^.]+$/, '');
    return noExt.replace(/^[0-9a-f-]{36}-/, '') || last;
  } catch {
    return url;
  }
};
</script>

<template>
  <div
    ref="scrollEl"
    class="flex-1 overflow-y-auto scrollbar-visible px-4 py-3 space-y-1.5 bg-gray-50"
    @scroll="onScroll"
  >
    <div v-if="loading && messages.length === 0" class="flex justify-center py-12">
      <Loader2 class="w-6 h-6 animate-spin text-gray-400" />
    </div>

    <p v-else-if="messages.length === 0" class="text-center text-gray-400 py-12 text-sm">
      Chưa có tin nhắn nào. Hãy bắt đầu cuộc trò chuyện
      <span v-if="peerName" class="text-gray-600 font-medium">với {{ peerName }}</span>
      <span v-else>!</span>
    </p>

    <div v-if="hasMore && messages.length > 0 && !loading" class="text-center">
      <button class="text-xs text-primary-600 hover:underline" @click="$emit('loadMore')">
        Tải tin cũ hơn
      </button>
    </div>
    <div v-if="loading && hasMore" class="flex justify-center">
      <Loader2 class="w-4 h-4 animate-spin text-gray-400" />
    </div>

    <template v-for="group in grouped" :key="group.date">
      <div class="flex items-center justify-center my-1">
        <span class="px-2 py-0.5 text-[10px] text-gray-500 bg-white rounded-full border border-gray-200">
          {{ group.date === new Date().toDateString() ? 'Hôm nay' : group.date }}
        </span>
      </div>
      <div
        v-for="m in group.items"
        :key="m.id"
        class="flex"
        :class="m.senderId === currentUserId ? 'justify-end' : 'justify-start'"
      >
        <div
          class="max-w-[70%] px-2.5 py-1.5 rounded-xl text-[13px] leading-snug shadow-sm"
          :class="m.senderId === currentUserId
            ? 'bg-blue-600 text-white rounded-br-md'
            : 'bg-white text-gray-800 border border-gray-200 rounded-bl-md'"
        >
          <!--
            Attachments block — render TRƯỚC content text.
            - Ảnh: grid 1 hoặc 2 cột (nếu >1 ảnh). Click mở tab mới.
            - File (PDF/DOCX/...): card với icon MIME + tên + size + nút tải.
            Phase 2: thêm lightbox với zoom/swipe cho ảnh.
          -->
          <div
            v-if="m.attachments && m.attachments.length > 0"
            class="mb-1.5 space-y-1"
          >
            <!-- Ảnh: grid (1 cột nếu 1 ảnh, 2 cột nếu nhiều) -->
            <div
              v-if="imageAttachments(m.attachments).length > 0"
              class="grid gap-1"
              :class="imageAttachments(m.attachments).length === 1 ? 'grid-cols-1' : 'grid-cols-2'"
            >
              <a
                v-for="(att, idx) in imageAttachments(m.attachments)"
                :key="`img-${idx}`"
                :href="att.url"
                target="_blank"
                rel="noopener noreferrer"
                class="block rounded-md overflow-hidden bg-gray-100 max-w-[200px] max-h-[200px] hover:opacity-90 transition"
                :title="att.mime"
              >
                <img
                  :src="att.url"
                  :alt="att.mime"
                  class="w-full h-full object-cover max-h-[200px]"
                  loading="lazy"
                />
              </a>
            </div>

            <!-- File non-image: danh sách card dọc -->
            <div
              v-if="fileAttachments(m.attachments).length > 0"
              class="space-y-1"
            >
              <a
                v-for="(att, idx) in fileAttachments(m.attachments)"
                :key="`file-${idx}`"
                :href="att.url"
                :download="att.name ?? true"
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-2 px-2.5 py-1.5 rounded-md border transition"
                :class="m.senderId === currentUserId
                  ? 'bg-blue-700/30 border-blue-500/40 hover:bg-blue-700/50 text-white'
                  : 'bg-gray-50 border-gray-200 hover:bg-gray-100 text-gray-800'"
                :title="`Tải ${att.name ?? att.mime}`"
              >
                <component
                  :is="fileIcon(att.mime, att.name).icon"
                  class="w-4 h-4 shrink-0"
                  :class="fileIcon(att.mime, att.name).color"
                />
                <span class="flex-1 min-w-0 truncate text-[12px] font-medium">
                  {{ att.name ?? filenameFromUrl(att.url) }}
                </span>
                <span
                  class="shrink-0 text-[10px]"
                  :class="m.senderId === currentUserId ? 'text-blue-100' : 'text-gray-500'"
                >
                  {{ formatFileSize(att.sizeBytes) }}
                </span>
                <Download class="w-3.5 h-3.5 shrink-0" :class="m.senderId === currentUserId ? 'text-white' : 'text-gray-400'" />
              </a>
            </div>
          </div>
          <div v-if="m.content" class="break-words" v-html="safe(m.content)" />
          <div
            class="mt-0.5 flex items-center justify-end gap-1 text-[10px] font-mono"
            :class="m.senderId === currentUserId ? 'text-blue-100' : 'text-gray-400'"
          >
            <span>{{ fmtTime(m.createdAt) }}</span>
            <!--
              Read receipt chỉ hiện trên message của mình (senderId === currentUserId).
              ✓         = đã gửi (chưa đọc)
              ✓✓ xanh    = đã xem (readAt được set bởi peer qua chat:read)
              Tooltip trên ✓✓: "Đã xem lúc HH:mm" — bám theo pattern Messenger/Telegram.
            -->
            <Check
              v-if="m.senderId === currentUserId && !m.readAt"
              class="h-3.5 w-3.5 -mr-0.5 inline-block"
              aria-label="Đã gửi"
            />
            <span
              v-else-if="m.senderId === currentUserId && m.readAt"
              :title="readTooltip(m.readAt)"
              class="inline-flex items-center -mr-0.5 cursor-default"
              :aria-label="readTooltip(m.readAt)"
            >
              <CheckCheck
                class="h-4 w-4 text-blue-100"
                aria-hidden="true"
              />
              <!--
                Avatar peer — chỉ render ở TIN CUỐI CÙNG của mình đã được đọc.
                Style Messenger: avatar 14px, tròn, nằm sau ✓✓ trên cùng hàng
                với time + tick. Nếu peer chưa set avatar → không render
                để tránh ô trống.
              -->
              <img
                v-if="peerAvatar && m.id === lastOwnReadId"
                :src="peerAvatar"
                :alt="readTooltip(m.readAt)"
                class="ml-1 h-3.5 w-3.5 rounded-full object-cover ring-1 ring-white"
              />
            </span>
          </div>
        </div>
      </div>
    </template>

    <div v-if="peerTyping" class="flex justify-start">
      <div class="px-2.5 py-1.5 bg-white border border-gray-200 rounded-xl rounded-bl-md">
        <div class="flex gap-1">
          <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0ms" />
          <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 150ms" />
          <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 300ms" />
        </div>
      </div>
    </div>
  </div>
</template>