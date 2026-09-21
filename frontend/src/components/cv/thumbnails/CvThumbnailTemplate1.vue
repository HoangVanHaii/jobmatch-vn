<script setup lang="ts">
/**
 * CvThumbnailTemplate1 — bản thu nhỏ của CVTemplate1 (orange header + 2 cột).
 *
 * NGUYÊN TẮC QUAN TRỌNG: render ĐẦY ĐỦ 100% nội dung giống CVTemplate1.vue.
 *   - Cùng data (data: CvRenderData).
 *   - Cùng section: contact, skills, interests, certificates, activities,
 *     summary, educations, experiences, projects.
 *   - Cùng field cho mỗi item.
 *   - Cùng thứ tự section (sidebar trước, main sau).
 *   - Cùng cấu trúc DOM (header cam + 2 cột 35/65).
 *
 * KHÔNG BAO GIỜ:
 *   - truncate text bằng `...` hoặc slice.
 *   - line-clamp / max-height / overflow-hidden để ẩn content.
 *   - bỏ section / bỏ field / bỏ bullet.
 *   - thay text bằng placeholder khác.
 *
 * KHÁC BIỆT với CVTemplate1.vue:
 *   - Kích thước nhỏ hơn (font 3-5px, padding theo %) để fit container ~132×170.
 *   - Dùng % thay cho px để scale theo container (parent MyResumesView set
 *     width=132px + aspectRatio 850/1100 ≈ height 170px).
 *   - Bỏ avatar initial fallback lớn (sẽ vô hình ở size 4-5px).
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
  <div class="w-full h-full bg-white text-neutral-800 font-sans leading-tight overflow-hidden">
    <!-- ==================== HEADER CAM (full width) ==================== -->
    <div class="w-full bg-orange-500 relative" style="height: 22%;">
      <div class="h-full relative">
        <!-- Họ tên + chức danh (căn giữa theo chiều dọc, bên phải avatar) -->
        <div
          class="absolute top-1/2 -translate-y-1/2 text-white"
          style="left: 30%; right: 4%;"
        >
          <p
            class="font-bold uppercase tracking-wide leading-tight break-words"
            style="font-size: 5.5px;"
          >
            {{ data.personalInfo.fullName || 'HỌ VÀ TÊN' }}
          </p>
          <p
            class="font-normal mt-[1px] opacity-95 break-words"
            style="font-size: 4px;"
          >
            {{ data.personalInfo.position || 'Vị trí ứng tuyển' }}
          </p>
        </div>
      </div>
    </div>

    <!-- ==================== BODY 2 CỘT ==================== -->
    <div class="grid relative w-full" style="grid-template-columns: 35% 65%; height: 78%;">
      <!-- ============ AVATAR (nằm giữa header và body) ============ -->
      <div
        class="absolute z-10"
        style="left: 4%; top: -11%; width: 22%; aspect-ratio: 1 / 1;"
      >
        <div class="w-full h-full rounded-full bg-white p-[2%] shadow-md">
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
              style="font-size: 8px;"
            >
              {{ initial(data.personalInfo.fullName) }}
            </span>
          </div>
        </div>
      </div>

      <!-- ============ SIDEBAR TRÁI (~35%) ============ -->
      <aside
        class="bg-white"
        style="padding: 12% 4% 3% 4%;"
      >
        <!-- Thông tin cá nhân — căn giữa, chỉ hiển thị Email và Điện thoại
             (database chỉ lưu 2 field này, gender/dob/address bị bỏ). -->
        <div class="flex flex-col items-center gap-[2px] mb-[5%]">
          <div class="text-center">
            <p class="text-neutral-500 leading-none" style="font-size: 2.5px;">Email</p>
            <p class="font-semibold text-neutral-800 leading-tight mt-[1px] break-all" style="font-size: 3px;">
              {{ data.personalInfo.email || '—' }}
            </p>
          </div>
          <div class="text-center">
            <p class="text-neutral-500 leading-none" style="font-size: 2.5px;">Điện thoại</p>
            <p class="font-semibold text-neutral-800 leading-tight mt-[1px]" style="font-size: 3px;">
              {{ data.personalInfo.phone || '—' }}
            </p>
          </div>
        </div>

        <!-- Kỹ năng -->
        <section v-if="data.skills.length" class="mb-[4%]">
          <h2
            class="inline-block bg-orange-500 text-white font-semibold rounded-sm leading-none mb-[3%]"
            style="font-size: 3.5px; padding: 1.5px 3px;"
          >
            Kỹ năng
          </h2>
          <ul class="flex flex-col gap-[1px]">
            <li
              v-for="(s, i) in data.skills"
              :key="i"
              class="text-neutral-700 leading-snug"
              style="font-size: 3px;"
            >
              • {{ s.name }}
            </li>
          </ul>
        </section>

        <!-- Sở thích -->
        <section v-if="data.interests && data.interests.length" class="mb-[4%]">
          <h2
            class="inline-block bg-orange-500 text-white font-semibold rounded-sm leading-none mb-[3%]"
            style="font-size: 3.5px; padding: 1.5px 3px;"
          >
            Sở thích
          </h2>
          <ul class="flex flex-col gap-[1px]">
            <li
              v-for="(it, i) in data.interests"
              :key="i"
              class="text-neutral-700 leading-snug"
              style="font-size: 3px;"
            >
              • {{ it }}
            </li>
          </ul>
        </section>

        <!-- Chứng chỉ -->
        <section v-if="data.certificates.length" class="mb-[4%]">
          <h2
            class="inline-block bg-orange-500 text-white font-semibold rounded-sm leading-none mb-[3%]"
            style="font-size: 3.5px; padding: 1.5px 3px;"
          >
            Chứng chỉ
          </h2>
          <ul class="flex flex-col gap-[2px]">
            <li v-for="(c, i) in data.certificates" :key="i">
              <p class="font-semibold text-neutral-800 leading-tight" style="font-size: 3px;">
                {{ c.name }}
              </p>
              <p
                v-if="c.issuer"
                class="text-neutral-600 leading-tight mt-[1px]"
                style="font-size: 2.5px;"
              >
                {{ c.issuer }}
              </p>
              <p
                v-if="c.date"
                class="text-neutral-500 leading-tight mt-[1px]"
                style="font-size: 2.5px;"
              >
                {{ c.date }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Hoạt động -->
        <section v-if="data.activities.length">
          <h2
            class="inline-block bg-orange-500 text-white font-semibold rounded-sm leading-none mb-[3%]"
            style="font-size: 3.5px; padding: 1.5px 3px;"
          >
            Hoạt động
          </h2>
          <ul class="flex flex-col gap-[3px]">
            <li v-for="(a, i) in data.activities" :key="i">
              <p class="font-semibold text-neutral-800 leading-tight" style="font-size: 3px;">
                {{ a.name }}
              </p>
              <p
                v-if="a.role"
                class="text-neutral-600 leading-tight mt-[1px]"
                style="font-size: 2.5px;"
              >
                {{ a.role }}
              </p>
              <p
                v-if="a.time"
                class="text-neutral-500 leading-tight mt-[1px]"
                style="font-size: 2.5px;"
              >
                {{ a.time }}
              </p>
              <p
                v-if="a.description"
                class="text-neutral-700 whitespace-pre-wrap mt-[1px]"
                style="font-size: 2.5px; line-height: 1.4;"
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
        style="padding: 3% 4% 3% 3%;"
      >
        <!-- Mục tiêu nghề nghiệp -->
        <section v-if="data.summary" class="mb-[5%]">
          <h2
            class="inline-block bg-orange-500 text-white font-semibold rounded-sm leading-none mb-[3%]"
            style="font-size: 3.5px; padding: 1.5px 3px;"
          >
            Mục tiêu nghề nghiệp
          </h2>
          <p
            class="text-neutral-800 whitespace-pre-wrap"
            style="font-size: 3px; line-height: 1.5;"
          >
            {{ data.summary }}
          </p>
        </section>

        <!-- Học vấn -->
        <section v-if="data.educations.length" class="mb-[5%]">
          <h2
            class="inline-block bg-orange-500 text-white font-semibold rounded-sm leading-none mb-[3%]"
            style="font-size: 3.5px; padding: 1.5px 3px;"
          >
            Học vấn
          </h2>
          <ul class="flex flex-col gap-[3px]">
            <li v-for="(e, i) in data.educations" :key="i">
              <div class="flex items-baseline justify-between gap-[3px] flex-wrap">
                <p class="font-bold text-neutral-800 leading-tight" style="font-size: 3.2px;">
                  {{ e.school }}
                </p>
                <p
                  v-if="e.startYear || e.endYear"
                  class="text-neutral-600 leading-tight whitespace-nowrap"
                  style="font-size: 2.5px;"
                >
                  {{ dateRange(e.startYear, e.endYear) || 'Nay' }}
                </p>
              </div>
              <p
                v-if="e.degree || e.major"
                class="font-semibold text-neutral-700 leading-tight mt-[1px]"
                style="font-size: 3px;"
              >
                <span v-if="e.degree">{{ e.degree }}</span>
                <span v-if="e.degree && e.major"> - </span>
                <span v-if="e.major">{{ e.major }}</span>
              </p>
              <p
                v-if="e.description"
                class="text-neutral-700 whitespace-pre-wrap mt-[1px]"
                style="font-size: 2.5px; line-height: 1.4;"
              >
                {{ e.description }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Kinh nghiệm làm việc -->
        <section v-if="data.experiences.length" class="mb-[5%]">
          <h2
            class="inline-block bg-orange-500 text-white font-semibold rounded-sm leading-none mb-[3%]"
            style="font-size: 3.5px; padding: 1.5px 3px;"
          >
            Kinh nghiệm làm việc
          </h2>
          <ul class="flex flex-col gap-[3px]">
            <li v-for="(x, i) in data.experiences" :key="i">
              <div class="flex items-baseline justify-between gap-[3px] flex-wrap">
                <p class="font-bold text-neutral-800 leading-tight" style="font-size: 3.2px;">
                  {{ x.company }}
                </p>
                <p
                  v-if="x.startDate || x.endDate"
                  class="text-neutral-600 leading-tight whitespace-nowrap"
                  style="font-size: 2.5px;"
                >
                  {{ dateRange(x.startDate, x.endDate) || 'Nay' }}
                </p>
              </div>
              <p
                class="font-semibold text-neutral-700 leading-tight mt-[1px]"
                style="font-size: 3px;"
              >
                {{ x.position }}
              </p>
              <p
                v-if="x.description"
                class="text-neutral-700 whitespace-pre-wrap mt-[1px]"
                style="font-size: 2.5px; line-height: 1.4;"
              >
                {{ x.description }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Dự án -->
        <section v-if="data.projects.length">
          <h2
            class="inline-block bg-orange-500 text-white font-semibold rounded-sm leading-none mb-[3%]"
            style="font-size: 3.5px; padding: 1.5px 3px;"
          >
            Dự án
          </h2>
          <ul class="flex flex-col gap-[3px]">
            <li v-for="(p, i) in data.projects" :key="i">
              <div class="flex items-baseline justify-between gap-[3px] flex-wrap">
                <p class="font-bold text-neutral-800 leading-tight" style="font-size: 3.2px;">
                  {{ p.name }}
                </p>
                <p
                  v-if="p.time"
                  class="text-neutral-600 leading-tight whitespace-nowrap"
                  style="font-size: 2.5px;"
                >
                  {{ p.time }}
                </p>
              </div>
              <p
                v-if="p.role"
                class="font-semibold text-neutral-700 leading-tight mt-[1px]"
                style="font-size: 3px;"
              >
                {{ p.role }}
              </p>
              <p
                v-if="p.description"
                class="text-neutral-700 whitespace-pre-wrap mt-[1px]"
                style="font-size: 2.5px; line-height: 1.4;"
              >
                {{ p.description }}
              </p>
              <p
                v-if="p.link"
                class="text-orange-600 break-all mt-[1px]"
                style="font-size: 2.5px;"
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
