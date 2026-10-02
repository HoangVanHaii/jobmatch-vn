<script setup lang="ts">
/**
 * MockupResumeView — Mockup cho trang list CV của candidate (Forma-style card).
 *
 * Sections:
 *   - Hero (welcome + search by role/style)
 *   - Filters + view toggle (grid/list)
 *   - Resume grid — render thật từ useCvStore (xem MyResumesView để biết API)
 *   - Bottom feature cards (Popular / ATS)
 *
 * UI pattern giữ nguyên mockup ban đầu; chỉ thay nguồn dữ liệu từ mock → API.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import {
  Search,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Bookmark,
  Upload,
  ListFilter,
  Palette,
  Sparkles,
  Brain,
  Loader2,
  AlertTriangle,
  X,
} from 'lucide-vue-next'
import { useCvStore } from '@stores/cv'
import { useToastStore } from '@stores/toast'
import { uploadApi } from '@services/upload.api'
import { useSocket } from '@composables/useSocket'
import type { Cv, CvSource, CvStatus, CvFailureReason } from '@/types/cv'
import { getAiScore } from '@/types/cv'
import { scoreLabel } from '@/utils/aiScore'
import type { CvLanguage } from '@/utils/cvLabels'
import { clampTemplateId } from '@/utils/cvTemplates'
import CvThumbnail from '@components/cv/thumbnails/CvThumbnail.vue'
import UploadFilesDialog from '@components/upload/UploadFilesDialog.vue'
import type { UploadItem } from '@components/upload/UploadFilesDialog.vue'
import CvDetailView from '@components/cv/CvDetailView.vue'
import CvTemplateLightbox from '@components/cv/CvTemplateLightbox.vue'
import CvBuilderEditor from '@components/cv/builder/CvBuilderEditor.vue'

// ===== Wire API — lấy CV list từ cvStore (cùng pattern MyResumesView) =====
const cvStore = useCvStore()
const { items, loading, total, page, pageSize, totalPages } = storeToRefs(cvStore)
const router = useRouter()
const toast = useToastStore()

/* ===== Upload dialog — mở từ nút Upload trong FILTERS =====
 * Flow 2 bước: dialog đã upload file lên MinIO (item success có result.url/
 * key/mime). "Đính kèm" chỉ còn bước 2 — POST /cvs/upload tạo CV row
 * (source='upload', status='parsing'), BE tự enqueue job parse AI; FE theo
 * dõi kết quả qua socket `cv:status-changed` ở trang list CV.
 * Dialog đã cap 3 file/lần để khớp `cvAiRateLimiter` (3 req/phút/user). */
const showUpload = ref<boolean>(false)
const isAttaching = ref<boolean>(false)
const onUploadAttach = async (files: UploadItem[]): Promise<void> => {
  if (!files.length || isAttaching.value) return
  isAttaching.value = true
  let ok = 0
  let lastError: string | null = null
  try {
    // Tuần tự (không Promise.all) — lỗi từng file tách bạch, dừng sớm gọn.
    for (const f of files) {
      if (!f.result) continue
      const created = await cvStore.upload({
        // Filename gốc (bỏ extension) làm title — listCV dễ nhận biết.
        title: f.name.replace(/\.[^.]+$/, ''),
        fileUrl: f.result.url,
        fileType: f.result.mime,
      })
      if (created) ok++
      else {
        lastError = cvStore.error ?? 'Không tạo được CV.'
        // Dọn orphan: file đã nằm trên MinIO nhưng không có CV row trỏ tới.
        // Best-effort — lỗi xoá không đổi outcome của toast.
        if (f.result.key) uploadApi.removeFile(f.result.key).catch(() => {})
      }
    }
  } finally {
    isAttaching.value = false
  }
  if (ok > 0 && ok === files.length) {
    toast.success(`Đã thêm ${ok} CV. Đang phân tích...`)
    router.push('/candidate/resumes')
  } else if (ok > 0) {
    toast.warning(`Đã thêm ${ok}/${files.length} CV. ${lastError ?? 'Phần còn lại lỗi.'}`)
  } else {
    toast.error(lastError ?? 'Không tạo được CV. Vui lòng thử lại.')
  }
}

