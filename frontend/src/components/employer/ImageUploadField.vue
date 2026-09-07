<script setup lang="ts">
/**
 * ImageUploadField — field upload ảnh (logo/cover) dùng chung cho CompanyView
 * và CreateCompanyModal. Trước đây logo/cover được nhập bằng URL text — không
 * khả thi cho user non-tech. Component này cho phép click để chọn file từ
 * máy → upload lên MinIO qua /uploads/image → set URL vào model.
 *
 * Flow:
 *   1. User click vùng preview/placeholder → trigger hidden file input.
 *   2. File change → validate MIME + size → uploadStore.uploadImage(file, folder).
 *   3. BE trả { url, key, mime, size } → emit 'update:url' với url mới.
 *   4. Parent lưu url vào form.company.logoUrl → submit kèm theo.
 *
 * Props:
 *   - url: URL hiện tại (có thể là string hoặc null từ parent).
 *   - folder: thư mục MinIO ('logos' | 'covers').
 *   - shape: 'square' (logo vuông) hoặc 'wide' (cover chữ nhật ngang).
 *   - label/description: hiển thị phía trên vùng upload.
 *   - disabled: khi parent đang submit.
 *
 * Lưu ý:
 *   - BE whitelist image/jpeg|png|webp|gif, tối đa 5MB (xem upload.api.ts).
 *   - KHÔNG có endpoint xoá trên BE — nếu user muốn xoá ảnh, click nút "Xoá"
 *     để set url = null (PATCH sẽ ghi null lên DB). File cũ trên MinIO vẫn
 *     tồn tại (orphan) — chấp nhận vì storage rẻ, không có UI xoá file riêng.
 */
import { computed, ref } from 'vue';
import { AlertCircle, Camera, ImageIcon, Loader2, Trash2 } from 'lucide-vue-next';
import { useUploadStore } from '@stores/upload';

const props = withDefaults(
  defineProps<{
    url?: string | null;
    folder: 'logos' | 'covers';
    label: string;
    description?: string;
    shape?: 'square' | 'wide';
    disabled?: boolean;
    /** Ẩn label + description render bên trong — dùng khi parent đã render label riêng (vd section header). */
    hideLabel?: boolean;
  }>(),
  {
    url: null,
    description: '',
    shape: 'square',
    disabled: false,
    hideLabel: false,
  },
);

const emit = defineEmits<{
  (e: 'update:url', value: string | null): void;
}>();

const uploadStore = useUploadStore();
const fileInputRef = ref<HTMLInputElement | null>(null);
const localError = ref<string | null>(null);

const isUploading = computed<boolean>(() => uploadStore.loading);
const errorMessage = computed<string | null>(() => localError.value ?? uploadStore.error);

/** MIME + size guard phía client — fail-fast với message tiếng Việt. */
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const MAX_SIZE = 5 * 1024 * 1024;

const validateFile = (file: File): string | null => {
  if (!IMAGE_MIME.includes(file.type as (typeof IMAGE_MIME)[number])) {
    return `Định dạng không hỗ trợ (${file.type || 'không xác định'}). Chỉ chấp nhận JPG, PNG, WEBP, GIF.`;
  }
  if (file.size > MAX_SIZE) {
    return 'Ảnh tối đa 5MB.';
  }
  return null;
};

const pickFile = (): void => {
  if (props.disabled || isUploading.value) return;
  fileInputRef.value?.click();
};

const handleFileChange = async (e: Event): Promise<void> => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  localError.value = null;
  uploadStore.clearError();

  const validationError = validateFile(file);
  if (validationError) {
    localError.value = validationError;
    target.value = '';
    return;
  }

  const result = await uploadStore.uploadImage(file, props.folder);
  if (result) {
    emit('update:url', result.url);
  }
  // Reset input value để chọn lại cùng file vẫn trigger change event.
  target.value = '';
};

const removeImage = (): void => {
  if (props.disabled || isUploading.value) return;
  emit('update:url', null);
  localError.value = null;
  uploadStore.clearError();
};

