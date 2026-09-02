<script setup lang="ts">
/**
 * CvThumbnailTemplate3 — bản thu nhỏ của CVTemplate3 (serif 1-cột centered + hr-lines).
 *
 * Phải GIỐNG HỆT CVTemplate3 về layout, font-serif, IN HOA headers, hr-lines,
 * order: Mục tiêu → Học vấn → Kinh nghiệm → Kỹ năng (table) → Hoạt động.
 * LƯU Ý: CVTemplate3 KHÔNG có dự án và chứng chỉ — chỉ có 5 sections trên.
 *
 * Layout mapping (full → thumb):
 *   - Header centered: avatar tròn + name (26px bold) + position (14px italic
 *     neutral-600) + contact row inline (phone/email/portfolio/address + icons).
 *   - Body sections: h2 font-sans IN HOA tracking-[1px] + hr-line border-neutral-800
 *     + content.
 *     1. MỤC TIÊU NGHỀ NGHIỆP — summary whitespace-pre-wrap.
 *     2. HỌC VẤN — school bold + dates (neutral-500) + major (italic) + degree.
 *     3. KINH NGHIỆM LÀM VIỆC — company bold + dates + position (italic).
 *     4. KỸ NĂNG — table w-[38%] name + special description for "Kỹ năng giao tiếp".
 *     5. HOẠT ĐỘNG — name bold + time + role (italic).
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
  return last2.length > 22 ? last2.slice(0, 21) + '…' : last2;
});

const trunc = (s: string | null | undefined, max: number): string => {
  const v = (s ?? '').trim();
  if (v.length <= max) return v;
  return v.slice(0, max - 1).trimEnd() + '…';
};

/** Đúng logic CVTemplate3: hardcoded cho "Kỹ năng giao tiếp", rỗng cho các skill khác. */
const skillDescription = (name: string): string =>
  name === 'Kỹ năng giao tiếp'
    ? 'Thành thạo trong việc lắng nghe, truyền đạt thông tin rõ ràng và thuyết phục'
    : '';
</script>

