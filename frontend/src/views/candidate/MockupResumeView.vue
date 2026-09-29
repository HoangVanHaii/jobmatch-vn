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
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import {
  Search,
  ChevronDown,
  ChevronRight,
  Bookmark,
  ListFilter,
  Palette,
  Grid2x2,
  List as ListIcon,
  Sparkles,
  Brain,
  Loader2,
} from 'lucide-vue-next'
import { useCvStore } from '@stores/cv'
import type { Cv } from '@/types/cv'
import { getAiScore } from '@/types/cv'
import { scoreLabel } from '@/utils/aiScore'
import CvThumbnail from '@components/cv/thumbnails/CvThumbnail.vue'

// ===== Wire API — lấy CV list từ cvStore (cùng pattern MyResumesView) =====
const cvStore = useCvStore()
const { items, loading } = storeToRefs(cvStore)

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

/** Bottom feature cards — giữ nguyên mockup (không phải data từ API). */
const aiTemplates = [
  { title: 'Clean Starter Resume', date: 'Thomas Luke', style: 'minimal' },
  { title: 'Editorial Style CV', date: 'Mark Moore', style: 'modern' },
  { title: 'Structured Career Resume', date: 'Alex Williams', style: 'classic' },
  { title: 'Vibrant Skills Resume', date: 'Jerry Hernandez', style: 'yellow' },
] as const
</script>

