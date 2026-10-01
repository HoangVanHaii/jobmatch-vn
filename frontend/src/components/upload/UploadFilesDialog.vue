<script setup lang="ts">
/**
 * UploadFilesDialog — modal upload file/URL cho project attachments.
 *
 * Features:
 *   - Drag & drop zone + nút "Chọn file".
 *   - "Upload từ URL" — GET file từ URL công khai rồi upload lên BE như file
 *     thường. Fetch chạy từ browser nên URL phải cho phép CORS; server chặn
 *     CORS thì item rơi vào failed với lý do rõ ràng.
 *   - List file với progress bar THẬT (axios onUploadProgress) + trạng thái
 *     (uploading / success / failed) + retry cho failed + delete (abort request
 *     đang chạy).
 *   - Footer: Đóng / Đính kèm (disabled khi còn uploading).
 *
 * Upload thật qua `uploadApi.uploadFile` (POST /uploads/file — single file,
 * 10MB, PDF/DOCX/XLSX/PPT/TXT/CSV/ZIP/image). Nhiều file chọn cùng lúc fire
 * song song, mỗi file 1 request độc lập; 1 file fail không ảnh hưởng file khác.
 * Emit `attach` trả các item success kèm `result` (url/key từ MinIO).
 */
import { computed, ref } from 'vue'
import { X, UploadCloud, FileText, Trash2, RefreshCw } from 'lucide-vue-next'
import { uploadApi, isAllowedFileMime, type UploadResult } from '@services/upload.api'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    maxFileSizeMb?: number
    /** Caller tựa đề modal (mặc định "Upload Cvs"). */
    title?: string
    /** Folder MinIO trên BE — quyết định prefix key trả về. */
    folder?: string
  }>(),
  {
    maxFileSizeMb: 10,
    title: 'Upload Cvs',
    folder: 'cvs',
  },
)

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  attach: [files: UploadItem[]]
}>()

/* ============================================================================
 * Types
 * ==========================================================================*/
export type UploadStatus = 'queued' | 'uploading' | 'success' | 'failed'

export interface UploadItem {
  id: string
  name: string
  size: number // bytes
  status: UploadStatus
  progress: number // 0–100
  /** Source — File (drag/select, hoặc URL đã fetch về) hoặc URL string. */
  source: File | string
  /** Estimate thời gian còn lại (giây) — tính từ tốc độ upload thật. */
  timeLeft: number | null
  /** Kết quả thật từ BE (url/key/mime/size) sau khi upload thành công. UploadItem. */
  result?: UploadResult
  /** Lý do failed (size/MIME/network) — hiển thị ở dòng trạng thái. */
  error?: string
}

const items = ref<UploadItem[]>([])

/* ============================================================================
 * Helpers
 * ==========================================================================*/
