<script setup lang="ts">
/**
 * CvThumbnailTemplate2 — bản thu nhỏ của CVTemplate2 (teal + corner decorations).
 *
 * NGUYÊN TẮC QUAN TRỌNG: render ĐẦY ĐỦ 100% nội dung giống CVTemplate2.vue.
 *   - Cùng data (data: CvRenderData).
 *   - Cùng section: email/phone, skills, certificates, interests, summary,
 *     educations, experiences, activities, projects.
 *   - Cùng field cho mỗi item.
 *   - Cùng thứ tự section (header → left → right).
 *   - Cùng cấu trúc DOM (corner decorations + header + 2 cột 34/66).
 *
 * KHÔNG BAO GIỜ:
 *   - truncate text bằng `...` hoặc slice.
 *   - line-clamp / max-height / overflow-hidden để ẩn content.
 *   - bỏ section / bỏ field / bỏ bullet.
 *
 * KHÁC BIỆT với CVTemplate2.vue:
 *   - Kích thước nhỏ hơn (font 2.5-6px, padding theo %) để fit container ~132×170.
 *   - Dùng % thay cho px để scale theo container (parent MyResumesView set
 *     width=132px + aspectRatio 850/1100 ≈ height 170px).
 */
import type { CvRenderData } from '@/types/cv';

defineProps<{ data: CvRenderData }>();

const initial = (name: string | undefined | null): string => {
  const trimmed = (name ?? '').trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
};

const dateRange = (start: string | undefined, end: string | undefined): string => {
  const s = start ?? '';
  const e = end ?? '';
  if (!s && !e) return '';
  if (s && !e) return s;
  if (!s && e) return e;
  return `${s} — ${e}`;
};
</script>

