<script setup lang="ts">
/**
 * Template 4 — PROFESSIONAL RESUME (navy top bar + light blue header + 2-col body).
 *
 * Layout:
 *   - Thanh navy mỏng ở mép trên (#164D70) chạy full-width, ~8px, không bo góc.
 *   - Header nền xanh rất nhạt (#EEF6FB):
 *     + LEFT: họ tên (uppercase, navy bold) → job title (uppercase, navy) →
 *       line navy ngắn → contact 2 cột (phone | email).
 *     + RIGHT: avatar tròn lớn với border navy mảnh.
 *   - Body 2 cột (47% / 53%):
 *     + LEFT (47%): Mục tiêu, Kỹ năng, Chứng chỉ, Sở thích.
 *     + RIGHT (53%): Trình độ học vấn, Kinh nghiệm, Hoạt động, Dự án.
 *   - Section heading: chữ IN HOA navy bold + đường ngang navy kéo dài tới
 *     mép phải cột. KHÔNG pill, KHÔNG box, KHÔNG icon, KHÔNG rounded.
 *
 * Quy tắc render:
 *   - Field nào không có data → ẩn hẳn section.
 *   - Bullet / item list render ĐẦY ĐỦ 100% — KHÔNG truncate, KHÔNG line-clamp.
 *   - Data lấy từ `data: CvRenderData`, không hard-code nội dung ảnh.
 *
 * Phần "Thông tin liên hệ" chỉ render phone + email (DB không lưu
 * gender/dob/address — theo quyết định từ Template 1).
 */
import {
  Phone, Mail, GraduationCap, Briefcase, Star, FolderGit2,
} from 'lucide-vue-next';
import type { CvRenderData } from '@/types/cv';

defineProps<{ data: CvRenderData }>();

/** Chữ cái đầu của tên làm avatar fallback. */
const initial = (name: string | undefined | null): string => {
  const trimmed = (name ?? '').trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
};
</script>