const formatDate = (cv: Cv): string => {
  const raw = cv.updatedAt || cv.createdAt
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

onMounted(async () => {
  await cvStore.fetchList(undefined, undefined, undefined, true)
})

/* ===== Socket `cv:status-changed` — tắt spinner khi parse xong =====
 * Mirror MyResumesView: worker emit status mới → store updateStatus patch
 * local, card tự bỏ overlay "Đang phân tích" mà không cần refetch. Status
 * terminal ('ready'/'failed') re-fetch full row để lấy ai_analysis mới
 * (score badge + brain icon hiện đúng). */
useSocket(
  'cv:status-changed',
  (payload: { cvId: string; status: CvStatus; failureReason?: CvFailureReason | null }) => {
    const { cvId, status, failureReason } = payload
    if (!cvId || !status) return
    cvStore.updateStatus(cvId, status, failureReason ?? null)
    if (status === 'ready' || status === 'failed') void cvStore.refreshDetail(cvId)
  },
)

/** CV đang trong pipeline parse/analyze → hiện overlay spinner trên card. */
const isProcessing = (cv: Cv): boolean =>
  cv.status === 'pending' || cv.status === 'parsing' || cv.status === 'analyzing'

/* ===== Re-analyze — nút brain hiện khi hover card CV đã parse =====
 * POST /cvs/:cvId/analyze qua cvStore.triggerAnalysis — store applyRow patch
 * row local (status='analyzing') nên overlay spinner hiện ngay, không đợi
 * socket. Fail (kể cả 429 quota) → toast lỗi từ cvStore.error. */
const analyzingId = ref<string | null>(null)
const handleAnalyze = async (cv: Cv): Promise<void> => {
  if (analyzingId.value) return
  analyzingId.value = cv.id
  try {
    const ok = await cvStore.triggerAnalysis(cv.id)
    if (!ok) toast.error(cvStore.error ?? 'Không gọi được phân tích AI.')
  } finally {
    analyzingId.value = null
  }
}

/* ===== Tab filter "CV của tôi" — Tất cả / Upload / Thủ công =====
 * Server-side qua cvStore.fetchList (?source=) — mirror handleSourceChange
 * ở MyResumesView: tab 'all' cần resetFilters=true để clear query.source
 * vì fetchList mặc định coi undefined = "giữ nguyên source hiện tại". */
type SourceTab = 'all' | CvSource
const sourceTab = ref<SourceTab>('all')
const sourceTabs: Array<{ value: SourceTab; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'upload', label: 'Upload' },
  { value: 'direct', label: 'Thủ công' },
]
const sourceToQuery = (s: SourceTab): CvSource | undefined =>
  s === 'all' ? undefined : s

const handleSourceChange = async (s: SourceTab): Promise<void> => {
  sourceTab.value = s
  await cvStore.fetchList(sourceToQuery(s), 1, undefined, s === 'all')
}

/* ===== Phân trang — server-side qua store (page/total/totalPages) =====
 * fetchList(source, pageNum) với q=undefined nghĩa là "giữ nguyên q hiện tại"
 * — search/source đổi đã tự reset page=1 phía store và watch. */
const goToPage = async (p: number): Promise<void> => {
  const target = Math.min(Math.max(1, p), totalPages.value)
  if (target === page.value) return
  await cvStore.fetchList(sourceToQuery(sourceTab.value), target, undefined)
}

/* ===== Chi tiết CV — click card mở CvDetailView =====
 * detailId ref theo store items (computed find) → sau setPrimary/remove ở
 * parent, modal tự cập nhật theo row mới mà không cần giữ object cũ. */
const detailId = ref<string | null>(null)
const detailCv = computed<Cv | null>(
  () => items.value.find((c) => c.id === detailId.value) ?? null,
)
const openDetail = (cv: Cv): void => {
  detailId.value = cv.id
}
const closeDetail = (): void => {
  detailId.value = null
}
const settingPrimaryId = ref<string | null>(null)
const onSetPrimary = async (cvId: string): Promise<void> => {
  settingPrimaryId.value = cvId
  const ok = await cvStore.setPrimary(cvId)
  settingPrimaryId.value = null
  if (ok) toast.success('Đã đặt làm CV chính.')
  else toast.error(cvStore.error ?? 'Không đặt được CV chính.')
}
const deletingId = ref<string | null>(null)
const onDeleteCv = async (cv: Cv): Promise<void> => {
  deletingId.value = cv.id
  const ok = await cvStore.remove(cv.id)
  deletingId.value = null
  if (ok) {
    toast.success('Đã xóa CV.')
    closeDetail() // row đã bị xoá khỏi list — đóng modal để không render row mồ côi
  } else {
    toast.error(cvStore.error ?? 'Không xóa được CV.')
  }
}
/* ===== Builder overlay — CvBuilderEditor nhúng ngay trong trang =====
 * Mở từ 3 entry: nút "Tạo mới" (create), lightbox "Dùng mẫu này" (create
 * kèm templateId + ngôn ngữ đang chọn), menu "Sửa" CV direct (edit kèm cvId).
 * Lưu thành công → đóng overlay + refresh list (reset filter để CV mới
 * chắc chắn hiển thị). Không còn route sang CreateResumeView. */
