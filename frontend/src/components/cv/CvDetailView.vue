<script setup lang="ts">
/**
 * CvDetailView — modal xem chi tiết 1 CV, pattern theo mockup trang list CV
 * (font-poppins, text-size nhỏ, accent #5b4eea).
 *
 * 3 tab:
 *   - "Chi tiết"  — nội dung CV KHÔNG khung: direct → CVTemplateRenderer full
 *     A4 (white block, không ring/shadow); upload PDF → iframe native viewer;
 *     image → <img> contain; DOCX → fallback tải về (render docx-preview đầy
 *     đủ đã có ở CvPreview — không nhân bản composable vào đây).
 *   - "AI Summary" — điểm + strengths/weaknesses/suggestions từ ai_analysis;
 *     chưa phân tích / parsing / failed → empty state tương ứng.
 *   - "File" — metadata file (loại, nguồn, ngày) + nút tải xuống.
 *
 * 3 action ở footer (component PURE — chỉ emit, parent tự gọi store/router):
 *   - "Đặt làm CV chính" → emit('set-primary') — disabled khi đã là primary,
 *     loading qua prop `settingPrimary`.
 *   - "Xóa CV" → 2 bước inline confirm rồi emit('delete').
 *   - "Chỉnh sửa CV" → CHỈ hiện với CV tạo tay (source='direct') → emit('edit').
 */
import { computed, ref, watch } from 'vue'
import {
  X,
  FileText,
  Brain,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  Star,
  Trash2,
  Pencil,
  Download,
  Loader2,
  ShieldAlert,
  Info,
} from 'lucide-vue-next'
import CVTemplateRenderer from '@components/cv/templates/CVTemplateRenderer.vue'
import { buildRenderData } from '@/composables/cvRenderData'
import { scoreLabel } from '@/utils/aiScore'
import type { Cv } from '@/types/cv'

const props = withDefaults(
  defineProps<{
    open: boolean
    /** CV đang xem — reactive từ parent (derived từ store items) nên set
     *  primary/xoá ở parent xong, UI trong modal tự cập nhật theo. */
    cv: Cv | null
    /** Loading state cho nút "Đặt làm CV chính". */
    settingPrimary?: boolean
    /** Loading state cho nút "Xóa CV". */
    deleting?: boolean
    /** Loading state cho nút "Phân tích ngay" (tab AI Summary empty state). */
    analyzing?: boolean
    /** Chế độ xem mẫu demo (template hệ thống): chỉ tab Chi tiết + CTA
     *  "Dùng mẫu này" — ẩn action set-primary/delete/edit/analyze. */
    demo?: boolean
  }>(),
  {
    settingPrimary: false,
    deleting: false,
    analyzing: false,
    demo: false,
  },
)

const emit = defineEmits<{
  close: []
  'set-primary': [cvId: string]
  edit: [cv: Cv]
  delete: [cv: Cv]
  /** Bấm nút phân tích ở tab AI Summary (CV chưa analyzed hoặc failed). */
  analyze: [cvId: string]
  /** Chế độ demo — user muốn dùng mẫu này để tạo CV. */
  'use-template': [cv: Cv]
}>()

/* ============================================================================
 * Tabs
 * ==========================================================================*/
type DetailTab = 'detail' | 'ai' | 'file'
const activeTab = ref<DetailTab>('detail')
// Mở modal mỗi lần về tab "Chi tiết" — tránh giữ tab cũ của CV lần trước.
watch(
  () => props.open,
  (o) => {
    if (o) activeTab.value = 'detail'
  },
)

const tabs: Array<{ value: DetailTab; label: string }> = [
  { value: 'detail', label: 'Chi tiết' },
  { value: 'ai', label: 'AI Summary' },
  { value: 'file', label: 'File' },
]
// Demo template: chỉ còn tab Chi tiết (AI/File không có ý nghĩa với mẫu).
const visibleTabs = computed<Array<{ value: DetailTab; label: string }>>(() =>
  props.demo ? tabs.filter((t) => t.value === 'detail') : tabs,
)

/* ============================================================================
 * Derived từ cv
 * ==========================================================================*/
