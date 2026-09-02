<script setup lang="ts">
/**
 * Template 4 — dark navy full-width header, avatar lớn tròn, 2 cột với timeline cam.
 * Cột trái: contact + summary + skills (chấm xanh lá) + interests.
 * Cột phải: education + experience + activities (timeline chấm cam).
 * Toàn bộ styling dùng Tailwind utility classes — không <style scoped>.
 *
 * Responsive:
 *   - Mobile (<768px): header stack dọc (avatar trên, tên/vị trí canh giữa),
 *     body grid-cols-[280px_1fr] → 1 cột (aside stack lên trên main),
 *     avatar 140px → 110px, icon section 18px → 16px, padding + text giảm.
 *   - md+ (≥768px): giữ nguyên bản gốc (header ngang, sidebar 280px + main 1fr).
 *
 * Lý do responsive:
 *   - Cột trái fix 280px trên viewport 375px chỉ để lại ~70px cho main → timeline
 *     và mọi dòng text bị vỡ; stack 1 cột là cách duy nhất đọc được.
 *   - Thumbnail (132px) và print PDF (A4 fixed) KHÔNG bị ảnh hưởng — parent
 *     handle qua transform: scale() / Playwright viewport A4 (~793px → md:).
 */
import {
  Phone, Mail, MapPin, Calendar, Briefcase, GraduationCap, Star, User,
} from 'lucide-vue-next';
import type { CvRenderData } from '@/types/cv';

defineProps<{ data: CvRenderData }>();
</script>

