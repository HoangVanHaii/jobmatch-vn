<script setup lang="ts">
/**
 * CvThumbnailTemplate5 — bản thu nhỏ của CVTemplate5 (minimalist editorial 1-cột).
 *
 * Phải GIỐNG HỆT CVTemplate5 về layout centered, sans-serif, IN HOA tracking rộng,
 * font-light, hr-line gradient (transparent→#ccc→transparent).
 * THỨ TỰ SECTION đúng CVTemplate5: Giới thiệu → Kinh nghiệm → Học vấn → Kỹ năng
 * → Dự án → Chứng chỉ → Hoạt động → Sở thích.
 * LƯU Ý: Kinh nghiệm TRƯỚC Học vấn (đúng thứ tự CVTemplate5).
 *
 * Layout mapping (full → thumb):
 *   - Header centered: avatar 24x24 + name (34px font-light tracking-[4px]
 *     uppercase neutral-900) + position (14px tracking-[2px] uppercase
 *     neutral-500) + contact row inline (phone/email/address/portfolio-github-linkedin
 *     với icon amber-700).
 *   - Body 1-cột centered, sections:
 *     Mỗi section: h2 centered (font-semibold tracking-[4px] uppercase) +
 *     hr gradient + content centered.
 *     1. Giới thiệu (summary centered max-w-620)
 *     2. Kinh nghiệm (position + dates + company amber-700)
 *     3. Học vấn (school + dates + "Chuyên ngành:" amber)
 *     4. Kỹ năng (chip pills rounded-full bg-neutral-100)
 *     5. Dự án (name + time + "Vai trò:" amber + description + link)
 *     6. Chứng chỉ (name + date + issuer amber)
 *     7. Hoạt động (name + time + "Vai trò:" amber + description)
 *     8. Sở thích (joined " · ")
 *
 * Khác biệt: bỏ lucide icons.
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
  return last2.length > 18 ? last2.slice(0, 17) + '…' : last2;
});

const trunc = (s: string | null | undefined, max: number): string => {
  const v = (s ?? '').trim();
  if (v.length <= max) return v;
  return v.slice(0, max - 1).trimEnd() + '…';
};

/** Contact row giống CVTemplate5 (logic giống nguyên hàm contactRow). */
const contactRow = computed<Array<string>>(() => {
  const pi = props.data.personalInfo;
  const rows: string[] = [];
  if (pi.phone) rows.push(pi.phone);
  if (pi.email) rows.push(pi.email);
  if (pi.address) rows.push(pi.address);
  if (pi.portfolio || pi.github || pi.linkedin) {
    rows.push(pi.portfolio || pi.github || pi.linkedin || '');
  }
  return rows;
});
</script>

