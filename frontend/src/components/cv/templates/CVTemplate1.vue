<script setup lang="ts">
/**
 * Template 1 — bám sát ảnh tham chiếu (TopCV-style orange header).
 *
 * Cấu trúc:
 *   1. Header cam full-width (200px) chứa avatar (200x200, overlap xuống body)
 *      + họ tên (IN HOA, trắng) + chức danh (trắng, nhỏ hơn).
 *   2. Body 2 cột: sidebar trái (~35%) + main phải (~65%).
 *   3. Section heading: pill cam (inline-block, border-radius nhẹ, chữ trắng).
 *
 * Quy tắc render:
 *   - Section nào không có data thì ẩn hẳn (không hiển thị pill trống).
 *   - Bullet / item list render ĐẦY ĐỦ 100% — KHÔNG truncate, KHÔNG line-clamp,
 *     KHÔNG max-height.
 *   - Data lấy từ `data: CvRenderData`, không hard-code giá trị nào.
 *
 * Tỷ lệ 2 cột dùng `grid-cols-[35%_65%]` để sidebar hẹp hơn main như ảnh.
 * Container max-width 850px (chuẩn A4) + mx-auto để căn giữa khi preview.
 */
import type { CvRenderData } from '@/types/cv';

defineProps<{ data: CvRenderData }>();

/** Lấy chữ cái đầu của tên làm avatar fallback khi không có avatarUrl. */
const initial = (name: string | undefined | null): string => {
  const trimmed = (name ?? '').trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
};

