<script setup lang="ts">
/**
 * Template 2 — teal/cyan accent với geometric decorations ở các góc.
 *
 * Layout:
 *   - Background trắng (CV là document A4, không phải card UI).
 *   - 2 mảng trang trí hình học màu teal ở góc trên-trái + dưới-phải (clip-path).
 *   - Header (KHÔNG full-width bg): avatar tròn (border 2px đen) + name/position
 *     + contact list (icon tròn teal + text).
 *   - Body 2 cột: left ~34% + right ~66%, gap 28px, không divider.
 *   - Section heading: teal #5FA3BA, uppercase, bold — KHÔNG background pill,
 *     KHÔNG border, KHÔNG card. Khác hoàn toàn Template 1.
 *
 * Quy tắc render:
 *   - Field nào không có data → ẩn hẳn section (không hiển thị heading rỗng).
 *   - Bullet / item list render ĐẦY ĐỦ 100% — KHÔNG truncate, KHÔNG line-clamp.
 *   - Data lấy từ `data: CvRenderData`, không hard-code nội dung ảnh tham chiếu.
 *
 * Phần "Thông tin cá nhân" chỉ render Email + Điện thoại (database không lưu
 * gender/dob/address — theo quyết định từ Template 1).
 */
import { Phone, Mail } from 'lucide-vue-next';
import type { CvRenderData } from '@/types/cv';

defineProps<{ data: CvRenderData }>();

/** Chữ cái đầu của tên làm avatar fallback. */
const initial = (name: string | undefined | null): string => {
  const trimmed = (name ?? '').trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
};