const renderData = computed(() => (props.cv ? buildRenderData(props.cv) : null))
const templateId = computed<number>(() => {
  const id = props.cv?.templateId
  return id !== null && id !== undefined && id >= 1 && id <= 5 ? id : 1
})

const isDirect = computed<boolean>(() => props.cv?.source === 'direct')
const mime = computed<string>(() => (props.cv?.fileType ?? '').toLowerCase())
const isPdf = computed<boolean>(() => mime.value === 'application/pdf')
const isImage = computed<boolean>(() => mime.value.startsWith('image/'))
const isProcessing = computed<boolean>(
  () =>
    props.cv?.status === 'pending' ||
    props.cv?.status === 'parsing' ||
    props.cv?.status === 'analyzing',
)

/** Nhãn MIME ngắn cho tab File + chip header. */
const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/msword': 'DOC',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'text/plain': 'TXT',
  'text/csv': 'CSV',
  'application/zip': 'ZIP',
}
const mimeLabel = computed<string>(
  () => MIME_LABELS[mime.value] ?? (props.cv?.fileType ? props.cv.fileType : '—'),
)

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * Build URL xem PDF trong tab "Chi tiết" — nối fragment để ẩn toolbar,
 * sidebar thumbnail (navpanes) và scrollbar của trình xem PDF Chrome, mở
 * với chế độ fit chiều ngang (FitH).
 *
 * Chỉ nối khi URL CHƯA có fragment (`#`) — nối 2 lần sẽ tạo `##...`, trình
 * xem chỉ đọc fragment đầu và bỏ qua các param sau.
 *
 * KHÔNG dùng helper này cho link tải ở tab "File" — tab đó giữ URL gốc đầy
 * đủ để native viewer vẫn có toolbar (tải/in) khi user mở link.
 */
const buildPdfViewUrl = (url: string): string =>
  url.includes('#') ? url : `${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`

/* ============================================================================
 * Delete confirm 2 bước — bấm lần 1 đổi nhãn "Xác nhận?", lần 2 mới emit.
 * Đóng modal hoặc đổi CV → reset về bước 1.
 * ==========================================================================*/
