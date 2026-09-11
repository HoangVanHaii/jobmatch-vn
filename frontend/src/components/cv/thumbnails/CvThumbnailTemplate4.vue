<script setup lang="ts">
/**
 * CvThumbnailTemplate4 — bản thu nhỏ của CVTemplate4 (navy top bar + light blue header).
 *
 * NGUYÊN TẮC QUAN TRỌNG: render ĐẦY ĐỦ 100% nội dung giống CVTemplate4.vue.
 *   - Cùng data (data: CvRenderData).
 *   - Cùng section: header (name/position/contact/avatar), Mục tiêu, Kỹ năng,
 *     Chứng chỉ, Sở thích (left), Trình độ học vấn, Kinh nghiệm làm việc,
 *     Hoạt động, Dự án (right).
 *   - Cùng field cho mỗi item (KHÔNG bỏ field nào).
 *   - Cùng thứ tự section.
 *   - Cùng cấu trúc DOM (top navy bar + light blue header + 2 cột 47/53).
 *   - Cùng màu navy #164D70, cùng heading pattern (text + line ngang).
 *
 * KHÔNG BAO GIỜ:
 *   - truncate text bằng `...` hoặc slice.
 *   - line-clamp / max-height / overflow-hidden để ẩn content.
 *   - bỏ section / bỏ field / bỏ bullet.
 *   - dùng `truncate` Tailwind class để cắt text.
 *
 * KHÁC BIỆT với CVTemplate4.vue:
 *   - Kích thước nhỏ hơn (font 2.5-5px, padding theo %) để fit container ~132×170.
 *   - Dùng % thay cho px để scale theo container (parent MyResumesView set
 *     width=132px + aspectRatio 850/1100 ≈ height 170px).
 *   - Bỏ Lucide icons trong heading (chỉ giữ text + line), avatar initial fallback
 *     nhỏ, border avatar 0.5px.
 */
import type { CvRenderData } from '@/types/cv';

defineProps<{ data: CvRenderData }>();

const initial = (name: string | undefined | null): string => {
  const trimmed = (name ?? '').trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
};
</script>

