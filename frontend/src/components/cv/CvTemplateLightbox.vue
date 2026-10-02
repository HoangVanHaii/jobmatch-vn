<script setup lang="ts">
/**
 * CvTemplateLightbox — lightbox xem mẫu CV hệ thống ở khung full-size A4,
 * giống cách hiển thị trang /test6: sheet trắng max-w-[794px] bo góc +
 * shadow + ring, cuộn dọc khi nội dung dài hơn viewport.
 *
 * Dùng cho chế độ demo (click card "Mẫu CV từ hệ thống" ở trang list CV):
 * render CVTemplateRenderer theo templateId + parsedData của mẫu, kèm CTA
 * "Dùng mẫu này" → parent tự route sang CreateResumeView (component PURE —
 * chỉ emit, không gọi router/store).
 */
import { computed } from 'vue'
import { X, Pencil } from 'lucide-vue-next'
import CVTemplateRenderer from '@components/cv/templates/CVTemplateRenderer.vue'
import { buildRenderData } from '@/composables/cvRenderData'
import type { Cv } from '@/types/cv'
import type { CvLanguage } from '@/utils/cvLabels'

const props = defineProps<{
  open: boolean
  /** Mẫu CV demo (source='direct', templateId 1-7) — cung cấp templateId + parsedData. */
  cv: Cv | null
  /** Ngôn ngữ tiêu đề section trong template ('vi' | 'en'). Default 'en'. */
  language?: CvLanguage
}>()

const emit = defineEmits<{
  close: []
  /** User muốn dùng mẫu này để tạo CV. */
  'use-template': [cv: Cv]
  /** Đổi ngôn ngữ tiêu đề template — dùng với v-model:language ở parent. */
  'update:language': [lang: CvLanguage]
}>()

const renderData = computed(() => (props.cv ? buildRenderData(props.cv) : null))
/** Renderer tự fallback template 1 khi templateId không hợp lệ. */
const templateId = computed<number>(() => props.cv?.templateId ?? 1)
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
        v-if="open && cv && renderData"
        class="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-[2px] sm:p-8"
        @click.self="emit('close')"
      >
        <div class="font-poppins mx-auto flex w-full max-w-[794px] flex-col">
          <!-- ===== Toolbar: tên mẫu + CTA + đóng (trên sheet, tông sáng) ===== -->
          <div class="mb-3 flex items-center justify-between gap-3">
            <div class="min-w-0 text-white">
              <div class="truncate text-[15px] font-semibold drop-shadow-sm">
                {{ cv.title?.trim() || 'Mẫu CV hệ thống' }}
              </div>
              <div class="text-[11px] text-white/70">
                Xem trước mẫu — nội dung demo từ hệ thống JobMatch
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <!-- Toggle ngôn ngữ tiêu đề template (EN/VI) — nằm ngay trong
                   lightbox vì khi overlay mở, toggle ngoài trang list bị che.
                   State nằm ở parent (v-model:language) để đồng bộ cả trang. -->
              <div class="flex items-center rounded-md bg-white/10 p-0.5">
                <button
                  v-for="lang in (['en', 'vi'] as const)"
                  :key="lang"
                  type="button"
                  class="inline-flex h-7 items-center rounded px-2.5 text-[11px] font-semibold uppercase transition-colors"
                  :class="language === lang
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-white/70 hover:text-white'"
                  :aria-pressed="language === lang"
                  @click="emit('update:language', lang)"
                >
                  {{ lang }}
                </button>
              </div>
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#5b4eea] px-3.5 text-[12px] font-medium text-white shadow-sm transition-colors hover:bg-[#4a3ed1]"
                @click="emit('use-template', cv)"
              >
                <Pencil :size="12" />
                Dùng mẫu này
              </button>
              <button
                type="button"
                class="grid h-8 w-8 place-items-center rounded-md bg-white/10 text-white transition-colors hover:bg-white/20"
                aria-label="Đóng"
                @click="emit('close')"
              >
                <X :size="16" />
              </button>
            </div>
          </div>

          <!-- ===== Sheet A4 — cùng khung trang /test6 ===== -->
          <div class="overflow-hidden rounded-lg bg-white shadow-xl ring-1 ring-slate-900/5">
            <CVTemplateRenderer
              :template-id="templateId"
              :data="renderData"
              :language="language"
            />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