const uid = (): string => Math.random().toString(36).slice(2) + Date.now().toString(36)

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kb`
  return `${(bytes / 1024 / 1024).toFixed(1)} mb`
}

/** Cập nhật progress + timeLeft từ tốc độ upload thật (loaded/elapsed). */
const updateProgress = (item: UploadItem, percent: number, loaded: number, total: number): void => {
  item.progress = percent
  const startedAt = startTimes.get(item.id)
  if (startedAt !== undefined && loaded > 0 && total > loaded) {
    const elapsed = (Date.now() - startedAt) / 1000
    const rate = loaded / Math.max(elapsed, 0.1)
    item.timeLeft = Math.max(1, Math.round((total - loaded) / rate))
  }
}

const hasInProgress = computed<boolean>(() => items.value.some((i) => i.status === 'uploading' || i.status === 'queued'))

/**
 * Giới hạn số file attach mỗi lần — BE `cvAiRateLimiter` chỉ cho 3 request
 * tạo CV/phút/user (mỗi CV tạo = 1 job parse AI tốn kém). Vượt quá sẽ 429.
 */
const MAX_ATTACH = 3

const successItems = computed<UploadItem[]>(() => items.value.filter((i) => i.status === 'success'))
/** Số item sẽ trở thành attachable (success + đang chạy) — dùng chặn khi kéo thêm file. */
const attachableCount = computed<number>(() => items.value.filter((i) => i.status !== 'failed').length)
const overLimit = computed<boolean>(() => successItems.value.length > MAX_ATTACH)
const canAttach = computed<boolean>(
  () => successItems.value.length > 0 && !overLimit.value && !hasInProgress.value,
)

/** Maps cho upload engine — controllers để abort, startTimes để tính timeLeft. */
const controllers = new Map<string, AbortController>()
const startTimes = new Map<string, number>()

const startUpload = (item: UploadItem): void => {
  if (!(item.source instanceof File)) return
  const controller = new AbortController()
  controllers.set(item.id, controller)
  startTimes.set(item.id, Date.now())
  item.status = 'uploading'
  item.progress = 0
  item.error = undefined

  uploadApi.uploadFile(
    item.source,
    props.folder,
    (percent, loaded, total) => updateProgress(item, percent, loaded, total),
    controller.signal,
  )
    .then(({ data }) => {
      item.status = 'success'
      item.progress = 100
      item.timeLeft = null
      item.result = data.data
    })
    .catch((err: unknown) => {
      // Abort do removeItem — item đã bị gỡ, không cần mark failed.
      if (controller.signal.aborted) return
      item.status = 'failed'
      item.timeLeft = null
      item.error = err instanceof Error ? err.message : 'Upload failed'
    })
    .finally(() => {
      controllers.delete(item.id)
      startTimes.delete(item.id)
    })
}

/* ============================================================================
 * Add file (từ drag/select)
 * ==========================================================================*/
const isDragging = ref<boolean>(false)
const urlInput = ref<string>('')
const urlError = ref<string | null>(null)
const urlLoading = ref<boolean>(false)

const addFile = (file: File): void => {
  // Chặn ngay khi kéo vào: item thứ N+1 không được upload, đánh dấu failed
  // kèm lý do để user thấy ngay trong list.
  if (attachableCount.value >= MAX_ATTACH) {
    items.value.push({
      id: uid(),
      name: file.name,
      size: file.size,
      status: 'failed',
      progress: 0,
      source: file,
      timeLeft: null,
      error: `Tối đa ${MAX_ATTACH} file mỗi lần — giới hạn phân tích AI 3 CV/phút.`,
    })
    return
  }
  // Soft-fail: item failed kèm lý do để user thấy ngay trong list.
  if (file.size > props.maxFileSizeMb * 1024 * 1024) {
    items.value.push({
      id: uid(),
      name: file.name,
      size: file.size,
      status: 'failed',
      progress: 0,
      source: file,
      timeLeft: null,
      error: `File vượt quá ${props.maxFileSizeMb} MB`,
    })
    return
  }
  if (!isAllowedFileMime(file.type)) {
    items.value.push({
      id: uid(),
      name: file.name,
      size: file.size,
      status: 'failed',
      progress: 0,
      source: file,
      timeLeft: null,
      error: `Định dạng không hỗ trợ (${file.type || 'unknown'})`,
    })
    return
  }
  const id = uid()
  items.value.push({
    id,
    name: file.name,
    size: file.size,
    status: 'queued',
    progress: 0,
    source: file,
    timeLeft: null,
  })
  const item = items.value[items.value.length - 1]
  startUpload(item)
}

const onFileInput = (e: Event): void => {
  const target = e.target as HTMLInputElement
  const files = target.files
  if (!files) return
  for (let i = 0; i < files.length; i++) {
    const f = files.item(i)
    if (f) addFile(f)
  }
  // Reset input để chọn lại cùng file vẫn fire onChange.
  target.value = ''
}

const onDrop = (e: DragEvent): void => {
  e.preventDefault()
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (!files) return
  for (let i = 0; i < files.length; i++) {
    const f = files.item(i)
    if (f) addFile(f)
  }
}

const onDragOver = (e: DragEvent): void => {
  e.preventDefault()
  isDragging.value = true
}

const onDragLeave = (): void => {
  isDragging.value = false
}

/* ============================================================================
 * URL upload — GET file từ URL công khai, convert sang File rồi upload bình
 * thường qua startUpload. Lưu ý CORS: server không trả Access-Control-Allow-
 * Origin sẽ fail ở bước fetch → item failed.
 * ==========================================================================*/
const extractFilename = (url: string): string => {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop() ?? 'file'
    return decodeURIComponent(last) || 'file'
  } catch {
    return 'file'
  }
}

const handleUploadUrl = async (): Promise<void> => {
  const raw = urlInput.value.trim()
  if (!raw) {
    urlError.value = 'Nhập URL trước.'
    return
  }
  try {
    new URL(raw)
  } catch {
    urlError.value = 'URL không hợp lệ.'
    return
  }
  urlError.value = null
  // Cùng hạn ngạch như drag/select — URL không được đi vòng qua MAX_ATTACH.
  if (attachableCount.value >= MAX_ATTACH) {
    urlError.value = `Tối đa ${MAX_ATTACH} file mỗi lần — giới hạn phân tích AI 3 CV/phút.`
    return
  }
  urlLoading.value = true
  // Tạo item queued trước để UX phản hồi ngay; size sẽ cập nhật sau khi GET.
  items.value.push({
    id: uid(),
    name: extractFilename(raw),
    size: 0,
    status: 'queued',
    progress: 0,
    source: raw,
    timeLeft: null,
  })
  const item = items.value[items.value.length - 1]
  try {
    // GET (không phải HEAD) — cần body blob để upload lên BE.
    const res = await fetch(raw)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const file = new File([blob], item.name, { type: blob.type })
    // Đưa qua cùng pipeline guard (size/MIME) như file thường.
    if (file.size > props.maxFileSizeMb * 1024 * 1024) {
      item.status = 'failed'
      item.error = `File vượt quá ${props.maxFileSizeMb} MB`
      urlError.value = item.error
      return
    }
    if (!isAllowedFileMime(file.type)) {
      item.status = 'failed'
      item.error = `Định dạng không hỗ trợ (${file.type || 'unknown'})`
      urlError.value = item.error
      return
    }
    item.size = blob.size
    item.source = file
    // Re-check sau khi fetch xong — trong lúc tải user có thể đã thêm file.
    if (attachableCount.value >= MAX_ATTACH) {
      item.status = 'failed'
      item.error = `Tối đa ${MAX_ATTACH} file mỗi lần — giới hạn phân tích AI 3 CV/phút.`
      urlError.value = item.error
      return
    }
    startUpload(item)
    urlInput.value = ''
  } catch {
    item.status = 'failed'
    item.error = 'Không tải được file từ URL (CORS hoặc URL lỗi).'
    urlError.value = 'Không fetch được file từ URL.'
  } finally {
    urlLoading.value = false
  }
}

/* ============================================================================
 * Item actions
 * ==========================================================================*/
const removeItem = (id: string): void => {
  // Abort request đang chạy (nếu có) rồi gỡ item.
  controllers.get(id)?.abort()
  controllers.delete(id)
  startTimes.delete(id)
  items.value = items.value.filter((i) => i.id !== id)
}

const retryItem = (id: string): void => {
  const item = items.value.find((i) => i.id === id)
  if (!item) return
  // Chỉ retry được khi đã có File (upload fail). Item fail do fetch URL thì
  // source vẫn là string → user xoá và dán lại URL.
  if (!(item.source instanceof File)) return
  // Vẫn còn trong hạn ngạch mới cho retry (tránh vượt 3 attachable).
  if (attachableCount.value >= MAX_ATTACH) {
    item.error = `Tối đa ${MAX_ATTACH} file mỗi lần — giới hạn phân tích AI 3 CV/phút.`
    return
  }
  startUpload(item)
}

/* ============================================================================
 * Dialog open/close
 * ==========================================================================*/
const close = (): void => {
  // Không abort request đang chạy — items sống qua lần đóng/mở, user mở lại
  // sẽ thấy progress tiếp diễn.
  emit('update:modelValue', false)
}

const attach = (): void => {
  // Chỉ gửi item success (đã có result: url/key/mime/size từ MinIO).
  emit('attach', successItems.value)
  items.value = [] // đã bàn giao cho caller — mở lại modal trắng tinh
  emit('update:modelValue', false)
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
        @click.self="close"
      >
        <div
          class="font-poppins w-full max-w-md rounded-xl bg-white shadow-2xl ring-1 ring-slate-200"
          role="dialog"
          aria-modal="true"
        >
          <!-- Header -->
          <div class="flex items-center justify-between px-5 pt-5">
            <div>
              <h2 class="text-[15px] font-semibold text-slate-900">
                {{ title }}
              </h2>
              <p class="mt-0.5 text-[11px] text-slate-500">
                Tải lên file hoặc URL CV của bạn.
              </p>
            </div>
            <button
              type="button"
              class="text-slate-400 hover:text-slate-700 transition-colors"
              aria-label="Đóng"
              @click="close"
            >
              <X :size="16" />
            </button>
          </div>

          <!-- Body -->
          <div class="px-5 pb-5 pt-3">
            <!-- Drop zone -->
            <label
              class="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-7 text-center cursor-pointer transition-colors"
              :class="
                isDragging
                  ? 'border-[#5b4eea] bg-[#5b4eea]/5'
                  : 'border-slate-300 bg-slate-50/50 hover:border-slate-400'
              "
              @dragover="onDragOver"
              @dragleave="onDragLeave"
              @drop="onDrop"
            >
              <UploadCloud :size="22" :class="isDragging ? 'text-[#5b4eea]' : 'text-slate-400'" />
              <div class="text-[12px] font-medium text-slate-700">
                Kéo và thả file vào đây hoặc nhấn nút "Chọn file".
              </div>
              <div class="text-[10px] text-slate-500">
                Kích thước tối đa: {{ maxFileSizeMb }} MB
              </div>
              <input
                type="file"
                multiple
                class="sr-only"
                @change="onFileInput"
              >
              <span
                class="mt-1 inline-flex h-7 items-center rounded-md bg-[#5b4eea] px-3 text-[11px] font-medium text-white hover:bg-[#4a3ed1] transition-colors"
              >
                Chọn file
              </span>
            </label>

            <!-- URL upload -->
            <div class="mt-4">
              <div class="mb-1.5 text-[11px] font-medium text-slate-700">
                Hoặc upload từ URL
              </div>
              <div
                class="flex overflow-hidden rounded-md border border-slate-200 focus-within:border-[#5b4eea] focus-within:ring-1 focus-within:ring-[#5b4eea]"
              >
                <input
                  v-model="urlInput"
                  type="url"
                  placeholder="Add file URL"
                  class="min-w-0 flex-1 border-0 bg-white px-3 py-1.5 text-[12px] text-slate-700 outline-none placeholder:text-slate-400"
                  @keyup.enter="handleUploadUrl"
                >
                <button
                  type="button"
                  class="inline-flex items-center bg-[#5b4eea] px-3 text-[11px] font-medium text-white hover:bg-[#4a3ed1] disabled:opacity-50 transition-colors"
                  :disabled="urlLoading"
                  @click="handleUploadUrl"
                >
                  Upload
                </button>
              </div>
              <p v-if="urlError" class="mt-1 text-[10px] text-red-600">
                {{ urlError }}
              </p>
            </div>

            <!-- File list -->
            <div v-if="items.length" class="mt-4">
              <div class="mb-2 text-[11px] font-semibold text-slate-700">
                Uploaded Files
              </div>
              <ul class="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
                <li
                  v-for="item in items"
                  :key="item.id"
                  class="flex items-center gap-2.5 rounded-md border border-slate-200 bg-white px-2.5 py-2"
                >
                  <FileText :size="14" class="shrink-0 text-slate-400" />

                  <div class="min-w-0 flex-1">
                    <div class="flex items-baseline justify-between gap-2">
                      <div class="truncate text-[11px] font-medium text-slate-800">
                        {{ item.name }}
                      </div>
                      <div class="flex shrink-0 items-center gap-1.5">
                        <!-- Retry (chỉ failed) -->
                        <button
                          v-if="item.status === 'failed'"
                          type="button"
                          class="text-slate-400 hover:text-[#5b4eea] transition-colors"
                          aria-label="Retry"
                          @click="retryItem(item.id)"
                        >
                          <RefreshCw :size="13" />
                        </button>
                        <button
                          type="button"
                          class="text-slate-400 hover:text-red-600 transition-colors"
                          aria-label="Xoá"
                          @click="removeItem(item.id)"
                        >
                          <Trash2 :size="13" />
                        </button>
                      </div>
                    </div>
                    <div class="mt-1 flex items-center gap-1.5">
                      <!-- Progress bar — width thật từ axios onUploadProgress -->
                      <div class="relative h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          class="absolute inset-y-0 left-0 rounded-full transition-all"
                          :class="item.status === 'failed' ? 'bg-red-400' : 'bg-emerald-500'"
                          :style="{ width: `${item.status === 'failed' ? 100 : item.progress}%` }"
                        />
                      </div>
                      <div class="shrink-0 text-[10px] tabular-nums text-slate-500 max-w-[150px] truncate">
                        <template v-if="item.status === 'uploading'">
                          {{ item.progress }}% | {{ item.timeLeft ?? 0 }} sec left
                        </template>
                        <template v-else-if="item.status === 'success'">
                          Tải lên thành công | 100%
                        </template>
                        <template v-else-if="item.status === 'failed'">
                          {{ item.error ?? 'Tải lên thất bại' }}
                        </template>
                        <template v-else>
                          {{ formatSize(item.size) }}
                        </template>
                      </div>
                    </div>
                  </div>
                </li>
              </ul>
            </div>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <p
              v-if="overLimit"
              class="mr-auto text-[10px] text-amber-600"
            >
              Tối đa {{ MAX_ATTACH }} file mỗi lần — giới hạn phân tích AI 3 CV/phút.
            </p>
            <button
              type="button"
              class="h-8 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              @click="close"
            >
              Đóng
            </button>
            <button
              type="button"
              class="h-8 rounded-md bg-[#5b4eea] px-3 text-[12px] font-medium text-white hover:bg-[#4a3ed1] disabled:opacity-50 transition-colors"
              :disabled="!canAttach"
              @click="attach"
            >
              Đính kèm
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>