<template>
  <div
    class="w-full bg-white text-neutral-900 font-sans"
    style="min-height: 1100px;"
  >
    <!-- ==================== THANH NAVY MỎNG TRÊN CÙNG ==================== -->
    <div class="w-full" style="height: 8px; background: #164D70;" />

    <!-- ==================== HEADER (light blue bg) ==================== -->
    <header
      class="w-full grid grid-cols-[1fr_180px] items-center gap-8 px-12 py-8"
      style="background: #EEF6FB;"
    >
      <!-- LEFT: name + job title + line + contact -->
      <div class="min-w-0">
        <h1
          class="font-bold uppercase leading-tight break-words"
          style="font-size: 32px; color: #164D70; letter-spacing: 0.5px;"
        >
          {{ data.personalInfo.fullName || 'HỌ VÀ TÊN' }}
        </h1>
        <p
          class="font-bold uppercase mt-2 break-words"
          style="font-size: 15px; color: #164D70; letter-spacing: 1px;"
        >
          {{ data.personalInfo.position || 'Vị trí ứng tuyển' }}
        </p>

        <!-- Đường ngang navy ngắn dưới job title -->
        <div
          class="mt-3 mb-4"
          style="height: 2px; width: 180px; background: #164D70;"
        />

        <!-- Contact 2 cột: phone | email -->
        <div
          v-if="data.personalInfo.phone || data.personalInfo.email"
          class="grid grid-cols-2 gap-x-6 gap-y-2"
          style="font-size: 12.5px;"
        >
          <div
            v-if="data.personalInfo.phone"
            class="flex items-center gap-2 text-neutral-700"
          >
            <Phone class="w-3.5 h-3.5 shrink-0" style="color: #164D70;" />
            <span class="break-all">{{ data.personalInfo.phone }}</span>
          </div>
          <div
            v-if="data.personalInfo.email"
            class="flex items-center gap-2 text-neutral-700"
          >
            <Mail class="w-3.5 h-3.5 shrink-0" style="color: #164D70;" />
            <span class="break-all">{{ data.personalInfo.email }}</span>
          </div>
        </div>
      </div>

      <!-- RIGHT: avatar tròn border navy -->
      <div class="flex justify-end">
        <div
          class="rounded-full bg-white shrink-0 overflow-hidden flex items-center justify-center"
          style="
            width: 160px;
            height: 160px;
            border: 2px solid #164D70;
          "
        >
          <img
            v-if="data.personalInfo.avatarUrl"
            :src="data.personalInfo.avatarUrl"
            :alt="data.personalInfo.fullName"
            class="w-full h-full object-cover"
          />
          <span
            v-else
            class="font-semibold leading-none"
            style="font-size: 56px; color: #164D70;"
          >
            {{ initial(data.personalInfo.fullName) }}
          </span>
        </div>
      </div>
    </header>

    <!-- ==================== BODY 2 CỘT (47% / 53%) ==================== -->
    <div
      class="w-full grid"
      style="grid-template-columns: 47% 53%; column-gap: 0;"
    >
      <!-- ============ LEFT COLUMN (47%) ============ -->
      <aside
        class="flex flex-col gap-5"
        style="padding: 24px 24px 32px 40px; background: #FFFFFF;"
      >
        <!-- Mục tiêu nghề nghiệp -->
        <section v-if="data.summary">
          <h2 class="flex items-center gap-2 mb-2 leading-none">
            <span
              class="font-bold uppercase whitespace-nowrap"
              style="font-size: 15px; color: #164D70; letter-spacing: 1px;"
            >
              Mục tiêu nghề nghiệp
            </span>
            <span class="flex-1 h-[1.5px]" style="background: #164D70;" />
          </h2>
          <p
            class="text-neutral-800 whitespace-pre-wrap"
            style="font-size: 12.5px; line-height: 1.5;"
          >
            {{ data.summary }}
          </p>
        </section>

        <!-- Kỹ năng -->
        <section v-if="data.skills.length">
          <h2 class="flex items-center gap-2 mb-2 leading-none">
            <span
              class="font-bold uppercase whitespace-nowrap"
              style="font-size: 15px; color: #164D70; letter-spacing: 1px;"
            >
              Kỹ năng
            </span>
            <span class="flex-1 h-[1.5px]" style="background: #164D70;" />
          </h2>
          <ul class="flex flex-col gap-1.5" style="font-size: 12.5px;">
            <li
              v-for="(s, i) in data.skills"
              :key="i"
              class="flex items-start gap-2 text-neutral-700"
            >
              <span
                class="mt-[7px] w-1.5 h-1.5 rounded-full shrink-0"
                style="background: #164D70;"
              />
              <span class="break-words">{{ s.name }}</span>
            </li>
          </ul>
        </section>

        <!-- Chứng chỉ -->
        <section v-if="data.certificates.length">
          <h2 class="flex items-center gap-2 mb-2 leading-none">
            <span
              class="font-bold uppercase whitespace-nowrap"
              style="font-size: 15px; color: #164D70; letter-spacing: 1px;"
            >
              Chứng chỉ
            </span>
            <span class="flex-1 h-[1.5px]" style="background: #164D70;" />
          </h2>
          <ul class="flex flex-col gap-2" style="font-size: 12.5px;">
            <li
              v-for="(c, i) in data.certificates"
              :key="i"
              class="text-neutral-700"
            >
              <strong class="text-neutral-900">{{ c.name }}</strong>
              <span v-if="c.issuer"> — {{ c.issuer }}</span>
              <span
                v-if="c.date"
                class="text-neutral-500 italic ml-1"
                style="font-size: 11.5px;"
              >{{ c.date }}</span>
            </li>
          </ul>
        </section>

        <!-- Sở thích -->
        <section v-if="data.interests && data.interests.length">
          <h2 class="flex items-center gap-2 mb-2 leading-none">
            <span
              class="font-bold uppercase whitespace-nowrap"
              style="font-size: 15px; color: #164D70; letter-spacing: 1px;"
            >
              Sở thích
            </span>
            <span class="flex-1 h-[1.5px]" style="background: #164D70;" />
          </h2>
          <ul class="flex flex-col gap-1.5" style="font-size: 12.5px;">
            <li
              v-for="(it, i) in data.interests"
              :key="i"
              class="flex items-start gap-2 text-neutral-700"
            >
              <span
                class="mt-[7px] w-1.5 h-1.5 rounded-full shrink-0"
                style="background: #164D70;"
              />
              <span class="break-words">{{ it }}</span>
            </li>
          </ul>
        </section>
      </aside>

      <!-- ============ RIGHT COLUMN (53%) ============ -->
      <main
        class="flex flex-col gap-5"
        style="padding: 24px 40px 32px 24px; background: #FFFFFF; border-left: 1px solid #E5E7EB;"
      >
        <!-- Trình độ học vấn -->
        <section v-if="data.educations.length">
          <h2 class="flex items-center gap-2 mb-2 leading-none">
            <GraduationCap class="w-4 h-4 shrink-0" style="color: #164D70;" />
            <span
              class="font-bold uppercase whitespace-nowrap"
              style="font-size: 15px; color: #164D70; letter-spacing: 1px;"
            >
              Trình độ học vấn
            </span>
            <span class="flex-1 h-[1.5px]" style="background: #164D70;" />
          </h2>
          <ul class="flex flex-col gap-3" style="font-size: 12.5px;">
            <li v-for="(e, i) in data.educations" :key="i">
              <div class="flex items-baseline justify-between gap-2 flex-wrap">
                <strong class="text-neutral-900 break-words">{{ e.school }}</strong>
                <span
                  v-if="e.startYear || e.endYear"
                  class="text-neutral-500 italic whitespace-nowrap"
                  style="font-size: 11.5px;"
                >
                  {{ e.startYear || '' }}<span v-if="e.startYear || e.endYear"> — </span>{{ e.endYear || 'Nay' }}
                </span>
              </div>
              <p
                v-if="e.major || e.degree"
                class="text-neutral-700 leading-tight mt-1 break-words"
              >
                <span v-if="e.major">Chuyên ngành: {{ e.major }}</span>
                <span v-if="e.major && e.degree"> — </span>
                <span v-if="e.degree">{{ e.degree }}</span>
              </p>
              <p
                v-if="e.description"
                class="text-neutral-700 whitespace-pre-wrap mt-1.5"
                style="font-size: 12px; line-height: 1.45;"
              >
                {{ e.description }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Kinh nghiệm làm việc -->
        <section v-if="data.experiences.length">
          <h2 class="flex items-center gap-2 mb-2 leading-none">
            <Briefcase class="w-4 h-4 shrink-0" style="color: #164D70;" />
            <span
              class="font-bold uppercase whitespace-nowrap"
              style="font-size: 15px; color: #164D70; letter-spacing: 1px;"
            >
              Kinh nghiệm làm việc
            </span>
            <span class="flex-1 h-[1.5px]" style="background: #164D70;" />
          </h2>
          <ul class="flex flex-col gap-3" style="font-size: 12.5px;">
            <li v-for="(x, i) in data.experiences" :key="i">
              <div class="flex items-baseline justify-between gap-2 flex-wrap">
                <strong class="text-neutral-900 break-words">{{ x.company }}</strong>
                <span
                  v-if="x.startDate || x.endDate"
                  class="text-neutral-500 italic whitespace-nowrap"
                  style="font-size: 11.5px;"
                >
                  {{ x.startDate || '' }}<span v-if="x.startDate || x.endDate"> — </span>{{ x.endDate || 'Nay' }}
                </span>
              </div>
              <p
                class="text-neutral-700 font-medium leading-tight mt-1 break-words"
              >
                {{ x.position }}
              </p>
              <p
                v-if="x.description"
                class="text-neutral-700 whitespace-pre-wrap mt-1.5"
                style="font-size: 12px; line-height: 1.45;"
              >
                {{ x.description }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Hoạt động -->
        <section v-if="data.activities.length">
          <h2 class="flex items-center gap-2 mb-2 leading-none">
            <Star class="w-4 h-4 shrink-0" style="color: #164D70;" />
            <span
              class="font-bold uppercase whitespace-nowrap"
              style="font-size: 15px; color: #164D70; letter-spacing: 1px;"
            >
              Hoạt động
            </span>
            <span class="flex-1 h-[1.5px]" style="background: #164D70;" />
          </h2>
          <ul class="flex flex-col gap-3" style="font-size: 12.5px;">
            <li v-for="(a, i) in data.activities" :key="i">
              <div class="flex items-baseline justify-between gap-2 flex-wrap">
                <strong class="text-neutral-900 break-words">{{ a.name }}</strong>
                <span
                  v-if="a.time"
                  class="text-neutral-500 italic whitespace-nowrap"
                  style="font-size: 11.5px;"
                >
                  {{ a.time }}
                </span>
              </div>
              <p
                v-if="a.role"
                class="text-neutral-700 leading-tight mt-1 break-words"
              >
                Vai trò: {{ a.role }}
              </p>
              <p
                v-if="a.description"
                class="text-neutral-700 whitespace-pre-wrap mt-1.5"
                style="font-size: 12px; line-height: 1.45;"
              >
                {{ a.description }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Dự án tham gia -->
        <section v-if="data.projects.length">
          <h2 class="flex items-center gap-2 mb-2 leading-none">
            <FolderGit2 class="w-4 h-4 shrink-0" style="color: #164D70;" />
            <span
              class="font-bold uppercase whitespace-nowrap"
              style="font-size: 15px; color: #164D70; letter-spacing: 1px;"
            >
              Dự án tham gia
            </span>
            <span class="flex-1 h-[1.5px]" style="background: #164D70;" />
          </h2>
          <ul class="flex flex-col gap-3" style="font-size: 12.5px;">
            <li v-for="(p, i) in data.projects" :key="i">
              <div class="flex items-baseline justify-between gap-2 flex-wrap">
                <strong class="text-neutral-900 break-words">{{ p.name }}</strong>
                <span
                  v-if="p.time"
                  class="text-neutral-500 italic whitespace-nowrap"
                  style="font-size: 11.5px;"
                >
                  {{ p.time }}
                </span>
              </div>
              <p
                v-if="p.role"
                class="text-neutral-700 leading-tight mt-1 break-words"
              >
                {{ p.role }}
              </p>
              <p
                v-if="p.description"
                class="text-neutral-700 whitespace-pre-wrap mt-1.5"
                style="font-size: 12px; line-height: 1.45;"
              >
                {{ p.description }}
              </p>
              <p
                v-if="p.link"
                class="break-all mt-1"
                style="font-size: 11.5px; color: #164D70;"
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
