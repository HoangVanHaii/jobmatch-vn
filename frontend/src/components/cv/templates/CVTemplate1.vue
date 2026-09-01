<script setup lang="ts">
/**
 * Template 1 — bám sát ảnh 1.
 * Sidebar tối (stone-700) bên trái, avatar tròn ở header, contact + skills (progress bar)
 * + interests. Content phải nền trắng: Học vấn + Kinh nghiệm + Dự án.
 * Toàn bộ styling dùng Tailwind utility classes — không <style scoped>.
 *
 * Responsive:
 *   - Mobile (<640px): sidebar STACK lên trên (1 column), avatar nhỏ lại,
 *     text giảm size để vừa viewport.
 *   - md+ (≥768px): 2 cột như bản gốc (sidebar 280px + main flex).
 *
 * Lý do responsive:
 *   - Thumbnail (132px) và print PDF (A4 fixed) KHÔNG cần responsive — đã
 *     được parent handle qua transform: scale() / Playwright viewport.
 *   - Preview modal là use case user-facing duy nhất cần reflow khi mở
 *     trên mobile (<640px) — sidebar 280px cứng chiếm gần hết viewport
 *     sẽ làm main content bị nén không đọc được.
 *   - md+ (768px) vẫn trigger 2-col → an toàn cho Playwright (set viewport
 *     A4 ~793px) và mọi modal desktop.
 */
import { Lightbulb, Users, Wrench, Phone, Mail, MapPin, Calendar, User as UserIcon } from 'lucide-vue-next';
import type { CvRenderData } from '@/types/cv';

defineProps<{ data: CvRenderData }>();

/** Level 1-5 → % chiều rộng progress bar (mặc định 3 nếu không có). */
const skillPercent = (level?: number): number => {
  const lv = level ?? 3;
  return Math.max(0, Math.min(100, (lv / 5) * 100));
};
</script>