<template>
  <div
    class="w-full h-full flex flex-col bg-white text-neutral-800 font-sans overflow-hidden text-center"
    style="padding: 6% 7%; gap: 4%;"
  >
    <!-- Header centered giống CVTemplate5 -->
    <header class="flex flex-col items-center">
      <div
        v-if="data.personalInfo.avatarUrl || data.personalInfo.fullName"
        class="rounded-full bg-neutral-100 mx-auto mb-[3%] overflow-hidden flex items-center justify-center"
        style="width: 11%; aspect-ratio: 1 / 1;"
      >
        <img
          v-if="data.personalInfo.avatarUrl"
          :src="data.personalInfo.avatarUrl"
          :alt="data.personalInfo.fullName"
          class="w-full h-full object-cover"
        />
        <span v-else class="font-semibold text-neutral-400 text-[6px] leading-none">{{ initial }}</span>
      </div>
      <h1
        class="font-light uppercase leading-tight tracking-[3px] text-neutral-900 truncate w-full"
        style="font-size: 9px;"
      >
        {{ shortName }}
      </h1>
      <p
        v-if="data.personalInfo.position"
        class="uppercase text-neutral-500 tracking-[2px] leading-tight truncate w-full mt-[1px]"
        style="font-size: 5.5px;"
      >
        {{ data.personalInfo.position }}
      </p>
      <!-- Contact row inline (đúng logic CVTemplate5) -->
      <ul
        v-if="contactRow.length"
        class="list-none p-0 mt-[3px] mx-auto flex flex-wrap justify-center gap-[3%] text-neutral-500"
        style="font-size: 4.5px;"
      >
        <li
          v-for="(c, idx) in contactRow"
          :key="`c-${idx}`"
          class="truncate max-w-[60px]"
        >
          {{ c }}
        </li>
      </ul>
    </header>

    <!-- ============ 1. GIỚI THIỆU ============ -->
    <section v-if="data.summary" class="flex flex-col gap-[3%] text-center">
      <h2
        class="font-semibold text-neutral-900 tracking-[3px] uppercase leading-none"
        style="font-size: 5px;"
      >
        Giới thiệu
      </h2>
      <hr
        class="border-0 w-full"
        style="height: 1px; background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%); margin: 2px 0;"
      />
      <p
        class="text-center text-neutral-600 whitespace-pre-wrap"
        style="font-size: 5px;"
      >
        {{ data.summary }}
      </p>
    </section>

    <!-- ============ 2. KINH NGHIỆM (TRƯỚC HỌC VẤN — đúng thứ tự CVTemplate5) ============ -->
    <section v-if="data.experiences.length" class="flex flex-col gap-[3%]">
      <h2
        class="font-semibold text-neutral-900 tracking-[3px] uppercase leading-none"
        style="font-size: 5px;"
      >
        Kinh nghiệm
      </h2>
      <hr
        class="border-0 w-full"
        style="height: 1px; background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%); margin: 2px 0;"
      />
      <ul class="flex flex-col gap-[4%]">
        <li
          v-for="(x, idx) in data.experiences"
          :key="`x-${idx}`"
          class="leading-tight"
        >
          <header class="flex items-baseline justify-between gap-[3%] flex-wrap" style="font-size: 5px;">
            <h3 class="font-semibold text-neutral-900 m-0 truncate">{{ trunc(x.position, 22) }}</h3>
            <span v-if="x.startDate || x.endDate" class="text-neutral-500 tracking-[1px] whitespace-nowrap" style="font-size: 4.5px;">
              {{ x.startDate || '' }}<span v-if="x.startDate || x.endDate"> — </span>{{ x.endDate || 'Nay' }}
            </span>
          </header>
          <p v-if="x.company" class="text-amber-700 font-medium mt-[1px] truncate" style="font-size: 5px;">{{ trunc(x.company, 26) }}</p>
        </li>
      </ul>
    </section>

    <!-- ============ 3. HỌC VẤN ============ -->
    <section v-if="data.educations.length" class="flex flex-col gap-[3%]">
      <h2
        class="font-semibold text-neutral-900 tracking-[3px] uppercase leading-none"
        style="font-size: 5px;"
      >
        Học vấn
      </h2>
      <hr
        class="border-0 w-full"
        style="height: 1px; background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%); margin: 2px 0;"
      />
      <ul class="flex flex-col gap-[4%]">
        <li
          v-for="(e, idx) in data.educations"
          :key="`e-${idx}`"
          class="leading-tight"
        >
          <header class="flex items-baseline justify-between gap-[3%] flex-wrap" style="font-size: 5px;">
            <h3 class="font-semibold text-neutral-900 m-0 truncate">{{ trunc(e.school, 22) }}</h3>
            <span v-if="e.startYear || e.endYear" class="text-neutral-500 tracking-[1px] whitespace-nowrap" style="font-size: 4.5px;">
              {{ e.startYear || '' }}<span v-if="e.startYear || e.endYear"> — </span>{{ e.endYear || 'Nay' }}
            </span>
          </header>
          <p v-if="e.major" class="text-amber-700 font-medium mt-[1px] truncate" style="font-size: 5px;">Chuyên ngành: {{ trunc(e.major, 22) }}</p>
        </li>
      </ul>
    </section>

    <!-- ============ 4. KỸ NĂNG (chip pills rounded-full bg-neutral-100) ============ -->
    <section v-if="data.skills.length" class="flex flex-col gap-[3%]">
      <h2
        class="font-semibold text-neutral-900 tracking-[3px] uppercase leading-none"
        style="font-size: 5px;"
      >
        Kỹ năng
      </h2>
      <hr
        class="border-0 w-full"
        style="height: 1px; background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%); margin: 2px 0;"
      />
      <ul class="list-none p-0 m-0 flex flex-wrap justify-center gap-[2%]">
        <li
          v-for="(s, idx) in data.skills"
          :key="`s-${idx}`"
          class="bg-neutral-100 text-neutral-700 rounded-full border border-neutral-200 leading-tight truncate"
          style="font-size: 4.5px; padding: 1px 5px;"
        >
          {{ trunc(s.name, 14) }}
        </li>
      </ul>
    </section>

    <!-- ============ 5. DỰ ÁN ============ -->
    <section v-if="data.projects.length" class="flex flex-col gap-[3%]">
      <h2
        class="font-semibold text-neutral-900 tracking-[3px] uppercase leading-none"
        style="font-size: 5px;"
      >
        Dự án
      </h2>
      <hr
        class="border-0 w-full"
        style="height: 1px; background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%); margin: 2px 0;"
      />
      <ul class="flex flex-col gap-[4%]">
        <li
          v-for="(p, idx) in data.projects"
          :key="`p-${idx}`"
          class="leading-tight"
        >
          <header class="flex items-baseline justify-between gap-[3%] flex-wrap" style="font-size: 5px;">
            <h3 class="font-semibold text-neutral-900 m-0 truncate">{{ trunc(p.name, 22) }}</h3>
            <span v-if="p.time" class="text-neutral-500 tracking-[1px]" style="font-size: 4.5px;">{{ trunc(p.time, 14) }}</span>
          </header>
          <p v-if="p.role" class="text-amber-700 font-medium mt-[1px] truncate" style="font-size: 5px;">Vai trò: {{ trunc(p.role, 22) }}</p>
          <p v-if="p.link" class="text-neutral-500 break-all mt-[1px]" style="font-size: 4px;">{{ trunc(p.link, 28) }}</p>
        </li>
      </ul>
    </section>

    <!-- ============ 6. CHỨNG CHỈ ============ -->
    <section v-if="data.certificates.length" class="flex flex-col gap-[3%]">
      <h2
        class="font-semibold text-neutral-900 tracking-[3px] uppercase leading-none"
        style="font-size: 5px;"
      >
        Chứng chỉ
      </h2>
      <hr
        class="border-0 w-full"
        style="height: 1px; background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%); margin: 2px 0;"
      />
      <ul class="flex flex-col gap-[4%]">
        <li
          v-for="(c, idx) in data.certificates"
          :key="`c-${idx}`"
          class="leading-tight"
        >
          <header class="flex items-baseline justify-between gap-[3%] flex-wrap" style="font-size: 5px;">
            <h3 class="font-semibold text-neutral-900 m-0 truncate">{{ trunc(c.name, 22) }}</h3>
            <span v-if="c.date" class="text-neutral-500 tracking-[1px]" style="font-size: 4.5px;">{{ trunc(c.date, 14) }}</span>
          </header>
          <p v-if="c.issuer" class="text-amber-700 font-medium mt-[1px] truncate" style="font-size: 5px;">{{ trunc(c.issuer, 26) }}</p>
        </li>
      </ul>
    </section>

    <!-- ============ 7. HOẠT ĐỘNG ============ -->
    <section v-if="data.activities.length" class="flex flex-col gap-[3%]">
      <h2
        class="font-semibold text-neutral-900 tracking-[3px] uppercase leading-none"
        style="font-size: 5px;"
      >
        Hoạt động
      </h2>
      <hr
        class="border-0 w-full"
        style="height: 1px; background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%); margin: 2px 0;"
      />
      <ul class="flex flex-col gap-[4%]">
        <li
          v-for="(a, idx) in data.activities"
          :key="`a-${idx}`"
          class="leading-tight"
        >
          <header class="flex items-baseline justify-between gap-[3%] flex-wrap" style="font-size: 5px;">
            <h3 class="font-semibold text-neutral-900 m-0 truncate">{{ trunc(a.name, 22) }}</h3>
            <span v-if="a.time" class="text-neutral-500 tracking-[1px]" style="font-size: 4.5px;">{{ trunc(a.time, 14) }}</span>
          </header>
          <p v-if="a.role" class="text-amber-700 font-medium mt-[1px] truncate" style="font-size: 5px;">Vai trò: {{ trunc(a.role, 22) }}</p>
        </li>
      </ul>
    </section>

    <!-- ============ 8. SỞ THÍCH ============ -->
    <section v-if="data.interests && data.interests.length" class="flex flex-col gap-[3%]">
      <h2
        class="font-semibold text-neutral-900 tracking-[3px] uppercase leading-none"
        style="font-size: 5px;"
      >
        Sở thích
      </h2>
      <hr
        class="border-0 w-full"
        style="height: 1px; background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%); margin: 2px 0;"
      />
      <p
        class="text-center text-neutral-500 leading-tight"
        style="font-size: 5px;"
      >
        {{ data.interests.join(' · ') }}
      </p>
    </section>
  </div>
</template>