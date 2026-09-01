<script setup lang="ts">
/**
 * Template 2 — header gradient xám với shape tròn nền, avatar tròn lớn.
 * 2 cột: trái (Thông tin / Học vấn / Kỹ năng / Chứng chỉ) | phải (Kinh nghiệm / Hoạt động).
 * Toàn bộ styling dùng Tailwind utility classes — không <style scoped>.
 *
 * Responsive:
 *   - Mobile (<768px): header stack dọc (avatar trên, tên/vị trí dưới, canh giữa),
 *     body 2 cột → 1 cột, avatar 130px → 100px, padding + text giảm size.
 *   - md+ (≥768px): giữ nguyên bản gốc (header ngang, body grid 2 cột).
 *
 * Lý do responsive:
 *   - Thumbnail (132px) và print PDF (A4 fixed) KHÔNG cần responsive — parent
 *     đã handle qua transform: scale() / Playwright viewport A4 (~793px → md:).
 *   - Preview modal là use case user-facing duy nhất cần reflow trên mobile:
 *     grid-cols-2 cứng làm mỗi cột chỉ còn ~150px, text vỡ không đọc được.
 */
import { Phone, Mail, Globe, MapPin } from 'lucide-vue-next';
import type { CvRenderData } from '@/types/cv';

defineProps<{ data: CvRenderData }>();
</script>