/** Khoảng thời gian "start — end", fallback 'Nay' nếu thiếu end. */
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
  <div class="w-full bg-white text-neutral-900 font-sans relative overflow-hidden">
    <!-- ==================== TOP-LEFT TEAL DECORATION ====================
         Thin geometric L-shape: 2 thanh vuông góc (horizontal + vertical) tạo
         thành chữ L sát mép trên-trái. Mỏng (10px), vuông, không bo góc. -->
    <div
      class="absolute top-0 left-0 z-0"
      style="width: 180px; height: 10px; background: #5FA3BA;"
    />
    <div
      class="absolute top-0 left-0 z-0"
      style="width: 10px; height: 100px; background: #5FA3BA;"
    />

    <!-- ==================== BOTTOM-RIGHT TEAL DECORATION ====================
         Thin geometric reverse L-shape: thanh dọc phải + thanh ngang dưới,
         mirror của top-left. -->
    <div
      class="absolute bottom-0 right-0 z-0"
      style="width: 10px; height: 110px; background: #5FA3BA;"
    />
    <div
      class="absolute bottom-0 right-0 z-0"
      style="width: 190px; height: 10px; background: #5FA3BA;"
    />

    <!-- ==================== HEADER (white, no bg) ==================== -->
    <div class="relative z-[1] flex items-start gap-8 px-12 pt-12 pb-8">
      <!-- Avatar tròn, có border 2px đen (theo ảnh tham chiếu) -->
      <div class="w-[200px] h-[200px] rounded-full bg-white border-2 border-neutral-900 p-[3px] shrink-0">
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
            style="font-size: 64px;"
          >
            {{ initial(data.personalInfo.fullName) }}
          </span>
        </div>
      </div>

      <!-- Họ tên + chức danh + contact -->
      <div class="flex-1 min-w-0 pt-4">
        <h1
          class="font-bold uppercase tracking-wide leading-tight break-words"
          style="font-size: 32px;"
        >
          {{ data.personalInfo.fullName || 'HỌ VÀ TÊN' }}
        </h1>
        <p
          class="font-medium uppercase mt-2 break-words"
          style="font-size: 14px;"
        >
          {{ data.personalInfo.position || 'Vị trí ứng tuyển' }}
        </p>

        <!-- Contact list — chỉ Email + Điện thoại (database không có gender/dob/address) -->
        <ul class="mt-5 flex flex-col gap-2.5">
          <li v-if="data.personalInfo.email" class="flex items-center gap-3">
            <span class="w-6 h-6 rounded-full bg-[#5FA3BA] flex items-center justify-center shrink-0">
              <Mail class="w-3.5 h-3.5 text-white" />
            </span>
            <span class="break-all" style="font-size: 13px;">{{ data.personalInfo.email }}</span>
          </li>
          <li v-if="data.personalInfo.phone" class="flex items-center gap-3">
            <span class="w-6 h-6 rounded-full bg-[#5FA3BA] flex items-center justify-center shrink-0">
              <Phone class="w-3.5 h-3.5 text-white" />
            </span>
            <span style="font-size: 13px;">{{ data.personalInfo.phone }}</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- ==================== BODY 2 CỘT (left 34% / right 66%) ==================== -->
    <div
      class="relative z-[1] grid px-12 pb-12"
      style="grid-template-columns: 34% 66%; column-gap: 28px;"
    >
      <!-- ============ LEFT COLUMN (~34%) ============ -->
      <aside class="flex flex-col gap-6">
        <!-- Kỹ năng -->
        <section v-if="data.skills.length">
          <h2
            class="font-bold uppercase mb-3"
            style="color: #5FA3BA; font-size: 19px;"
          >
            Kỹ năng
          </h2>
          <ul class="flex flex-col gap-1.5" style="font-size: 13px;">
            <li v-for="(s, i) in data.skills" :key="i">- {{ s.name }}</li>
          </ul>
        </section>

        <!-- Chứng chỉ -->
        <section v-if="data.certificates.length">
          <h2
            class="font-bold uppercase mb-3"
            style="color: #5FA3BA; font-size: 19px;"
          >
            Chứng chỉ
          </h2>
          <ul class="flex flex-col gap-3" style="font-size: 13px;">
            <li v-for="(c, i) in data.certificates" :key="i">
              <p class="font-semibold text-neutral-900 leading-tight">{{ c.name }}</p>
              <p
                v-if="c.issuer"
                class="text-neutral-700 leading-tight mt-0.5"
                style="font-size: 12.5px;"
              >
                {{ c.issuer }}
              </p>
              <p
                v-if="c.date"
                class="text-neutral-600 leading-tight mt-0.5"
                style="font-size: 12px;"
              >
                {{ c.date }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Sở thích -->
        <section v-if="data.interests && data.interests.length">
          <h2
            class="font-bold uppercase mb-3"
            style="color: #5FA3BA; font-size: 19px;"
          >
            Sở thích
          </h2>
          <ul class="flex flex-col gap-1.5" style="font-size: 13px;">
            <li v-for="(it, i) in data.interests" :key="i">- {{ it }}</li>
          </ul>
        </section>
      </aside>

      <!-- ============ RIGHT COLUMN (~66%) ============ -->
      <main class="flex flex-col gap-6">
        <!-- Mục tiêu nghề nghiệp -->
        <section v-if="data.summary">
          <h2
            class="font-bold uppercase mb-3"
            style="color: #5FA3BA; font-size: 19px;"
          >
            Mục tiêu nghề nghiệp
          </h2>
          <p
            class="text-neutral-800 whitespace-pre-wrap"
            style="font-size: 13.5px; line-height: 1.55;"
          >
            {{ data.summary }}
          </p>
        </section>

        <!-- Trình độ học vấn -->
        <section v-if="data.educations.length">
          <h2
            class="font-bold uppercase mb-3"
            style="color: #5FA3BA; font-size: 19px;"
          >
            Trình độ học vấn
          </h2>
          <ul class="flex flex-col gap-4" style="font-size: 13px;">
            <li v-for="(e, i) in data.educations" :key="i">
              <p class="font-semibold text-neutral-900 leading-tight">{{ e.school }}</p>
              <p
                v-if="e.startYear || e.endYear"
                class="text-neutral-600 leading-tight mt-0.5"
                style="font-size: 12px;"
              >
                {{ dateRange(e.startYear, e.endYear) }}
              </p>
              <p
                v-if="e.degree || e.major"
                class="text-neutral-800 leading-tight mt-1"
              >
                <span v-if="e.degree">{{ e.degree }}</span>
                <span v-if="e.degree && e.major"> - </span>
                <span v-if="e.major">{{ e.major }}</span>
              </p>
              <p
                v-if="e.description"
                class="text-neutral-700 whitespace-pre-wrap mt-1"
                style="font-size: 12.5px; line-height: 1.5;"
              >
                {{ e.description }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Kinh nghiệm làm việc -->
        <section v-if="data.experiences.length">
          <h2
            class="font-bold uppercase mb-3"
            style="color: #5FA3BA; font-size: 19px;"
          >
            Kinh nghiệm làm việc
          </h2>
          <ul class="flex flex-col gap-4" style="font-size: 13px;">
            <li v-for="(x, i) in data.experiences" :key="i">
              <p class="font-semibold text-neutral-900 leading-tight">{{ x.company }}</p>
              <p
                v-if="x.startDate || x.endDate"
                class="text-neutral-600 leading-tight mt-0.5"
                style="font-size: 12px;"
              >
                {{ dateRange(x.startDate, x.endDate) }}
              </p>
              <p class="font-medium text-neutral-800 leading-tight mt-1">{{ x.position }}</p>
              <p
                v-if="x.description"
                class="text-neutral-700 whitespace-pre-wrap mt-1"
                style="font-size: 12.5px; line-height: 1.5;"
              >
                {{ x.description }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Hoạt động -->
        <section v-if="data.activities.length">
          <h2
            class="font-bold uppercase mb-3"
            style="color: #5FA3BA; font-size: 19px;"
          >
            Hoạt động
          </h2>
          <ul class="flex flex-col gap-4" style="font-size: 13px;">
            <li v-for="(a, i) in data.activities" :key="i">
              <p class="font-semibold text-neutral-900 leading-tight">{{ a.name }}</p>
              <p
                v-if="a.time"
                class="text-neutral-600 leading-tight mt-0.5"
                style="font-size: 12px;"
              >
                {{ a.time }}
              </p>
              <p
                v-if="a.role"
                class="text-neutral-800 leading-tight mt-1"
              >
                {{ a.role }}
              </p>
              <p
                v-if="a.description"
                class="text-neutral-700 whitespace-pre-wrap mt-1"
                style="font-size: 12.5px; line-height: 1.5;"
              >
                {{ a.description }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Dự án tham gia -->
        <section v-if="data.projects.length">
          <h2
            class="font-bold uppercase mb-3"
            style="color: #5FA3BA; font-size: 19px;"
          >
            Dự án tham gia
          </h2>
          <ul class="flex flex-col gap-4" style="font-size: 13px;">
            <li v-for="(p, i) in data.projects" :key="i">
              <p class="font-semibold text-neutral-900 leading-tight">{{ p.name }}</p>
              <p
                v-if="p.time"
                class="text-neutral-600 leading-tight mt-0.5"
                style="font-size: 12px;"
              >
                {{ p.time }}
              </p>
              <p
                v-if="p.role"
                class="font-medium text-neutral-800 leading-tight mt-1"
              >
                {{ p.role }}
              </p>
              <p
                v-if="p.description"
                class="text-neutral-700 whitespace-pre-wrap mt-1"
                style="font-size: 12.5px; line-height: 1.5;"
              >
                {{ p.description }}
              </p>
              <p
                v-if="p.link"
                class="break-all mt-1"
                style="font-size: 12px; color: #5FA3BA;"
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
