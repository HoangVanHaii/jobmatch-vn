<script setup lang="ts">
/**
 * Template 2 — "Mustard Two-Column" (theo ảnh tham chiếu user cung cấp,
 * trang 2 của design, chuyển thành CV standalone).
 *
 * Cấu trúc (1 trang A4):
 *   1. Header mỏng: dải vàng chéo nhỏ + HỌ TÊN serif uppercase (ngang) +
 *      chức danh tracking rộng + block liên hệ ô vuông vàng bên phải.
 *   2. Body 2 cột 35/65 (divider dọc):
 *      - Trái: EDUCATION + SKILLS + ACTIVITIES.
 *      - Phải: WORK EXPERIENCE + CERTIFICATES (grid 2 cột kiểu "References")
 *        + INTERESTS (vòng tròn vàng + chữ cái đầu + nhãn).
 *
 * Cùng ngôn ngữ thiết kế với Template 1 (heading uppercase + gạch chân đoạn
 * vàng, accent #F2B72E) — khác ở phân bố section và header ngang gọn.
 *
 * Quy tắc render (convention chung): section rỗng → ẩn; render đầy đủ 100%;
 * description nhiều dòng → bullet list; data từ CvRenderData.
 */
import { computed } from 'vue';
import { Phone, Mail, MapPin } from 'lucide-vue-next';
import type { CvRenderData } from '@/types/cv';

const props = defineProps<{ data: CvRenderData }>();

/** Accent vàng mustard của design. */
const ACCENT = '#F2B72E';

/** Hiển thị khoảng thời gian — bỏ dấu — nếu 1 trong 2 vế có giá trị. */
const dateRange = (start: string | undefined, end: string | undefined): string => {
  const s = start ?? '';
  const e = end ?? '';
  if (!s && !e) return '';
  if (s && !e) return s;
  if (!s && e) return e;
  return `${s} — ${e}`;
};

/**
 * Tách description thành các dòng bullet — bỏ bullet marker cũ nếu user đã
 * tự gõ ("-", "•", "*"). >1 dòng → bullet list; 1 dòng → paragraph.
 */
const toLines = (text: string | undefined | null): string[] =>
  (text ?? '')
    .split('\n')
    .map((l) => l.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);

/** Contact rows cho header — chỉ hiện field có giá trị. */
const contacts = computed(() => {
  const p = props.data.personalInfo;
  return [
    { icon: Phone, text: p.phone },
    { icon: Mail, text: p.email },
    { icon: MapPin, text: p.address },
  ].filter((c) => c.text);
});
</script>