<template>
  <div class="w-full min-h-[1100px] bg-white text-neutral-700 font-sans text-[12.5px] md:text-[13px] leading-relaxed flex flex-col">
    <!-- Header -->
    <header class="relative overflow-hidden bg-[#a8b3c0] px-5 pt-6 pb-5 md:px-10 md:pt-9 md:pb-7 flex items-center">
      <!-- Shape nền trang trí -->
      <div class="absolute w-[140px] h-[140px] rounded-full bg-[rgba(184,108,59,0.18)] -top-[30px] right-[30%]" />
      <div
        class="absolute w-[180px] h-[180px] bg-[rgba(184,108,59,0.12)] -bottom-[60px] left-[8%]"
        style="border-radius: 0 50% 50% 50%"
      />

      <div class="relative z-[1] flex flex-col md:flex-row items-center gap-4 md:gap-6 w-full text-center md:text-left">
        <!-- Avatar — 100px trên mobile để không chiếm hết chiều cao header -->
        <div class="w-[100px] h-[100px] md:w-[130px] md:h-[130px] rounded-full bg-white p-1 shrink-0">
          <div class="w-full h-full rounded-full overflow-hidden bg-neutral-300 flex items-center justify-center">
            <img
              v-if="data.personalInfo.avatarUrl"
              :src="data.personalInfo.avatarUrl"
              :alt="data.personalInfo.fullName"
              class="w-full h-full object-cover"
            />
            <span v-else class="text-[34px] md:text-[44px] font-semibold text-stone-600">
              {{ (data.personalInfo.fullName || '?').charAt(0).toUpperCase() }}
            </span>
          </div>
        </div>

        <div class="flex-1">
          <h1 class="text-[24px] md:text-[30px] font-bold text-neutral-800 m-0">
            {{ data.personalInfo.fullName || 'Họ và tên' }}
          </h1>
          <p class="text-[14px] md:text-[16px] text-amber-700 font-semibold mt-1">
            {{ data.personalInfo.position || 'Vị trí ứng tuyển' }}
          </p>
          <p v-if="data.summary" class="text-[12px] md:text-[12.5px] mt-2 md:mt-3 text-neutral-600 max-w-[520px] mx-auto md:mx-0">
            {{ data.summary }}
          </p>
        </div>
      </div>
    </header>

    <!-- Body 2 cột (mobile: stack 1 cột) -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 px-5 pt-5 pb-6 md:px-10 md:pt-7 md:pb-9 flex-1">
      <!-- Cột trái -->
      <section class="flex flex-col gap-4">
        <h2 class="text-[15px] md:text-base font-bold text-amber-700 m-0 pb-1.5 border-b-[1.5px] border-amber-700">
          Thông tin cá nhân
        </h2>
        <ul class="list-none p-0 m-0 flex flex-col gap-1.5">
          <li v-if="data.personalInfo.phone" class="flex items-center gap-2 text-[12px] md:text-[12.5px]">
            <Phone class="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>{{ data.personalInfo.phone }}</span>
          </li>
          <li v-if="data.personalInfo.email" class="flex items-center gap-2 text-[12px] md:text-[12.5px]">
            <Mail class="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>{{ data.personalInfo.email }}</span>
          </li>
          <li v-if="data.personalInfo.facebook" class="flex items-center gap-2 text-[12px] md:text-[12.5px]">
            <Globe class="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>{{ data.personalInfo.facebook }}</span>
          </li>
          <li v-if="data.personalInfo.address" class="flex items-center gap-2 text-[12px] md:text-[12.5px]">
            <MapPin class="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>{{ data.personalInfo.address }}</span>
          </li>
        </ul>

        <template v-if="data.educations.length">
          <h2 class="text-[15px] md:text-base font-bold text-amber-700 m-0 pb-1.5 border-b-[1.5px] border-amber-700">
            Học vấn
          </h2>
          <div v-for="(e, i) in data.educations" :key="i" class="mb-2">
            <p class="text-[12.5px] md:text-[13px] mb-1 text-neutral-800">
              <strong>{{ e.school }}</strong> | {{ e.startYear || '' }} - {{ e.endYear || 'Nay' }}
            </p>
            <p class="text-[12px] md:text-[12.5px] my-0.5 text-neutral-600"><strong>Chuyên ngành:</strong> {{ e.major || '—' }}</p>
            <p v-if="e.degree" class="text-[12px] md:text-[12.5px] my-0.5 text-neutral-600"><strong>Xếp loại:</strong> {{ e.degree }}</p>
            <p v-if="e.description" class="text-[12px] md:text-[12.5px] my-0.5 text-neutral-600">
              <strong>{{ e.description.split('\n')[0] }}</strong>
            </p>
          </div>
        </template>

        <template v-if="data.skills.length">
          <h2 class="text-[15px] md:text-base font-bold text-amber-700 m-0 pb-1.5 border-b-[1.5px] border-amber-700">
            Kỹ năng
          </h2>
          <ul class="list-none p-0 m-0 flex flex-col gap-1.5">
            <li
              v-for="(s, i) in data.skills"
              :key="i"
              class="relative pl-4 text-[12px] md:text-[12.5px]"
            >
              <span class="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-amber-700" />
              {{ s.name }}
            </li>
          </ul>
        </template>

        <template v-if="data.certificates.length">
          <h2 class="text-[15px] md:text-base font-bold text-amber-700 m-0 pb-1.5 border-b-[1.5px] border-amber-700">
            Chứng chỉ
          </h2>
          <div v-for="(c, i) in data.certificates" :key="i" class="mb-2">
            <p class="text-[12.5px] md:text-[13px] mb-1 text-neutral-800"><strong>{{ c.date || '' }}</strong></p>
            <p class="text-[12px] md:text-[12.5px] my-0.5 text-neutral-600">
              {{ c.name }}<span v-if="c.issuer"> — {{ c.issuer }}</span>
            </p>
          </div>
        </template>
      </section>

      <!-- Cột phải -->
      <section class="flex flex-col gap-4">
        <template v-if="data.experiences.length">
          <h2 class="text-[15px] md:text-base font-bold text-amber-700 m-0 pb-1.5 border-b-[1.5px] border-amber-700">
            Kinh nghiệm làm việc
          </h2>
          <div v-for="(x, i) in data.experiences" :key="i" class="mb-2">
            <p class="text-[12.5px] md:text-[13px] mb-1 text-neutral-800">
              <strong>{{ x.company }}</strong> | {{ x.startDate || '' }} - {{ x.endDate || 'Nay' }}
            </p>
            <p class="text-[12px] md:text-[12.5px] my-0.5 text-neutral-600"><strong>{{ x.position }}</strong></p>
            <p v-if="x.description" class="text-[12px] md:text-[12.5px] mt-1 whitespace-pre-wrap">{{ x.description }}</p>
          </div>
        </template>

        <template v-if="data.activities.length">
          <h2 class="text-[15px] md:text-base font-bold text-amber-700 m-0 pb-1.5 border-b-[1.5px] border-amber-700">
            Hoạt động
          </h2>
          <div v-for="(a, i) in data.activities" :key="i" class="mb-2">
            <p class="text-[12.5px] md:text-[13px] mb-1 text-neutral-800">
              <strong>{{ a.name }}</strong> | {{ a.time || '' }}
            </p>
            <p v-if="a.role" class="text-[12px] md:text-[12.5px] my-0.5 text-neutral-600">{{ a.role }}</p>
            <p v-if="a.description" class="text-[12px] md:text-[12.5px] mt-1 whitespace-pre-wrap">{{ a.description }}</p>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>