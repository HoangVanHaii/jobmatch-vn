<script setup lang="ts">
/**
 * Template 3 — MINIMAL PROFESSIONAL RESUME (one-column, serif, centered header).
 *
 * Phong cách:
 *   - White background, không có avatar/sidebar/gradient/decoration.
 *   - Header căn giữa: tên (serif, IN HOA, bold) → chức danh (italic) →
 *     contact (dùng `|` separator, hyperlink màu xanh).
 *   - Section heading: serif bold + horizontal line mảnh màu xám bên dưới.
 *   - 1 cột duy nhất, không chia trái-phải.
 *
 * Sections (theo thứ tự ảnh tham chiếu + data có sẵn):
 *   1. Career Objective (data.summary)
 *   2. Skills (data.skills — bullet, bold phần trước dấu ":")
 *   3. Education (data.educations)
 *   4. Featured Projects (data.projects — section MỚI so với bản cũ)
 *   5. Work Experience (data.experiences — thêm để không bỏ data)
 *   6. Activities (data.activities)
 *   7. Certificates (data.certificates)
 *
 * Quy tắc render:
 *   - Field nào không có data → ẩn section.
 *   - Bullet / item list render ĐẦY ĐỦ 100% — KHÔNG truncate, KHÔNG line-clamp.
 *   - Data lấy từ `data: CvRenderData`, không hard-code nội dung ảnh.
 *
 * Phần "Thông tin cá nhân" header chỉ render:
 *   email + phone (line 1)
 *   github + portfolio + linkedin + facebook (line 2)
 * (gender/dob/address bị bỏ — không có trong DB).
 */
import type { CvRenderData } from '@/types/cv';

// `disableLinks` (default false) tự expose cho <template>. Khi true → render
// text-only (<span>) thay vì <a> cho email/github/portfolio/linkedin/facebook/
// project link — dùng khi preview/select-template để user không click nhầm
// vào URL bên trong thumbnail → navigate đi.
withDefaults(
  defineProps<{ data: CvRenderData; disableLinks?: boolean }>(),
  { disableLinks: false },
);

/** Khoảng thời gian "start — end", fallback 'Nay' nếu thiếu end. */
const dateRange = (start: string | undefined, end: string | undefined): string => {
  const s = start ?? '';
  const e = end ?? '';
  if (!s && !e) return '';
  if (s && !e) return s;
  if (!s && e) return e;
  return `${s} — ${e}`;
};

/** Tách skill thành { label, value } theo dấu ":" đầu tiên — phần trước ":" bold. */
const skillParts = (name: string): { label: string; value: string } => {
  const idx = name.indexOf(':');
  if (idx === -1) return { label: '', value: name };
  return {
    label: name.substring(0, idx).trim(),
    value: name.substring(idx + 1).trim(),
  };
};

/** Tách description thành danh sách bullet (newline-separated, filter rỗng). */
const descriptionBullets = (desc: string | undefined): string[] => {
  if (!desc) return [];
  return desc.split('\n').map((l) => l.trim()).filter(Boolean);
};

/** Chuẩn hoá URL — thêm https:// nếu thiếu scheme để link clickable đúng. */
const normalizeUrl = (url: string): string => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
};
</script>