/** Hiển thị khoảng thời gian — bỏ dấu — nếu 1 trong 2 vế có giá trị. */
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
  <div class="w-full bg-white text-neutral-800 font-sans leading-relaxed">
    <!-- ==================== HEADER CAM (full width) ==================== -->
    <div class="w-full bg-orange-500 relative" style="height: 200px;">
      <div class="max-w-[850px] mx-auto h-full relative">
        <!-- Họ tên + chức danh (căn phải theo chiều dọc, nằm bên phải avatar) -->
        <div
          class="absolute top-1/2 -translate-y-1/2 text-white"
          style="left: 280px; right: 40px;"
        >
          <h1
            class="font-bold uppercase tracking-wide leading-tight break-words"
            style="font-size: 30px;"
          >
            {{ data.personalInfo.fullName || 'HỌ VÀ TÊN' }}
          </h1>
          <p
            class="font-normal mt-2 opacity-95 break-words"
            style="font-size: 16px;"
          >
            {{ data.personalInfo.position || 'Vị trí ứng tuyển' }}
          </p>
        </div>
      </div>
    </div>

    <!-- ==================== BODY 2 CỘT ==================== -->
    <div class="max-w-[850px] mx-auto grid relative" style="grid-template-columns: 35% 65%;">
      <!-- ============ AVATAR (nằm giữa header và body) ============
           top: -100px = nửa trên nằm trong header (cam), nửa dưới nằm trong body. -->
      <div
        class="absolute z-10"
        style="left: 40px; top: -100px; width: 200px; height: 200px;"
      >
        <div class="w-full h-full rounded-full bg-white p-[8px] shadow-lg">
          <div class="w-full h-full rounded-full overflow-hidden bg-stone-200 flex items-center justify-center">
            <img
              v-if="data.personalInfo.avatarUrl"
              :src="data.personalInfo.avatarUrl"
              :alt="data.personalInfo.fullName"
              class="w-full h-full object-cover"
            />
            <span
              v-else
              class="font-semibold text-stone-400 leading-none"
              style="font-size: 64px;"
            >
              {{ initial(data.personalInfo.fullName) }}
            </span>
          </div>
        </div>
      </div>

      <!-- ============ SIDEBAR TRÁI (~35%) ============ -->
      <aside
        class="bg-white"
        style="padding: 110px 24px 32px 24px;"
      >
        <!-- Thông tin cá nhân — căn giữa, chỉ hiển thị Email và Điện thoại
             (database chỉ lưu 2 field này, gender/dob/address bị bỏ). -->
        <div class="flex flex-col items-center gap-3 mb-7">
          <div class="text-center">
            <p class="text-neutral-500 leading-none" style="font-size: 11px;">Email</p>
            <p class="font-semibold text-neutral-800 leading-tight mt-1 break-all" style="font-size: 13px;">
              {{ data.personalInfo.email || '—' }}
            </p>
          </div>
          <div class="text-center">
            <p class="text-neutral-500 leading-none" style="font-size: 11px;">Điện thoại</p>
            <p class="font-semibold text-neutral-800 leading-tight mt-1" style="font-size: 13px;">
              {{ data.personalInfo.phone || '—' }}
            </p>
          </div>
        </div>

        <!-- Kỹ năng -->
        <section v-if="data.skills.length" class="mb-6">
          <h2
            class="inline-block bg-orange-500 text-white font-semibold rounded-md leading-none mb-3"
            style="font-size: 14px; padding: 8px 14px;"
          >
            Kỹ năng
          </h2>
          <ul class="flex flex-col gap-1.5">
            <li
              v-for="(s, i) in data.skills"
              :key="i"
              class="text-neutral-700 leading-snug"
              style="font-size: 13px;"
            >
              • {{ s.name }}
            </li>
          </ul>
        </section>

        <!-- Sở thích -->
        <section v-if="data.interests && data.interests.length" class="mb-6">
          <h2
            class="inline-block bg-orange-500 text-white font-semibold rounded-md leading-none mb-3"
            style="font-size: 14px; padding: 8px 14px;"
          >
            Sở thích
          </h2>
          <ul class="flex flex-col gap-1.5">
            <li
              v-for="(it, i) in data.interests"
              :key="i"
              class="text-neutral-700 leading-snug"
              style="font-size: 13px;"
            >
              • {{ it }}
            </li>
          </ul>
        </section>

        <!-- Chứng chỉ -->
        <section v-if="data.certificates.length" class="mb-6">
          <h2
            class="inline-block bg-orange-500 text-white font-semibold rounded-md leading-none mb-3"
            style="font-size: 14px; padding: 8px 14px;"
          >
            Chứng chỉ
          </h2>
          <ul class="flex flex-col gap-2.5">
            <li v-for="(c, i) in data.certificates" :key="i">
              <p class="font-semibold text-neutral-800 leading-tight" style="font-size: 13px;">
                {{ c.name }}
              </p>
              <p
                v-if="c.issuer"
                class="text-neutral-600 leading-tight mt-0.5"
                style="font-size: 12px;"
              >
                {{ c.issuer }}
              </p>
              <p
                v-if="c.date"
                class="text-neutral-500 leading-tight mt-0.5"
                style="font-size: 11px;"
              >
                {{ c.date }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Hoạt động -->
        <section v-if="data.activities.length">
          <h2
            class="inline-block bg-orange-500 text-white font-semibold rounded-md leading-none mb-3"
            style="font-size: 14px; padding: 8px 14px;"
          >
            Hoạt động
          </h2>
          <ul class="flex flex-col gap-3">
            <li v-for="(a, i) in data.activities" :key="i">
              <p class="font-semibold text-neutral-800 leading-tight" style="font-size: 13px;">
                {{ a.name }}
              </p>
              <p
                v-if="a.role"
                class="text-neutral-600 leading-tight mt-0.5"
                style="font-size: 12px;"
              >
                {{ a.role }}
              </p>
              <p
                v-if="a.time"
                class="text-neutral-500 leading-tight mt-0.5"
                style="font-size: 11px;"
              >
                {{ a.time }}
              </p>
              <p
                v-if="a.description"
                class="text-neutral-700 whitespace-pre-wrap mt-1"
                style="font-size: 12px; line-height: 1.5;"
              >
                {{ a.description }}
              </p>
            </li>
          </ul>
        </section>
      </aside>

      <!-- ============ MAIN PHẢI (~65%) ============ -->
      <main
        class="bg-white"
        style="padding: 32px 32px 32px 24px;"
      >
        <!-- Mục tiêu nghề nghiệp -->
        <section v-if="data.summary" class="mb-6">
          <h2
            class="inline-block bg-orange-500 text-white font-semibold rounded-md leading-none mb-3"
            style="font-size: 14px; padding: 8px 14px;"
          >
            Mục tiêu nghề nghiệp
          </h2>
          <p
            class="text-neutral-800 whitespace-pre-wrap"
            style="font-size: 13.5px; line-height: 1.6;"
          >
            {{ data.summary }}
          </p>
        </section>

        <!-- Học vấn -->
        <section v-if="data.educations.length" class="mb-6">
          <h2
            class="inline-block bg-orange-500 text-white font-semibold rounded-md leading-none mb-3"
            style="font-size: 14px; padding: 8px 14px;"
          >
            Học vấn
          </h2>
          <ul class="flex flex-col gap-4">
            <li v-for="(e, i) in data.educations" :key="i">
              <div class="flex items-baseline justify-between gap-3 flex-wrap">
                <p class="font-bold text-neutral-800 leading-tight" style="font-size: 14px;">
                  {{ e.school }}
                </p>
                <p
                  v-if="e.startYear || e.endYear"
                  class="text-neutral-600 leading-tight whitespace-nowrap"
                  style="font-size: 12px;"
                >
                  {{ dateRange(e.startYear, e.endYear) || 'Nay' }}
                </p>
              </div>
              <p
                v-if="e.degree || e.major"
                class="font-semibold text-neutral-700 leading-tight mt-1"
                style="font-size: 13px;"
              >
                <span v-if="e.degree">{{ e.degree }}</span>
                <span v-if="e.degree && e.major"> - </span>
                <span v-if="e.major">{{ e.major }}</span>
              </p>
              <p
                v-if="e.description"
                class="text-neutral-700 whitespace-pre-wrap mt-1.5"
                style="font-size: 12.5px; line-height: 1.5;"
              >
                {{ e.description }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Kinh nghiệm làm việc -->
        <section v-if="data.experiences.length" class="mb-6">
          <h2
            class="inline-block bg-orange-500 text-white font-semibold rounded-md leading-none mb-3"
            style="font-size: 14px; padding: 8px 14px;"
          >
            Kinh nghiệm làm việc
          </h2>
          <ul class="flex flex-col gap-4">
            <li v-for="(x, i) in data.experiences" :key="i">
              <div class="flex items-baseline justify-between gap-3 flex-wrap">
                <p class="font-bold text-neutral-800 leading-tight" style="font-size: 14px;">
                  {{ x.company }}
                </p>
                <p
                  v-if="x.startDate || x.endDate"
                  class="text-neutral-600 leading-tight whitespace-nowrap"
                  style="font-size: 12px;"
                >
                  {{ dateRange(x.startDate, x.endDate) || 'Nay' }}
                </p>
              </div>
              <p
                class="font-semibold text-neutral-700 leading-tight mt-1"
                style="font-size: 13px;"
              >
                {{ x.position }}
              </p>
              <p
                v-if="x.description"
                class="text-neutral-700 whitespace-pre-wrap mt-1.5"
                style="font-size: 12.5px; line-height: 1.5;"
              >
                {{ x.description }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Dự án -->
        <section v-if="data.projects.length">
          <h2
            class="inline-block bg-orange-500 text-white font-semibold rounded-md leading-none mb-3"
            style="font-size: 14px; padding: 8px 14px;"
          >
            Dự án
          </h2>
          <ul class="flex flex-col gap-4">
            <li v-for="(p, i) in data.projects" :key="i">
              <div class="flex items-baseline justify-between gap-3 flex-wrap">
                <p class="font-bold text-neutral-800 leading-tight" style="font-size: 14px;">
                  {{ p.name }}
                </p>
                <p
                  v-if="p.time"
                  class="text-neutral-600 leading-tight whitespace-nowrap"
                  style="font-size: 12px;"
                >
                  {{ p.time }}
                </p>
              </div>
              <p
                v-if="p.role"
                class="font-semibold text-neutral-700 leading-tight mt-1"
                style="font-size: 13px;"
              >
                {{ p.role }}
              </p>
              <p
                v-if="p.description"
                class="text-neutral-700 whitespace-pre-wrap mt-1.5"
                style="font-size: 12.5px; line-height: 1.5;"
              >
                {{ p.description }}
              </p>
              <p
                v-if="p.link"
                class="text-orange-600 break-all mt-1"
                style="font-size: 12px;"
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
