<script setup lang="ts">
/**
 * MessageInput — ô nhập tin nhắn + nút gửi + nút upload file/ảnh.
 *
 * Phase 1 (chat attachment): ảnh only.
 * Phase 2 (file): mở rộng paste + file picker để nhận cả PDF/DOCX/XLSX/ZIP/TXT.
 *
 * Flow upload (dùng chung cho cả ảnh và file):
 *   1. User paste từ clipboard HOẶC click icon + chọn file.
 *   2. Mỗi file → upload qua `uploadApi.uploadChatAttachment(file)`.
 *      - image/* → POST /uploads/image (folder='chat')
 *      - file khác → POST /uploads/file (folder='chat')
 *      Wrapper trả về `{ url, key, mime, size, kind: 'image'|'file', name }`.
 *   3. Push vào `attachments` ref với status='done' + previewUrl (ObjectURL).
 *   4. Render preview: image → thumbnail; file → icon MIME + tên + size.
 *   5. User bấm Send → emit `{ content, attachments }`. Parent (ChatView)
 *      gọi `chatHook.send({ content, attachments })` để gửi qua socket.
 *
 * Hỗ trợ gửi file-only (content rỗng) — useChat.send() chấp nhận.
 *
 * Lưu ý UX:
 *   - Toast lỗi khi upload fail (network / MIME / size) → giữ entry với
 *     status='error' để user retry hoặc xoá.
 *   - Nút X trên mỗi preview để xoá file pending trước khi gửi.
 *   - Paste xử lý `e.clipboardData.items` cho cả image/* và application/*;
 *     nếu không có file → để default paste (text) chạy bình thường.
 */
import { computed, ref } from 'vue';
import {
  Send,
  ImagePlus,
  Loader2,
  X,
} from 'lucide-vue-next';
import { formatFileSize, uploadApi } from '@services/upload.api';
import { fileIconInfo } from '@utils/fileIcon';
import { useToastStore } from '@stores/toast';
import type { ChatAttachmentDraft } from '@/types/chat';

const props = defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'send', payload: { content: string; attachments: ChatAttachmentDraft[] }): void;
  (e: 'typing', val: boolean): void;
}>();

const toast = useToastStore();

const text = ref('');
const textareaEl = ref<HTMLTextAreaElement | null>(null);
const fileInputEl = ref<HTMLInputElement | null>(null);

/**
 * Local attachment state — lưu cả draft (đã upload xong) lẫn upload progress.
 *
 * Shape:
 *   id          — local id để React key / xoá
 *   status      — 'uploading' | 'done' | 'error'
 *   kind        — 'image' | 'file' (cho renderer quyết định thumbnail vs file card)
 *   previewUrl  — ObjectURL từ File (image) hoặc null (file non-image → icon)
 *   name        — tên file gốc (cho hiển thị + Content-Disposition ở BE)
 *   url, key, mime, sizeBytes — set khi upload xong
 *
 * Khi gửi → chỉ include status='done' vào emit payload.
 */
interface PendingAttachment {
  id: string;
  status: 'uploading' | 'done' | 'error';
  kind: 'image' | 'file';
  url?: string;
  key?: string;
  mime?: string;
  sizeBytes?: number;
  error?: string;
  previewUrl: string | null;
  name: string;
}

const attachments = ref<PendingAttachment[]>([]);

const canSend = computed(() => {
  if (props.disabled) return false;
  const hasText = text.value.trim().length > 0;
  const hasUploadedAttachment = attachments.value.some((a) => a.status === 'done');
  return hasText || hasUploadedAttachment;
});

const uploadingCount = computed(
  () => attachments.value.filter((a) => a.status === 'uploading').length,
);

/**
 * Map MIME → icon + màu (centralized ở utils/fileIcon để MessageList +
 * MessageInput đồng bộ visual).
 */
const fileIcon = (mime: string, name?: string) => fileIconInfo(mime, name);