<template>
  <div class="grid grid-cols-1 md:grid-cols-[280px_1fr] w-full min-h-[1100px] bg-white text-neutral-800 font-sans text-[13px] leading-relaxed">
    <!-- ============ SIDEBAR TRÁI ============ -->
    <aside class="bg-stone-700 text-white px-6 py-8 md:py-10 flex flex-col items-center">
      <!-- Avatar tròn, bo viền trắng — nhỏ lại 120px trên mobile để không chiếm
           quá nhiều viewport khi sidebar stack lên trên. -->
      <div class="w-[120px] h-[120px] md:w-[170px] md:h-[170px] rounded-full bg-white p-[4px] mb-5 shadow-lg">
        <div class="w-full h-full rounded-full overflow-hidden bg-stone-300 flex items-center justify-center">
          <img
            v-if="data.personalInfo.avatarUrl"
            :src="data.personalInfo.avatarUrl"
            :alt="data.personalInfo.fullName"
            class="w-full h-full object-cover"
          />
          <span v-else class="text-[40px] md:text-[54px] font-semibold text-stone-700">
            {{ (data.personalInfo.fullName || '?').charAt(0).toUpperCase() }}
          </span>
        </div>
      </div>

      <h1 class="text-[20px] md:text-[22px] font-bold tracking-wide text-center uppercase">
        {{ data.personalInfo.fullName || 'Họ và tên' }}
      </h1>
      <p class="text-[13px] md:text-[14px] italic font-normal text-stone-200 text-center mt-1 mb-5 md:mb-6 opacity-90">
        {{ data.personalInfo.position || 'Vị trí ứng tuyển' }}
      </p>

      <!-- Contact list — trên mobile giảm gap, trên md giữ gap-2 -->
      <div class="w-full flex flex-col gap-1.5 md:gap-2 mb-6 md:mb-7 max-w-[280px]">
        <p v-if="data.personalInfo.phone" class="flex items-center gap-2 text-[12px] md:text-[12.5px]">
          <Phone class="w-[14px] h-[14px] opacity-80 shrink-0" />
          <span class="break-all">{{ data.personalInfo.phone }}</span>
        </p>
        <p v-if="data.personalInfo.email" class="flex items-center gap-2 text-[12px] md:text-[12.5px]">
          <Mail class="w-[14px] h-[14px] opacity-80 shrink-0" />
          <span class="break-all">{{ data.personalInfo.email }}</span>
        </p>
        <p v-if="data.personalInfo.address" class="flex items-center gap-2 text-[12px] md:text-[12.5px]">
          <MapPin class="w-[14px] h-[14px] opacity-80 shrink-0" />
          <span class="break-all">{{ data.personalInfo.address }}</span>
        </p>
        <p v-if="data.personalInfo.dob" class="flex items-center gap-2 text-[12px] md:text-[12.5px]">
          <Calendar class="w-[14px] h-[14px] opacity-80 shrink-0" />
          <span>{{ data.personalInfo.dob }}</span>
        </p>
        <p v-if="data.personalInfo.gender" class="flex items-center gap-2 text-[12px] md:text-[12.5px]">
          <UserIcon class="w-[14px] h-[14px] opacity-80 shrink-0" />
          <span>{{ data.personalInfo.gender }}</span>
        </p>
      </div>

      <!-- Mục tiêu nghề nghiệp -->
      <section v-if="data.summary" class="w-full max-w-[280px] md:max-w-none mb-5 md:mb-6">
        <h2 class="text-[14px] md:text-[15px] font-bold uppercase tracking-wider pb-1.5 mb-3 border-b border-white/30">
          Mục tiêu nghề nghiệp
        </h2>
        <p class="text-[12px] md:text-[12.5px] whitespace-pre-wrap">{{ data.summary }}</p>
      </section>

      <!-- Kỹ năng — progress bar -->
      <section v-if="data.skills.length" class="w-full max-w-[280px] md:max-w-none mb-5 md:mb-6">
        <h2 class="text-[14px] md:text-[15px] font-bold uppercase tracking-wider pb-1.5 mb-3 border-b border-white/30">
          Kỹ năng
        </h2>
        <ul class="flex flex-col gap-2.5">
          <li v-for="(s, i) in data.skills" :key="i" class="flex flex-col gap-1">
            <div class="flex items-center justify-between text-[12px] md:text-[12.5px]">
              <span>{{ s.name }}</span>
              <span class="text-[11px] text-stone-300">{{ s.level ?? 3 }}/5</span>
            </div>
            <div class="h-1 bg-white/15 rounded-full overflow-hidden">
              <div
                class="h-full bg-amber-500 rounded-full transition-all"
                :style="{ width: skillPercent(s.level) + '%' }"
              />
            </div>
          </li>
        </ul>
      </section>

      <!-- Sở thích -->
      <section v-if="data.interests && data.interests.length" class="w-full max-w-[280px] md:max-w-none">
        <h2 class="text-[14px] md:text-[15px] font-bold uppercase tracking-wider pb-1.5 mb-3 border-b border-white/30">
          Sở thích
        </h2>
        <ul class="list-disc pl-5 space-y-1 text-[12px] md:text-[12.5px] marker:text-amber-500">
          <li v-for="(it, i) in data.interests" :key="i">{{ it }}</li>
        </ul>
      </section>
    </aside>

    <!-- ============ MAIN PHẢI ============ -->
    <main class="px-5 py-6 md:px-8 md:py-10">
      <!-- Học vấn -->
      <section v-if="data.educations.length" class="mb-6 md:mb-7">
        <h2 class="flex items-center gap-2 text-[16px] md:text-[18px] font-bold uppercase tracking-wide text-stone-700 mb-4 pb-2 border-b-2 border-amber-700">
          <Lightbulb class="w-[18px] h-[18px] md:w-[20px] md:h-[20px] text-amber-700" />
          Học vấn
        </h2>
        <ul class="relative pl-6 space-y-4 before:absolute before:left-1 before:top-2 before:bottom-2 before:w-0.5 before:bg-neutral-200">
          <li
            v-for="(e, i) in data.educations"
            :key="i"
            class="relative before:absolute before:-left-[18px] before:top-1.5 before:w-3 before:h-3 before:rounded-full before:bg-amber-700 before:ring-4 before:ring-white"
          >
            <div class="flex items-baseline justify-between gap-3 flex-wrap">
              <span class="font-semibold text-stone-700">{{ e.major || 'Công nghệ thông tin' }}</span>
              <span v-if="e.startYear || e.endYear" class="text-[11px] md:text-[11.5px] text-amber-700 font-semibold tracking-wide">
                {{ e.startYear || '' }}<span v-if="e.startYear || e.endYear"> — </span>{{ e.endYear || 'Nay' }}
              </span>
            </div>
            <p class="text-[12.5px] md:text-[13px] mt-0.5"><strong class="text-stone-700">{{ e.school }}</strong></p>
            <p v-if="e.description" class="text-[12px] md:text-[12.5px] mt-1 text-neutral-600 whitespace-pre-wrap">{{ e.description }}</p>
          </li>
        </ul>
      </section>

      <!-- Kinh nghiệm làm việc -->
      <section v-if="data.experiences.length" class="mb-6 md:mb-7">
        <h2 class="flex items-center gap-2 text-[16px] md:text-[18px] font-bold uppercase tracking-wide text-stone-700 mb-4 pb-2 border-b-2 border-amber-700">
          <Users class="w-[18px] h-[18px] md:w-[20px] md:h-[20px] text-amber-700" />
          Kinh nghiệm làm việc
        </h2>
        <ul class="relative pl-6 space-y-4 before:absolute before:left-1 before:top-2 before:bottom-2 before:w-0.5 before:bg-neutral-200">
          <li
            v-for="(x, i) in data.experiences"
            :key="i"
            class="relative before:absolute before:-left-[18px] before:top-1.5 before:w-3 before:h-3 before:rounded-full before:bg-amber-700 before:ring-4 before:ring-white"
          >
            <div class="flex items-baseline justify-between gap-3 flex-wrap">
              <span class="font-semibold text-stone-700">{{ x.position }}</span>
              <span v-if="x.startDate || x.endDate" class="text-[11px] md:text-[11.5px] text-amber-700 font-semibold tracking-wide">
                {{ x.startDate || '' }}<span v-if="x.startDate || x.endDate"> — </span>{{ x.endDate || 'Nay' }}
              </span>
            </div>
            <p class="text-[12.5px] md:text-[13px] mt-0.5"><strong class="text-stone-700">{{ x.company }}</strong></p>
            <p v-if="x.description" class="text-[12px] md:text-[12.5px] mt-1 text-neutral-600 whitespace-pre-wrap">{{ x.description }}</p>
          </li>
        </ul>
      </section>

      <!-- Dự án -->
      <section v-if="data.projects.length">
        <h2 class="flex items-center gap-2 text-[16px] md:text-[18px] font-bold uppercase tracking-wide text-stone-700 mb-4 pb-2 border-b-2 border-amber-700">
          <Wrench class="w-[18px] h-[18px] md:w-[20px] md:h-[20px] text-amber-700" />
          Dự án
        </h2>
        <ul class="flex flex-col gap-3">
          <li
            v-for="(p, i) in data.projects"
            :key="i"
            class="rounded-md border border-neutral-200 px-4 py-3 bg-neutral-50/50"
          >
            <p class="font-semibold text-[13.5px] md:text-[14px] text-stone-700">{{ p.name }}</p>
            <p v-if="p.role" class="text-[11.5px] md:text-[12px] text-amber-700 font-semibold uppercase tracking-wide mt-0.5">{{ p.role }}</p>
            <p v-if="p.description" class="text-[12px] md:text-[12.5px] mt-1 text-neutral-600 whitespace-pre-wrap">{{ p.description }}</p>
            <p v-if="p.link" class="text-[11px] md:text-[11.5px] mt-1 text-stone-500 break-all">{{ p.link }}</p>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>
