<script setup lang="ts">
/**
 * Template 3 — serif 1 cột, centered, đường kẻ ngang phân cách section.
 * Toàn bộ styling dùng Tailwind utility classes — không <style scoped>.
 *
 * Responsive:
 *   - Mobile (<768px): giảm padding trang (px-10 → px-5) để tận dụng chiều
 *     ngang viewport, giảm text/gap, các dòng "tiêu đề — mốc thời gian" được
 *     wrap xuống dòng thay vì nén sát nhau.
 *   - md+ (≥768px): giữ nguyên bản gốc.
 *
 * Lý do responsive:
 *   - Layout đã là 1 cột nên không cần đổi grid; vấn đề duy nhất trên mobile là
 *     padding 40px mỗi bên "ăn" ~80px/375px viewport và các row justify-between
 *     bị nén.
 *   - Thumbnail (132px) và print PDF (A4 fixed) KHÔNG bị ảnh hưởng — parent
 *     handle qua transform: scale() / Playwright viewport A4 (~793px → md:).
 */
import { Phone, Mail, Globe, MapPin } from 'lucide-vue-next';
import type { CvRenderData } from '@/types/cv';

defineProps<{ data: CvRenderData }>();
</script>

<template>
  <div class="w-full min-h-[1100px] bg-white text-neutral-800 font-serif text-[12.5px] md:text-[13px] leading-relaxed px-5 pt-6 pb-7 md:px-10 md:pt-9 md:pb-10 flex flex-col gap-[14px] md:gap-[18px]">
    <!-- Header centered -->
    <header class="text-center mb-2">
      <h1 class="text-[22px] md:text-[26px] font-bold m-0 tracking-[0.3px]">
        {{ data.personalInfo.fullName || 'Họ và tên' }}
      </h1>
      <p class="text-[13px] md:text-[14px] italic mt-1 text-neutral-600">
        {{ data.personalInfo.position || 'Vị trí ứng tuyển' }}
      </p>
      <p class="flex flex-wrap justify-center gap-2.5 md:gap-3.5 text-[11.5px] md:text-[12px] mt-2.5 text-neutral-500">
        <span v-if="data.personalInfo.phone" class="inline-flex items-center gap-1">
          <Phone class="w-3 h-3" />
          <span>{{ data.personalInfo.phone }}</span>
        </span>
        <span v-if="data.personalInfo.email" class="inline-flex items-center gap-1">
          <Mail class="w-3 h-3" />
          <span>{{ data.personalInfo.email }}</span>
        </span>
        <span v-if="data.personalInfo.portfolio" class="inline-flex items-center gap-1">
          <Globe class="w-3 h-3" />
          <span>{{ data.personalInfo.portfolio }}</span>
        </span>
        <span v-if="data.personalInfo.address" class="inline-flex items-center gap-1">
          <MapPin class="w-3 h-3" />
          <span>{{ data.personalInfo.address }}</span>
        </span>
      </p>
    </header>

    <!-- Sections -->
    <section v-if="data.summary" class="w-full">
      <h2 class="font-sans text-[12.5px] md:text-[13px] font-bold tracking-[1px] mb-1 m-0">MỤC TIÊU NGHỀ NGHIỆP</h2>
      <hr class="border-0 border-t-[1.5px] border-neutral-800 mb-2.5" />
      <p class="text-[12px] md:text-[12.5px] mt-1.5 whitespace-pre-wrap">{{ data.summary }}</p>
    </section>

    <section v-if="data.educations.length" class="w-full">
      <h2 class="font-sans text-[12.5px] md:text-[13px] font-bold tracking-[1px] mb-1 m-0">HỌC VẤN</h2>
      <hr class="border-0 border-t-[1.5px] border-neutral-800 mb-2.5" />
      <div v-for="(e, i) in data.educations" :key="i" class="mb-3">
        <p class="flex flex-wrap justify-between items-baseline m-0">
          <strong>{{ e.school }}</strong>
          <span v-if="e.startYear || e.endYear" class="text-[11.5px] md:text-[12px] text-neutral-500">
            {{ e.startYear || '' }} - {{ e.endYear || 'Nay' }}
          </span>
        </p>
        <p class="text-[12px] md:text-[12.5px] mt-0.5 mb-0">
          <em>{{ e.major || '' }}</em>{{ e.degree ? ' · ' + e.degree : '' }}
        </p>
        <p v-if="e.description" class="text-[12px] md:text-[12.5px] mt-1.5 whitespace-pre-wrap">{{ e.description }}</p>
      </div>
    </section>

    <section v-if="data.experiences.length" class="w-full">
      <h2 class="font-sans text-[12.5px] md:text-[13px] font-bold tracking-[1px] mb-1 m-0">KINH NGHIỆM LÀM VIỆC</h2>
      <hr class="border-0 border-t-[1.5px] border-neutral-800 mb-2.5" />
      <div v-for="(x, i) in data.experiences" :key="i" class="mb-3">
        <p class="flex flex-wrap justify-between items-baseline m-0">
          <strong>{{ x.company }}</strong>
          <span v-if="x.startDate || x.endDate" class="text-[11.5px] md:text-[12px] text-neutral-500">
            {{ x.startDate || '' }} - {{ x.endDate || 'Nay' }}
          </span>
        </p>
        <p class="text-[12px] md:text-[12.5px] mt-0.5 mb-0"><em>{{ x.position }}</em></p>
        <p v-if="x.description" class="text-[12px] md:text-[12.5px] mt-1.5 whitespace-pre-wrap">{{ x.description }}</p>
      </div>
    </section>

    <section v-if="data.skills.length" class="w-full">
      <h2 class="font-sans text-[12.5px] md:text-[13px] font-bold tracking-[1px] mb-1 m-0">KỸ NĂNG</h2>
      <hr class="border-0 border-t-[1.5px] border-neutral-800 mb-2.5" />
      <table class="w-full border-collapse text-[12px] md:text-[12.5px]">
        <tbody>
          <tr v-for="(s, i) in data.skills" :key="i" class="border-b border-neutral-200">
            <td class="py-1.5 px-2 align-top font-semibold w-[38%]">{{ s.name }}</td>
            <td class="py-1.5 px-2 align-top text-neutral-500">
              {{ s.name === 'Kỹ năng giao tiếp' ? 'Thành thạo trong việc lắng nghe, truyền đạt thông tin rõ ràng và thuyết phục' : '' }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="data.activities.length" class="w-full">
      <h2 class="font-sans text-[12.5px] md:text-[13px] font-bold tracking-[1px] mb-1 m-0">HOẠT ĐỘNG</h2>
      <hr class="border-0 border-t-[1.5px] border-neutral-800 mb-2.5" />
      <div v-for="(a, i) in data.activities" :key="i" class="mb-3">
        <p class="flex flex-wrap justify-between items-baseline m-0">
          <strong>{{ a.name }}</strong>
          <span v-if="a.time" class="text-[11.5px] md:text-[12px] text-neutral-500">{{ a.time }}</span>
        </p>
        <p v-if="a.role" class="text-[12px] md:text-[12.5px] mt-0.5 mb-0"><em>{{ a.role }}</em></p>
        <p v-if="a.description" class="text-[12px] md:text-[12.5px] mt-1.5 whitespace-pre-wrap">{{ a.description }}</p>
      </div>
    </section>
  </div>
</template>