const builderOpen = ref(false)
const builderCvId = ref<string | null>(null)
const builderTemplateId = ref(1)
const builderLanguage = ref<CvLanguage>('en')

const openCreateBuilder = (): void => {
  builderCvId.value = null
  builderTemplateId.value = 1
  builderOpen.value = true
}

/** Lưu thành công trong builder → đóng overlay + refresh list (reset filter
 *  về mặc định để CV mới/chỉnh sửa chắc chắn hiển thị). */
const onBuilderSaved = (): void => {
  builderOpen.value = false
  void cvStore.fetchList(undefined, undefined, undefined, true)
}

const onEditCv = (cv: Cv): void => {
  closeDetail()
  builderCvId.value = cv.id
  builderOpen.value = true
}
/** Adapter — dialog emit cvId, handleAnalyze nhận Cv. */
const onAnalyzeFromDetail = (cvId: string): void => {
  const cv = detailCv.value
  if (cv) void handleAnalyze(cv)
}

/* ===== Chi tiết template demo — click card "Mẫu CV từ hệ thống" =====
 * Fake Cv (direct, templateId 1-7) mở CvDetailView chế độ demo: chỉ tab
 * Chi tiết + CTA "Dùng mẫu này" → route sang CreateResumeView kèm templateId. */
const tplDetailCv = ref<Cv | null>(null)

/** Ngôn ngữ tiêu đề section khi xem chi tiết mẫu (lightbox "Mẫu CV từ
 *  hệ thống"). UI-only — không persist; default 'en' theo yêu cầu. */
const templateLanguage = ref<CvLanguage>('en')

const onUseTemplate = (cv: Cv): void => {
  tplDetailCv.value = null
  builderCvId.value = null
  builderTemplateId.value = clampTemplateId(cv.templateId ?? 1)
  // Đồng bộ mode ngôn ngữ tiêu đề đang chọn ở lightbox sang builder.
  builderLanguage.value = templateLanguage.value
  builderOpen.value = true
}

/* ===== Search theo title — server-side (?q=), debounce 400ms =====
 * Mirror watch(searchQuery) ở MyResumesView: giữ nguyên source filter
 * (fetchList(undefined, ...) = không đổi source), q đổi → store tự về page 1.
 * Trim trước khi gửi; empty sau trim → undefined (BE reject empty string). */
const searchQuery = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null
const SEARCH_DEBOUNCE_MS = 400
watch(searchQuery, (val) => {
  if (searchTimer) clearTimeout(searchTimer)
  const trimmed = val.trim()
  // Empty sau trim → null (CLEAR q) — undefined nghĩa là "giữ nguyên q cũ"
  // → list sẽ không về ban đầu khi user xoá hết text.
  const q = trimmed.length > 0 ? trimmed : null
  searchTimer = setTimeout(() => {
    void cvStore.fetchList(undefined, undefined, q)
  }, SEARCH_DEBOUNCE_MS)
})
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

/* ===== AI-Generated Templates — render 5 template thật từ components/cv =====
 * Mỗi card dựng 1 Cv "direct" giả (templateId 1-7) + parsedData mẫu chung,
 * đưa qua CvThumbnail để render đúng CvThumbnailTemplate{1-5} (cùng đường
 * render như card "CV của tôi"). parsedData key khớp buildRenderData
 * (name/position/summary/education/experience/skills/...). */