<template>
  <div class="w-full bg-white text-neutral-800 font-sans" style="line-height: 1.5;">
    <div class="max-w-[850px] mx-auto relative">
      <!-- ==================== DẢI VÀNG CHÉO GÓC TRÁI (nhỏ) ==================== -->
      <div
        class="absolute pointer-events-none"
        style="left: -120px; top: -120px; width: 200px; height: 200px; background: #F2B72E; transform: rotate(45deg);"
      />

      <!-- ==================== HEADER MỎNG ==================== -->
      <header class="relative flex items-center justify-between" style="padding: 34px 40px 18px 36px;">
        <div class="relative">
          <h1
            class="uppercase m-0"
            style="
              font-family: Georgia, 'Times New Roman', serif;
              font-size: 27px;
              font-weight: 700;
              letter-spacing: 2px;
              line-height: 1.15;
              color: #111827;
            "
          >
            {{ data.personalInfo.fullName || 'Họ và Tên' }}
          </h1>
          <p
            class="uppercase m-0"
            style="margin-top: 4px; font-size: 10px; font-weight: 600; letter-spacing: 4px; color: #6b7280;"
          >
            {{ data.personalInfo.position || 'Vị trí ứng tuyển' }}
          </p>
        </div>

        <!-- Block liên hệ -->
        <div class="flex flex-col items-start gap-1.5" style="max-width: 250px;">
          <div
            v-for="(c, i) in contacts"
            :key="i"
            class="flex items-center gap-2"
          >
            <span
              class="inline-flex items-center justify-center shrink-0 text-white"
              style="width: 20px; height: 20px; background: #F2B72E;"
            >
              <component :is="c.icon" :size="11" />
            </span>
            <span class="break-all" style="font-size: 10.5px; color: #374151;">{{ c.text }}</span>
          </div>
        </div>
      </header>

      <!-- ==================== BODY 2 CỘT 35/65 ==================== -->
      <div
        class="grid"
        style="grid-template-columns: 35% 65%; padding: 6px 40px 40px 36px;"
      >
        <!-- ============ CỘT TRÁI: EDUCATION + SKILLS + ACTIVITIES ============ -->
        <div style="padding-right: 22px;">
          <!-- EDUCATION -->
          <section v-if="data.educations.length" class="mb-6">
            <h2
              class="uppercase m-0 font-bold"
              style="font-size: 14px; letter-spacing: 2px; color: #111827;"
            >
              Education
            </h2>
            <div class="flex items-center" style="margin: 6px 0 12px;">
              <span :style="{ height: '3px', width: '24px', background: ACCENT }" />
              <span class="flex-1" style="height: 1px; background: #d1d5db;" />
            </div>
            <ul class="flex flex-col m-0 p-0 list-none" style="gap: 13px;">
              <li v-for="(e, i) in data.educations" :key="i">
                <p class="font-bold uppercase m-0" style="font-size: 11.5px; letter-spacing: 0.4px; color: #111827;">
                  {{ e.degree || e.major || e.school }}
                </p>
                <p class="m-0" style="margin-top: 2px; font-size: 10.5px; color: #6b7280;">
                  {{ e.school }}
                </p>
                <p
                  v-if="e.startYear || e.endYear"
                  class="m-0"
                  style="margin-top: 1px; font-size: 10px; color: #9ca3af;"
                >
                  {{ dateRange(e.startYear, e.endYear) }}
                </p>
              </li>
            </ul>
          </section>

          <!-- SKILLS -->
          <section v-if="data.skills.length" class="mb-6">
            <h2
              class="uppercase m-0 font-bold"
              style="font-size: 14px; letter-spacing: 2px; color: #111827;"
            >
              Skills
            </h2>
            <div class="flex items-center" style="margin: 6px 0 12px;">
              <span :style="{ height: '3px', width: '24px', background: ACCENT }" />
              <span class="flex-1" style="height: 1px; background: #d1d5db;" />
            </div>
            <ul class="flex flex-col m-0 p-0 list-none" style="gap: 4px;">
              <li
                v-for="(s, i) in data.skills"
                :key="i"
                class="flex gap-1.5"
                style="font-size: 11px; line-height: 1.6; color: #4b5563;"
              >
                <span style="color: #111827;">•</span>
                <span>{{ s.name }}</span>
              </li>
            </ul>
          </section>

          <!-- ACTIVITIES -->
          <section v-if="data.activities.length">
            <h2
              class="uppercase m-0 font-bold"
              style="font-size: 14px; letter-spacing: 2px; color: #111827;"
            >
              Activities
            </h2>
            <div class="flex items-center" style="margin: 6px 0 12px;">
              <span :style="{ height: '3px', width: '24px', background: ACCENT }" />
              <span class="flex-1" style="height: 1px; background: #d1d5db;" />
            </div>
            <ul class="flex flex-col m-0 p-0 list-none" style="gap: 12px;">
              <li v-for="(a, i) in data.activities" :key="i">
                <p class="font-bold uppercase m-0" style="font-size: 11.5px; letter-spacing: 0.4px; color: #111827;">
                  {{ a.name }}
                </p>
                <p v-if="a.role" class="m-0" style="margin-top: 1px; font-size: 10.5px; color: #6b7280;">
                  {{ a.role }}
                </p>
                <p v-if="a.time" class="m-0" style="margin-top: 1px; font-size: 10px; color: #9ca3af;">
                  {{ a.time }}
                </p>
                <p
                  v-if="a.description"
                  class="m-0 whitespace-pre-wrap"
                  style="margin-top: 4px; font-size: 10.5px; line-height: 1.6; color: #4b5563;"
                >
                  {{ a.description }}
                </p>
              </li>
            </ul>
          </section>
        </div>

        <!-- ============ CỘT PHẢI: EXPERIENCE + CERTIFICATES + INTERESTS ============ -->
        <div style="padding-left: 26px; border-left: 1px solid #e5e7eb;">
          <!-- WORK EXPERIENCE -->
          <section v-if="data.experiences.length" class="mb-6">
            <h2
              class="uppercase m-0 font-bold"
              style="font-size: 14px; letter-spacing: 2px; color: #111827;"
            >
              Work Experience
            </h2>
            <div class="flex items-center" style="margin: 6px 0 14px;">
              <span :style="{ height: '3px', width: '24px', background: ACCENT }" />
              <span class="flex-1" style="height: 1px; background: #d1d5db;" />
            </div>
            <ul class="flex flex-col m-0 p-0 list-none" style="gap: 15px;">
              <li v-for="(x, i) in data.experiences" :key="i">
                <p class="font-bold uppercase m-0" style="font-size: 12px; letter-spacing: 0.5px; color: #111827;">
                  {{ x.position }}
                </p>
                <div class="flex items-baseline justify-between gap-3" style="margin-top: 2px;">
                  <p class="m-0" style="font-size: 11px; color: #6b7280;">
                    {{ x.company }}
                  </p>
                  <p
                    v-if="x.startDate || x.endDate"
                    class="m-0 whitespace-nowrap shrink-0"
                    style="font-size: 10px; color: #9ca3af;"
                  >
                    {{ dateRange(x.startDate, x.endDate) }}
                  </p>
                </div>

                <template v-if="toLines(x.description).length > 1">
                  <ul class="flex flex-col m-0 p-0 list-none" style="margin-top: 6px; gap: 3px;">
                    <li
                      v-for="(line, j) in toLines(x.description)"
                      :key="j"
                      class="flex gap-1.5"
                      style="font-size: 11px; line-height: 1.6; color: #4b5563;"
                    >
                      <span style="color: #111827;">•</span>
                      <span>{{ line }}</span>
                    </li>
                  </ul>
                </template>
                <p
                  v-else-if="toLines(x.description).length === 1"
                  class="m-0"
                  style="margin-top: 6px; font-size: 11px; line-height: 1.6; color: #4b5563;"
                >
                  {{ toLines(x.description)[0] }}
                </p>
              </li>
            </ul>
          </section>

          <!-- CERTIFICATES — grid 2 cột kiểu "References" trong ảnh -->
          <section v-if="data.certificates.length" class="mb-6">
            <h2
              class="uppercase m-0 font-bold"
              style="font-size: 14px; letter-spacing: 2px; color: #111827;"
            >
              Certificates
            </h2>
            <div class="flex items-center" style="margin: 6px 0 14px;">
              <span :style="{ height: '3px', width: '24px', background: ACCENT }" />
              <span class="flex-1" style="height: 1px; background: #d1d5db;" />
            </div>
            <div class="grid grid-cols-2" style="gap: 12px 18px;">
              <div v-for="(c, i) in data.certificates" :key="i">
                <p class="font-bold uppercase m-0" style="font-size: 11px; letter-spacing: 0.4px; color: #111827;">
                  {{ c.name }}
                </p>
                <p v-if="c.issuer" class="m-0" style="margin-top: 1px; font-size: 10.5px; color: #6b7280;">
                  {{ c.issuer }}
                </p>
                <p v-if="c.date" class="m-0" style="margin-top: 1px; font-size: 10px; color: #9ca3af;">
                  {{ c.date }}
                </p>
              </div>
            </div>
          </section>

          <!-- INTERESTS — vòng tròn vàng + chữ cái đầu + nhãn -->
          <section v-if="data.interests.length">
            <h2
              class="uppercase m-0 font-bold"
              style="font-size: 14px; letter-spacing: 2px; color: #111827;"
            >
              Interest
            </h2>
            <div class="flex items-center" style="margin: 6px 0 14px;">
              <span :style="{ height: '3px', width: '24px', background: ACCENT }" />
              <span class="flex-1" style="height: 1px; background: #d1d5db;" />
            </div>
            <div class="flex flex-wrap" style="gap: 14px;">
              <div
                v-for="(it, i) in data.interests"
                :key="i"
                class="flex flex-col items-center"
                style="width: 64px; gap: 5px;"
              >
                <span
                  class="flex items-center justify-center rounded-full text-white"
                  style="
                    width: 42px;
                    height: 42px;
                    background: #F2B72E;
                    font-family: Georgia, 'Times New Roman', serif;
                    font-size: 17px;
                    font-weight: 700;
                  "
                >
                  {{ it.trim().charAt(0).toUpperCase() }}
                </span>
                <span class="text-center" style="font-size: 10px; line-height: 1.3; color: #4b5563;">
                  {{ it }}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
