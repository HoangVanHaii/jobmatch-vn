<script setup lang="ts">
/**
 * CvThumbnailTemplate1 — bản thu nhỏ của CVTemplate1 (sidebar tối + main).
 *
 * Phải GIỐNG HỆT CVTemplate1 về layout, màu sắc, content, format. Chỉ khác
 * ở font size nhỏ hơn (4-6px thay vì 12-22px) để fit thumbnail 132×170.
 *
 * Layout mapping (full size → thumbnail):
 *   - Sidebar (grid-cols-[280px_1fr]): 35% width, bg-stone-700, nội dung:
 *       1. Avatar tròn (white border, bg-stone-300 fallback)
 *       2. Name (uppercase tracking-wide) + position (italic stone-200)
 *       3. Contact list: phone, email, address, dob, gender (MỖI field là 1 dòng)
 *       4. Mục tiêu nghề nghiệp (heading IN HOA + border-bottom)
 *       5. Kỹ năng: progress bar amber-500 (name + X/5 + bar)
 *       6. Sở thích: list-disc amber marker
 *   - Main (65% width, bg-white):
 *       1. Học vấn (heading IN HOA + Lightbulb icon + amber border) — timeline dots amber
 *       2. Kinh nghiệm làm việc (Users icon + amber border) — timeline dots amber
 *       3. Dự án (Wrench icon + amber border) — cards border-neutral-200 + role amber uppercase
 *
 * Khác biệt với full template:
 *   - Bỏ lucide icons (sẽ vô hình ở 4-6px font).
 *   - Bỏ `mb-7` → dùng gap %.
 *   - Bỏ timeline (relative pl-6 before:) → thay bằng indent nhỏ.
 *   - overflow-hidden clip phần thừa nếu content quá dài.
 */
import { computed } from 'vue';
import type { CvRenderData } from '@/types/cv';

const props = defineProps<{ data: CvRenderData }>();

const initial = computed<string>(() => {
  const name = props.data.personalInfo.fullName?.trim();
  return (name && name.length > 0 ? name.charAt(0) : '?').toUpperCase();
});

