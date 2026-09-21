<script setup lang="ts">
/**
 * CvThumbnailTemplate3 — bản thu nhỏ của CVTemplate3 (minimal serif, one-column).
 *
 * NGUYÊN TẮC QUAN TRỌNG: render ĐẦY ĐỦ 100% nội dung giống CVTemplate3.vue.
 *   - Cùng data (data: CvRenderData).
 *   - Cùng section: Career Objective, Skills, Education, Featured Projects,
 *     Work Experience, Activities, Certificates.
 *   - Cùng field cho mỗi item.
 *   - Cùng thứ tự section.
 *   - Cùng cấu trúc DOM (centered header + 1 column với hr-lines).
 *
 * KHÔNG BAO GIỜ:
 *   - truncate text bằng `...` hoặc slice.
 *   - line-clamp / max-height / overflow-hidden để ẩn content.
 *   - bỏ section / bỏ field / bỏ bullet.
 *
 * KHÁC BIỆT với CVTemplate3.vue:
 *   - Kích thước nhỏ hơn (font 2.5-5px, padding theo %) để fit container ~132×170.
 *   - Dùng % thay cho px để scale theo container.
 */
import type { CvRenderData } from '@/types/cv';

defineProps<{ data: CvRenderData }>();

const dateRange = (start: string | undefined, end: string | undefined): string => {
  const s = start ?? '';
  const e = end ?? '';
  if (!s && !e) return '';
  if (s && !e) return s;
  if (!s && e) return e;
  return `${s} — ${e}`;
};

const skillParts = (name: string): { label: string; value: string } => {
  const idx = name.indexOf(':');
  if (idx === -1) return { label: '', value: name };
  return {
    label: name.substring(0, idx).trim(),
    value: name.substring(idx + 1).trim(),
  };
};

const descriptionBullets = (desc: string | undefined): string[] => {
  if (!desc) return [];
  return desc.split('\n').map((l) => l.trim()).filter(Boolean);
};
</script>

