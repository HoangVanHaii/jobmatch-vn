<script setup lang="ts">
/**
 * Template 5 — PROFESSIONAL RESUME với sidebar trái + main phải.
 *
 * Layout:
 *   - 2 cột:
 *     + LEFT sidebar (~33%): nền #EEF6FB, chạy full-height.
 *       - Decoration góc trên-trái + góc dưới-trái (geometric navy).
 *       - Avatar tròn lớn border navy, căn giữa.
 *       - Họ tên (uppercase navy bold) + Job title (label xanh chữ trắng).
 *       - Contact list: icon circle xanh + label/value (DB không lưu dob/address).
 *     + RIGHT main (~67%): nền trắng, các section xếp dọc.
 *       - Section heading: icon xanh + title navy uppercase + line ngang navy.
 *
 * Sections (main, đúng thứ tự ảnh tham chiếu):
 *   1. Mục tiêu nghề nghiệp
 *   2. Trình độ học vấn
 *   3. Kinh nghiệm thực tập
 *   4. Dự án học tập
 *   5. Kỹ năng chuyên môn
 *   6. Chứng chỉ
 *   + Hoạt động / Sở thích nếu data có.
 *
 * Quy tắc render:
 *   - Field nào không có data → ẩn hẳn section.
 *   - Bullet / item list render ĐẦY ĐỦ 100% — KHÔNG truncate, KHÔNG line-clamp.
 *   - Data lấy từ `data: CvRenderData`, không hard-code nội dung ảnh.
 *   - Phù hợp đa ngành — không phụ thuộc industry nào.
 */
import {
  Phone, Mail, User, MapPin, Calendar, Target, GraduationCap,
  Briefcase, FolderGit2, Settings, Award, Star, Heart,
} from 'lucide-vue-next';
import type { CvRenderData } from '@/types/cv';

defineProps<{ data: CvRenderData }>();

/** Chữ cái đầu của tên làm avatar fallback. */
const initial = (name: string | undefined | null): string => {
  const trimmed = (name ?? '').trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
};

/** Tách description thành bullet list (newline-separated, filter rỗng). */
const descriptionBullets = (desc: string | undefined): string[] => {
  if (!desc) return [];
  return desc.split('\n').map((l) => l.trim()).filter(Boolean);
};
</script>