<template>
  <div
    class="w-full h-full flex flex-col bg-white text-neutral-800 font-serif overflow-hidden text-center"
    style="padding: 5% 6%; gap: 4%;"
  >
    <!-- Header centered giống CVTemplate3 -->
    <header class="flex flex-col items-center text-center">
      <!-- Avatar tròn -->
      <div
        v-if="data.personalInfo.avatarUrl || data.personalInfo.fullName"
        class="rounded-full bg-neutral-100 flex items-center justify-center overflow-hidden shrink-0 mb-[3%]"
        style="width: 13%; aspect-ratio: 1 / 1;"
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
        class="font-bold leading-tight truncate w-full"
        style="font-size: 9px;"
      >
        {{ shortName }}
      </h1>
      <p
        v-if="data.personalInfo.position"
        class="italic text-neutral-600 leading-tight truncate w-full mt-[1px]"
        style="font-size: 5.5px;"
      >
        {{ data.personalInfo.position }}
      </p>
      <!-- Contact row inline (phone/email/portfolio/address) -->
      <p
        v-if="data.personalInfo.phone || data.personalInfo.email || data.personalInfo.portfolio || data.personalInfo.address"
        class="text-neutral-500 truncate w-full leading-tight"
        style="font-size: 4.5px; margin-top: 3px;"
        :title="[data.personalInfo.phone, data.personalInfo.email, data.personalInfo.portfolio, data.personalInfo.address].filter(Boolean).join(' · ')"
      >
        {{ [data.personalInfo.phone, data.personalInfo.email, data.personalInfo.portfolio, data.personalInfo.address].filter(Boolean).join(' · ') }}
      </p>
    </header>

    <!-- ============ MỤC TIÊU NGHỀ NGHIỆP ============ -->
    <section v-if="data.summary" class="flex flex-col gap-[3%] text-left">
      <h2
        class="font-sans uppercase tracking-[1px] font-bold leading-none"
        style="font-size: 5px;"
      >
        Mục tiêu nghề nghiệp
      </h2>
      <hr class="border-0 border-t-[1.5px] border-neutral-800 w-full" />
      <p
        class="leading-snug whitespace-pre-wrap"
        style="font-size: 5px;"
      >
        {{ data.summary }}
      </p>
    </section>

    <!-- ============ HỌC VẤN ============ -->
    <section v-if="data.educations.length" class="flex flex-col gap-[3%] text-left">
      <h2
        class="font-sans uppercase tracking-[1px] font-bold leading-none"
        style="font-size: 5px;"
      >
        Học vấn
      </h2>
      <hr class="border-0 border-t-[1.5px] border-neutral-800 w-full" />
      <ul class="flex flex-col gap-[4%]">
        <li
          v-for="(e, idx) in data.educations"
          :key="`e-${idx}`"
          class="leading-tight"
        >
          <p class="flex justify-between items-baseline gap-[3%] flex-wrap" style="font-size: 5px;">
            <strong>{{ trunc(e.school, 24) }}</strong>
            <span v-if="e.startYear || e.endYear" class="text-neutral-500" style="font-size: 4.5px;">
              {{ e.startYear || '' }} - {{ e.endYear || 'Nay' }}
            </span>
          </p>
          <p class="mt-[1px]" style="font-size: 5px;">
            <em>{{ trunc(e.major || '', 28) }}</em>{{ e.degree ? ' · ' + trunc(e.degree, 16) : '' }}
          </p>
        </li>
      </ul>
    </section>

    <!-- ============ KINH NGHIỆM LÀM VIỆC ============ -->
    <section v-if="data.experiences.length" class="flex flex-col gap-[3%] text-left">
      <h2
        class="font-sans uppercase tracking-[1px] font-bold leading-none"
        style="font-size: 5px;"
      >
        Kinh nghiệm làm việc
      </h2>
      <hr class="border-0 border-t-[1.5px] border-neutral-800 w-full" />
      <ul class="flex flex-col gap-[4%]">
        <li
          v-for="(x, idx) in data.experiences"
          :key="`x-${idx}`"
          class="leading-tight"
        >
          <p class="flex justify-between items-baseline gap-[3%] flex-wrap" style="font-size: 5px;">
            <strong>{{ trunc(x.company, 24) }}</strong>
            <span v-if="x.startDate || x.endDate" class="text-neutral-500" style="font-size: 4.5px;">
              {{ x.startDate || '' }} - {{ x.endDate || 'Nay' }}
            </span>
          </p>
          <p class="mt-[1px]" style="font-size: 5px;">
            <em>{{ trunc(x.position, 28) }}</em>
          </p>
        </li>
      </ul>
    </section>

    <!-- ============ KỸ NĂNG (table) ============ -->
    <section v-if="data.skills.length" class="flex flex-col gap-[3%] text-left">
      <h2
        class="font-sans uppercase tracking-[1px] font-bold leading-none"
        style="font-size: 5px;"
      >
        Kỹ năng
      </h2>
      <hr class="border-0 border-t-[1.5px] border-neutral-800 w-full" />
      <table class="w-full border-collapse" style="font-size: 5px;">
        <tbody>
          <tr
            v-for="(s, idx) in data.skills"
            :key="`s-${idx}`"
            class="border-b border-neutral-200"
          >
            <td class="align-top font-semibold" style="width: 38%; padding: 2px 4px;">{{ trunc(s.name, 14) }}</td>
            <td class="align-top text-neutral-500" style="padding: 2px 4px;">{{ skillDescription(s.name) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ============ HOẠT ĐỘNG ============ -->
    <section v-if="data.activities.length" class="flex flex-col gap-[3%] text-left">
      <h2
        class="font-sans uppercase tracking-[1px] font-bold leading-none"
        style="font-size: 5px;"
      >
        Hoạt động
      </h2>
      <hr class="border-0 border-t-[1.5px] border-neutral-800 w-full" />
      <ul class="flex flex-col gap-[4%]">
        <li
          v-for="(a, idx) in data.activities"
          :key="`a-${idx}`"
          class="leading-tight"
        >
          <p class="flex justify-between items-baseline gap-[3%] flex-wrap" style="font-size: 5px;">
            <strong>{{ trunc(a.name, 24) }}</strong>
            <span v-if="a.time" class="text-neutral-500" style="font-size: 4.5px;">{{ trunc(a.time, 14) }}</span>
          </p>
          <p v-if="a.role" class="mt-[1px]" style="font-size: 5px;">
            <em>{{ trunc(a.role, 28) }}</em>
          </p>
        </li>
      </ul>
    </section>
  </div>
</template>