<template>
  <div class="w-full h-full bg-white text-neutral-900 font-serif overflow-hidden">
    <!-- ==================== HEADER CENTERED ==================== -->
    <header class="text-center">
      <p
        class="font-bold uppercase tracking-wide leading-tight break-words"
        style="font-size: 6px;"
      >
        {{ data.personalInfo.fullName || 'HỌ VÀ TÊN' }}
      </p>
      <p
        class="italic mt-[1px] text-neutral-700 break-words"
        style="font-size: 3.5px;"
      >
        {{ data.personalInfo.position || 'Vị trí ứng tuyển' }}
      </p>

      <!-- Contact line 1 -->
      <p
        v-if="data.personalInfo.email || data.personalInfo.phone"
        class="mt-[2px] text-neutral-700"
        style="font-size: 3px;"
      >
        <span v-if="data.personalInfo.email" class="break-all">{{ data.personalInfo.email }}</span>
        <span
          v-if="data.personalInfo.email && data.personalInfo.phone"
          class="mx-[2px] text-neutral-500"
        >|</span>
        <span v-if="data.personalInfo.phone">{{ data.personalInfo.phone }}</span>
      </p>

      <!-- Contact line 2 -->
      <p
        v-if="data.personalInfo.github || data.personalInfo.portfolio || data.personalInfo.linkedin || data.personalInfo.facebook"
        class="mt-[1px] text-neutral-700"
        style="font-size: 3px;"
      >
        <span v-if="data.personalInfo.github">{{ data.personalInfo.github }}</span>
        <span
          v-if="data.personalInfo.github && (data.personalInfo.portfolio || data.personalInfo.linkedin || data.personalInfo.facebook)"
          class="mx-[2px] text-neutral-500"
        >|</span>
        <span v-if="data.personalInfo.portfolio">{{ data.personalInfo.portfolio }}</span>
        <span
          v-if="data.personalInfo.portfolio && (data.personalInfo.linkedin || data.personalInfo.facebook)"
          class="mx-[2px] text-neutral-500"
        >|</span>
        <span v-if="data.personalInfo.linkedin">{{ data.personalInfo.linkedin }}</span>
        <span
          v-if="data.personalInfo.linkedin && data.personalInfo.facebook"
          class="mx-[2px] text-neutral-500"
        >|</span>
        <span v-if="data.personalInfo.facebook">{{ data.personalInfo.facebook }}</span>
      </p>
    </header>

    <!-- ==================== CAREER OBJECTIVE ==================== -->
    <section v-if="data.summary" class="mt-[4%]">
      <h2 class="font-serif font-bold leading-none" style="font-size: 4.5px;">
        Career Objective
      </h2>
      <hr class="border-t border-neutral-500 mt-[2px] mb-[3px]" style="border-top-width: 0.5px;" />
      <p
        class="text-neutral-800 whitespace-pre-wrap"
        style="font-size: 3px; line-height: 1.35;"
      >
        {{ data.summary }}
      </p>
    </section>

    <!-- ==================== SKILLS ==================== -->
    <section v-if="data.skills.length" class="mt-[4%]">
      <h2 class="font-serif font-bold leading-none" style="font-size: 4.5px;">
        Skills
      </h2>
      <hr class="border-t border-neutral-500 mt-[2px] mb-[3px]" style="border-top-width: 0.5px;" />
      <ul class="flex flex-col gap-[1px]" style="font-size: 3px; line-height: 1.35;">
        <li v-for="(s, i) in data.skills" :key="i">
          <template v-if="skillParts(s.name).label">
            <strong>{{ skillParts(s.name).label }}:</strong>
            <span class="text-neutral-800"> {{ skillParts(s.name).value }}</span>
          </template>
          <span v-else class="text-neutral-800">{{ s.name }}</span>
        </li>
      </ul>
    </section>

    <!-- ==================== EDUCATION ==================== -->
    <section v-if="data.educations.length" class="mt-[4%]">
      <h2 class="font-serif font-bold leading-none" style="font-size: 4.5px;">
        Education
      </h2>
      <hr class="border-t border-neutral-500 mt-[2px] mb-[3px]" style="border-top-width: 0.5px;" />
      <ul class="flex flex-col gap-[3px]">
        <li v-for="(e, i) in data.educations" :key="i">
          <div class="flex items-baseline justify-between gap-[2px] flex-wrap">
            <strong style="font-size: 3.2px;">{{ e.school }}</strong>
            <span
              v-if="e.startYear || e.endYear"
              class="text-neutral-500 italic whitespace-nowrap"
              style="font-size: 2.5px;"
            >
              {{ dateRange(e.startYear, e.endYear) }}
            </span>
          </div>
          <div
            v-if="e.major || e.degree"
            class="flex items-baseline justify-between gap-[2px] flex-wrap mt-[1px]"
          >
            <em
              v-if="e.major"
              class="text-neutral-700"
              style="font-size: 2.8px;"
            >Major: {{ e.major }}</em>
            <span
              v-if="e.degree"
              class="text-neutral-500 italic whitespace-nowrap"
              style="font-size: 2.5px;"
            >
              {{ e.degree }}
            </span>
          </div>
          <p
            v-if="e.description"
            class="text-neutral-700 whitespace-pre-wrap mt-[1px]"
            style="font-size: 2.8px; line-height: 1.3;"
          >
            {{ e.description }}
          </p>
        </li>
      </ul>
    </section>

    <!-- ==================== FEATURED PROJECTS ==================== -->
    <section v-if="data.projects.length" class="mt-[4%]">
      <h2 class="font-serif font-bold leading-none" style="font-size: 4.5px;">
        Featured Projects
      </h2>
      <hr class="border-t border-neutral-500 mt-[2px] mb-[3px]" style="border-top-width: 0.5px;" />
      <ul class="flex flex-col gap-[4px]">
        <li v-for="(p, i) in data.projects" :key="i">
          <p class="font-bold text-neutral-900 leading-tight" style="font-size: 3.5px;">
            {{ p.name }}
          </p>
          <p
            v-if="p.role"
            class="italic text-neutral-600 mt-[1px]"
            style="font-size: 2.5px;"
          >
            Role: {{ p.role }}
          </p>
          <p
            v-if="p.link"
            class="mt-[1px]"
            style="font-size: 2.8px;"
          >
            <strong class="text-neutral-900">GitHub:</strong>
            <span class="break-all ml-[1px]">{{ p.link }}</span>
          </p>
          <ul
            v-if="p.description"
            class="flex flex-col gap-[1px] mt-[1px]"
            style="font-size: 2.8px; line-height: 1.3;"
          >
            <li
              v-for="(line, idx) in descriptionBullets(p.description)"
              :key="idx"
              class="text-neutral-800"
            >
              {{ line.startsWith('•') ? line : '• ' + line }}
            </li>
          </ul>
        </li>
      </ul>
    </section>

    <!-- ==================== WORK EXPERIENCE ==================== -->
    <section v-if="data.experiences.length" class="mt-[4%]">
      <h2 class="font-serif font-bold leading-none" style="font-size: 4.5px;">
        Work Experience
      </h2>
      <hr class="border-t border-neutral-500 mt-[2px] mb-[3px]" style="border-top-width: 0.5px;" />
      <ul class="flex flex-col gap-[3px]">
        <li v-for="(x, i) in data.experiences" :key="i">
          <div class="flex items-baseline justify-between gap-[2px] flex-wrap">
            <strong style="font-size: 3.2px;">{{ x.company }}</strong>
            <span
              v-if="x.startDate || x.endDate"
              class="text-neutral-500 italic whitespace-nowrap"
              style="font-size: 2.5px;"
            >
              {{ dateRange(x.startDate, x.endDate) }}
            </span>
          </div>
          <p class="italic text-neutral-700 mt-[1px]" style="font-size: 2.8px;">
            {{ x.position }}
          </p>
          <p
            v-if="x.description"
            class="text-neutral-700 whitespace-pre-wrap mt-[1px]"
            style="font-size: 2.8px; line-height: 1.3;"
          >
            {{ x.description }}
          </p>
        </li>
      </ul>
    </section>

    <!-- ==================== ACTIVITIES ==================== -->
    <section v-if="data.activities.length" class="mt-[4%]">
      <h2 class="font-serif font-bold leading-none" style="font-size: 4.5px;">
        Activities
      </h2>
      <hr class="border-t border-neutral-500 mt-[2px] mb-[3px]" style="border-top-width: 0.5px;" />
      <ul class="flex flex-col gap-[3px]">
        <li v-for="(a, i) in data.activities" :key="i">
          <div class="flex items-baseline justify-between gap-[2px] flex-wrap">
            <strong style="font-size: 3.2px;">{{ a.name }}</strong>
            <span
              v-if="a.time"
              class="text-neutral-500 italic whitespace-nowrap"
              style="font-size: 2.5px;"
            >
              {{ a.time }}
            </span>
          </div>
          <p
            v-if="a.role"
            class="italic text-neutral-700 mt-[1px]"
            style="font-size: 2.8px;"
          >
            {{ a.role }}
          </p>
          <p
            v-if="a.description"
            class="text-neutral-700 whitespace-pre-wrap mt-[1px]"
            style="font-size: 2.8px; line-height: 1.3;"
          >
            {{ a.description }}
          </p>
        </li>
      </ul>
    </section>

    <!-- ==================== CERTIFICATES ==================== -->
    <section v-if="data.certificates.length" class="mt-[4%]">
      <h2 class="font-serif font-bold leading-none" style="font-size: 4.5px;">
        Certificates
      </h2>
      <hr class="border-t border-neutral-500 mt-[2px] mb-[3px]" style="border-top-width: 0.5px;" />
      <ul class="flex flex-col gap-[2px]" style="font-size: 2.8px;">
        <li v-for="(c, i) in data.certificates" :key="i">
          <strong class="text-neutral-900">{{ c.name }}</strong>
          <span v-if="c.issuer" class="text-neutral-700"> — {{ c.issuer }}</span>
          <span
            v-if="c.date"
            class="text-neutral-500 italic ml-[2px]"
            style="font-size: 2.5px;"
          >{{ c.date }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
