<script setup lang="ts">
/**
 * Template 5 — minimalist editorial 1 cột, centered, sans-serif clean.
 * Top: avatar + tên + position + contact row inline.
 * Phần thân: section title IN HOA + horizontal rule + content.
 * Toàn bộ styling dùng Tailwind utility classes — không <style scoped>.
 */
import { computed } from 'vue';
import { Phone, Mail, MapPin, Globe } from 'lucide-vue-next';
import type { CvRenderData } from '@/types/cv';

const props = defineProps<{ data: CvRenderData }>();

/** Tính các dòng liên hệ để render inline (chỉ hiện các trường có giá trị). */
const contactRow = computed(() => {
  const pi = props.data.personalInfo;
  const rows: Array<{ icon: typeof Phone; value: string }> = [];
  if (pi.phone) rows.push({ icon: Phone, value: pi.phone });
  if (pi.email) rows.push({ icon: Mail, value: pi.email });
  if (pi.address) rows.push({ icon: MapPin, value: pi.address });
  if (pi.portfolio || pi.github || pi.linkedin) {
    rows.push({ icon: Globe, value: pi.portfolio || pi.github || pi.linkedin || '' });
  }
  return rows;
});
</script>

<template>
  <div class="w-full min-h-[1100px] bg-white text-neutral-800 font-sans text-[13px] leading-relaxed px-16 pt-12 pb-14">
    <!-- Header centered -->
    <header class="text-center mb-9">
      <div
        v-if="data.personalInfo.avatarUrl || data.personalInfo.fullName"
        class="w-24 h-24 rounded-full bg-neutral-100 mx-auto mb-4 overflow-hidden flex items-center justify-center"
      >
        <img
          v-if="data.personalInfo.avatarUrl"
          :src="data.personalInfo.avatarUrl"
          :alt="data.personalInfo.fullName"
          class="w-full h-full object-cover"
        />
        <span v-else class="text-[32px] font-semibold text-neutral-400">
          {{ (data.personalInfo.fullName || '?').charAt(0).toUpperCase() }}
        </span>
      </div>
      <h1 class="text-[34px] font-light tracking-[4px] m-0 uppercase text-neutral-900">
        {{ data.personalInfo.fullName || 'Họ và tên' }}
      </h1>
      <p class="text-[14px] mt-1.5 text-neutral-500 tracking-[2px] uppercase">
        {{ data.personalInfo.position || 'Vị trí ứng tuyển' }}
      </p>

      <!-- Contact row inline -->
      <ul v-if="contactRow.length" class="list-none p-0 mt-4 mx-auto flex flex-wrap justify-center gap-3.5 max-w-[600px] text-[12px] text-neutral-500">
        <li
          v-for="(c, i) in contactRow"
          :key="i"
          class="inline-flex items-center gap-1.5"
        >
          <component :is="c.icon" class="w-[13px] h-[13px] text-amber-700" />
          <span>{{ c.value }}</span>
        </li>
      </ul>
    </header>

    <!-- Body 1 cột -->
    <main>
      <section v-if="data.summary" class="mb-[26px]">
        <h2 class="text-[12px] font-semibold text-neutral-900 m-0 tracking-[4px] uppercase text-center">Giới thiệu</h2>
        <hr
          class="border-0 h-px m-2 mb-[18px]"
          style="background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%)"
        />
        <p class="text-[13.5px] text-center max-w-[620px] mx-auto text-neutral-600 whitespace-pre-wrap">{{ data.summary }}</p>
      </section>

      <section v-if="data.experiences.length" class="mb-[26px]">
        <h2 class="text-[12px] font-semibold text-neutral-900 m-0 tracking-[4px] uppercase text-center">Kinh nghiệm</h2>
        <hr
          class="border-0 h-px m-2 mb-[18px]"
          style="background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%)"
        />
        <article v-for="(x, i) in data.experiences" :key="i" class="mb-3.5">
          <header class="flex items-baseline justify-between gap-3 flex-wrap">
            <h3 class="text-[14px] font-semibold m-0 text-neutral-900">{{ x.position }}</h3>
            <span v-if="x.startDate || x.endDate" class="text-[11.5px] text-neutral-500 tracking-[1px] whitespace-nowrap">
              {{ x.startDate || '' }}<span v-if="x.startDate || x.endDate"> — </span>{{ x.endDate || 'Nay' }}
            </span>
          </header>
          <p v-if="x.company" class="text-[12.5px] mt-0.5 mb-0 text-amber-700 font-medium">{{ x.company }}</p>
          <p v-if="x.description" class="text-[12.5px] mt-1.5 text-neutral-600 whitespace-pre-wrap">{{ x.description }}</p>
        </article>
      </section>

      <section v-if="data.educations.length" class="mb-[26px]">
        <h2 class="text-[12px] font-semibold text-neutral-900 m-0 tracking-[4px] uppercase text-center">Học vấn</h2>
        <hr
          class="border-0 h-px m-2 mb-[18px]"
          style="background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%)"
        />
        <article v-for="(e, i) in data.educations" :key="i" class="mb-3.5">
          <header class="flex items-baseline justify-between gap-3 flex-wrap">
            <h3 class="text-[14px] font-semibold m-0 text-neutral-900">{{ e.school }}</h3>
            <span v-if="e.startYear || e.endYear" class="text-[11.5px] text-neutral-500 tracking-[1px] whitespace-nowrap">
              {{ e.startYear || '' }}<span v-if="e.startYear || e.endYear"> — </span>{{ e.endYear || 'Nay' }}
            </span>
          </header>
          <p v-if="e.major" class="text-[12.5px] mt-0.5 mb-0 text-amber-700 font-medium">Chuyên ngành: {{ e.major }}</p>
          <p v-if="e.description" class="text-[12.5px] mt-1.5 text-neutral-600 whitespace-pre-wrap">{{ e.description }}</p>
        </article>
      </section>

      <section v-if="data.skills.length" class="mb-[26px]">
        <h2 class="text-[12px] font-semibold text-neutral-900 m-0 tracking-[4px] uppercase text-center">Kỹ năng</h2>
        <hr
          class="border-0 h-px m-2 mb-[18px]"
          style="background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%)"
        />
        <ul class="list-none p-0 m-0 flex flex-wrap justify-center gap-2">
          <li
            v-for="(s, i) in data.skills"
            :key="i"
            class="text-[12px] px-3.5 py-1 bg-neutral-100 text-neutral-700 rounded-full border border-neutral-200"
          >
            {{ s.name }}
          </li>
        </ul>
      </section>

      <section v-if="data.projects.length" class="mb-[26px]">
        <h2 class="text-[12px] font-semibold text-neutral-900 m-0 tracking-[4px] uppercase text-center">Dự án</h2>
        <hr
          class="border-0 h-px m-2 mb-[18px]"
          style="background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%)"
        />
        <article v-for="(p, i) in data.projects" :key="i" class="mb-3.5">
          <header class="flex items-baseline justify-between gap-3 flex-wrap">
            <h3 class="text-[14px] font-semibold m-0 text-neutral-900">{{ p.name }}</h3>
            <span v-if="p.time" class="text-[11.5px] text-neutral-500 tracking-[1px]">{{ p.time }}</span>
          </header>
          <p v-if="p.role" class="text-[12.5px] mt-0.5 mb-0 text-amber-700 font-medium">Vai trò: {{ p.role }}</p>
          <p v-if="p.description" class="text-[12.5px] mt-1.5 text-neutral-600 whitespace-pre-wrap">{{ p.description }}</p>
          <p v-if="p.link" class="text-[12px] mt-1 text-neutral-500 break-all">{{ p.link }}</p>
        </article>
      </section>

      <section v-if="data.certificates.length" class="mb-[26px]">
        <h2 class="text-[12px] font-semibold text-neutral-900 m-0 tracking-[4px] uppercase text-center">Chứng chỉ</h2>
        <hr
          class="border-0 h-px m-2 mb-[18px]"
          style="background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%)"
        />
        <article v-for="(c, i) in data.certificates" :key="i" class="mb-3.5">
          <header class="flex items-baseline justify-between gap-3 flex-wrap">
            <h3 class="text-[14px] font-semibold m-0 text-neutral-900">{{ c.name }}</h3>
            <span v-if="c.date" class="text-[11.5px] text-neutral-500 tracking-[1px]">{{ c.date }}</span>
          </header>
          <p v-if="c.issuer" class="text-[12.5px] mt-0.5 mb-0 text-amber-700 font-medium">{{ c.issuer }}</p>
        </article>
      </section>

      <section v-if="data.activities.length" class="mb-[26px]">
        <h2 class="text-[12px] font-semibold text-neutral-900 m-0 tracking-[4px] uppercase text-center">Hoạt động</h2>
        <hr
          class="border-0 h-px m-2 mb-[18px]"
          style="background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%)"
        />
        <article v-for="(a, i) in data.activities" :key="i" class="mb-3.5">
          <header class="flex items-baseline justify-between gap-3 flex-wrap">
            <h3 class="text-[14px] font-semibold m-0 text-neutral-900">{{ a.name }}</h3>
            <span v-if="a.time" class="text-[11.5px] text-neutral-500 tracking-[1px]">{{ a.time }}</span>
          </header>
          <p v-if="a.role" class="text-[12.5px] mt-0.5 mb-0 text-amber-700 font-medium">Vai trò: {{ a.role }}</p>
          <p v-if="a.description" class="text-[12.5px] mt-1.5 text-neutral-600 whitespace-pre-wrap">{{ a.description }}</p>
        </article>
      </section>

      <section v-if="data.interests && data.interests.length" class="mb-[26px]">
        <h2 class="text-[12px] font-semibold text-neutral-900 m-0 tracking-[4px] uppercase text-center">Sở thích</h2>
        <hr
          class="border-0 h-px m-2 mb-[18px]"
          style="background: linear-gradient(90deg, transparent 0%, #ccc 50%, transparent 100%)"
        />
        <p class="text-[12.5px] text-center text-neutral-500 m-0">{{ data.interests.join(' · ') }}</p>
      </section>
    </main>
  </div>
</template>