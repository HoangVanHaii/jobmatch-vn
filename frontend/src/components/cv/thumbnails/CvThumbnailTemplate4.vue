<script setup lang="ts">
/**
 * CvThumbnailTemplate4 — bản thu nhỏ của CVTemplate4 (navy header + 2-col body).
 *
 * Phải GIỐNG HỆT CVTemplate4 về layout, navy #0e2a47 header, orange accent
 * #b86c3b, green dot #4a7c3a cho skills/interests.
 * LƯU Ý: CVTemplate4 KHÔNG có dự án và chứng chỉ — chỉ các section dưới.
 *
 * Layout mapping (full → thumb):
 *   - Header navy full-width: gradient overlay + avatar white border shadow +
 *     name (30px white) + position (#f4a261 uppercase tracking) + accent strip
 *     cam gradient dưới.
 *   - Body 2-col (grid-cols-[280px_1fr]):
 *     Left: Thông tin liên hệ (icon #b86c3b + 5 field phone/email/address/dob/gender)
 *       → Mục tiêu nghề nghiệp → Kỹ năng (green dot #4a7c3a bullets) → Sở thích.
 *     Right: Học vấn (GraduationCap icon + timeline dots #b86c3b) →
 *       Kinh nghiệm làm việc (Briefcase icon + timeline) →
 *       Hoạt động (Star icon + timeline).
 *
 * Khác biệt: bỏ lucide icons, bỏ box-shadow dot timeline (chỉ giữ dot amber).
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
  <div class="w-full h-full flex flex-col bg-white font-sans overflow-hidden">
    <!-- Header navy giống CVTemplate4 -->
    <header
      class="relative overflow-hidden shrink-0 flex items-center px-[6%]"
      style="background: linear-gradient(120deg, #0e2a47 0%, #14365a 70%, #1a4267 100%); height: 28%;"
    >
      <div class="relative z-[1] flex items-center gap-[5%] w-full">
        <!-- Avatar tròn với border trắng (giống CVTemplate4) -->
        <div
          class="rounded-full bg-white p-[3%] shrink-0"
          style="width: 18%; aspect-ratio: 1 / 1;"
        >
          <div class="w-full h-full rounded-full bg-neutral-300 flex items-center justify-center overflow-hidden">
            <img
              v-if="data.personalInfo.avatarUrl"
              :src="data.personalInfo.avatarUrl"
              :alt="data.personalInfo.fullName"
              class="w-full h-full object-cover"
            />
            <span v-else class="font-semibold text-stone-600 text-[6px] leading-none">{{ initial }}</span>
          </div>
        </div>

        <div class="flex-1 min-w-0 text-white leading-tight">
          <h2
            class="font-bold truncate"
            style="font-size: 8px;"
          >
            {{ shortName }}
          </h2>
          <p
            v-if="data.personalInfo.position"
            class="font-semibold uppercase tracking-[0.5px] mt-[1px] truncate"
            style="font-size: 5.5px; color: #f4a261;"
          >
            {{ data.personalInfo.position }}
          </p>
        </div>
      </div>

      <!-- Accent strip cam gradient dưới -->
      <div
        class="absolute bottom-0 left-0 w-full"
        style="height: 5%; background: linear-gradient(90deg, #b86c3b 0%, #d68a52 60%, transparent 100%);"
      />
    </header>

    <!-- Body 2 cột (grid-cols-[280px_1fr] → 35%/65%) -->
    <div
      class="grid gap-[4%] px-[5%] flex-1 bg-white overflow-hidden"
      style="grid-template-columns: 35% 1fr; padding-top: 5%; padding-bottom: 5%;"
    >
      <!-- ============ CỘT TRÁI ============ -->
      <aside class="flex flex-col gap-[4%] overflow-hidden">
        <!-- Thông tin liên hệ -->
        <section
          v-if="data.personalInfo.phone || data.personalInfo.email || data.personalInfo.address || data.personalInfo.dob || data.personalInfo.gender"
          class="flex flex-col gap-[3%]"
        >
          <h3
            class="font-bold uppercase tracking-[1px] border-b-2 leading-none"
            style="font-size: 5px; padding-bottom: 2px; color: #0e2a47; border-color: #b86c3b;"
          >
            Thông tin liên hệ
          </h3>
          <ul class="flex flex-col gap-[3%] leading-tight" style="font-size: 5px;">
            <li v-if="data.personalInfo.phone" class="truncate" style="color: #b86c3b;">● {{ data.personalInfo.phone }}</li>
            <li v-if="data.personalInfo.email" class="truncate" style="color: #b86c3b;">● {{ data.personalInfo.email }}</li>
            <li v-if="data.personalInfo.address" class="break-words" style="color: #b86c3b;">● {{ data.personalInfo.address }}</li>
            <li v-if="data.personalInfo.dob" class="truncate" style="color: #b86c3b;">● {{ data.personalInfo.dob }}</li>
            <li v-if="data.personalInfo.gender" class="truncate" style="color: #b86c3b;">● {{ data.personalInfo.gender }}</li>
          </ul>
        </section>

        <!-- Mục tiêu nghề nghiệp -->
        <section v-if="data.summary" class="flex flex-col gap-[3%]">
          <h3
            class="font-bold uppercase tracking-[1px] border-b-2 leading-none"
            style="font-size: 5px; padding-bottom: 2px; color: #0e2a47; border-color: #b86c3b;"
          >
            Mục tiêu nghề nghiệp
          </h3>
          <p
            class="leading-snug whitespace-pre-wrap"
            style="font-size: 5px; color: #404040;"
          >
            {{ data.summary }}
          </p>
        </section>

        <!-- Kỹ năng — green dot #4a7c3a bullets -->
        <section v-if="data.skills.length" class="flex flex-col gap-[3%]">
          <h3
            class="font-bold uppercase tracking-[1px] border-b-2 leading-none"
            style="font-size: 5px; padding-bottom: 2px; color: #0e2a47; border-color: #b86c3b;"
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
                class="absolute left-0 top-1/2 -translate-y-1/2 rounded-full"
                style="width: 2px; height: 2px; background: #4a7c3a;"
              />
              {{ trunc(s.name, 26) }}
            </li>
          </ul>
        </section>

        <!-- Sở thích — green dot bullets -->
        <section v-if="data.interests && data.interests.length" class="flex flex-col gap-[3%]">
          <h3
            class="font-bold uppercase tracking-[1px] border-b-2 leading-none"
            style="font-size: 5px; padding-bottom: 2px; color: #0e2a47; border-color: #b86c3b;"
          >
            Sở thích
          </h3>
          <ul class="flex flex-col gap-[3%]">
            <li
              v-for="(it, idx) in data.interests"
              :key="`i-${idx}`"
              class="relative leading-tight"
              style="font-size: 5px; padding-left: 6px;"
            >
              <span
                class="absolute left-0 top-1/2 -translate-y-1/2 rounded-full"
                style="width: 2px; height: 2px; background: #4a7c3a;"
              />
              {{ it }}
            </li>
          </ul>
        </section>
      </aside>

      <!-- ============ CỘT PHẢI ============ -->
      <main class="flex flex-col gap-[4%] overflow-hidden">
        <!-- Học vấn — timeline dots #b86c3b -->
        <section v-if="data.educations.length" class="flex flex-col gap-[3%]">
          <h3
            class="font-bold uppercase tracking-[1px] border-b-2 leading-none"
            style="font-size: 5px; padding-bottom: 2px; color: #0e2a47; border-color: #b86c3b;"
          >
            Học vấn
          </h3>
          <ul class="flex flex-col gap-[4%]">
            <li
              v-for="(e, idx) in data.educations"
              :key="`e-${idx}`"
              class="relative leading-tight"
              style="font-size: 5px; padding-left: 6px;"
            >
              <span
                class="absolute left-0 top-[2px] rounded-full"
                style="width: 2px; height: 2px; background: #b86c3b;"
              />
              <p class="font-semibold" style="color: #0e2a47;">{{ trunc(e.school, 22) }}</p>
              <p class="font-semibold mt-[1px]" style="color: #b86c3b; font-size: 4.5px;">
                {{ e.startYear || '' }}<span v-if="e.startYear || e.endYear"> - </span>{{ e.endYear || 'Nay' }}
              </p>
              <p v-if="e.major" class="mt-[1px] text-neutral-600" style="font-size: 4.5px;">
                <strong>Chuyên ngành:</strong> {{ trunc(e.major, 22) }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Kinh nghiệm làm việc — position " — company" + dates -->
        <section v-if="data.experiences.length" class="flex flex-col gap-[3%]">
          <h3
            class="font-bold uppercase tracking-[1px] border-b-2 leading-none"
            style="font-size: 5px; padding-bottom: 2px; color: #0e2a47; border-color: #b86c3b;"
          >
            Kinh nghiệm làm việc
          </h3>
          <ul class="flex flex-col gap-[4%]">
            <li
              v-for="(x, idx) in data.experiences"
              :key="`x-${idx}`"
              class="relative leading-tight"
              style="font-size: 5px; padding-left: 6px;"
            >
              <span
                class="absolute left-0 top-[2px] rounded-full"
                style="width: 2px; height: 2px; background: #b86c3b;"
              />
              <p class="font-semibold" style="color: #0e2a47;">
                {{ trunc(x.position, 20) }}<span v-if="x.company"> — {{ trunc(x.company, 14) }}</span>
              </p>
              <p class="font-semibold mt-[1px]" style="color: #b86c3b; font-size: 4.5px;">
                {{ x.startDate || '' }}<span v-if="x.startDate || x.endDate"> - </span>{{ x.endDate || 'Nay' }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Hoạt động -->
        <section v-if="data.activities.length" class="flex flex-col gap-[3%]">
          <h3
            class="font-bold uppercase tracking-[1px] border-b-2 leading-none"
            style="font-size: 5px; padding-bottom: 2px; color: #0e2a47; border-color: #b86c3b;"
          >
            Hoạt động
          </h3>
          <ul class="flex flex-col gap-[4%]">
            <li
              v-for="(a, idx) in data.activities"
              :key="`a-${idx}`"
              class="relative leading-tight"
              style="font-size: 5px; padding-left: 6px;"
            >
              <span
                class="absolute left-0 top-[2px] rounded-full"
                style="width: 2px; height: 2px; background: #b86c3b;"
              />
              <p class="font-semibold" style="color: #0e2a47;">{{ trunc(a.name, 22) }}</p>
              <p v-if="a.time" class="font-semibold mt-[1px]" style="color: #b86c3b; font-size: 4.5px;">{{ trunc(a.time, 18) }}</p>
              <p v-if="a.role" class="mt-[1px] text-neutral-600" style="font-size: 4.5px;">
                <strong>Vai trò:</strong> {{ trunc(a.role, 20) }}
              </p>
            </li>
          </ul>
        </section>
      </main>
    </div>
  </div>
</template>