<template>
  <div class="w-full min-h-[1100px] bg-white text-neutral-800 font-sans text-[12.5px] md:text-[13px] leading-relaxed flex flex-col">
    <!-- Header ngang full-width -->
    <header class="relative overflow-hidden px-5 pt-6 pb-12 md:px-10 md:pt-8 md:pb-14" style="background: #0e2a47">
      <!-- Overlay gradient -->
      <div
        class="absolute inset-0"
        style="background: linear-gradient(120deg, #0e2a47 0%, #14365a 70%, #1a4267 100%)"
      />

      <div class="relative z-[1] flex flex-col md:flex-row items-center gap-4 md:gap-7 text-center md:text-left">
        <!-- Avatar — 110px trên mobile khi header stack dọc -->
        <div class="w-[110px] h-[110px] md:w-[140px] md:h-[140px] rounded-full bg-white p-[5px] shrink-0 shadow-[0_6px_18px_rgba(0,0,0,0.25)]">
          <div class="w-full h-full rounded-full overflow-hidden bg-neutral-300 flex items-center justify-center">
            <img
              v-if="data.personalInfo.avatarUrl"
              :src="data.personalInfo.avatarUrl"
              :alt="data.personalInfo.fullName"
              class="w-full h-full object-cover"
            />
            <span v-else class="text-[38px] md:text-[48px] font-semibold text-stone-600">
              {{ (data.personalInfo.fullName || '?').charAt(0).toUpperCase() }}
            </span>
          </div>
        </div>

        <div class="flex-1 text-white">
          <h1 class="text-[24px] md:text-[30px] font-bold m-0 leading-[1.15] tracking-[0.3px]">
            {{ data.personalInfo.fullName || 'Họ và tên' }}
          </h1>
          <p class="text-[14px] md:text-[15px] mt-1.5 text-[#f4a261] font-semibold tracking-[0.5px] uppercase">
            {{ data.personalInfo.position || 'Vị trí ứng tuyển' }}
          </p>
        </div>
      </div>

      <!-- Accent strip cam dưới header -->
      <div
        class="absolute bottom-0 left-0 h-2.5 w-full"
        style="background: linear-gradient(90deg, #b86c3b 0%, #d68a52 60%, transparent 100%)"
      />
    </header>

    <!-- Body 2 cột (mobile: aside stack lên trên main) -->
    <div class="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6 px-5 pt-6 pb-7 md:px-10 md:pt-8 md:pb-9 flex-1 bg-white">
      <!-- Cột trái -->
      <aside class="flex flex-col gap-[18px] md:gap-[22px]">
        <section v-if="data.personalInfo.phone || data.personalInfo.email || data.personalInfo.address || data.personalInfo.dob || data.personalInfo.gender">
          <h2 class="text-[14px] md:text-[15px] font-bold text-[#0e2a47] m-0 mb-2.5 pb-1.5 border-b-2 border-[#b86c3b] uppercase tracking-[1px]">
            Thông tin liên hệ
          </h2>
          <ul class="list-none p-0 m-0 flex flex-col gap-1.5">
            <li v-if="data.personalInfo.phone" class="flex items-center gap-2 text-[12px] md:text-[12.5px]">
              <Phone class="w-3.5 h-3.5 text-[#b86c3b] shrink-0" />
              <span>{{ data.personalInfo.phone }}</span>
            </li>
            <li v-if="data.personalInfo.email" class="flex items-center gap-2 text-[12px] md:text-[12.5px]">
              <Mail class="w-3.5 h-3.5 text-[#b86c3b] shrink-0" />
              <span>{{ data.personalInfo.email }}</span>
            </li>
            <li v-if="data.personalInfo.address" class="flex items-center gap-2 text-[12px] md:text-[12.5px]">
              <MapPin class="w-3.5 h-3.5 text-[#b86c3b] shrink-0" />
              <span>{{ data.personalInfo.address }}</span>
            </li>
            <li v-if="data.personalInfo.dob" class="flex items-center gap-2 text-[12px] md:text-[12.5px]">
              <Calendar class="w-3.5 h-3.5 text-[#b86c3b] shrink-0" />
              <span>{{ data.personalInfo.dob }}</span>
            </li>
            <li v-if="data.personalInfo.gender" class="flex items-center gap-2 text-[12px] md:text-[12.5px]">
              <User class="w-3.5 h-3.5 text-[#b86c3b] shrink-0" />
              <span>{{ data.personalInfo.gender }}</span>
            </li>
          </ul>
        </section>

        <section v-if="data.summary">
          <h2 class="text-[14px] md:text-[15px] font-bold text-[#0e2a47] m-0 mb-2.5 pb-1.5 border-b-2 border-[#b86c3b] uppercase tracking-[1px]">
            Mục tiêu nghề nghiệp
          </h2>
          <p class="text-[12px] md:text-[12.5px] m-0 text-neutral-700 whitespace-pre-wrap">{{ data.summary }}</p>
        </section>

        <section v-if="data.skills.length">
          <h2 class="text-[14px] md:text-[15px] font-bold text-[#0e2a47] m-0 mb-2.5 pb-1.5 border-b-2 border-[#b86c3b] uppercase tracking-[1px]">
            Kỹ năng
          </h2>
          <ul class="list-none p-0 m-0 flex flex-col gap-1.5">
            <li
              v-for="(s, i) in data.skills"
              :key="i"
              class="relative pl-[18px] text-[12.5px] md:text-[13px]"
            >
              <span class="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#4a7c3a]" />
              {{ s.name }}
            </li>
          </ul>
        </section>

        <section v-if="data.interests && data.interests.length">
          <h2 class="text-[14px] md:text-[15px] font-bold text-[#0e2a47] m-0 mb-2.5 pb-1.5 border-b-2 border-[#b86c3b] uppercase tracking-[1px]">
            Sở thích
          </h2>
          <ul class="list-none p-0 m-0 flex flex-col gap-1.5">
            <li
              v-for="(it, i) in data.interests"
              :key="i"
              class="relative pl-[18px] text-[12.5px] md:text-[13px]"
            >
              <span class="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#4a7c3a]" />
              {{ it }}
            </li>
          </ul>
        </section>
      </aside>

      <!-- Cột phải -->
      <main class="flex flex-col gap-[18px] md:gap-[22px]">
        <section v-if="data.educations.length">
          <h2 class="text-[14px] md:text-[15px] font-bold text-[#0e2a47] m-0 mb-2.5 pb-1.5 border-b-2 border-[#b86c3b] uppercase tracking-[1px] flex items-center gap-2">
            <GraduationCap class="w-4 h-4 md:w-[18px] md:h-[18px] text-[#b86c3b] shrink-0" />
            Học vấn
          </h2>
          <ul class="relative list-none p-0 m-0 before:absolute before:left-[5px] before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-neutral-200">
            <li
              v-for="(e, i) in data.educations"
              :key="i"
              class="relative pl-[26px] mb-3.5"
            >
              <span
                class="absolute left-0 top-1 w-3 h-3 rounded-full bg-[#b86c3b]"
                style="box-shadow: 0 0 0 3px #fff, 0 0 0 4px #e6e6e6"
              />
              <p class="text-[13.5px] md:text-[14px] font-semibold mb-0.5 text-[#0e2a47]">{{ e.school }}</p>
              <p class="text-[11.5px] md:text-[12px] text-[#b86c3b] mb-1 font-semibold">
                {{ e.startYear || '' }}<span v-if="e.startYear || e.endYear"> - </span>{{ e.endYear || 'Nay' }}
              </p>
              <p v-if="e.major" class="text-[12px] md:text-[12.5px] my-0.5 text-neutral-600"><strong>Chuyên ngành:</strong> {{ e.major }}</p>
              <p v-if="e.description" class="text-[12px] md:text-[12.5px] mt-1 text-neutral-700 whitespace-pre-wrap">{{ e.description }}</p>
            </li>
          </ul>
        </section>

        <section v-if="data.experiences.length">
          <h2 class="text-[14px] md:text-[15px] font-bold text-[#0e2a47] m-0 mb-2.5 pb-1.5 border-b-2 border-[#b86c3b] uppercase tracking-[1px] flex items-center gap-2">
            <Briefcase class="w-4 h-4 md:w-[18px] md:h-[18px] text-[#b86c3b] shrink-0" />
            Kinh nghiệm làm việc
          </h2>
          <ul class="relative list-none p-0 m-0 before:absolute before:left-[5px] before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-neutral-200">
            <li
              v-for="(x, i) in data.experiences"
              :key="i"
              class="relative pl-[26px] mb-3.5"
            >
              <span
                class="absolute left-0 top-1 w-3 h-3 rounded-full bg-[#b86c3b]"
                style="box-shadow: 0 0 0 3px #fff, 0 0 0 4px #e6e6e6"
              />
              <p class="text-[13.5px] md:text-[14px] font-semibold mb-0.5 text-[#0e2a47]">
                {{ x.position }}<span v-if="x.company"> — {{ x.company }}</span>
              </p>
              <p class="text-[11.5px] md:text-[12px] text-[#b86c3b] mb-1 font-semibold">
                {{ x.startDate || '' }}<span v-if="x.startDate || x.endDate"> - </span>{{ x.endDate || 'Nay' }}
              </p>
              <p v-if="x.description" class="text-[12px] md:text-[12.5px] mt-1 text-neutral-700 whitespace-pre-wrap">{{ x.description }}</p>
            </li>
          </ul>
        </section>

        <section v-if="data.activities.length">
          <h2 class="text-[14px] md:text-[15px] font-bold text-[#0e2a47] m-0 mb-2.5 pb-1.5 border-b-2 border-[#b86c3b] uppercase tracking-[1px] flex items-center gap-2">
            <Star class="w-4 h-4 md:w-[18px] md:h-[18px] text-[#b86c3b] shrink-0" />
            Hoạt động
          </h2>
          <ul class="relative list-none p-0 m-0 before:absolute before:left-[5px] before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-neutral-200">
            <li
              v-for="(a, i) in data.activities"
              :key="i"
              class="relative pl-[26px] mb-3.5"
            >
              <span
                class="absolute left-0 top-1 w-3 h-3 rounded-full bg-[#b86c3b]"
                style="box-shadow: 0 0 0 3px #fff, 0 0 0 4px #e6e6e6"
              />
              <p class="text-[13.5px] md:text-[14px] font-semibold mb-0.5 text-[#0e2a47]">{{ a.name }}</p>
              <p v-if="a.time" class="text-[11.5px] md:text-[12px] text-[#b86c3b] mb-1 font-semibold">{{ a.time }}</p>
              <p v-if="a.role" class="text-[12px] md:text-[12.5px] my-0.5 text-neutral-600"><strong>Vai trò:</strong> {{ a.role }}</p>
              <p v-if="a.description" class="text-[12px] md:text-[12.5px] mt-1 text-neutral-700 whitespace-pre-wrap">{{ a.description }}</p>
            </li>
          </ul>
        </section>
      </main>
    </div>
  </div>
</template>