<template>
  <div
    class="w-full h-full bg-white text-neutral-900 font-sans flex flex-col overflow-hidden"
  >
    <!-- ==================== THANH NAVY MỎNG TRÊN CÙNG ==================== -->
    <div class="w-full shrink-0" style="height: 1%; background: #164D70;" />

    <!-- ==================== HEADER (light blue bg) ==================== -->
    <header
      class="w-full grid shrink-0 items-center gap-[6%]"
      style="
        grid-template-columns: 1fr 28%;
        padding: 4% 6%;
        background: #EEF6FB;
      "
    >
      <!-- LEFT: name + job title + line + contact -->
      <div class="min-w-0">
        <p
          class="font-bold uppercase leading-tight break-words"
          style="font-size: 5.5px; color: #164D70; letter-spacing: 0.3px;"
        >
          {{ data.personalInfo.fullName || 'HỌ VÀ TÊN' }}
        </p>
        <p
          class="font-bold uppercase mt-[1px] break-words"
          style="font-size: 3px; color: #164D70; letter-spacing: 0.5px;"
        >
          {{ data.personalInfo.position || 'Vị trí ứng tuyển' }}
        </p>

        <!-- Đường ngang navy ngắn dưới job title -->
        <div
          class="mt-[2px] mb-[3px]"
          style="height: 0.5px; width: 30%; background: #164D70;"
        />

        <!-- Contact 2 cột: phone | email -->
        <div
          v-if="data.personalInfo.phone || data.personalInfo.email"
          class="grid gap-x-[6%] gap-y-[1px]"
          style="grid-template-columns: 1fr 1fr; font-size: 2.5px;"
        >
          <div
            v-if="data.personalInfo.phone"
            class="flex items-center gap-[2px] text-neutral-700"
          >
            <span
              class="w-[1px] h-[1px] rounded-full shrink-0"
              style="background: #164D70;"
            />
            <span class="break-all">{{ data.personalInfo.phone }}</span>
          </div>
          <div
            v-if="data.personalInfo.email"
            class="flex items-center gap-[2px] text-neutral-700"
          >
            <span
              class="w-[1px] h-[1px] rounded-full shrink-0"
              style="background: #164D70;"
            />
            <span class="break-all">{{ data.personalInfo.email }}</span>
          </div>
        </div>
      </div>

      <!-- RIGHT: avatar tròn border navy -->
      <div class="flex justify-end">
        <div
          class="rounded-full bg-white shrink-0 overflow-hidden flex items-center justify-center"
          style="
            width: 100%;
            aspect-ratio: 1 / 1;
            border: 0.5px solid #164D70;
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
            style="font-size: 6px; color: #164D70;"
          >
            {{ initial(data.personalInfo.fullName) }}
          </span>
        </div>
      </div>
    </header>

    <!-- ==================== BODY 2 CỘT (47% / 53%) ==================== -->
    <div
      class="w-full grid flex-1 overflow-hidden"
      style="grid-template-columns: 47% 53%;"
    >
      <!-- ============ LEFT COLUMN (47%) ============ -->
      <aside
        class="flex flex-col gap-[4%] overflow-hidden"
        style="padding: 4% 4% 4% 6%;"
      >
        <!-- Mục tiêu nghề nghiệp -->
        <section v-if="data.summary">
          <h2 class="flex items-center gap-[2px] mb-[2px] leading-none">
            <span
              class="font-bold uppercase whitespace-nowrap"
              style="font-size: 3.5px; color: #164D70; letter-spacing: 0.3px;"
            >
              Mục tiêu nghề nghiệp
            </span>
            <span class="flex-1 h-[0.5px]" style="background: #164D70;" />
          </h2>
          <p
            class="text-neutral-800 whitespace-pre-wrap"
            style="font-size: 2.5px; line-height: 1.4;"
          >
            {{ data.summary }}
          </p>
        </section>

        <!-- Kỹ năng -->
        <section v-if="data.skills.length">
          <h2 class="flex items-center gap-[2px] mb-[2px] leading-none">
            <span
              class="font-bold uppercase whitespace-nowrap"
              style="font-size: 3.5px; color: #164D70; letter-spacing: 0.3px;"
            >
              Kỹ năng
            </span>
            <span class="flex-1 h-[0.5px]" style="background: #164D70;" />
          </h2>
          <ul class="flex flex-col gap-[1px]" style="font-size: 2.5px;">
            <li
              v-for="(s, i) in data.skills"
              :key="i"
              class="flex items-start gap-[2px] text-neutral-700"
            >
              <span
                class="mt-[2px] w-[1px] h-[1px] rounded-full shrink-0"
                style="background: #164D70;"
              />
              <span class="break-words">{{ s.name }}</span>
            </li>
          </ul>
        </section>

        <!-- Chứng chỉ -->
        <section v-if="data.certificates.length">
          <h2 class="flex items-center gap-[2px] mb-[2px] leading-none">
            <span
              class="font-bold uppercase whitespace-nowrap"
              style="font-size: 3.5px; color: #164D70; letter-spacing: 0.3px;"
            >
              Chứng chỉ
            </span>
            <span class="flex-1 h-[0.5px]" style="background: #164D70;" />
          </h2>
          <ul class="flex flex-col gap-[2px]" style="font-size: 2.5px;">
            <li
              v-for="(c, i) in data.certificates"
              :key="i"
              class="text-neutral-700 break-words"
            >
              <strong class="text-neutral-900">{{ c.name }}</strong>
              <span v-if="c.issuer"> — {{ c.issuer }}</span>
              <span
                v-if="c.date"
                class="text-neutral-500 italic ml-[2px]"
                style="font-size: 2px;"
              >{{ c.date }}</span>
            </li>
          </ul>
        </section>

        <!-- Sở thích -->
        <section v-if="data.interests && data.interests.length">
          <h2 class="flex items-center gap-[2px] mb-[2px] leading-none">
            <span
              class="font-bold uppercase whitespace-nowrap"
              style="font-size: 3.5px; color: #164D70; letter-spacing: 0.3px;"
            >
              Sở thích
            </span>
            <span class="flex-1 h-[0.5px]" style="background: #164D70;" />
          </h2>
          <ul class="flex flex-col gap-[1px]" style="font-size: 2.5px;">
            <li
              v-for="(it, i) in data.interests"
              :key="i"
              class="flex items-start gap-[2px] text-neutral-700"
            >
              <span
                class="mt-[2px] w-[1px] h-[1px] rounded-full shrink-0"
                style="background: #164D70;"
              />
              <span class="break-words">{{ it }}</span>
            </li>
          </ul>
        </section>
      </aside>

      <!-- ============ RIGHT COLUMN (53%) ============ -->
      <main
        class="flex flex-col gap-[4%] overflow-hidden"
        style="
          padding: 4% 6% 4% 4%;
          background: #FFFFFF;
          border-left: 0.5px solid #E5E7EB;
        "
      >
        <!-- Trình độ học vấn -->
        <section v-if="data.educations.length">
          <h2 class="flex items-center gap-[2px] mb-[2px] leading-none">
            <span
              class="font-bold uppercase whitespace-nowrap"
              style="font-size: 3.5px; color: #164D70; letter-spacing: 0.3px;"
            >
              Trình độ học vấn
            </span>
            <span class="flex-1 h-[0.5px]" style="background: #164D70;" />
          </h2>
          <ul class="flex flex-col gap-[3px]" style="font-size: 2.5px;">
            <li v-for="(e, i) in data.educations" :key="i">
              <div class="flex items-baseline justify-between gap-[2px] flex-wrap">
                <strong class="text-neutral-900 break-words">{{ e.school }}</strong>
                <span
                  v-if="e.startYear || e.endYear"
                  class="text-neutral-500 italic whitespace-nowrap"
                  style="font-size: 2px;"
                >
                  {{ e.startYear || '' }}<span v-if="e.startYear || e.endYear"> — </span>{{ e.endYear || 'Nay' }}
                </span>
              </div>
              <p
                v-if="e.major || e.degree"
                class="text-neutral-700 leading-tight mt-[1px] break-words"
              >
                <span v-if="e.major">Chuyên ngành: {{ e.major }}</span>
                <span v-if="e.major && e.degree"> — </span>
                <span v-if="e.degree">{{ e.degree }}</span>
              </p>
              <p
                v-if="e.description"
                class="text-neutral-700 whitespace-pre-wrap mt-[1px]"
                style="font-size: 2px; line-height: 1.35;"
              >
                {{ e.description }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Kinh nghiệm làm việc -->
        <section v-if="data.experiences.length">
          <h2 class="flex items-center gap-[2px] mb-[2px] leading-none">
            <span
              class="font-bold uppercase whitespace-nowrap"
              style="font-size: 3.5px; color: #164D70; letter-spacing: 0.3px;"
            >
              Kinh nghiệm làm việc
            </span>
            <span class="flex-1 h-[0.5px]" style="background: #164D70;" />
          </h2>
          <ul class="flex flex-col gap-[3px]" style="font-size: 2.5px;">
            <li v-for="(x, i) in data.experiences" :key="i">
              <div class="flex items-baseline justify-between gap-[2px] flex-wrap">
                <strong class="text-neutral-900 break-words">{{ x.company }}</strong>
                <span
                  v-if="x.startDate || x.endDate"
                  class="text-neutral-500 italic whitespace-nowrap"
                  style="font-size: 2px;"
                >
                  {{ x.startDate || '' }}<span v-if="x.startDate || x.endDate"> — </span>{{ x.endDate || 'Nay' }}
                </span>
              </div>
              <p class="text-neutral-700 font-medium leading-tight mt-[1px] break-words">
                {{ x.position }}
              </p>
              <p
                v-if="x.description"
                class="text-neutral-700 whitespace-pre-wrap mt-[1px]"
                style="font-size: 2px; line-height: 1.35;"
              >
                {{ x.description }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Hoạt động -->
        <section v-if="data.activities.length">
          <h2 class="flex items-center gap-[2px] mb-[2px] leading-none">
            <span
              class="font-bold uppercase whitespace-nowrap"
              style="font-size: 3.5px; color: #164D70; letter-spacing: 0.3px;"
            >
              Hoạt động
            </span>
            <span class="flex-1 h-[0.5px]" style="background: #164D70;" />
          </h2>
          <ul class="flex flex-col gap-[3px]" style="font-size: 2.5px;">
            <li v-for="(a, i) in data.activities" :key="i">
              <div class="flex items-baseline justify-between gap-[2px] flex-wrap">
                <strong class="text-neutral-900 break-words">{{ a.name }}</strong>
                <span
                  v-if="a.time"
                  class="text-neutral-500 italic whitespace-nowrap"
                  style="font-size: 2px;"
                >
                  {{ a.time }}
                </span>
              </div>
              <p
                v-if="a.role"
                class="text-neutral-700 leading-tight mt-[1px] break-words"
              >
                Vai trò: {{ a.role }}
              </p>
              <p
                v-if="a.description"
                class="text-neutral-700 whitespace-pre-wrap mt-[1px]"
                style="font-size: 2px; line-height: 1.35;"
              >
                {{ a.description }}
              </p>
            </li>
          </ul>
        </section>

        <!-- Dự án tham gia -->
        <section v-if="data.projects.length">
          <h2 class="flex items-center gap-[2px] mb-[2px] leading-none">
            <span
              class="font-bold uppercase whitespace-nowrap"
              style="font-size: 3.5px; color: #164D70; letter-spacing: 0.3px;"
            >
              Dự án tham gia
            </span>
            <span class="flex-1 h-[0.5px]" style="background: #164D70;" />
          </h2>
          <ul class="flex flex-col gap-[3px]" style="font-size: 2.5px;">
            <li v-for="(p, i) in data.projects" :key="i">
              <div class="flex items-baseline justify-between gap-[2px] flex-wrap">
                <strong class="text-neutral-900 break-words">{{ p.name }}</strong>
                <span
                  v-if="p.time"
                  class="text-neutral-500 italic whitespace-nowrap"
                  style="font-size: 2px;"
                >
                  {{ p.time }}
                </span>
              </div>
              <p
                v-if="p.role"
                class="text-neutral-700 leading-tight mt-[1px] break-words"
              >
                {{ p.role }}
              </p>
              <p
                v-if="p.description"
                class="text-neutral-700 whitespace-pre-wrap mt-[1px]"
                style="font-size: 2px; line-height: 1.35;"
              >
                {{ p.description }}
              </p>
              <p
                v-if="p.link"
                class="break-all mt-[1px]"
                style="font-size: 2px; color: #164D70;"
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
