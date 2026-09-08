<script setup lang="ts">
/**
 * ChatMediaPanel — side panel xem ảnh + file đã chia sẻ trong conversation.
 *
 * Mở từ icon FolderOpen trên chat header. Slide từ phải vào (overlay,
 * không push MessageList). 2 tab Images / Files, gom nhóm theo ngày.
 *
 * Flow:
 *   1. User click FolderOpen → parent set `open=true`.
 *   2. Watch `open`: khi vừa mở → fetch song song 2 API (image + file) để
 *      badge count chính xác + switch tab instant.
 *   3. User switch tab → computed `currentItems` đổi → render lại grid/list.
 *   4. ESC / click backdrop / click × → emit update:open=false.
 *
 * Lưu ý UX:
 *   - Body scroll lock khi mở (pattern CreateJobModal.vue).
 *   - Click ảnh → mở tab mới (full size từ MinIO URL).
 *   - Click file → download (anchor `download` attr).
 *   - Không realtime-update nội bộ panel khi có message mới — chỉ refetch
 *     khi user mở lại (open true lần nữa). Tránh spam + scroll jumps.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import { X, Image as ImageIcon, FileText, Loader2 } from 'lucide-vue-next';
import { chatApi } from '@services/chat.api';
import { formatFileSize } from '@services/upload.api';
import { fileIconInfo } from '@utils/fileIcon';
import type { ChatAttachmentWithContext } from '@/types/chat';

type Tab = 'image' | 'file';

const props = defineProps<{
  open: boolean;
  conversationId: string;
  currentUserId: string;
}>();

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void;
}>();

const activeTab = ref<Tab>('image');
const images = ref<ChatAttachmentWithContext[]>([]);
const files = ref<ChatAttachmentWithContext[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

/** Lock body scroll khi panel mở — pattern CreateJobModal.vue. */
const lockScroll = (): void => {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = 'hidden';
};
const unlockScroll = (): void => {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = '';
};

/** ESC đóng panel — pattern CreateJobModal.vue. */
const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape' && props.open) {
    close();
  }
};

/**
 * Watch `open`: lock scroll + ESC khi mở, unlock khi đóng. Khi vừa mở
 * (false → true) → fetch cả 2 tab. Nếu đã có data rồi thì không fetch lại
 * (đỡ spam khi user close + open liên tục).
 */
watch(
  () => props.open,
  async (open) => {
    if (open) {
      lockScroll();
      document.addEventListener('keydown', onKeydown);
      if (images.value.length === 0 && files.value.length === 0) {
        await fetchAll();
      }
    } else {
      unlockScroll();
      document.removeEventListener('keydown', onKeydown);
    }
  },
);

onBeforeUnmount(() => {
  unlockScroll();
  document.removeEventListener('keydown', onKeydown);
});

/**
 * Fetch song song 2 API (image + file) — Promise.all để spinner hiện 1 lần
 * và chỉ dismiss khi cả 2 xong. Lỗi của 1 bên không block bên kia — render
 * từng tab với state riêng.
 */
const fetchAll = async (): Promise<void> => {
  loading.value = true;
  error.value = null;
  try {
    const [imgRes, fileRes] = await Promise.all([
      chatApi.listAttachments(props.conversationId, { kind: 'image' }),
      chatApi.listAttachments(props.conversationId, { kind: 'file' }),
    ]);
    images.value = imgRes.data.data.items;
    files.value = fileRes.data.data.items;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Không tải được ảnh & file';
  } finally {
    loading.value = false;
  }
};

const close = (): void => emit('update:open', false);

/** Items hiện tại theo tab. */
const currentItems = computed<ChatAttachmentWithContext[]>(() =>
  activeTab.value === 'image' ? images.value : files.value,
);

/**
 * Group items theo ngày (local day). Mỗi nhóm render header + grid/list.
 * Sort trong nhóm giữ nguyên thứ tự từ BE (DESC theo createdAt).
 *
 * Label: "Hôm nay", "Hôm qua", hoặc "DD/MM/YYYY" cho ngày cũ hơn (vi locale).
 */
const grouped = computed<{ label: string; items: ChatAttachmentWithContext[] }[]>(() => {
  const groups: { key: string; label: string; items: ChatAttachmentWithContext[] }[] = [];
  for (const att of currentItems.value) {
    const d = dayjs(att.createdAt);
    const key = d.format('YYYY-MM-DD');
    let label: string;
    if (key === dayjs().format('YYYY-MM-DD')) label = 'Hôm nay';
    else if (key === dayjs().subtract(1, 'day').format('YYYY-MM-DD')) label = 'Hôm qua';
    else label = d.format('DD/MM/YYYY');
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(att);
    else groups.push({ key, label, items: [att] });
  }
  return groups.map(({ key, label, items }) => ({ label, items }));
});

/** Reuse fileIcon helper từ MessageList để đồng bộ visual. */
const fileIcon = (mime: string, name?: string | null) => fileIconInfo(mime, name);

/**
 * Fallback filename từ URL khi `att.name` null/undefined — copy pattern
 * từ MessageList.vue để đồng bộ.
 */
const filenameFromUrl = (url: string): string => {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop() ?? '';
    const noExt = last.replace(/\.[^.]+$/, '');
    return noExt.replace(/^[0-9a-f-]{36}-/, '') || last;
  } catch {
    return url;
  }
};

const tabButtonClass = (tab: Tab): string =>
  activeTab.value === tab
    ? 'bg-slate-900 text-white shadow-sm'
    : 'text-slate-500 hover:text-slate-800 hover:bg-white/70';
</script>