const aiParsedData: Record<string, unknown> = {
  name: 'Edward Smith',
  position: 'UI/UX Designer',
  email: 'info@email.com',
  phone: '+112 456 890099',
  portfolio: 'www.example.com',
  address: '1234, Address, 4rd/New york Street, New York City 4560',
  avatarUrl: '/avatars/template1-portrait.jpg',
  summary:
    "I'm Edward Smith, Lorem ipsum dolor sit amet, dolor consectetur adipiscing elit. Vivamus volutpat amet dolor sit id. Consectetur adipiscing elit vivamus volutpat libero lorem ipsum dolor. Vivamus volutpat sit id. Lorem ipsum dolor sit amet, consectetur adipiscing elit vivamus. Volutpat sit id.\nAutem dolor consectetur adipiscing elit vivamus. Mauris sit amet adipiscing elit vivamus. Volutpat libero lorem ipsum dolor vivamus.",
  education: [
    {
      school: 'University Name / Location',
      degree: 'Degree name here',
      startYear: '2015',
      endYear: '2016',
    },
    {
      school: 'University Name / Location',
      degree: 'Degree name here',
      startYear: '2010',
      endYear: '2015',
    },
    {
      school: 'University Name / Location',
      degree: 'Degree name here',
      startYear: '2008',
      endYear: '2010',
    },
  ],
  experience: [
    {
      company: 'Company Name / Location',
      position: 'Job position title here',
      startDate: '2024',
      endDate: '2029',
      description:
        'Lorem ipsum dolor sit amet, dolor consectetur adipiscing elit. Vivamus volutpat amet dolor sit id. Consectetur adipiscing elit vivamus volutpat libero lorem ipsum dolor. Vivamus volutpat sit id.\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus volutpat sit idolor.\nAmet dolor elit dolor sit amet. Consectetur adipiscing elit vivamus.\nLorem ipsum dolor volutpat lorem consectetur adipiscing elit vivamus.',
    },
    {
      company: 'Company Name / Location',
      position: 'Job position title here',
      startDate: '2020',
      endDate: '2024',
      description:
        'Lorem ipsum dolor sit amet, dolor consectetur adipiscing elit. Vivamus volutpat amet dolor sit id. Consectetur adipiscing elit vivamus volutpat libero lorem ipsum dolor. Vivamus volutpat sit id.\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus volutpat sit idolor.\nAmet dolor elit dolor sit amet. Consectetur adipiscing elit vivamus.\nLorem ipsum dolor volutpat lorem consectetur adipiscing elit vivamus.',
    },
    {
      company: 'Company Name / Location',
      position: 'Job position title here',
      startDate: '2016',
      endDate: '2020',
      description:
        'Lorem ipsum dolor sit amet, dolor consectetur adipiscing elit. Vivamus volutpat amet dolor sit id. Consectetur adipiscing elit vivamus volutpat libero lorem ipsum dolor. Vivamus volutpat sit id.\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus volutpat sit idolor.\nAmet dolor elit dolor sit amet. Consectetur adipiscing elit vivamus.\nLorem ipsum dolor volutpat lorem consectetur adipiscing elit vivamus.',
    },
  ],
  skills: [
    { name: 'Graphic Design', level: 4 },
    { name: 'Project Management', level: 4 },
    { name: 'Market Research', level: 3 },
    { name: 'Branding', level: 4 },
    { name: 'UI/UX Design', level: 5 },
    { name: 'Web Design', level: 4 },
    { name: 'Web Development', level: 3 },
    { name: 'Team Development', level: 4 },
  ],
  certifications: [
    { name: 'Joseph Daniel', issuer: 'Position Here / Company Name', date: '+112 456 8900995' },
    { name: 'Joseph Daniel', issuer: 'Position Here / Company Name', date: '+112 456 8900995' },
  ],
  projects: [
    {
      name: 'JobMatch VN',
      role: 'Frontend Lead',
      time: '2023 — 2024',
      description: 'Nền tảng matching việc làm cho thị trường Việt Nam.',
    },
  ],
  interests: [
    'Graphic Design',
    'Project Management',
    'Market Research',
    'Branding',
    'UI/UX Design',
    'Photography',
  ],
}

/** Tên hiển thị theo style của CVTemplate{1-5}. */
/** Tên hiển thị theo style thật của CVTemplate{1-5}. */
const aiTemplateMeta = [
  { name: 'Cam Hiện Đại' },      // 1 — header cam full-width + 2 cột 35/65
  { name: 'Teal Hình Học' },     // 2 — góc chữ L teal + avatar viền đen
  { name: 'Serif Cổ Điển' },     // 3 — serif 1 cột, header căn giữa
  { name: 'Navy Chuyên Nghiệp' },// 4 — thanh navy + header nền xanh nhạt
  { name: 'Sidebar Cá Tính' },   // 5 — sidebar trái xanh + tam giác decor
  { name: 'Mustard Editorial' }, // 6 — navy/yellow, tên dọc + ảnh chân dung
  { name: 'Ocean Teal Executive' }, // 7 — serif xanh biển, thanh liên hệ ngang
] as const