const shortName = computed<string>(() => {
  const parts = (props.data.personalInfo.fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'HỌ VÀ TÊN';
  const last2 = parts.slice(-2).join(' ');
  return last2.length > 16 ? last2.slice(0, 15) + '…' : last2;
});

/** Level 1-5 → % chiều rộng progress bar. */
const skillPercent = (level?: number): number => {
  const lv = level ?? 3;
  return Math.max(0, Math.min(100, (lv / 5) * 100));
};

const trunc = (s: string | null | undefined, max: number): string => {
  const v = (s ?? '').trim();
  if (v.length <= max) return v;
  return v.slice(0, max - 1).trimEnd() + '…';
};
</script>

<template>
  <div
    class="w-full h-full grid bg-white text-neutral-800 font-sans overflow-hidden"
    style="grid-template-columns: 35% 65%; gap: 0;"
  >
    <!-- ============ SIDEBAR TRÁI (đúng thứ tự CVTemplate1) ============ -->
    <aside class="bg-stone-700 text-white px-[5%] py-[5%] flex flex-col gap-[4%] overflow-hidden">
      <!-- Avatar tròn, bo viền trắng -->
      <div class="flex justify-center">
        <div
          class="rounded-full bg-white shrink-0 overflow-hidden flex items-center justify-center"
          style="width: 28%; aspect-ratio: 1 / 1;"
        >
          <div class="w-full h-full bg-stone-300 flex items-center justify-center overflow-hidden">
            <img
              v-if="data.personalInfo.avatarUrl"
              :src="data.personalInfo.avatarUrl"
              :alt="data.personalInfo.fullName"
              class="w-full h-full object-cover"
            />
            <span v-else class="font-semibold text-stone-700 text-[8px] leading-none">
              {{ initial }}
            </span>
          </div>
        </div>
      </div>

      <!-- Tên + position (uppercase tracking-wide) -->
      <div class="w-full text-center leading-tight">
        <p
          class="font-bold uppercase tracking-wide truncate"
          style="font-size: 7px;"
        >
          {{ shortName }}
        </p>
        <p
          v-if="data.personalInfo.position"
          class="italic font-normal text-stone-200 opacity-90 mt-[2px] truncate"
          style="font-size: 5.5px;"
        >
          {{ data.personalInfo.position }}
        </p>
      </div>

      <!-- Contact list (mỗi field là 1 dòng riêng, giống CVTemplate1) -->
      <div class="flex flex-col gap-[3%] leading-tight" style="font-size: 5px;">
        <p v-if="data.personalInfo.phone" class="break-all">{{ data.personalInfo.phone }}</p>
        <p v-if="data.personalInfo.email" class="break-all">{{ data.personalInfo.email }}</p>
        <p v-if="data.personalInfo.address" class="break-words">{{ data.personalInfo.address }}</p>
        <p v-if="data.personalInfo.dob">{{ data.personalInfo.dob }}</p>
        <p v-if="data.personalInfo.gender">{{ data.personalInfo.gender }}</p>
      </div>

      <!-- Mục tiêu nghề nghiệp (sidebar — đúng thứ tự CVTemplate1) -->
      <section v-if="data.summary" class="flex flex-col gap-[4%]">
        <h4
          class="font-bold uppercase tracking-wider border-b border-white/30 leading-none"
          style="font-size: 5px; padding-bottom: 2px;"
        >
          Mục tiêu nghề nghiệp
        </h4>
        <p
          class="whitespace-pre-wrap leading-snug"
          style="font-size: 5px;"
        >
          {{ data.summary }}
        </p>
      </section>

      <!-- Kỹ năng — progress bar amber-500 (đúng format CVTemplate1) -->
      <section v-if="data.skills.length" class="flex flex-col gap-[4%] overflow-hidden">
        <h4
          class="font-bold uppercase tracking-wider border-b border-white/30 leading-none"
          style="font-size: 5px; padding-bottom: 2px;"
        >
          Kỹ năng
        </h4>
        <ul class="flex flex-col gap-[4%]">
          <li
            v-for="(s, idx) in data.skills"
            :key="`s-${idx}`"
            class="flex flex-col gap-[1px] leading-tight"
          >
            <div class="flex items-center justify-between" style="font-size: 5px;">
              <span>{{ trunc(s.name, 14) }}</span>
              <span class="text-stone-300" style="font-size: 4.5px;">{{ s.level ?? 3 }}/5</span>
            </div>
            <div class="bg-white/15 rounded-full overflow-hidden" style="height: 2px;">
              <div
                class="bg-amber-500 rounded-full h-full"
                :style="{ width: `${skillPercent(s.level)}%` }"
              />
            </div>
          </li>
        </ul>
      </section>

      <!-- Sở thích — list-disc amber marker -->
      <section v-if="data.interests && data.interests.length" class="flex flex-col gap-[4%]">
        <h4
          class="font-bold uppercase tracking-wider border-b border-white/30 leading-none"
          style="font-size: 5px; padding-bottom: 2px;"
        >
          Sở thích
        </h4>
        <ul
          class="list-disc flex flex-col gap-[2%] marker:text-amber-500"
          style="font-size: 5px; padding-left: 8px;"
        >
          <li v-for="(it, idx) in data.interests" :key="`i-${idx}`">{{ it }}</li>
        </ul>
      </section>
    </aside>

    <!-- ============ MAIN PHẢI (đúng thứ tự CVTemplate1) ============ -->
    <main class="px-[5%] py-[5%] flex flex-col gap-[5%] bg-white overflow-hidden">

      <!-- Học vấn — major (font-semibold stone-700) + dates (amber) + school (bold) -->
      <section v-if="data.educations.length" class="flex flex-col gap-[4%]">
        <h4
          class="flex items-center gap-[2%] font-bold uppercase tracking-wide text-stone-700 border-b-2 border-amber-700 leading-none"
          style="font-size: 5px; padding-bottom: 2px;"
        >
          Học vấn
        </h4>
        <ul class="flex flex-col gap-[4%]">
          <li
            v-for="(e, idx) in data.educations"
            :key="`e-${idx}`"
            class="leading-tight"
          >
            <div class="flex items-baseline justify-between gap-[4%] flex-wrap" style="font-size: 5px;">
              <span class="font-semibold text-stone-700">{{ trunc(e.major || 'Công nghệ thông tin', 26) }}</span>
              <span v-if="e.startYear || e.endYear" class="text-amber-700 font-semibold tracking-wide" style="font-size: 4.5px;">
                {{ e.startYear || '' }}<span v-if="e.startYear || e.endYear"> — </span>{{ e.endYear || 'Nay' }}
              </span>
            </div>
            <p class="mt-[1px] font-semibold text-stone-700" style="font-size: 5px;">
              {{ trunc(e.school, 26) }}
            </p>
          </li>
        </ul>
      </section>

      <!-- Kinh nghiệm làm việc — position (font-semibold stone-700) + dates (amber) + company (bold) -->
      <section v-if="data.experiences.length" class="flex flex-col gap-[4%]">
        <h4
          class="flex items-center gap-[2%] font-bold uppercase tracking-wide text-stone-700 border-b-2 border-amber-700 leading-none"
          style="font-size: 5px; padding-bottom: 2px;"
        >
          Kinh nghiệm làm việc
        </h4>
        <ul class="flex flex-col gap-[4%]">
          <li
            v-for="(x, idx) in data.experiences"
            :key="`x-${idx}`"
            class="leading-tight"
          >
            <div class="flex items-baseline justify-between gap-[4%] flex-wrap" style="font-size: 5px;">
              <span class="font-semibold text-stone-700">{{ trunc(x.position, 26) }}</span>
              <span v-if="x.startDate || x.endDate" class="text-amber-700 font-semibold tracking-wide" style="font-size: 4.5px;">
                {{ x.startDate || '' }}<span v-if="x.startDate || x.endDate"> — </span>{{ x.endDate || 'Nay' }}
              </span>
            </div>
            <p class="mt-[1px] font-semibold text-stone-700" style="font-size: 5px;">
              {{ trunc(x.company, 26) }}
            </p>
          </li>
        </ul>
      </section>

      <!-- Dự án — name + role (uppercase amber) + description + link -->
      <section v-if="data.projects.length" class="flex flex-col gap-[4%]">
        <h4
          class="flex items-center gap-[2%] font-bold uppercase tracking-wide text-stone-700 border-b-2 border-amber-700 leading-none"
          style="font-size: 5px; padding-bottom: 2px;"
        >
          Dự án
        </h4>
        <ul class="flex flex-col gap-[4%]">
          <li
            v-for="(p, idx) in data.projects"
            :key="`p-${idx}`"
            class="leading-tight rounded-sm border border-neutral-200 bg-neutral-50/50"
            style="padding: 4px 6px;"
          >
            <p class="font-semibold text-stone-700" style="font-size: 5px;">{{ trunc(p.name, 26) }}</p>
            <p v-if="p.role" class="text-amber-700 font-semibold uppercase tracking-wide mt-[1px]" style="font-size: 4.5px;">
              {{ p.role }}
            </p>
            <p v-if="p.link" class="text-stone-500 break-all mt-[1px]" style="font-size: 4px;">{{ p.link }}</p>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>