/**
 * Upload 1 file lên MinIO (image qua /uploads/image, file qua /uploads/file).
 * Push vào `attachments` với status='uploading' trước (preview từ ObjectURL
 * cho image; null cho file non-image để dùng icon), update thành 'done' khi
 * thành công, 'error' khi fail.
 *
 * Toast lỗi 1 lần khi fail — không spam nếu user upload nhiều file cùng lúc.
 */
const uploadFile = async (file: File): Promise<void> => {
  const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const isImage = file.type.startsWith('image/');
  const previewUrl = isImage ? URL.createObjectURL(file) : null;
  const entry: PendingAttachment = {
    id,
    status: 'uploading',
    kind: isImage ? 'image' : 'file',
    previewUrl,
    name: file.name,
  };
  attachments.value = [...attachments.value, entry];

  try {
    const result = await uploadApi.uploadChatAttachment(file);
    attachments.value = attachments.value.map((a) =>
      a.id === id
        ? {
            ...a,
            status: 'done',
            url: result.url,
            key: result.key,
            mime: result.mime,
            sizeBytes: result.size,
            kind: result.kind,
          }
        : a,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Upload thất bại';
    attachments.value = attachments.value.map((a) =>
      a.id === id ? { ...a, status: 'error', error: msg } : a,
    );
    toast.push({ variant: 'error', title: 'Upload thất bại', body: msg });
  }
};

const removeAttachment = (id: string): void => {
  const target = attachments.value.find((a) => a.id === id);
  if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
  attachments.value = attachments.value.filter((a) => a.id !== id);
};

const onPickFile = (): void => {
  fileInputEl.value?.click();
};

const onFileInputChange = (e: Event): void => {
  const target = e.target as HTMLInputElement;
  const files = target.files;
  if (!files || files.length === 0) return;
  void Promise.all(Array.from(files).map((f) => uploadFile(f)));
  // Reset input để chọn lại cùng file (nếu user muốn retry)
  target.value = '';
};

/**
 * Paste handler — bắt MỌI file từ clipboard, ngăn default để tránh paste blob
 * vào textarea. Nếu clipboard chỉ có text → để mặc định.
 *
 * Hỗ trợ:
 *   - Print Screen ảnh (Win/Mac đều cho image vào clipboard).
 *   - Cmd/Ctrl+V sau khi copy 1 file từ Finder/Explorer.
 *   - Paste screenshot từ Snipping Tool / Lightshot.
 *   - Paste PDF/file từ OS clipboard (Finder preview, Windows Explorer copy).
 */
const onPaste = (e: ClipboardEvent): void => {
  const items = e.clipboardData?.items;
  if (!items) return;
  const files: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (files.length === 0) return;
  e.preventDefault();
  void Promise.all(files.map((f) => uploadFile(f)));
};

const onSend = (): void => {
  if (!canSend.value) return;
  const content = text.value.trim();
  // Chỉ include status='done' attachments — uploading/error bị bỏ qua (giữ
  // lại trong UI để user retry; user có thể xoá thủ công).
  const readyAttachments: ChatAttachmentDraft[] = attachments.value
    .filter(
      (a) =>
        a.status === 'done' && a.url && a.key && a.mime && a.sizeBytes !== undefined,
    )
    .map((a) => ({
      url: a.url!,
      key: a.key!,
      mime: a.mime!,
      sizeBytes: a.sizeBytes!,
      kind: a.kind,
      name: a.name,
    }));
  emit('send', { content, attachments: readyAttachments });
  text.value = '';
  // Cleanup previews + reset attachments
  for (const a of attachments.value) {
    if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
  }
  attachments.value = [];
  emit('typing', false);
  textareaEl.value?.focus();
};

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    onSend();
  }
};

const onInput = (): void => {
  emit('typing', text.value.length > 0);
};
</script>