/** Kích thước vùng preview theo shape. */
const previewClass = computed(() =>
  props.shape === 'wide'
    ? 'w-full aspect-[4/1] sm:aspect-[5/1]'
    : 'w-28 h-28 sm:w-32 sm:h-32',
);

const folderLabel = computed<string>(() => (props.folder === 'logos' ? 'Logo' : 'Cover'));
</script>

<template>
  <div class="min-w-0">
    <template v-if="!hideLabel">
      <label class="block text-xs font-medium text-gray-700 mb-1.5">
        {{ label }}
      </label>
      <p v-if="description" class="text-[11px] text-gray-500 mb-2">
        {{ description }}
      </p>
    </template>

    <!-- Preview / placeholder — click anywhere to upload -->
    <div
      class="relative group rounded-lg border border-gray-200 bg-gray-50 overflow-hidden cursor-pointer"
      :class="[previewClass, { 'pointer-events-none opacity-60': disabled }]"
      role="button"
      tabindex="0"
      :title="url ? `Đổi ${folderLabel.toLowerCase()}` : `Tải lên ${folderLabel.toLowerCase()}`"
      :aria-label="url ? `Đổi ${folderLabel.toLowerCase()}` : `Tải lên ${folderLabel.toLowerCase()}`"
      @click="pickFile"
      @keydown.enter.prevent="pickFile"
      @keydown.space.prevent="pickFile"
    >
      <img
        v-if="url"
        :src="url"
        :alt="folderLabel"
        class="w-full h-full object-cover transition-opacity"
        :class="{ 'opacity-50': isUploading }"
        @error="($event.target as HTMLImageElement).style.display = 'none'"
      />
      <div
        v-else
        class="w-full h-full flex flex-col items-center justify-center text-gray-400 gap-1.5"
        aria-hidden="true"
      >
        <ImageIcon v-if="shape === 'wide'" class="w-7 h-7" />
        <ImageIcon v-else class="w-8 h-8" />
        <span class="text-[11px] font-medium text-gray-500 group-hover:text-gray-700 transition">
          Tải ảnh lên
        </span>
      </div>

      <!-- Upload overlay (active) -->
      <div
        v-if="isUploading"
        class="absolute inset-0 flex items-center justify-center bg-slate-900/55 text-white pointer-events-none"
      >
        <Loader2 class="w-5 h-5 animate-spin" />
      </div>

      <!-- Hover overlay (idle) — "Đổi ảnh" -->
      <div
        v-if="!isUploading && !disabled"
        class="absolute inset-0 flex items-center justify-center gap-1.5 bg-slate-900/0 group-hover:bg-slate-900/55 text-white opacity-0 group-hover:opacity-100 transition pointer-events-none"
      >
        <Camera class="w-4 h-4" />
        <span class="text-xs font-medium">{{ url ? 'Đổi ảnh' : 'Tải ảnh' }}</span>
      </div>

      <!-- Remove button — small X ở góc trên phải, chỉ hiện khi đã có ảnh -->
      <button
        v-if="url && !isUploading && !disabled"
        type="button"
        class="absolute top-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white hover:bg-red-600 transition shadow-sm"
        title="Xoá ảnh"
        :aria-label="`Xoá ${folderLabel.toLowerCase()}`"
        @click.stop="removeImage"
        @mousedown.stop
      >
        <Trash2 class="w-3 h-3" />
      </button>
    </div>

    <!-- Error message -->
    <p
      v-if="errorMessage"
      role="alert"
      class="mt-1.5 text-xs text-red-600 inline-flex items-start gap-1"
    >
      <AlertCircle class="w-3 h-3 mt-0.5 shrink-0" />
      <span class="break-words">{{ errorMessage }}</span>
    </p>

    <!-- Hidden file input -->
    <input
      ref="fileInputRef"
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif"
      class="hidden"
      :disabled="disabled || isUploading"
      @change="handleFileChange"
    />
  </div>
</template>
