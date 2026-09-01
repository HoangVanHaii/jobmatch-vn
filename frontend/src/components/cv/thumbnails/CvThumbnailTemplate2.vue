<script setup lang="ts">
/**
 * CvThumbnailTemplate2 — bản thu nhỏ của CVTemplate2 (gradient slate + 2-col body).
 *
 * Phải GIỐNG HỆT CVTemplate2 về layout, màu sắc, content, format.
 *
 * Layout mapping (full → thumb):
 *   - Header (#a8b3c0 gradient): avatar tròn + name (30px bold) + position (amber-700)
 *     + **summary** (12.5px neutral-600 max-w-520) + 2 shape tròn cam trang trí.
 *   - Body 2-col (gap-8 px-10 pt-7 pb-9):
 *     Left: Thông tin cá nhân (icon amber-700 + 4 field) → Học vấn (school|dates
 *       + "Chuyên ngành:" + "Xếp loại:" + description) → Kỹ năng (amber dot bullets)
 *       → Chứng chỉ (date bold + name + " — issuer").
 *     Right: Kinh nghiệm làm việc (company|dates + position bold + description)
 *       → Hoạt động (name + " | time" + role + description).
 *
 * Khác biệt:
 *   - Bỏ lucide icons (vô hình ở 4-6px).
 *   - Bỏ extra shape decorative thứ 2 (chỉ giữ 1 để đỡ rối).
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

const trunc = (s: string | null | undefined, max: number): string => {
  const v = (s ?? '').trim();
  if (v.length <= max) return v;
  return v.slice(0, max - 1).trimEnd() + '…';
};
</script>

<template>
  <div class="w-full h-full flex flex-col bg-white text-neutral-700 font-sans overflow-hidden">
    <!-- Header (#a8b3c0 gradient + shape cam) -->
    <header
      class="relative overflow-hidden flex items-center px-[6%] shrink-0"
      style="background: #a8b3c0; height: 32%;"
    >
      <!-- Shape tròn cam (giữ 1 shape, giống CVTemplate2) -->
      <div
        class="absolute rounded-full"
        style="
          width: 22%; aspect-ratio: 1 / 1;
          background: rgba(184, 108, 59, 0.18);
          top: -25%; right: 18%;
        "
      />

      <div class="relative z-[1] flex items-center gap-[5%] w-full">
        <!-- Avatar tròn (giống CVTemplate2 — bg-white p-1) -->
        <div
          class="rounded-full bg-white shrink-0 overflow-hidden flex items-center justify-center"
          style="width: 22%; aspect-ratio: 1 / 1;"
        >
          <div class="w-full h-full bg-neutral-300 flex items-center justify-center overflow-hidden">
            <img
              v-if="data.personalInfo.avatarUrl"
              :src="data.personalInfo.avatarUrl"
              :alt="data.personalInfo.fullName"
              class="w-full h-full object-cover"
            />
            <span v-else class="font-semibold text-stone-600 text-[8px] leading-none">
              {{ initial }}
            </span>
          </div>
        </div>

        <div class="flex-1 min-w-0 leading-tight">
          <h2 class="font-bold text-neutral-800 truncate" style="font-size: 8px;">
            {{ shortName }}
          </h2>
          <p
            v-if="data.personalInfo.position"
            class="text-amber-700 font-semibold mt-[1px] truncate"
            style="font-size: 6px;"
          >
            {{ data.personalInfo.position }}
          </p>
          <!-- Summary trong header (đúng format CVTemplate2) -->
          <p
            v-if="data.summary"
            class="text-neutral-600 mt-[2px] line-clamp-2"
            style="font-size: 4.5px;"
          >
            {{ data.summary }}
          </p>
        </div>
      </div>
    </header>

    <!-- Body 2 cột -->
    <div
      class="grid grid-cols-2 gap-[4%] px-[6%] flex-1 bg-white overflow-hidden"
      style="padding-top: 5%; padding-bottom: 5%;"
    >
      <!-- ============ CỘT TRÁI ============ -->
      <div class="flex flex-col gap-[4%] overflow-hidden">
        <!-- Thông tin cá nhân (4 field) -->
        <section class="flex flex-col gap-[3%]">
          <h3
            class="font-bold text-amber-700 border-b-[1.5px] border-amber-700 leading-none"
            style="font-size: 5px; padding-bottom: 2px;"
          >
            Thông tin cá nhân
          </h3>
          <ul class="flex flex-col gap-[2%] leading-tight" style="font-size: 5px;">
            <li v-if="data.personalInfo.phone" class="truncate">{{ data.personalInfo.phone }}</li>
            <li v-if="data.personalInfo.email" class="truncate">{{ data.personalInfo.email }}</li>
            <li v-if="data.personalInfo.facebook" class="truncate">{{ data.personalInfo.facebook }}</li>
            <li v-if="data.personalInfo.address" class="break-words">{{ data.personalInfo.address }}</li>
          </ul>
        </section>

        <!-- Học vấn (school|dates same line + Chuyên ngành: + Xếp loại: + description) -->
        <section v-if="data.educations.length" class="flex flex-col gap-[3%]">
          <h3
            class="font-bold text-amber-700 border-b-[1.5px] border-amber-700 leading-none"
            style="font-size: 5px; padding-bottom: 2px;"
          >
            Học vấn
          </h3>
          <ul class="flex flex-col gap-[4%]">
            <li
              v-for="(e, idx) in data.educations"
              :key="`e-${idx}`"
              class="leading-tight"
            >
              <p class="text-neutral-800" style="font-size: 5px;">
                <strong>{{ trunc(e.school, 18) }}</strong> | {{ e.startYear || '' }} - {{ e.endYear || 'Nay' }}
              </p>
              <p class="text-neutral-600 mt-[1px]" style="font-size: 4.5px;">
                <strong>Chuyên ngành:</strong> {{ trunc(e.major || '—', 22) }}
              </p>
              <p v-if="e.degree" class="text-neutral-600" style="font-size: 4.5px;">
                <strong>Xếp loại:</strong> {{ trunc(e.degree, 22) }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Kỹ năng — amber dot bullets -->
        <section v-if="data.skills.length" class="flex flex-col gap-[3%]">
          <h3
            class="font-bold text-amber-700 border-b-[1.5px] border-amber-700 leading-none"
            style="font-size: 5px; padding-bottom: 2px;"
          >
            Kỹ năng
          </h3>
          <ul class="flex flex-col gap-[3%]">
            <li
              v-for="(s, idx) in data.skills"
              :key="`s-${idx}`"
              class="relative leading-tight"
              style="font-size: 5px; padding-left: 6px;"
            >
              <span
                class="absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-amber-700"
                style="width: 2px; height: 2px;"
              />
              {{ trunc(s.name, 26) }}
            </li>
          </ul>
        </section>

        <!-- Chứng chỉ (date bold + name + " — issuer") -->
        <section v-if="data.certificates.length" class="flex flex-col gap-[3%]">
          <h3
            class="font-bold text-amber-700 border-b-[1.5px] border-amber-700 leading-none"
            style="font-size: 5px; padding-bottom: 2px;"
          >
            Chứng chỉ
          </h3>
          <ul class="flex flex-col gap-[4%]">
            <li
              v-for="(c, idx) in data.certificates"
              :key="`c-${idx}`"
              class="leading-tight"
            >
              <p class="text-neutral-800" style="font-size: 5px;">
                <strong>{{ c.date || '' }}</strong>
              </p>
              <p class="text-neutral-600 mt-[1px]" style="font-size: 4.5px;">
                {{ trunc(c.name, 22) }}<span v-if="c.issuer"> — {{ trunc(c.issuer, 16) }}</span>
              </p>
            </li>
          </ul>
        </section>
      </div>

      <!-- ============ CỘT PHẢI ============ -->
      <div class="flex flex-col gap-[4%] overflow-hidden">
        <!-- Kinh nghiệm làm việc -->
        <section v-if="data.experiences.length" class="flex flex-col gap-[3%]">
          <h3
            class="font-bold text-amber-700 border-b-[1.5px] border-amber-700 leading-none"
            style="font-size: 5px; padding-bottom: 2px;"
          >
            Kinh nghiệm làm việc
          </h3>
          <ul class="flex flex-col gap-[4%]">
            <li
              v-for="(x, idx) in data.experiences"
              :key="`x-${idx}`"
              class="leading-tight"
            >
              <p class="text-neutral-800" style="font-size: 5px;">
                <strong>{{ trunc(x.company, 18) }}</strong> | {{ x.startDate || '' }} - {{ x.endDate || 'Nay' }}
              </p>
              <p class="text-neutral-600 mt-[1px]" style="font-size: 4.5px;">
                <strong>{{ trunc(x.position, 24) }}</strong>
              </p>
            </li>
          </ul>
        </section>

        <!-- Hoạt động (name | time + role + description) -->
        <section v-if="data.activities.length" class="flex flex-col gap-[3%]">
          <h3
            class="font-bold text-amber-700 border-b-[1.5px] border-amber-700 leading-none"
            style="font-size: 5px; padding-bottom: 2px;"
          >
            Hoạt động
          </h3>
          <ul class="flex flex-col gap-[4%]">
            <li
              v-for="(a, idx) in data.activities"
              :key="`a-${idx}`"
              class="leading-tight"
            >
              <p class="text-neutral-800" style="font-size: 5px;">
                <strong>{{ trunc(a.name, 18) }}</strong> | {{ trunc(a.time || '', 12) }}
              </p>
              <p v-if="a.role" class="text-neutral-600 mt-[1px]" style="font-size: 4.5px;">
                {{ trunc(a.role, 24) }}
              </p>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>