const confirmDelete = ref<boolean>(false)
watch(
  () => [props.open, props.cv?.id] as const,
  () => {
    confirmDelete.value = false
  },
)
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
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
        @click.self="emit('close')"
      >
        <div
          class="font-poppins flex h-[85vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200"
          :class="demo ? 'max-w-2xl' : 'max-w-4xl'"
          role="dialog"
          aria-modal="true"
        >
          <!-- ==================== Header ==================== -->
          <div class="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <div class="flex min-w-0 items-center gap-2.5">
              <div class="truncate text-[15px] font-semibold text-slate-900">
                {{ cv?.title?.trim() || 'CV chưa đặt tên' }}
              </div>
              <!-- Chip CV chính -->
              <span
                v-if="!demo && cv?.isPrimary"
                class="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200/70"
              >
                <Star :size="10" class="fill-amber-500 text-amber-500" />
                CV chính
              </span>
              <!-- Chip nguồn -->
              <span
                class="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
              >
                {{ demo ? 'Mẫu hệ thống' : isDirect ? 'Tạo thủ công' : `Upload ${mimeLabel}` }}
              </span>
            </div>
            <button
              type="button"
              class="shrink-0 text-slate-400 transition-colors hover:text-slate-700"
              aria-label="Đóng"
              @click="emit('close')"
            >
              <X :size="16" />
            </button>
          </div>

          <!-- ==================== Tabs ==================== -->
          <!-- Demo template: chỉ 1 tab duy nhất → ẩn hẳn dải tab. -->
          <div v-if="!demo" class="flex items-center gap-1 border-b border-slate-100 px-5">
            <button
              v-for="tab in visibleTabs"
              :key="tab.value"
              type="button"
              class="relative -mb-px px-3 py-2 text-[12px] font-medium transition-colors"
              :class="
                activeTab === tab.value
                  ? 'text-[#5b4eea]'
                  : 'text-slate-500 hover:text-slate-800'
              "
              @click="activeTab = tab.value"
            >
              {{ tab.label }}
              <span
                class="absolute inset-x-2 bottom-0 h-0.5 rounded-full"
                :class="activeTab === tab.value ? 'bg-[#5b4eea]' : 'bg-transparent'"
              />
            </button>
          </div>

          <!-- ==================== Body ==================== -->
          <div class="min-h-0 flex-1 overflow-y-auto bg-slate-50/70">
            <!-- ========== Tab Chi tiết — nội dung CV, không khung ==========
                 Demo: padding mỏng + render FULL width (không max-w) để hết
                 khoảng trống 2 bên. -->
            <div v-if="activeTab === 'detail'" :class="demo ? 'p-3' : 'p-5'">
              <!-- Đang parse/analyze → chưa có nội dung để render -->
              <div
                v-if="isProcessing"
                class="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 text-slate-500"
              >
                <Loader2 :size="20" class="animate-spin text-[#5b4eea]" />
                <span class="text-[12px]">CV đang được phân tích — nội dung sẽ hiện sau.</span>
              </div>

              <!-- Direct: render full A4 qua CVTemplateRenderer — block trắng
                   trơn, KHÔNG ring/shadow ("không có khung chỉ có nội dung").
                   Demo: full width modal; thường: giới hạn 640px giữa. -->
              <div
                v-else-if="isDirect && renderData"
                class="mx-auto w-full bg-white"
                :class="demo ? '' : 'max-w-[640px]'"
                style="aspect-ratio: 850 / 1100"
              >
                <CVTemplateRenderer :template-id="templateId" :data="renderData" />
              </div>

              <!-- Upload PDF: iframe native viewer ẩn toolbar/sidebar qua
                   fragment (buildPdfViewUrl) — chỉ còn nội dung CV, full
                   width, cao cố định 70vh, không border. -->
              <iframe
                v-else-if="isPdf && cv?.fileUrl"
                :src="buildPdfViewUrl(cv?.fileUrl ?? '')"
                class="h-[70vh] w-full border-0 bg-white"
                title="Nội dung CV"
              />

              <!-- Upload image -->
              <img
                v-else-if="isImage && cv?.fileUrl"
                :src="cv.fileUrl"
                :alt="cv.title || 'CV image'"
                class="mx-auto max-h-[560px] w-auto max-w-full rounded-md bg-white object-contain"
              />

              <!-- DOCX / khác: fallback tải về (docx-preview đầy đủ có ở CvPreview) -->
              <div
                v-else
                class="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 text-center"
              >
                <FileText :size="22" class="text-slate-300" />
                <p class="text-[12px] text-slate-600">
                  Không xem trước được định dạng {{ mimeLabel }} ngay tại đây.
                </p>
                <a
                  v-if="cv?.fileUrl"
                  :href="cv.fileUrl"
                  target="_blank"
                  rel="noopener"
                  class="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <Download :size="12" />
                  Mở / tải file
                </a>
              </div>
            </div>

            <!-- ========== Tab AI Summary ========== -->
            <div v-else-if="activeTab === 'ai'" class="p-5">
              <!-- Chưa có analysis -->
              <div
                v-if="!cv?.ai_analysis"
                class="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 text-center"
              >
                <Brain :size="22" class="text-slate-300" />
                <template v-if="isProcessing">
                  <span class="text-[12px] text-slate-600">
                    AI đang phân tích CV — kết quả sẽ xuất hiện tại đây.
                  </span>
                </template>
                <template v-else-if="cv?.status === 'failed'">
                  <span class="inline-flex items-center gap-1.5 text-[12px] text-red-600">
                    <AlertTriangle :size="13" />
                    Phân tích thất bại — đây có thể không phải CV chuẩn.
                  </span>
                </template>
                <template v-else>
                  <span class="text-[12px] text-slate-600">
                    CV chưa được phân tích bằng AI.
                  </span>
                </template>

                <!-- Nút phân tích — hiện cho CV terminal chưa có analysis
                     (ready chưa analyzed, hoặc failed để thử lại). Đang
                     processing thì ẩn — worker đã chạy rồi. -->
                <button
                  v-if="cv && !isProcessing"
                  type="button"
                  class="mt-1 inline-flex h-8 items-center gap-1.5 rounded-md bg-[#5b4eea] px-3 text-[11px] font-medium text-white transition-colors hover:bg-[#4a3ed1] disabled:opacity-50"
                  :disabled="analyzing"
                  @click="emit('analyze', cv.id)"
                >
                  <Loader2 v-if="analyzing" :size="12" class="animate-spin" />
                  <Brain v-else :size="12" />
                  {{ analyzing ? 'Đang gửi…' : cv.status === 'failed' ? 'Phân tích lại' : 'Phân tích ngay' }}
                </button>
              </div>

              <!-- Có analysis -->
              <div v-else class="flex flex-col gap-4">
                <!-- Score header -->
                <div class="flex items-center gap-3 rounded-lg bg-white p-3.5 ring-1 ring-slate-200">
                  <div
                    class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[17px] font-bold"
                    :class="scoreLabel(cv.ai_analysis.total).tone"
                  >
                    {{ cv.ai_analysis.total }}
                  </div>
                  <div class="min-w-0">
                    <div class="text-[13px] font-semibold text-slate-900">
                      {{ scoreLabel(cv.ai_analysis.total).label }}
                    </div>
                    <div class="text-[11px] text-slate-500">
                      Điểm AI cập nhật {{ fmtDate(cv.scoreUpdatedAt) }}
                    </div>
                  </div>
                </div>

                <!-- Strengths -->
                <div
                  v-if="cv.ai_analysis.strengths?.length"
                  class="rounded-lg bg-white p-3.5 ring-1 ring-slate-200"
                >
                  <div class="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700">
                    <CheckCircle2 :size="13" />
                    Điểm mạnh
                  </div>
                  <ul class="flex flex-col gap-1.5">
                    <li
                      v-for="(s, i) in cv.ai_analysis.strengths"
                      :key="`s-${i}`"
                      class="flex gap-1.5 text-[11px] leading-relaxed text-slate-700"
                    >
                      <span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
                      {{ s }}
                    </li>
                  </ul>
                </div>

                <!-- Weaknesses -->
                <div
                  v-if="cv.ai_analysis.weaknesses?.length"
                  class="rounded-lg bg-white p-3.5 ring-1 ring-slate-200"
                >
                  <div class="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-red-700">
                    <AlertTriangle :size="13" />
                    Điểm yếu
                  </div>
                  <ul class="flex flex-col gap-1.5">
                    <li
                      v-for="(w, i) in cv.ai_analysis.weaknesses"
                      :key="`w-${i}`"
                      class="flex gap-1.5 text-[11px] leading-relaxed text-slate-700"
                    >
                      <span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                      {{ w }}
                    </li>
                  </ul>
                </div>

                <!-- Suggestions -->
                <div
                  v-if="cv.ai_analysis.suggestions?.length"
                  class="rounded-lg bg-white p-3.5 ring-1 ring-slate-200"
                >
                  <div class="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-primary-700">
                    <Lightbulb :size="13" />
                    Gợi ý cải thiện
                  </div>
                  <ul class="flex flex-col gap-1.5">
                    <li
                      v-for="(sg, i) in cv.ai_analysis.suggestions"
                      :key="`sg-${i}`"
                      class="flex gap-1.5 text-[11px] leading-relaxed text-slate-700"
                    >
                      <span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary-500" />
                      {{ sg }}
                    </li>
                  </ul>
                </div>

                <!-- Verification warnings (github/linkedin) -->
                <div
                  v-if="cv.ai_analysis.verificationWarnings?.length"
                  class="rounded-lg bg-amber-50/70 p-3.5 ring-1 ring-amber-200/70"
                >
                  <div class="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-amber-700">
                    <ShieldAlert :size="13" />
                    Cảnh báo xác minh
                  </div>
                  <ul class="flex flex-col gap-1.5">
                    <li
                      v-for="(v, i) in cv.ai_analysis.verificationWarnings"
                      :key="`v-${i}`"
                      class="text-[11px] leading-relaxed text-slate-700"
                    >
                      <span class="font-medium capitalize">{{ v.type }}</span>
                      ({{ v.url }}): {{ v.message }}
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <!-- ========== Tab File ========== -->
            <div v-else class="p-5">
              <div class="flex flex-col gap-2.5 rounded-lg bg-white p-4 ring-1 ring-slate-200">
                <template v-if="!isDirect">
                  <!-- Hàng info -->
                  <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <span class="text-[11px] text-slate-500">Tên file</span>
                    <span class="max-w-[65%] truncate text-[11px] font-medium text-slate-800">
                      {{ cv?.title?.trim() || 'CV chưa đặt tên' }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <span class="text-[11px] text-slate-500">Định dạng</span>
                    <span class="text-[11px] font-medium text-slate-800">{{ mimeLabel }}</span>
                  </div>
                  <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <span class="text-[11px] text-slate-500">Ngày tạo</span>
                    <span class="text-[11px] font-medium text-slate-800">
                      {{ fmtDate(cv?.createdAt ?? null) }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-[11px] text-slate-500">Cập nhật</span>
                    <span class="text-[11px] font-medium text-slate-800">
                      {{ fmtDate(cv?.updatedAt ?? null) }}
                    </span>
                  </div>
                  <a
                    v-if="cv?.fileUrl"
                    :href="cv.fileUrl"
                    target="_blank"
                    rel="noopener"
                    class="mt-1 inline-flex h-8 w-fit items-center gap-1.5 rounded-md bg-[#5b4eea] px-3 text-[11px] font-medium text-white transition-colors hover:bg-[#4a3ed1]"
                  >
                    <Download :size="12" />
                    Tải file xuống
                  </a>
                </template>

                <!-- Direct CV — không có file upload -->
                <template v-else>
                  <div class="flex flex-col items-center gap-2 py-6 text-center">
                    <Info :size="20" class="text-slate-300" />
                    <p class="text-[12px] text-slate-600">
                      CV tạo thủ công — không có file đính kèm.
                    </p>
                    <span class="text-[11px] text-slate-400">
                      Nội dung nằm ở tab "Chi tiết"; tải PDF từ bản xem trước khi cần.
                    </span>
                  </div>
                </template>
              </div>
            </div>
          </div>

          <!-- ==================== Footer actions ==================== -->
          <!-- Demo template: chỉ CTA "Dùng mẫu này" → parent route sang create. -->
          <div
            v-if="demo"
            class="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3"
          >
            <p class="text-[10px] text-slate-400">
              Mẫu demo — dùng để tạo CV, chỉnh sửa trực tiếp trên nội dung.
            </p>
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#5b4eea] px-3.5 text-[12px] font-medium text-white transition-colors hover:bg-[#4a3ed1]"
              @click="cv && emit('use-template', cv)"
            >
              <Pencil :size="12" />
              Dùng mẫu này
            </button>
          </div>

          <div
            v-else
            class="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3"
          >
            <!-- Trái: hint khi CV đang là primary -->
            <p class="text-[10px] text-slate-400">
              {{ cv?.isPrimary ? 'CV này đang được employers xem mặc định.' : '' }}
            </p>

            <div class="flex items-center gap-2">
              <!-- Chỉnh sửa — CHỈ CV tạo tay (source='direct') -->
              <button
                v-if="isDirect"
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
                @click="cv && emit('edit', cv)"
              >
                <Pencil :size="12" />
                Chỉnh sửa CV
              </button>

              <!-- Xóa — 2 bước confirm inline -->
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium transition-colors disabled:opacity-50"
                :class="
                  confirmDelete
                    ? 'border-red-600 bg-red-600 text-white hover:bg-red-700'
                    : 'border-red-200 bg-white text-red-600 hover:bg-red-50'
                "
                :disabled="deleting"
                @click="
                  confirmDelete ? cv && emit('delete', cv) : (confirmDelete = true)
                "
              >
                <Loader2 v-if="deleting" :size="12" class="animate-spin" />
                <Trash2 v-else :size="12" />
                {{ confirmDelete ? 'Xác nhận xoá?' : 'Xóa CV' }}
              </button>

              <!-- Đặt làm CV chính -->
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#5b4eea] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[#4a3ed1] disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="cv?.isPrimary || settingPrimary"
                :title="cv?.isPrimary ? 'Đã là CV chính' : 'Đặt làm CV chính'"
                @click="cv && emit('set-primary', cv.id)"
              >
                <Loader2 v-if="settingPrimary" :size="12" class="animate-spin" />
                <Star v-else :size="12" />
                {{ cv?.isPrimary ? 'CV chính' : 'Đặt làm CV chính' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