<template>
  <div class="w-full bg-white text-neutral-900 font-serif px-14 py-10">
    <!-- ==================== HEADER CENTERED ==================== -->
    <header class="text-center">
      <h1
        class="font-bold uppercase tracking-wide leading-tight break-words"
        style="font-size: 28px;"
      >
        {{ data.personalInfo.fullName || 'HỌ VÀ TÊN' }}
      </h1>
      <p
        class="italic mt-2 text-neutral-700 break-words"
        style="font-size: 14px;"
      >
        {{ data.personalInfo.position || 'Vị trí ứng tuyển' }}
      </p>

      <!-- Contact line 1: email | phone -->
      <p
        v-if="data.personalInfo.email || data.personalInfo.phone"
        class="mt-3 text-neutral-700"
        style="font-size: 13px;"
      >
        <a
          v-if="data.personalInfo.email && !disableLinks"
          :href="`mailto:${data.personalInfo.email}`"
          class="text-blue-700 hover:underline break-all"
        >{{ data.personalInfo.email }}</a>
        <span
          v-else-if="data.personalInfo.email"
          class="text-blue-700 break-all"
        >{{ data.personalInfo.email }}</span>
        <span
          v-if="data.personalInfo.email && data.personalInfo.phone"
          class="mx-2 text-neutral-500"
        >|</span>
        <span v-if="data.personalInfo.phone">{{ data.personalInfo.phone }}</span>
      </p>

      <!-- Contact line 2: github | portfolio | linkedin | facebook -->
      <p
        v-if="data.personalInfo.github || data.personalInfo.portfolio || data.personalInfo.linkedin || data.personalInfo.facebook"
        class="mt-1.5 text-neutral-700"
        style="font-size: 13px;"
      >
        <a
          v-if="data.personalInfo.github && !disableLinks"
          :href="normalizeUrl(data.personalInfo.github)"
          target="_blank"
          rel="noopener"
          class="text-blue-700 hover:underline"
        >{{ data.personalInfo.github }}</a>
        <span
          v-else-if="data.personalInfo.github"
          class="text-blue-700"
        >{{ data.personalInfo.github }}</span>
        <span
          v-if="data.personalInfo.github && (data.personalInfo.portfolio || data.personalInfo.linkedin || data.personalInfo.facebook)"
          class="mx-2 text-neutral-500"
        >|</span>
        <a
          v-if="data.personalInfo.portfolio && !disableLinks"
          :href="normalizeUrl(data.personalInfo.portfolio)"
          target="_blank"
          rel="noopener"
          class="text-blue-700 hover:underline"
        >{{ data.personalInfo.portfolio }}</a>
        <span
          v-else-if="data.personalInfo.portfolio"
          class="text-blue-700"
        >{{ data.personalInfo.portfolio }}</span>
        <span
          v-if="data.personalInfo.portfolio && (data.personalInfo.linkedin || data.personalInfo.facebook)"
          class="mx-2 text-neutral-500"
        >|</span>
        <a
          v-if="data.personalInfo.linkedin && !disableLinks"
          :href="normalizeUrl(data.personalInfo.linkedin)"
          target="_blank"
          rel="noopener"
          class="text-blue-700 hover:underline"
        >{{ data.personalInfo.linkedin }}</a>
        <span
          v-else-if="data.personalInfo.linkedin"
          class="text-blue-700"
        >{{ data.personalInfo.linkedin }}</span>
        <span
          v-if="data.personalInfo.linkedin && data.personalInfo.facebook"
          class="mx-2 text-neutral-500"
        >|</span>
        <a
          v-if="data.personalInfo.facebook && !disableLinks"
          :href="normalizeUrl(data.personalInfo.facebook)"
          target="_blank"
          rel="noopener"
          class="text-blue-700 hover:underline"
        >{{ data.personalInfo.facebook }}</a>
        <span
          v-else-if="data.personalInfo.facebook"
          class="text-blue-700"
        >{{ data.personalInfo.facebook }}</span>
      </p>
    </header>

    <!-- ==================== CAREER OBJECTIVE ==================== -->
    <section v-if="data.summary" class="mt-7">
      <h2 class="font-serif font-bold" style="font-size: 19px;">Career Objective</h2>
      <hr class="border-t border-neutral-500 mt-1.5 mb-2.5" style="border-top-width: 1px;" />
      <p
        class="text-neutral-800 whitespace-pre-wrap"
        style="font-size: 14px; line-height: 1.4;"
      >
        {{ data.summary }}
      </p>
    </section>

    <!-- ==================== SKILLS ==================== -->
    <section v-if="data.skills.length" class="mt-6">
      <h2 class="font-serif font-bold" style="font-size: 19px;">Skills</h2>
      <hr class="border-t border-neutral-500 mt-1.5 mb-2.5" style="border-top-width: 1px;" />
      <ul class="flex flex-col gap-1" style="font-size: 13.5px; line-height: 1.45;">
        <li
          v-for="(s, i) in data.skills"
          :key="i"
        >
          <template v-if="skillParts(s.name).label">
            <strong>{{ skillParts(s.name).label }}:</strong>
            <span class="text-neutral-800"> {{ skillParts(s.name).value }}</span>
          </template>
          <span v-else class="text-neutral-800">{{ s.name }}</span>
        </li>
      </ul>
    </section>

    <!-- ==================== EDUCATION ==================== -->
    <section v-if="data.educations.length" class="mt-6">
      <h2 class="font-serif font-bold" style="font-size: 19px;">Education</h2>
      <hr class="border-t border-neutral-500 mt-1.5 mb-2.5" style="border-top-width: 1px;" />
      <ul class="flex flex-col gap-4">
        <li v-for="(e, i) in data.educations" :key="i">
          <div class="flex items-baseline justify-between gap-3 flex-wrap">
            <strong style="font-size: 14px;">{{ e.school }}</strong>
            <span
              v-if="e.startYear || e.endYear"
              class="text-neutral-500 italic whitespace-nowrap"
              style="font-size: 12.5px;"
            >
              {{ dateRange(e.startYear, e.endYear) }}
            </span>
          </div>
          <div
            v-if="e.major || e.degree"
            class="flex items-baseline justify-between gap-3 flex-wrap mt-0.5"
          >
            <em
              v-if="e.major"
              class="text-neutral-700"
              style="font-size: 13px;"
            >Major: {{ e.major }}</em>
            <span
              v-if="e.degree"
              class="text-neutral-500 italic whitespace-nowrap"
              style="font-size: 12.5px;"
            >
              {{ e.degree }}
            </span>
          </div>
          <p
            v-if="e.description"
            class="text-neutral-700 whitespace-pre-wrap mt-1.5"
            style="font-size: 13px; line-height: 1.45;"
          >
            {{ e.description }}
          </p>
        </li>
      </ul>
    </section>

    <!-- ==================== FEATURED PROJECTS ==================== -->
    <section v-if="data.projects.length" class="mt-6">
      <h2 class="font-serif font-bold" style="font-size: 19px;">Featured Projects</h2>
      <hr class="border-t border-neutral-500 mt-1.5 mb-3" style="border-top-width: 1px;" />
      <ul class="flex flex-col gap-5">
        <li v-for="(p, i) in data.projects" :key="i">
          <!-- Project name (bold serif) -->
          <p class="font-bold text-neutral-900 leading-tight" style="font-size: 15.5px;">
            {{ p.name }}
          </p>
          <!-- Meta italic: Role -->
          <p
            v-if="p.role"
            class="italic text-neutral-600 mt-0.5"
            style="font-size: 12.5px;"
          >
            Role: {{ p.role }}
          </p>
          <!-- GitHub link -->
          <p
            v-if="p.link"
            class="mt-0.5"
            style="font-size: 13px;"
          >
            <strong class="text-neutral-900">GitHub:</strong>
            <a
              v-if="!disableLinks"
              :href="normalizeUrl(p.link)"
              target="_blank"
              rel="noopener"
              class="text-blue-700 hover:underline break-all ml-1"
            >{{ p.link }}</a>
            <span
              v-else
              class="text-blue-700 break-all ml-1"
            >{{ p.link }}</span>
          </p>
          <!-- Description bullets -->
          <ul
            v-if="p.description"
            class="flex flex-col gap-1 mt-1.5"
            style="font-size: 13px; line-height: 1.45;"
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

    <!-- ==================== WORK EXPERIENCE (data có thì hiển thị) ==================== -->
    <section v-if="data.experiences.length" class="mt-6">
      <h2 class="font-serif font-bold" style="font-size: 19px;">Work Experience</h2>
      <hr class="border-t border-neutral-500 mt-1.5 mb-2.5" style="border-top-width: 1px;" />
      <ul class="flex flex-col gap-4">
        <li v-for="(x, i) in data.experiences" :key="i">
          <div class="flex items-baseline justify-between gap-3 flex-wrap">
            <strong style="font-size: 14px;">{{ x.company }}</strong>
            <span
              v-if="x.startDate || x.endDate"
              class="text-neutral-500 italic whitespace-nowrap"
              style="font-size: 12.5px;"
            >
              {{ dateRange(x.startDate, x.endDate) }}
            </span>
          </div>
          <p class="italic text-neutral-700 mt-0.5" style="font-size: 13px;">
            {{ x.position }}
          </p>
          <p
            v-if="x.description"
            class="text-neutral-700 whitespace-pre-wrap mt-1.5"
            style="font-size: 13px; line-height: 1.45;"
          >
            {{ x.description }}
          </p>
        </li>
      </ul>
    </section>

    <!-- ==================== ACTIVITIES ==================== -->
    <section v-if="data.activities.length" class="mt-6">
      <h2 class="font-serif font-bold" style="font-size: 19px;">Activities</h2>
      <hr class="border-t border-neutral-500 mt-1.5 mb-2.5" style="border-top-width: 1px;" />
      <ul class="flex flex-col gap-4">
        <li v-for="(a, i) in data.activities" :key="i">
          <div class="flex items-baseline justify-between gap-3 flex-wrap">
            <strong style="font-size: 14px;">{{ a.name }}</strong>
            <span
              v-if="a.time"
              class="text-neutral-500 italic whitespace-nowrap"
              style="font-size: 12.5px;"
            >
              {{ a.time }}
            </span>
          </div>
          <p
            v-if="a.role"
            class="italic text-neutral-700 mt-0.5"
            style="font-size: 13px;"
          >
            {{ a.role }}
          </p>
          <p
            v-if="a.description"
            class="text-neutral-700 whitespace-pre-wrap mt-1.5"
            style="font-size: 13px; line-height: 1.45;"
          >
            {{ a.description }}
          </p>
        </li>
      </ul>
    </section>

    <!-- ==================== CERTIFICATES ==================== -->
    <section v-if="data.certificates.length" class="mt-6">
      <h2 class="font-serif font-bold" style="font-size: 19px;">Certificates</h2>
      <hr class="border-t border-neutral-500 mt-1.5 mb-2.5" style="border-top-width: 1px;" />
      <ul class="flex flex-col gap-2.5">
        <li
          v-for="(c, i) in data.certificates"
          :key="i"
          style="font-size: 13px;"
        >
          <strong class="text-neutral-900">{{ c.name }}</strong>
          <span v-if="c.issuer" class="text-neutral-700"> — {{ c.issuer }}</span>
          <span
            v-if="c.date"
            class="text-neutral-500 italic ml-2"
            style="font-size: 12.5px;"
          >{{ c.date }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