<template>
  <div class="font-poppins min-h-screen overflow-auto bg-white text-slate-700">
    <!-- ============== MAIN ============== -->
    <main class="min-w-0 flex-1 overflow-auto px-10 pb-7 pt-10">
      <!-- HERO -->
      <section class="relative flex h-[138px] items-center justify-center overflow-hidden rounded-[13px] bg-gradient-to-r from-[#faf3e8] via-white to-[#eef6ee] text-center">
        <!-- Left paper -->
        <div class="absolute -left-2 top-6 w-[94px] rotate-[-7deg] rounded-[9px] bg-white p-3 opacity-80 shadow-[0_8px_20px_rgba(0,0,0,0.06)]">
          <div class="text-[7px] font-bold">
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
        <div class="absolute -right-1.5 top-6 w-[94px] rotate-[7deg] rounded-[9px] bg-white p-3 opacity-80 shadow-[0_8px_20px_rgba(0,0,0,0.06)]">
          <div class="text-[7px] font-bold">
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
          <h1 class="mb-1.5 text-[15px] font-semibold text-slate-900">
            Welcome to the Template Library 🎉
          </h1>
          <p class="mb-3 text-[10px] text-slate-500">
            Browse professionally designed resume templates. Customize them easily, or let AI help you create one that fits your goals.
          </p>
          <div class="mx-auto flex h-[30px] w-[480px] max-w-[70%] overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div class="flex h-full items-center gap-1.5 border-r border-slate-200 px-2.5 text-[10px] text-slate-600">
              Role <ChevronDown :size="11" />
            </div>
            <div class="flex h-full items-center gap-1.5 border-r border-slate-200 px-2.5 text-[10px] text-slate-600">
              Style <ChevronDown :size="11" />
            </div>
            <input
              type="text"
              placeholder="Search by role, industry, or style"
              class="min-w-0 flex-1 border-0 px-2 text-[10px] text-slate-500 outline-none placeholder:text-slate-400"
            >
            <button class="m-0.5 grid h-[27px] w-[27px] place-items-center rounded-lg bg-[#ff8b24] text-white">
              <Search :size="13" />
            </button>
          </div>
        </div>
      </section>

      <!-- FILTERS -->
      <div class="my-3 flex items-center gap-1.5">
        <button class="flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] text-slate-600">
          <Bookmark :size="13" />
          Saved
        </button>
        <button class="flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] text-slate-600">
          <ListFilter :size="13" />
          Creation Type
        </button>
        <button class="flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] text-slate-600">
          <Palette :size="13" />
          Style
        </button>
        <button class="flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] text-slate-600">
          Industry <ChevronDown :size="13" />
        </button>

        <div class="ml-auto flex overflow-hidden rounded-md border border-slate-200">
          <button class="grid h-[27px] w-[27px] place-items-center bg-white text-slate-500">
            <Grid2x2 :size="13" />
          </button>
          <button class="grid h-[27px] w-[27px] place-items-center border-l border-slate-100 bg-white text-slate-500">
            <ListIcon :size="13" />
          </button>
        </div>
      </div>

      <!-- FRESHLY PUBLISHED -->
      <section class="mb-[18px]">
        <div class="mb-0.5 flex items-center gap-1.5">
          <h2 class="m-0 text-[13px] font-semibold">
            CV của tôi
          </h2>
          <ChevronRight :size="14" class="text-slate-500" />
        </div>
        <div class="mb-2.5 text-[9px] text-slate-500">
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

        <!-- Empty state -->
        <div
          v-else-if="!loading && items.length === 0"
          class="rounded-md border border-slate-200 bg-white py-12 text-center text-xs text-slate-500"
        >
          Bạn chưa có CV nào. Tạo CV mới để bắt đầu.
        </div>

        <!-- Grid — render thật từ API, preview PDF/template qua CvThumbnail.
             Card đã AI phân tích thì hiện chip điểm ở góc dưới phải
             (overlay trên gradient, tone theo scoreLabel). -->
        <div v-else class="grid w-full grid-cols-4 gap-2.5">
          <div
            v-for="cv in items"
            :key="cv.id"
            class="template-card group"
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
            <span
              v-if="getAiScore(cv) !== null"
              class="cv-ai-icon"
              title="Đã phân tích bằng AI"
            >
              <Brain :size="12" />
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
          </div>
        </div>
      </section>

      <!-- AI GENERATED -->
      <section class="mb-[18px]">
        <div class="mb-0.5 flex items-center gap-1.5">
          <h2 class="m-0 text-[13px] font-semibold">
            AI-Generated Templates
          </h2>
          <ChevronRight :size="14" class="text-slate-500" />
        </div>
        <div class="mb-2.5 text-[9px] text-slate-500">
          Templates created by AI based on job roles, experience level, and industry needs.
        </div>

        <div class="grid w-full grid-cols-4 gap-2.5">
          <!-- Card 1 — Minimal -->
          <div class="template-card group">
            <div class="resume-preview bg-white p-2.5">
              <div class="text-[8px] font-bold">
                Gabriella Karl
              </div>
              <div class="my-1.5 h-px bg-slate-200" />
              <div class="mt-1 mb-1 text-[4px] font-bold text-slate-600">
                Professional Summary
              </div>
              <div class="h-1 w-full rounded bg-slate-200" />
              <div class="mt-1 h-1 w-full rounded bg-slate-200" />
              <div class="mt-2 grid grid-cols-[1.25fr_0.75fr] gap-3.5">
                <div>
                  <div class="mt-1 mb-1 text-[4px] font-bold text-slate-600">
                    Education
                  </div>
                  <div class="h-1 w-full rounded bg-slate-200" />
                  <div class="mt-1 h-1 w-3/5 rounded bg-slate-200" />
                </div>
                <div>
                  <div class="mt-1 mb-1 text-[4px] font-bold text-slate-600">
                    Skills
                  </div>
                  <div class="h-1 w-full rounded bg-slate-200" />
                  <div class="mt-1 h-1 w-3/5 rounded bg-slate-200" />
                </div>
              </div>
            </div>
            <div class="template-info">
              <div class="truncate text-[13px] font-medium text-slate-700">
                {{ aiTemplates[0].title }}
              </div>
              <div class="text-[11px] text-slate-500">
                {{ aiTemplates[0].date }}
              </div>
            </div>
          </div>

          <!-- Card 2 — Modern -->
          <div class="template-card group">
            <div class="resume-preview bg-white p-2.5">
              <div class="text-[15px] font-bold leading-[13px] text-slate-900">
                Mike<br>Lewis<span class="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-[#ef7924] align-middle" />
              </div>
              <div class="mt-2 grid grid-cols-2 gap-2.5">
                <div>
                  <div class="mt-1 mb-1 text-[4px] font-bold text-slate-600">
                    Profile
                  </div>
                  <div class="h-1 w-full rounded bg-slate-200" />
                  <div class="mt-1 h-1 w-3/5 rounded bg-slate-200" />
                </div>
                <div>
                  <div class="mt-1 mb-1 text-[4px] font-bold text-slate-600">
                    Experience
                  </div>
                  <div class="h-1 w-full rounded bg-slate-200" />
                  <div class="mt-1 h-1 w-full rounded bg-slate-200" />
                </div>
              </div>
            </div>
            <div class="template-info">
              <div class="truncate text-[13px] font-medium text-slate-700">
                {{ aiTemplates[1].title }}
              </div>
              <div class="text-[11px] text-slate-500">
                {{ aiTemplates[1].date }}
              </div>
            </div>
          </div>

          <!-- Card 3 — Classic -->
          <div class="template-card group">
            <div class="resume-preview bg-white p-2.5">
              <div class="flex items-start justify-between">
                <div>
                  <div class="text-[7px] font-bold text-slate-800">
                    Frederick Frank
                  </div>
                  <div class="mt-0.5 h-1 w-3/5 rounded bg-slate-200" />
                </div>
                <div class="flex w-7 flex-col gap-0.5">
                  <span class="h-0.5 rounded bg-slate-300" />
                  <span class="h-0.5 rounded bg-slate-300" />
                  <span class="h-0.5 rounded bg-slate-300" />
                </div>
              </div>
              <div class="my-1.5 h-px bg-slate-200" />
              <div class="grid grid-cols-[1.25fr_0.75fr] gap-3.5">
                <div>
                  <div class="mt-2 mb-1 text-[4px] font-bold text-slate-600">
                    Experience
                  </div>
                  <div class="h-1 w-full rounded bg-slate-200" />
                  <div class="mt-1 h-1 w-full rounded bg-slate-200" />
                  <div class="mt-1 h-1 w-3/5 rounded bg-slate-200" />
                </div>
                <div>
                  <div class="mt-2 mb-1 text-[4px] font-bold text-slate-600">
                    Details
                  </div>
                  <div class="h-1 w-full rounded bg-slate-200" />
                  <div class="mt-1 h-1 w-3/5 rounded bg-slate-200" />
                </div>
              </div>
            </div>
            <div class="template-info">
              <div class="truncate text-[13px] font-medium text-slate-700">
                {{ aiTemplates[2].title }}
              </div>
              <div class="text-[11px] text-slate-500">
                {{ aiTemplates[2].date }}
              </div>
            </div>
          </div>

          <!-- Card 4 — Yellow -->
          <div class="template-card group">
            <div class="resume-preview relative bg-white p-2.5">
              <div class="absolute inset-x-0 top-0 h-7 bg-[#ffd25c]" />
              <div class="relative mt-0.5 text-[9px] font-bold">
                Steven Growl
              </div>
              <div class="relative mt-2 mb-1 text-[4px] font-bold text-slate-600">
                Professional Summary
              </div>
              <div class="h-1 w-full rounded bg-slate-200" />
              <div class="mt-1 h-1 w-full rounded bg-slate-200" />
              <div class="mt-2 mb-1 text-[4px] font-bold text-slate-600">
                Skills
              </div>
              <div class="h-1 w-full rounded bg-slate-200" />
              <div class="mt-1 h-1 w-3/5 rounded bg-slate-200" />
            </div>
            <div class="template-info">
              <div class="truncate text-[13px] font-medium text-slate-700">
                {{ aiTemplates[3].title }}
              </div>
              <div class="text-[11px] text-slate-500">
                {{ aiTemplates[3].date }}
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