<template>
  <Teleport to="body">
    <Transition name="slide">
      <div
        v-if="open"
        class="fixed inset-y-0 right-0 w-full sm:w-[420px] z-40"
        role="dialog"
        aria-modal="true"
        aria-label="Ảnh và file đã chia sẻ"
      >
        <!--
          Backdrop — phủ toàn màn hình. Click để đóng. Mobile: vẫn có
          backdrop; desktop: optional, nhưng cho nhất quán UX.
        -->
        <div
          class="absolute inset-0 bg-black/30"
          aria-hidden="true"
          @click="close"
        />

        <!-- Panel — fixed right, shadow + flex column -->
        <aside
          class="absolute right-0 top-0 h-full w-full sm:w-[420px] bg-white shadow-xl flex flex-col"
          @mousedown.stop
        >
          <!-- Header -->
          <header class="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <h2 class="font-semibold text-gray-900">Ảnh &amp; File</h2>
            <button
              type="button"
              class="w-8 h-8 rounded-full inline-flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition"
              aria-label="Đóng"
              title="Đóng (ESC)"
              @click="close"
            >
              <X class="w-4 h-4" />
            </button>
          </header>

          <!--
            Segmented tabs — pattern MyResumesView.vue:633-659 (slate-100 bg +
            slate-900 active). Count badge trên label để user biết có bao
            nhiêu ảnh/file trước khi switch.
          -->
          <div class="shrink-0 px-4 pt-3 pb-2 border-b border-gray-100">
            <div class="tabs-scroll flex w-full bg-slate-100/70 rounded-xl p-1" role="tablist">
              <button
                type="button"
                role="tab"
                :aria-selected="activeTab === 'image'"
                class="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition"
                :class="tabButtonClass('image')"
                @click="activeTab = 'image'"
              >
                <ImageIcon class="w-4 h-4" />
                <span>Ảnh</span>
                <span class="text-[11px] opacity-70">({{ images.length }})</span>
              </button>
              <button
                type="button"
                role="tab"
                :aria-selected="activeTab === 'file'"
                class="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition"
                :class="tabButtonClass('file')"
                @click="activeTab = 'file'"
              >
                <FileText class="w-4 h-4" />
                <span>File</span>
                <span class="text-[11px] opacity-70">({{ files.length }})</span>
              </button>
            </div>
          </div>

          <!-- Body — scrollable list -->
          <div class="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4 bg-gray-50">
            <!-- Loading: 1 lần khi mở panel, dismiss khi fetch xong -->
            <div v-if="loading" class="flex justify-center py-12">
              <Loader2 class="w-6 h-6 animate-spin text-gray-400" />
            </div>

            <!-- Error -->
            <p v-else-if="error" class="text-center text-red-500 py-12 text-sm">
              {{ error }}
            </p>

            <!-- Empty state cho tab hiện tại -->
            <p
              v-else-if="currentItems.length === 0"
              class="text-center text-gray-400 py-12 text-sm"
            >
              {{
                activeTab === 'image'
                  ? 'Chưa có ảnh nào trong cuộc trò chuyện này'
                  : 'Chưa có file nào trong cuộc trò chuyện này'
              }}
            </p>

            <!--
              Data: render group theo ngày. Mỗi group có header + grid/list.
              Key = messageId + url để tránh duplicate nếu 1 message có nhiều
              attachments cùng URL (hiếm nhưng possible nếu upload retry).
            -->
            <template v-else>
              <section v-for="group in grouped" :key="group.label">
                <h3 class="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  {{ group.label }}
                </h3>

                <!--
                  Images: grid 3 cột (square thumbnail, aspect-square để reserve
                  space trước khi ảnh load — quan trọng cho layout ổn định).
                  Click → mở tab mới full size.
                -->
                <div
                  v-if="activeTab === 'image'"
                  class="grid grid-cols-3 gap-1"
                >
                  <a
                    v-for="att in group.items"
                    :key="att.messageId + att.url"
                    :href="att.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="block aspect-square rounded-md overflow-hidden bg-gray-200 hover:opacity-90 transition"
                    :title="att.name ?? att.mime"
                  >
                    <img
                      :src="att.url"
                      :alt="att.name ?? att.mime"
                      class="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </a>
                </div>

                <!--
                  Files: list card dọc — icon MIME + tên + size + download hint.
                  Reuse pattern MessageList.vue (file attachment render).
                -->
                <div v-else class="space-y-1">
                  <a
                    v-for="att in group.items"
                    :key="att.messageId + att.url"
                    :href="att.url"
                    :download="att.name ?? true"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-gray-200 bg-white hover:bg-gray-50 transition"
                    :title="`Tải ${att.name ?? att.mime}`"
                  >
                    <component
                      :is="fileIcon(att.mime, att.name).icon"
                      class="w-4 h-4 shrink-0"
                      :class="fileIcon(att.mime, att.name).color"
                    />
                    <span class="flex-1 min-w-0 truncate text-[12px] font-medium text-gray-800">
                      {{ att.name ?? filenameFromUrl(att.url) }}
                    </span>
                    <span class="shrink-0 text-[10px] text-gray-500">
                      {{ formatFileSize(att.sizeBytes) }}
                    </span>
                  </a>
                </div>
              </section>
            </template>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/*
 * Slide từ phải — pattern chuẩn cho side panel. 0.3s ease đủ nhanh cho
 * UX responsive. Leave ngược lại (slide out sang phải).
 */
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}

/* Thin scrollbar cho tabs row — không cần vì chỉ 2 tab, nhưng giữ pattern */
.tabs-scroll {
  scrollbar-width: thin;
}
.tabs-scroll::-webkit-scrollbar {
  height: 4px;
}
.tabs-scroll::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 2px;
}
</style>