<template>
  <div class="border-t border-gray-200 bg-white p-3">
    <!--
      Attachment preview row — hiện thumbnail/file card ngay trên textarea.
      Mỗi item có nút X để xoá nếu user chọn nhầm hoặc upload fail muốn retry.
      Trạng thái:
        - uploading: spinner overlay (image) hoặc dim overlay (file)
        - error: red border + icon AlertCircle (giữ nguyên để user xoá thủ công)
    -->
    <div v-if="attachments.length > 0" class="flex flex-wrap gap-2 mb-2 pb-2 border-b border-gray-100">
      <div
        v-for="att in attachments"
        :key="att.id"
        class="relative rounded-md overflow-hidden border bg-gray-50 group"
        :class="[
          att.kind === 'image' ? 'h-16 w-16' : 'h-16 min-w-[180px] max-w-[220px] px-2.5 py-1.5',
          att.status === 'error' ? 'border-red-300' : 'border-gray-200',
        ]"
        :title="att.error ?? att.name"
      >
        <!-- Image: thumbnail với <img> -->
        <template v-if="att.kind === 'image' && att.previewUrl">
          <img
            :src="att.previewUrl"
            :alt="att.name"
            class="h-full w-full object-cover"
          />
          <div
            v-if="att.status === 'uploading'"
            class="absolute inset-0 bg-black/40 flex items-center justify-center"
          >
            <Loader2 class="w-4 h-4 text-white animate-spin" />
          </div>
        </template>

        <!-- File: icon MIME + tên + size -->
        <template v-else>
          <div class="flex items-center gap-2 h-full">
            <component
              :is="fileIcon(att.mime ?? '', att.name).icon"
              class="w-5 h-5 shrink-0"
              :class="fileIcon(att.mime ?? '', att.name).color"
            />
            <div class="min-w-0 flex-1">
              <p class="text-[11px] font-medium text-gray-800 truncate">
                {{ att.name }}
              </p>
              <p class="text-[10px] text-gray-500">
                {{ att.sizeBytes ? formatFileSize(att.sizeBytes) : '...' }}
              </p>
            </div>
          </div>
          <div
            v-if="att.status === 'uploading'"
            class="absolute inset-0 bg-black/30 flex items-center justify-center"
          >
            <Loader2 class="w-4 h-4 text-white animate-spin" />
          </div>
        </template>

        <!-- Nút xoá -->
        <button
          type="button"
          aria-label="Xoá file"
          title="Xoá"
          class="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition opacity-0 group-hover:opacity-100"
          @click="removeAttachment(att.id)"
        >
          <X class="w-3 h-3" />
        </button>
      </div>
      <!--
        Loading badge tổng khi có nhiều file cùng upload — tránh user bấm send
        trong khi file chưa sẵn sàng (canSend=false sẽ disable send button
        nhưng badge này cho hint trực quan).
      -->
      <div
        v-if="uploadingCount > 0"
        class="h-16 w-16 rounded-md border border-dashed border-gray-300 flex items-center justify-center text-[10px] text-gray-500"
      >
        Đang tải {{ uploadingCount }}…
      </div>
    </div>

    <div class="flex items-end gap-2">
      <!-- Nút upload ảnh — icon ImagePlus bên trái textarea -->
      <button
        type="button"
        :disabled="disabled"
        aria-label="Đính kèm ảnh"
        title="Đính kèm ảnh (hoặc paste từ clipboard)"
        class="shrink-0 w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transition"
        @click="onPickFile"
      >
        <ImagePlus class="w-4 h-4" />
      </button>
      <input
        ref="fileInputEl"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv,application/zip"
        multiple
        class="hidden"
        @change="onFileInputChange"
      />
      <textarea
        ref="textareaEl"
        v-model="text"
        rows="1"
        :disabled="disabled"
        placeholder="Nhập tin nhắn..."
        class="flex-1 resize-none px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-primary-400 focus:bg-white max-h-32"
        @input="onInput"
        @keydown="onKeydown"
        @paste="onPaste"
      />
      <button
        type="button"
        :disabled="!canSend"
        class="shrink-0 w-10 h-10 rounded-lg bg-primary-500 text-white flex items-center justify-center hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
        @click="onSend"
      >
        <Send class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>