/** Dựng Cv giả cho CvThumbnail + lightbox — title = tên mẫu (lightbox header). */
const makeAiTemplateCv = (templateId: number, name: string): Cv => ({
  id: `ai-template-${templateId}`,
  candidateId: '',
  title: name,
  fileUrl: null,
  fileType: null,
  isPrimary: false,
  status: 'ready',
  source: 'direct',
  templateId,
  parsedData: aiParsedData,
  ai_analysis: null,
  failureReason: null,
  scoreUpdatedAt: null,
  createdAt: '',
  updatedAt: '',
})

const aiTemplateCvs = aiTemplateMeta.map((meta, i) => ({
  cv: makeAiTemplateCv(i + 1, meta.name),
  name: meta.name,
}))
</script>

<template>
  <div class="font-poppins min-h-screen overflow-auto bg-white text-slate-700">
    <!-- ============== MAIN ============== -->
    <main class="min-w-0 flex-1 overflow-auto px-10 pb-7 pt-10">
      <!-- HERO -->
      <section class="relative flex h-[138px] items-center justify-center overflow-hidden rounded-[13px] bg-gradient-to-r from-[#faf3e8] via-white to-[#eef6ee] text-center">
        <!-- Left paper -->
        <div class="absolute -left-2 top-6 w-[94px] rotate-[-7deg] rounded-[9px] bg-white p-3 shadow-[0_8px_20px_rgba(0,0,0,0.06)]">
          <div class="text-[9px] font-bold text-slate-900">
            Resume
          </div>
          <div class="mt-2 flex flex-col gap-1">
            <span class="h-1 rounded bg-slate-200" />
            <span class="h-1 w-4/5 rounded bg-slate-200" />
            <span class="h-1 w-3/5 rounded bg-slate-200" />
            <span class="h-1 rounded bg-slate-200" />
            <span class="h-1 w-4/5 rounded bg-slate-200" />
            <span class="h-1 rounded bg-slate-200" />
          </div>
        </div>

        <!-- Right paper -->
        <div class="absolute -right-1.5 top-6 w-[94px] rotate-[7deg] rounded-[9px] bg-white p-3 shadow-[0_8px_20px_rgba(0,0,0,0.06)]">
          <div class="text-[9px] font-bold text-slate-900">
            Resume
          </div>
          <div class="mt-2 flex flex-col gap-1">
            <span class="h-1 rounded bg-slate-200" />
            <span class="h-1 w-4/5 rounded bg-slate-200" />
            <span class="h-1 w-3/5 rounded bg-slate-200" />
            <span class="h-1 rounded bg-slate-200" />
            <span class="h-1 w-4/5 rounded bg-slate-200" />
            <span class="h-1 rounded bg-slate-200" />
          </div>
        </div>

        <div>
          <h1 class="mb-1.5 text-[20px] font-semibold text-slate-900">
            Chào mừng bạn đến với thư viện CV của JobMatch
          </h1>
          <p class="mb-3 text-[14px] text-slate-500">
            Quản lý tất cả CV của bạn, khám phá các mẫu CV được tạo bởi hệ thống JobMatch.
          </p>
          <div class="mx-auto flex h-[30px] w-[480px] max-w-[70%] overflow-hidden rounded-lg border border-slate-200 bg-white p-0.5">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Tìm CV theo tên..."
              class="min-w-0 flex-1 border-0 px-2 text-[14px] text-slate-500 outline-none placeholder:text-slate-400 focus:ring-0 focus-visible:ring-0"
            >
            <button class="grid h-[24px] w-[24px] place-items-center rounded-md bg-blue-700 text-white">
              <Search :size="13" />
            </button>
          </div>
        </div>
      </section>

      <!-- FILTERS -->
      <div class="my-3 flex items-center gap-1.5">
        <button
          type="button"
          class="flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[14px] text-slate-600"
          @click="showUpload = true"
        >
          <Upload :size="13" />
          Upload
        </button>
        
        <button
          type="button"
          class="flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[14px] text-slate-600"
          @click="openCreateBuilder"
        >
          <Palette :size="13" />
          Tạo mới
        </button>
      </div>

      <!-- FRESHLY PUBLISHED -->
      <section class="mb-[18px]">
        <div class="mb-0.5 flex items-center gap-1.5">
          <h2 class="m-0 text-[15px] font-semibold">
            CV của tôi
          </h2>
          <ChevronRight :size="14" class="text-slate-500" />

          <!-- Source tabs — Tất cả / Upload / Thủ công (filter client-side) -->
          <div class="ml-auto flex overflow-hidden rounded-md border border-slate-200">
            <button
              v-for="(tab, i) in sourceTabs"
              :key="tab.value"
              class="flex h-[27px] items-center px-3 text-[14px] font-medium transition-colors"
              :class="[
                sourceTab === tab.value
                  ? 'bg-blue-700 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50',
                i > 0 ? 'border-l border-slate-100' : '',
              ]"
              :aria-pressed="sourceTab === tab.value"
              @click="handleSourceChange(tab.value)"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>
        <div class="mb-2.5 text-[12px] text-slate-500">
          Danh sách CV thực tế từ hồ sơ của bạn.
        </div>

        <!-- Loading state -->
        <div
          v-if="loading && items.length === 0"
          class="flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white py-12 text-xs text-slate-500"
          role="status"
        >
          <Loader2 :size="14" class="animate-spin text-slate-400" />
          Đang tải CV của bạn…
        </div>

        <!-- Empty state — theo query server-side hiện tại -->
        <div
          v-else-if="!loading && items.length === 0"
          class="rounded-md border border-slate-200 bg-white py-12 text-center text-xs text-slate-500"
        >
          {{ searchQuery.trim() || sourceTab !== 'all' ? 'Không có CV nào phù hợp.' : 'Bạn chưa có CV nào. Tạo CV mới để bắt đầu.' }}
        </div>

        <!-- Grid — render thật từ API, preview PDF/template qua CvThumbnail.
             Card đã AI phân tích thì hiện chip điểm ở góc dưới phải
             (overlay trên gradient, tone theo scoreLabel). -->
        <div v-else class="grid w-full grid-cols-4 gap-2.5">
          <div
            v-for="cv in items"
            :key="cv.id"
            class="template-card group cursor-pointer"
            @click="openDetail(cv)"
          >
            <div class="resume-preview bg-white">
              <CvThumbnail :cv="cv" fit="cover" class="w-full h-full" />
            </div>

            <div class="template-info">
              <div class="truncate text-[13px] font-semibold text-slate-700">
                {{ cv.title?.trim() || 'CV chưa đặt tên' }}
              </div>
              <div class="text-[11px] text-slate-500">
                {{ formatDate(cv) || '—' }}
              </div>
            </div>

            <!-- Icon chỉ báo "đã AI phân tích" — absolute góc trên phải,
                 nằm trên vùng preview (z-index cao hơn .resume-preview z=1). -->
            <!-- Brain icon tĩnh đã bỏ — CV ready chỉ hiện brain khi hover
                 (nút "phân tích lại" ở dưới, group-hover:opacity-100). -->

            <!-- Icon "lỗi phân tích" — góc trên phải, CV parse fail. Màu đỏ
                 override .cv-ai-icon, tooltip kèm lý do failureReason từ BE. -->
            <span
              v-if="cv.status === 'failed'"
              class="cv-ai-icon !bg-red-100 !text-red-600"
              :title="`Phân tích thất bại - Đây có thể không phải CV chuẩn`"
            >
              <AlertTriangle :size="12" />
            </span>

            <!-- AI score badge (chỉ CV đã phân tích) — absolute góc dưới phải,
                 z-index cao hơn .template-info (z=10) để nằm trên gradient. -->
            <span
              v-if="getAiScore(cv) !== null"
              class="cv-ai-score"
              :class="scoreLabel(getAiScore(cv) as number).tone"
              :title="`Điểm AI: ${getAiScore(cv)}/100`"
            >
              {{ getAiScore(cv) }}
            </span>

            <!-- Nút "phân tích lại" — hiện khi hover card CV đã parse (ready).
                 Đè lên brain badge (cùng vị trí góc trên phải, sau trong DOM).
                 Trong lúc gọi hiện spinner; xong thì overlay "Đang phân tích"
                 phủ card (store applyRow → status='analyzing'). -->
            <button
              v-if="cv.status === 'ready'"
              type="button"
              class="cv-ai-icon cursor-pointer !bg-white !text-[#5b4eea] opacity-0 shadow-[0_2px_6px_rgba(15,23,42,0.15)] transition-opacity duration-150 group-hover:opacity-100"
              title="Phân tích lại bằng AI"
              @click.stop="handleAnalyze(cv)"
            >
              <Loader2 v-if="analyzingId === cv.id" :size="12" class="animate-spin" />
              <Brain v-else :size="12" />
            </button>

            <!-- Overlay "đang phân tích" — CV upload mới chờ worker parse xong.
                 inset-0 + overflow:hidden của .template-card tự clip bo góc. -->
            <div
              v-if="isProcessing(cv)"
              class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 bg-white/75"
            >
              <Loader2 :size="18" class="animate-spin text-[#5b4eea]" />
              <span class="text-[14px] font-medium text-slate-600">Đang phân tích…</span>
            </div>
          </div>
        </div>

        <!-- Pagination — server-side qua store (page/total/totalPages), chỉ
             hiện khi tổng CV vượt 1 trang (pageSize=8). -->
        <nav
          v-if="total > pageSize"
          class="mt-3 flex items-center justify-between text-[11px] text-slate-500"
          aria-label="Phân trang"
        >
          <p>
            Trang <strong class="font-semibold text-slate-800">{{ page }}</strong>
            <span class="mx-1 text-slate-300">/</span>
            <strong class="font-semibold text-slate-800">{{ totalPages }}</strong>
            <span class="mx-1.5 text-slate-300">·</span>
            {{ total }} CV
          </p>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="page <= 1 || loading"
              aria-label="Trang trước"
              @click="goToPage(page - 1)"
            >
              <ChevronLeft :size="13" />
            </button>
            <button
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="page >= totalPages || loading"
              aria-label="Trang sau"
              @click="goToPage(page + 1)"
            >
              <ChevronRight :size="13" />
            </button>
          </div>
        </nav>
      </section>

      <!-- AI GENERATED -->
      <section class="mb-[18px]">
        <div class="mb-0.5 flex items-center gap-1.5">
          <h2 class="m-0 text-[15px] font-semibold">
            Mẫu CV từ hệ thống JobMatch
          </h2>
          <ChevronRight :size="14" class="text-slate-500" />
        </div>
        <div class="mb-2.5 text-[12px] text-slate-500">
          Mẫu CV được tạo bởi hệ thống dựa trên các vai trò công việc, cấp độ kinh nghiệm và nhu cầu của ngành nghề.
        </div>

        <div class="grid w-full grid-cols-4 gap-2.5">
          <div
            v-for="tpl in aiTemplateCvs"
            :key="tpl.cv.id"
            class="template-card template-card--tall group cursor-pointer"
            @click="tplDetailCv = tpl.cv"
          >
            <div class="resume-preview bg-white">
              <CvThumbnail :cv="tpl.cv" fit="cover" class="w-full h-full" />
            </div>

            <div class="template-info">
              <div class="truncate text-[13px] font-medium text-slate-700">
                {{ tpl.name }}
              </div>
              <div class="text-[11px] text-slate-500">
                Từ hệ thống JobMatch
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- BOTTOM FEATURES -->
      <div class="mt-1 grid grid-cols-2 gap-2.5">
        <div class="feature-card">
          <Sparkles class="absolute right-3 top-3 text-[#ff8b24]" :size="14" />
          <h3 class="m-0 mb-1 text-[12px] font-semibold">
            Most Popular Templates
          </h3>
          <p class="m-0 w-[57%] text-[9px] leading-relaxed text-slate-500">
            Frequently used templates with proven results.
          </p>
          <div class="feature-link">
            View popular templates　›
          </div>
          <div class="feature-paper">
            <div class="paper-row" />
            <div class="paper-row" />
            <div class="paper-row short" />
            <div class="paper-row" />
            <div class="paper-row" />
          </div>
        </div>

        <div class="feature-card">
          <h3 class="m-0 mb-1 text-[12px] font-semibold">
            Designed to Pass ATS
          </h3>
          <p class="m-0 w-[57%] text-[9px] leading-relaxed text-slate-500">
            Clean, structured templates optimized for applicant tracking systems.
          </p>
          <div class="feature-link">
            View popular templates　›
          </div>
          <div class="feature-paper">
            <div class="paper-row" />
            <div class="paper-row" />
            <div class="paper-row short" />
            <div class="paper-row" />
            <div class="paper-row" />
            <div class="paper-row" />
          </div>
        </div>
      </div>
    </main>

    <!-- Upload dialog — bind v-model với nút Upload trong FILTERS row. -->
    <UploadFilesDialog v-model="showUpload" @attach="onUploadAttach" />

    <!-- Detail dialog — click card mở. cv reactive từ store nên set-primary/
         delete ở parent xong, nội dung modal tự cập nhật. -->
    <CvDetailView
      :open="detailCv !== null"
      :cv="detailCv"
      :setting-primary="settingPrimaryId !== null"
      :deleting="deletingId !== null"
      :analyzing="detailCv !== null && analyzingId === detailCv.id"
      :language="templateLanguage"
      @close="closeDetail"
      @set-primary="onSetPrimary"
      @edit="onEditCv"
      @delete="onDeleteCv"
      @analyze="onAnalyzeFromDetail"
    />

    <!-- Template demo lightbox — click card "Mẫu CV từ hệ thống" mở khung
         full-size A4 như trang /test6. CTA "Dùng mẫu này" → mở builder overlay. -->
    <CvTemplateLightbox
      :open="tplDetailCv !== null"
      :cv="tplDetailCv"
      v-model:language="templateLanguage"
      @close="tplDetailCv = null"
      @use-template="onUseTemplate"
    />

    <!-- ===== Builder overlay — nền trong suốt (dim + blur trang list phía
         sau), chỉ nổi 2 ô: preview card (trái) + form card (phải) và các
         nút. Click ra vùng dim cũng đóng. ===== -->
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
          v-if="builderOpen"
          class="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 px-4 pt-4 backdrop-blur-sm sm:px-6 sm:pt-6 lg:px-8 lg:pt-8"
          @click.self="builderOpen = false"
        >
          <!-- Nút đóng nổi góc phải — không top bar để 2 ô editor là trung tâm -->
          <button
            type="button"
            class="fixed right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-white text-slate-600 shadow-lg ring-1 ring-slate-900/10 transition-colors hover:text-slate-900"
            aria-label="Đóng"
            @click="builderOpen = false"
          >
            <X :size="16" />
          </button>

          <div class="mx-auto w-full max-w-[1500px]">
            <CvBuilderEditor
              :cv-id="builderCvId"
              :initial-template-id="builderTemplateId"
              :initial-language="builderLanguage"
              @saved="onBuilderSaved"
              @cancel="builderOpen = false"
            />
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.template-card {
  position: relative;
  height: 170px;
  overflow: hidden;
  border-radius: 14px;
  border: 1px solid #e6e7e9;
  background: #fff;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.template-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.07);
}