<template>
  <div
    class="w-full bg-white text-neutral-900 font-sans grid grid-cols-[33%_67%]"
    style="min-height: 1100px;"
  >
    <!-- ==================== SIDEBAR TRÁI (~33%) ==================== -->
    <aside
      class="relative flex flex-col items-center gap-5 px-7 py-9 overflow-hidden"
      style="background: #EEF6FB;"
    >
      <!-- ============ DECORATION góc trên-trái ============ -->
      <div
        class="absolute top-0 left-0 z-0"
        style="
          width: 0;
          height: 0;
          border-top: 90px solid #064C8A;
          border-right: 90px solid transparent;
        "
      />
      <div
        class="absolute z-0"
        style="
          top: 0;
          left: 60px;
          width: 0;
          height: 0;
          border-top: 60px solid #0057A8;
          border-right: 60px solid transparent;
        "
      />

      <!-- ============ DECORATION góc dưới-trái ============ -->
      <div
        class="absolute bottom-0 left-0 z-0"
        style="
          width: 0;
          height: 0;
          border-bottom: 130px solid #064C8A;
          border-right: 130px solid transparent;
        "
      />
      <div
        class="absolute z-0"
        style="
          bottom: 0;
          left: 90px;
          width: 0;
          height: 0;
          border-bottom: 90px solid #0057A8;
          border-right: 90px solid transparent;
        "
      />

      <!-- ============ AVATAR tròn lớn ============ -->
      <div
        class="relative z-[1] rounded-full bg-white shrink-0 overflow-hidden flex items-center justify-center"
        style="
          width: 170px;
          height: 170px;
          border: 3px solid #064C8A;
          margin-top: 30px;
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
          style="font-size: 56px; color: #064C8A;"
        >
          {{ initial(data.personalInfo.fullName) }}
        </span>
      </div>

      <!-- ============ HỌ TÊN ============ -->
      <h1
        class="relative z-[1] text-center font-bold uppercase leading-tight break-words"
        style="font-size: 24px; color: #064C8A; letter-spacing: 1px;"
      >
        {{ data.personalInfo.fullName || 'HỌ VÀ TÊN' }}
      </h1>

      <!-- ============ JOB TITLE — label xanh chữ trắng ============ -->
      <div
        v-if="data.personalInfo.position"
        class="relative z-[1] inline-block"
      >
        <div
          class="font-bold uppercase text-center text-white"
          style="
            background: #0057A8;
            padding: 8px 22px;
            font-size: 14px;
            letter-spacing: 0.5px;
          "
        >
          {{ data.personalInfo.position }}
        </div>
      </div>

      <!-- ============ CONTACT LIST ============ -->
      <div class="relative z-[1] w-full flex flex-col gap-3 mt-3">
        <!-- Họ và tên -->
        <div
          v-if="data.personalInfo.fullName"
          class="flex items-start gap-3"
        >
          <span
            class="rounded-full shrink-0 flex items-center justify-center"
            style="
              width: 28px;
              height: 28px;
              background: #0057A8;
            "
          >
            <User class="w-3.5 h-3.5 text-white" />
          </span>
          <div class="flex-1 min-w-0 leading-tight">
            <p class="text-neutral-500" style="font-size: 11px;">Họ và tên</p>
            <p
              class="font-semibold text-neutral-900 mt-0.5 break-words"
              style="font-size: 12.5px;"
            >
              {{ data.personalInfo.fullName }}
            </p>
          </div>
        </div>

        <!-- Ngày sinh (DB không lưu — v-if luôn false nếu rỗng) -->
        <div
          v-if="data.personalInfo.dob"
          class="flex items-start gap-3"
        >
          <span
            class="rounded-full shrink-0 flex items-center justify-center"
            style="
              width: 28px;
              height: 28px;
              background: #0057A8;
            "
          >
            <Calendar class="w-3.5 h-3.5 text-white" />
          </span>
          <div class="flex-1 min-w-0 leading-tight">
            <p class="text-neutral-500" style="font-size: 11px;">Ngày sinh</p>
            <p
              class="font-semibold text-neutral-900 mt-0.5 break-words"
              style="font-size: 12.5px;"
            >
              {{ data.personalInfo.dob }}
            </p>
          </div>
        </div>

        <!-- Điện thoại -->
        <div
          v-if="data.personalInfo.phone"
          class="flex items-start gap-3"
        >
          <span
            class="rounded-full shrink-0 flex items-center justify-center"
            style="
              width: 28px;
              height: 28px;
              background: #0057A8;
            "
          >
            <Phone class="w-3.5 h-3.5 text-white" />
          </span>
          <div class="flex-1 min-w-0 leading-tight">
            <p class="text-neutral-500" style="font-size: 11px;">Điện thoại</p>
            <p
              class="font-semibold text-neutral-900 mt-0.5 break-all"
              style="font-size: 12.5px;"
            >
              {{ data.personalInfo.phone }}
            </p>
          </div>
        </div>

        <!-- Email -->
        <div
          v-if="data.personalInfo.email"
          class="flex items-start gap-3"
        >
          <span
            class="rounded-full shrink-0 flex items-center justify-center"
            style="
              width: 28px;
              height: 28px;
              background: #0057A8;
            "
          >
            <Mail class="w-3.5 h-3.5 text-white" />
          </span>
          <div class="flex-1 min-w-0 leading-tight">
            <p class="text-neutral-500" style="font-size: 11px;">Email</p>
            <p
              class="font-semibold text-neutral-900 mt-0.5 break-all"
              style="font-size: 12.5px;"
            >
              {{ data.personalInfo.email }}
            </p>
          </div>
        </div>

        <!-- Địa chỉ (DB không lưu — v-if luôn false nếu rỗng) -->
        <div
          v-if="data.personalInfo.address"
          class="flex items-start gap-3"
        >
          <span
            class="rounded-full shrink-0 flex items-center justify-center"
            style="
              width: 28px;
              height: 28px;
              background: #0057A8;
            "
          >
            <MapPin class="w-3.5 h-3.5 text-white" />
          </span>
          <div class="flex-1 min-w-0 leading-tight">
            <p class="text-neutral-500" style="font-size: 11px;">Địa chỉ</p>
            <p
              class="font-semibold text-neutral-900 mt-0.5 break-words"
              style="font-size: 12.5px;"
            >
              {{ data.personalInfo.address }}
            </p>
          </div>
        </div>
      </div>
    </aside>

    <!-- ==================== MAIN PHẢI (~67%) ==================== -->
    <main
      class="flex flex-col gap-5 px-10 py-10"
      style="background: #FFFFFF;"
    >
      <!-- Mục tiêu nghề nghiệp -->
      <section v-if="data.summary">
        <h2 class="flex items-center gap-2 mb-3 leading-none">
          <Target class="w-5 h-5 shrink-0" style="color: #064C8A;" />
          <span
            class="font-bold uppercase whitespace-nowrap"
            style="font-size: 17px; color: #064C8A; letter-spacing: 1px;"
          >
            Mục tiêu nghề nghiệp
          </span>
          <span class="flex-1 h-[2px]" style="background: #064C8A;" />
        </h2>
        <p
          class="text-neutral-800 whitespace-pre-wrap"
          style="font-size: 12.5px; line-height: 1.55;"
        >
          {{ data.summary }}
        </p>
      </section>

      <!-- Trình độ học vấn -->
      <section v-if="data.educations.length">
        <h2 class="flex items-center gap-2 mb-3 leading-none">
          <GraduationCap class="w-5 h-5 shrink-0" style="color: #064C8A;" />
          <span
            class="font-bold uppercase whitespace-nowrap"
            style="font-size: 17px; color: #064C8A; letter-spacing: 1px;"
          >
            Trình độ học vấn
          </span>
          <span class="flex-1 h-[2px]" style="background: #064C8A;" />
        </h2>
        <ul class="flex flex-col gap-4" style="font-size: 12.5px;">
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
              style="font-size: 12px; line-height: 1.5;"
            >
              {{ e.description }}
            </p>
          </li>
        </ul>
      </section>

      <!-- Kinh nghiệm thực tập -->
      <section v-if="data.experiences.length">
        <h2 class="flex items-center gap-2 mb-3 leading-none">
          <Briefcase class="w-5 h-5 shrink-0" style="color: #064C8A;" />
          <span
            class="font-bold uppercase whitespace-nowrap"
            style="font-size: 17px; color: #064C8A; letter-spacing: 1px;"
          >
            Kinh nghiệm làm việc
          </span>
          <span class="flex-1 h-[2px]" style="background: #064C8A;" />
        </h2>
        <ul class="flex flex-col gap-4" style="font-size: 12.5px;">
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
              class="font-medium text-neutral-700 leading-tight mt-1 break-words"
            >
              {{ x.position }}
            </p>
            <ul
              v-if="x.description"
              class="flex flex-col gap-1 mt-1.5"
              style="font-size: 12px; line-height: 1.5;"
            >
              <li
                v-for="(line, idx) in descriptionBullets(x.description)"
                :key="idx"
                class="text-neutral-700 break-words"
              >
                • {{ line }}
              </li>
            </ul>
          </li>
        </ul>
      </section>

      <!-- Dự án học tập -->
      <section v-if="data.projects.length">
        <h2 class="flex items-center gap-2 mb-3 leading-none">
          <FolderGit2 class="w-5 h-5 shrink-0" style="color: #064C8A;" />
          <span
            class="font-bold uppercase whitespace-nowrap"
            style="font-size: 17px; color: #064C8A; letter-spacing: 1px;"
          >
            Dự án tham gia
          </span>
          <span class="flex-1 h-[2px]" style="background: #064C8A;" />
        </h2>
        <ul class="flex flex-col gap-4" style="font-size: 12.5px;">
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
              class="font-medium text-neutral-700 leading-tight mt-1 break-words"
            >
              {{ p.role }}
            </p>
            <ul
              v-if="p.description"
              class="flex flex-col gap-1 mt-1.5"
              style="font-size: 12px; line-height: 1.5;"
            >
              <li
                v-for="(line, idx) in descriptionBullets(p.description)"
                :key="idx"
                class="text-neutral-700 break-words"
              >
                • {{ line }}
              </li>
            </ul>
            <p
              v-if="p.link"
              class="break-all mt-1"
              style="font-size: 11.5px; color: #064C8A;"
            >
              {{ p.link }}
            </p>
          </li>
        </ul>
      </section>

      <!-- Kỹ năng chuyên môn -->
      <section v-if="data.skills.length">
        <h2 class="flex items-center gap-2 mb-3 leading-none">
          <Settings class="w-5 h-5 shrink-0" style="color: #064C8A;" />
          <span
            class="font-bold uppercase whitespace-nowrap"
            style="font-size: 17px; color: #064C8A; letter-spacing: 1px;"
          >
            Kỹ năng chuyên môn
          </span>
          <span class="flex-1 h-[2px]" style="background: #064C8A;" />
        </h2>
        <div class="grid grid-cols-2 gap-x-8 gap-y-2" style="font-size: 12.5px;">
          <div
            v-for="(s, i) in data.skills"
            :key="i"
            class="flex items-start gap-2"
          >
            <span
              class="mt-[2px] w-3 h-3 rounded-full shrink-0 flex items-center justify-center"
              style="background: #0057A8;"
            >
              <span
                class="text-white font-bold leading-none"
                style="font-size: 8px;"
              >✓</span>
            </span>
            <span class="text-neutral-700 break-words">{{ s.name }}</span>
          </div>
        </div>
      </section>

      <!-- Chứng chỉ -->
      <section v-if="data.certificates.length">
        <h2 class="flex items-center gap-2 mb-3 leading-none">
          <Award class="w-5 h-5 shrink-0" style="color: #064C8A;" />
          <span
            class="font-bold uppercase whitespace-nowrap"
            style="font-size: 17px; color: #064C8A; letter-spacing: 1px;"
          >
            Chứng chỉ
          </span>
          <span class="flex-1 h-[2px]" style="background: #064C8A;" />
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

      <!-- Hoạt động -->
      <section v-if="data.activities.length">
        <h2 class="flex items-center gap-2 mb-3 leading-none">
          <Star class="w-5 h-5 shrink-0" style="color: #064C8A;" />
          <span
            class="font-bold uppercase whitespace-nowrap"
            style="font-size: 17px; color: #064C8A; letter-spacing: 1px;"
          >
            Hoạt động
          </span>
          <span class="flex-1 h-[2px]" style="background: #064C8A;" />
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
              style="font-size: 12px; line-height: 1.5;"
            >
              {{ a.description }}
            </p>
          </li>
        </ul>
      </section>

      <!-- Sở thích -->
      <section v-if="data.interests && data.interests.length">
        <h2 class="flex items-center gap-2 mb-3 leading-none">
          <Heart class="w-5 h-5 shrink-0" style="color: #064C8A;" />
          <span
            class="font-bold uppercase whitespace-nowrap"
            style="font-size: 17px; color: #064C8A; letter-spacing: 1px;"
          >
            Sở thích
          </span>
          <span class="flex-1 h-[2px]" style="background: #064C8A;" />
        </h2>
        <ul class="flex flex-col gap-1.5" style="font-size: 12.5px;">
          <li
            v-for="(it, i) in data.interests"
            :key="i"
            class="flex items-start gap-2 text-neutral-700"
          >
            <span
              class="mt-[7px] w-1.5 h-1.5 rounded-full shrink-0"
              style="background: #064C8A;"
            />
            <span class="break-words">{{ it }}</span>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>