<template>
  <div class="w-full h-full bg-white text-neutral-900 font-sans relative overflow-hidden">
    <!-- ==================== TOP-LEFT TEAL DECORATION ====================
         Thin geometric L-shape giống CVTemplate2 — 2 thanh vuông góc. -->
    <div
      class="absolute top-0 left-0 z-0"
      style="width: 21%; height: 1%; background: #5FA3BA;"
    />
    <div
      class="absolute top-0 left-0 z-0"
      style="width: 1.2%; height: 10%; background: #5FA3BA;"
    />

    <!-- ==================== BOTTOM-RIGHT TEAL DECORATION ====================
         Thin geometric reverse L-shape — mirror của top-left. -->
    <div
      class="absolute bottom-0 right-0 z-0"
      style="width: 1.2%; height: 11%; background: #5FA3BA;"
    />
    <div
      class="absolute bottom-0 right-0 z-0"
      style="width: 22%; height: 1%; background: #5FA3BA;"
    />

    <!-- ==================== HEADER ==================== -->
    <div class="relative z-[1] flex items-start gap-[6%] px-[6%] pt-[8%] pb-[4%]">
      <!-- Avatar tròn -->
      <div
        class="rounded-full bg-white shrink-0 overflow-hidden flex items-center justify-center"
        style="
          width: 22%;
          aspect-ratio: 1 / 1;
          border: 0.5px solid #111111;
          padding: 1px;
        "
      >
        <div class="w-full h-full rounded-full overflow-hidden bg-neutral-200 flex items-center justify-center">
          <img
            v-if="data.personalInfo.avatarUrl"
            :src="data.personalInfo.avatarUrl"
            :alt="data.personalInfo.fullName"
            class="w-full h-full object-cover rounded-full"
          />
          <span
            v-else
            class="font-semibold text-neutral-400 leading-none"
            style="font-size: 7px;"
          >
            {{ initial(data.personalInfo.fullName) }}
          </span>
        </div>
      </div>

      <!-- Họ tên + chức danh + contact -->
      <div class="flex-1 min-w-0 leading-tight">
        <p
          class="font-bold uppercase tracking-wide break-words"
          style="font-size: 6px;"
        >
          {{ data.personalInfo.fullName || 'HỌ VÀ TÊN' }}
        </p>
        <p
          class="font-medium uppercase mt-[1px] break-words"
          style="font-size: 4px;"
        >
          {{ data.personalInfo.position || 'Vị trí ứng tuyển' }}
        </p>

        <!-- Contact list -->
        <ul class="mt-[3px] flex flex-col gap-[1px]">
          <li v-if="data.personalInfo.email" class="flex items-center gap-[2px]">
            <span
              class="rounded-full bg-[#5FA3BA] flex items-center justify-center shrink-0"
              style="width: 3px; height: 3px;"
            >
              <span class="text-white" style="font-size: 1.8px;">✉</span>
            </span>
            <span class="break-all" style="font-size: 3px;">{{ data.personalInfo.email }}</span>
          </li>
          <li v-if="data.personalInfo.phone" class="flex items-center gap-[2px]">
            <span
              class="rounded-full bg-[#5FA3BA] flex items-center justify-center shrink-0"
              style="width: 3px; height: 3px;"
            >
              <span class="text-white" style="font-size: 1.8px;">☎</span>
            </span>
            <span style="font-size: 3px;">{{ data.personalInfo.phone }}</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- ==================== BODY 2 CỘT ==================== -->
    <div
      class="relative z-[1] grid px-[6%] pb-[5%]"
      style="grid-template-columns: 34% 66%; column-gap: 4%;"
    >
      <!-- ============ LEFT COLUMN (~34%) ============ -->
      <aside class="flex flex-col gap-[4%]">
        <!-- Kỹ năng -->
        <section v-if="data.skills.length">
          <h2
            class="font-bold uppercase mb-[3%]"
            style="color: #5FA3BA; font-size: 4.5px;"
          >
            Kỹ năng
          </h2>
          <ul class="flex flex-col gap-[1px]" style="font-size: 3px;">
            <li v-for="(s, i) in data.skills" :key="i">- {{ s.name }}</li>
          </ul>
        </section>

        <!-- Chứng chỉ -->
        <section v-if="data.certificates.length">
          <h2
            class="font-bold uppercase mb-[3%]"
            style="color: #5FA3BA; font-size: 4.5px;"
          >
            Chứng chỉ
          </h2>
          <ul class="flex flex-col gap-[2px]" style="font-size: 3px;">
            <li v-for="(c, i) in data.certificates" :key="i">
              <p class="font-semibold text-neutral-900 leading-tight">{{ c.name }}</p>
              <p
                v-if="c.issuer"
                class="text-neutral-700 leading-tight mt-[1px]"
                style="font-size: 2.5px;"
              >
                {{ c.issuer }}
              </p>
              <p
                v-if="c.date"
                class="text-neutral-600 leading-tight mt-[1px]"
                style="font-size: 2.5px;"
              >
                {{ c.date }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Sở thích -->
        <section v-if="data.interests && data.interests.length">
          <h2
            class="font-bold uppercase mb-[3%]"
            style="color: #5FA3BA; font-size: 4.5px;"
          >
            Sở thích
          </h2>
          <ul class="flex flex-col gap-[1px]" style="font-size: 3px;">
            <li v-for="(it, i) in data.interests" :key="i">- {{ it }}</li>
          </ul>
        </section>
      </aside>

      <!-- ============ RIGHT COLUMN (~66%) ============ -->
      <main class="flex flex-col gap-[4%]">
        <!-- Mục tiêu nghề nghiệp -->
        <section v-if="data.summary">
          <h2
            class="font-bold uppercase mb-[3%]"
            style="color: #5FA3BA; font-size: 4.5px;"
          >
            Mục tiêu nghề nghiệp
          </h2>
          <p
            class="text-neutral-800 whitespace-pre-wrap"
            style="font-size: 3px; line-height: 1.4;"
          >
            {{ data.summary }}
          </p>
        </section>

        <!-- Trình độ học vấn -->
        <section v-if="data.educations.length">
          <h2
            class="font-bold uppercase mb-[3%]"
            style="color: #5FA3BA; font-size: 4.5px;"
          >
            Trình độ học vấn
          </h2>
          <ul class="flex flex-col gap-[3px]" style="font-size: 3px;">
            <li v-for="(e, i) in data.educations" :key="i">
              <p class="font-semibold text-neutral-900 leading-tight">{{ e.school }}</p>
              <p
                v-if="e.startYear || e.endYear"
                class="text-neutral-600 leading-tight mt-[1px]"
                style="font-size: 2.5px;"
              >
                {{ dateRange(e.startYear, e.endYear) }}
              </p>
              <p
                v-if="e.degree || e.major"
                class="text-neutral-800 leading-tight mt-[1px]"
              >
                <span v-if="e.degree">{{ e.degree }}</span>
                <span v-if="e.degree && e.major"> - </span>
                <span v-if="e.major">{{ e.major }}</span>
              </p>
              <p
                v-if="e.description"
                class="text-neutral-700 whitespace-pre-wrap mt-[1px]"
                style="font-size: 2.5px; line-height: 1.3;"
              >
                {{ e.description }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Kinh nghiệm làm việc -->
        <section v-if="data.experiences.length">
          <h2
            class="font-bold uppercase mb-[3%]"
            style="color: #5FA3BA; font-size: 4.5px;"
          >
            Kinh nghiệm làm việc
          </h2>
          <ul class="flex flex-col gap-[3px]" style="font-size: 3px;">
            <li v-for="(x, i) in data.experiences" :key="i">
              <p class="font-semibold text-neutral-900 leading-tight">{{ x.company }}</p>
              <p
                v-if="x.startDate || x.endDate"
                class="text-neutral-600 leading-tight mt-[1px]"
                style="font-size: 2.5px;"
              >
                {{ dateRange(x.startDate, x.endDate) }}
              </p>
              <p class="font-medium text-neutral-800 leading-tight mt-[1px]">{{ x.position }}</p>
              <p
                v-if="x.description"
                class="text-neutral-700 whitespace-pre-wrap mt-[1px]"
                style="font-size: 2.5px; line-height: 1.3;"
              >
                {{ x.description }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Hoạt động -->
        <section v-if="data.activities.length">
          <h2
            class="font-bold uppercase mb-[3%]"
            style="color: #5FA3BA; font-size: 4.5px;"
          >
            Hoạt động
          </h2>
          <ul class="flex flex-col gap-[3px]" style="font-size: 3px;">
            <li v-for="(a, i) in data.activities" :key="i">
              <p class="font-semibold text-neutral-900 leading-tight">{{ a.name }}</p>
              <p
                v-if="a.time"
                class="text-neutral-600 leading-tight mt-[1px]"
                style="font-size: 2.5px;"
              >
                {{ a.time }}
              </p>
              <p
                v-if="a.role"
                class="text-neutral-800 leading-tight mt-[1px]"
              >
                {{ a.role }}
              </p>
              <p
                v-if="a.description"
                class="text-neutral-700 whitespace-pre-wrap mt-[1px]"
                style="font-size: 2.5px; line-height: 1.3;"
              >
                {{ a.description }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Dự án tham gia -->
        <section v-if="data.projects.length">
          <h2
            class="font-bold uppercase mb-[3%]"
            style="color: #5FA3BA; font-size: 4.5px;"
          >
            Dự án tham gia
          </h2>
          <ul class="flex flex-col gap-[3px]" style="font-size: 3px;">
            <li v-for="(p, i) in data.projects" :key="i">
              <p class="font-semibold text-neutral-900 leading-tight">{{ p.name }}</p>
              <p
                v-if="p.time"
                class="text-neutral-600 leading-tight mt-[1px]"
                style="font-size: 2.5px;"
              >
                {{ p.time }}
              </p>
              <p
                v-if="p.role"
                class="font-medium text-neutral-800 leading-tight mt-[1px]"
              >
                {{ p.role }}
              </p>
              <p
                v-if="p.description"
                class="text-neutral-700 whitespace-pre-wrap mt-[1px]"
                style="font-size: 2.5px; line-height: 1.3;"
              >
                {{ p.description }}
              </p>
              <p
                v-if="p.link"
                class="break-all mt-[1px]"
                style="font-size: 2.5px; color: #5FA3BA;"
              >
                {{ p.link }}
              </p>
            </li>
          </ul>
        </section>
      </main>
    </div>
  </div>
</template>