/* Card mẫu CV (AI-Generated Templates) — cao hơn card "CV của tôi" để preview
 * hiện được nhiều nội dung hơn. */
.template-card--tall {
  height: 270px;
}

.resume-preview {
  position: absolute;
  top: 10px;
  bottom: 0;
  left: 10px;
  right: 10px;
  height: auto;
  overflow: hidden;
  border-radius: 6px 6px 0 0;
  background: #fff;
  color: #555;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
  z-index: 1;
}

.resume-preview :deep(canvas) {
  width: 100% !important;
  height: 100% !important;
  object-fit: cover !important;
  object-position: top center !important;
}

.resume-preview :deep(img.object-cover) {
  object-position: top center !important;
}

.resume-preview::after {
  content: '';
  position: absolute;
  inset: auto 0 0 0;
  height: 48px;
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.22) 30%,
    rgba(255, 255, 255, 0.65) 68%,
    rgba(255, 255, 255, 0.9) 100%
  );
  pointer-events: none;
  z-index: 3;
}

.template-info {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  padding: 16px 12px 9px 12px;
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.55) 32%,
    rgba(255, 255, 255, 0.92) 70%,
    #ffffff 100%
  );
}

/* ===== Icon chỉ báo AI phân tích — góc trên phải =====
 * Chip tròn trắng nhỏ + icon Sparkles màu accent cam (đồng bộ #ff8b24 dùng
 * ở hero + feature card). Nằm trên .resume-preview (z=1). */
.cv-ai-icon {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 9999px;
  background: #fff;
  color: #ff8b24;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

/* ===== AI score badge góc dưới phải =====
 * Overlay trên .template-info (z=10), padding-right của info đã 12px → date
 * (căn trái, dòng dưới) không chồng badge ở góc phải. Tone class từ
 * scoreLabel (emerald/primary/amber/red). */
.cv-ai-score {
  position: absolute;
  bottom: 8px;
  right: 8px;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  min-width: 28px;
  padding: 0 6px;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  /* Tăng vùng không chạm để hover dễ — không ảnh hưởng layout. */
  padding-top: 2px;
  padding-bottom: 2px;
}

.feature-card {
  position: relative;
  height: 118px;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid #e8eaec;
  padding: 14px;
  background: linear-gradient(100deg, #fff, #fafafa);
}

.feature-link {
  position: absolute;
  bottom: 13px;
  left: 14px;
  font-size: 9px;
  color: #5f6368;
}

.feature-paper {
  position: absolute;
  right: 17px;
  bottom: -25px;
  width: 88px;
  height: 125px;
  background: #fff;
  transform: rotate(7deg);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.08);
  padding: 11px;
}

.paper-row {
  height: 5px;
  background: #e0e2e4;
  border-radius: 5px;
  margin-bottom: 6px;
}
.paper-row.short {
  width: 60%;
}
</style>
