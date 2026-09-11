<script setup lang="ts">
/**
 * CvThumbnailTemplate5 — bản thu nhỏ của CVTemplate5 (sidebar trái + main phải).
 *
 * NGUYÊN TẮC QUAN TRỌNG: render ĐẦY ĐỦ 100% nội dung giống CVTemplate5.vue.
 *   - Cùng data (data: CvRenderData).
 *   - Cùng section: sidebar (avatar/name/position/contact) + main
 *     (Mục tiêu, Trình độ học vấn, Kinh nghiệm, Dự án, Kỹ năng,
 *     Chứng chỉ, Hoạt động, Sở thích).
 *   - Cùng field cho mỗi item (KHÔNG bỏ field nào).
 *   - Cùng thứ tự section.
 *   - Cùng cấu trúc DOM (grid 33%/67% sidebar/main, decorations 2 góc).
 *   - Cùng màu navy #064C8A, cùng heading pattern (icon + text + line).
 *
 * KHÔNG BAO GIỜ:
 *   - truncate text bằng `...` hoặc slice.
 *   - line-clamp / max-height / overflow-hidden để ẩn content.
 *   - bỏ section / bỏ field / bỏ bullet.
 *   - dùng `truncate` Tailwind class để cắt text.
 *
 * KHÁC BIỆT với CVTemplate5.vue:
 *   - Kích thước nhỏ hơn (font 2-5px, padding theo %) để fit container ~132×170.
 *   - Dùng % thay cho px để scale theo container (parent MyResumesView set
 *     width=132px + aspectRatio 850/1100 ≈ height 170px).
 *   - Bỏ Lucide icons trong heading (chỉ giữ text + line), avatar initial fallback
 *     nhỏ, contact icon thay bằng bullet nhỏ, decorations thu nhỏ.
 */
import type { CvRenderData } from '@/types/cv';

defineProps<{ data: CvRenderData }>();

const initial = (name: string | undefined | null): string => {
  const trimmed = (name ?? '').trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
};

const descriptionBullets = (desc: string | undefined): string[] => {
  if (!desc) return [];
  return desc.split('\n').map((l) => l.trim()).filter(Boolean);
};
</script>

<template>
  <div
    class="w-full h-full bg-white text-neutral-900 font-sans grid overflow-hidden"
    style="grid-template-columns: 33% 67%;"
  >
    <!-- ==================== SIDEBAR TRÁI (~33%) ==================== -->
    <aside
      class="relative flex flex-col items-center gap-[3%] px-[8%] py-[6%] overflow-hidden"
      style="background: #EEF6FB;"
    >
      <!-- ============ DECORATION góc trên-trái ============ -->
      <div
        class="absolute top-0 left-0 z-0"
        style="
          width: 0;
          height: 0;
          border-top: 16% solid #064C8A;
          border-right: 16% solid transparent;
        "
      />
      <div
        class="absolute z-0"
        style="
          top: 0;
          left: 12%;
          width: 0;
          height: 0;
          border-top: 11% solid #0057A8;
          border-right: 11% solid transparent;
        "
      />

      <!-- ============ DECORATION góc dưới-trái ============ -->
      <div
        class="absolute bottom-0 left-0 z-0"
        style="
          width: 0;
          height: 0;
          border-bottom: 24% solid #064C8A;
          border-right: 24% solid transparent;
        "
      />
      <div
        class="absolute z-0"
        style="
          bottom: 0;
          left: 18%;
          width: 0;
          height: 0;
          border-bottom: 16% solid #0057A8;
          border-right: 16% solid transparent;
        "
      />

      <!-- ============ AVATAR tròn ============ -->
      <div
        class="relative z-[1] rounded-full bg-white shrink-0 overflow-hidden flex items-center justify-center"
        style="
          width: 30%;
          aspect-ratio: 1 / 1;
          border: 0.5px solid #064C8A;
          margin-top: 6%;
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
          style="font-size: 9px; color: #064C8A;"
        >
          {{ initial(data.personalInfo.fullName) }}
        </span>
      </div>

      <!-- ============ HỌ TÊN ============ -->
      <p
        class="relative z-[1] text-center font-bold uppercase leading-tight break-words"
        style="font-size: 4.5px; color: #064C8A; letter-spacing: 0.3px;"
      >
        {{ data.personalInfo.fullName || 'HỌ VÀ TÊN' }}
      </p>

      <!-- ============ JOB TITLE — label xanh ============ -->
      <div
        v-if="data.personalInfo.position"
        class="relative z-[1]"
      >
        <div
          class="font-bold uppercase text-center text-white"
          style="
            background: #0057A8;
            padding: 1.5px 4px;
            font-size: 2.8px;
            letter-spacing: 0.2px;
          "
        >
          {{ data.personalInfo.position }}
        </div>
      </div>

      <!-- ============ CONTACT LIST ============ -->
      <div class="relative z-[1] w-full flex flex-col gap-[3%] mt-[4%]">
        <!-- Họ và tên -->
        <div
          v-if="data.personalInfo.fullName"
          class="flex items-start gap-[4%]"
        >
          <span
            class="rounded-full shrink-0 flex items-center justify-center"
            style="
              width: 4px;
              height: 4px;
              background: #0057A8;
            "
          />
          <div class="flex-1 min-w-0 leading-tight">
            <p class="text-neutral-500" style="font-size: 1.8px;">Họ và tên</p>
            <p
              class="font-semibold text-neutral-900 mt-[0.5px] break-words"
              style="font-size: 2.2px;"
            >
              {{ data.personalInfo.fullName }}
            </p>
          </div>
        </div>

        <!-- Ngày sinh (DB không lưu — render nếu data có) -->
        <div
          v-if="data.personalInfo.dob"
          class="flex items-start gap-[4%]"
        >
          <span
            class="rounded-full shrink-0 flex items-center justify-center"
            style="
              width: 4px;
              height: 4px;
              background: #0057A8;
            "
          />
          <div class="flex-1 min-w-0 leading-tight">
            <p class="text-neutral-500" style="font-size: 1.8px;">Ngày sinh</p>
            <p
              class="font-semibold text-neutral-900 mt-[0.5px] break-words"
              style="font-size: 2.2px;"
            >
              {{ data.personalInfo.dob }}
            </p>
          </div>
        </div>

        <!-- Điện thoại -->
        <div
          v-if="data.personalInfo.phone"
          class="flex items-start gap-[4%]"
        >
          <span
            class="rounded-full shrink-0 flex items-center justify-center"
            style="
              width: 4px;
              height: 4px;
              background: #0057A8;
            "
          />
          <div class="flex-1 min-w-0 leading-tight">
            <p class="text-neutral-500" style="font-size: 1.8px;">Điện thoại</p>
            <p
              class="font-semibold text-neutral-900 mt-[0.5px] break-all"
              style="font-size: 2.2px;"
            >
              {{ data.personalInfo.phone }}
            </p>
          </div>
        </div>

        <!-- Email -->
        <div
          v-if="data.personalInfo.email"
          class="flex items-start gap-[4%]"
        >
          <span
            class="rounded-full shrink-0 flex items-center justify-center"
            style="
              width: 4px;
              height: 4px;
              background: #0057A8;
            "
          />
          <div class="flex-1 min-w-0 leading-tight">
            <p class="text-neutral-500" style="font-size: 1.8px;">Email</p>
            <p
              class="font-semibold text-neutral-900 mt-[0.5px] break-all"
              style="font-size: 2.2px;"
            >
              {{ data.personalInfo.email }}
            </p>
          </div>
        </div>

        <!-- Địa chỉ -->
        <div
          v-if="data.personalInfo.address"
          class="flex items-start gap-[4%]"
        >
          <span
            class="rounded-full shrink-0 flex items-center justify-center"
            style="
              width: 4px;
              height: 4px;
              background: #0057A8;
            "
          />
          <div class="flex-1 min-w-0 leading-tight">
            <p class="text-neutral-500" style="font-size: 1.8px;">Địa chỉ</p>
            <p
              class="font-semibold text-neutral-900 mt-[0.5px] break-words"
              style="font-size: 2.2px;"
            >
              {{ data.personalInfo.address }}
            </p>
          </div>
        </div>
      </div>
    </aside>

    <!-- ==================== MAIN PHẢI (~67%) ==================== -->
    <main
      class="flex flex-col gap-[4%] overflow-hidden"
      style="padding: 5% 6%; background: #FFFFFF;"
    >
      <!-- Mục tiêu nghề nghiệp -->
      <section v-if="data.summary">
        <h2 class="flex items-center gap-[2px] mb-[3px] leading-none">
          <span
            class="font-bold uppercase whitespace-nowrap"
            style="font-size: 3.8px; color: #064C8A; letter-spacing: 0.3px;"
          >
            Mục tiêu nghề nghiệp
          </span>
          <span class="flex-1 h-[0.5px]" style="background: #064C8A;" />
        </h2>
        <p
          class="text-neutral-800 whitespace-pre-wrap"
          style="font-size: 2.3px; line-height: 1.4;"
        >
          {{ data.summary }}
        </p>
      </section>

      <!-- Trình độ học vấn -->
      <section v-if="data.educations.length">
        <h2 class="flex items-center gap-[2px] mb-[3px] leading-none">
          <span
            class="font-bold uppercase whitespace-nowrap"
            style="font-size: 3.8px; color: #064C8A; letter-spacing: 0.3px;"
          >
            Trình độ học vấn
          </span>
          <span class="flex-1 h-[0.5px]" style="background: #064C8A;" />
        </h2>
        <ul class="flex flex-col gap-[4px]" style="font-size: 2.3px;">
          <li v-for="(e, i) in data.educations" :key="i">
            <div class="flex items-baseline justify-between gap-[2px] flex-wrap">
              <strong class="text-neutral-900 break-words">{{ e.school }}</strong>
              <span
                v-if="e.startYear || e.endYear"
                class="text-neutral-500 italic whitespace-nowrap"
                style="font-size: 1.8px;"
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
        <h2 class="flex items-center gap-[2px] mb-[3px] leading-none">
          <span
            class="font-bold uppercase whitespace-nowrap"
            style="font-size: 3.8px; color: #064C8A; letter-spacing: 0.3px;"
          >
            Kinh nghiệm làm việc
          </span>
          <span class="flex-1 h-[0.5px]" style="background: #064C8A;" />
        </h2>
        <ul class="flex flex-col gap-[4px]" style="font-size: 2.3px;">
          <li v-for="(x, i) in data.experiences" :key="i">
            <div class="flex items-baseline justify-between gap-[2px] flex-wrap">
              <strong class="text-neutral-900 break-words">{{ x.company }}</strong>
              <span
                v-if="x.startDate || x.endDate"
                class="text-neutral-500 italic whitespace-nowrap"
                style="font-size: 1.8px;"
              >
                {{ x.startDate || '' }}<span v-if="x.startDate || x.endDate"> — </span>{{ x.endDate || 'Nay' }}
              </span>
            </div>
            <p class="font-medium text-neutral-700 leading-tight mt-[1px] break-words">
              {{ x.position }}
            </p>
            <ul
              v-if="x.description"
              class="flex flex-col gap-[1px] mt-[1px]"
              style="font-size: 2px; line-height: 1.35;"
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

      <!-- Dự án tham gia -->
      <section v-if="data.projects.length">
        <h2 class="flex items-center gap-[2px] mb-[3px] leading-none">
          <span
            class="font-bold uppercase whitespace-nowrap"
            style="font-size: 3.8px; color: #064C8A; letter-spacing: 0.3px;"
          >
            Dự án tham gia
          </span>
          <span class="flex-1 h-[0.5px]" style="background: #064C8A;" />
        </h2>
        <ul class="flex flex-col gap-[4px]" style="font-size: 2.3px;">
          <li v-for="(p, i) in data.projects" :key="i">
            <div class="flex items-baseline justify-between gap-[2px] flex-wrap">
              <strong class="text-neutral-900 break-words">{{ p.name }}</strong>
              <span
                v-if="p.time"
                class="text-neutral-500 italic whitespace-nowrap"
                style="font-size: 1.8px;"
              >
                {{ p.time }}
              </span>
            </div>
            <p
              v-if="p.role"
              class="font-medium text-neutral-700 leading-tight mt-[1px] break-words"
            >
              {{ p.role }}
            </p>
            <ul
              v-if="p.description"
              class="flex flex-col gap-[1px] mt-[1px]"
              style="font-size: 2px; line-height: 1.35;"
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
              class="break-all mt-[1px]"
              style="font-size: 1.8px; color: #064C8A;"
            >
              {{ p.link }}
            </p>
          </li>
        </ul>
      </section>

      <!-- Kỹ năng chuyên môn -->
      <section v-if="data.skills.length">
        <h2 class="flex items-center gap-[2px] mb-[3px] leading-none">
          <span
            class="font-bold uppercase whitespace-nowrap"
            style="font-size: 3.8px; color: #064C8A; letter-spacing: 0.3px;"
          >
            Kỹ năng chuyên môn
          </span>
          <span class="flex-1 h-[0.5px]" style="background: #064C8A;" />
        </h2>
        <div class="grid grid-cols-2 gap-x-[4%] gap-y-[2px]" style="font-size: 2.3px;">
          <div
            v-for="(s, i) in data.skills"
            :key="i"
            class="flex items-start gap-[2px]"
          >
            <span
              class="mt-[1px] w-[2px] h-[2px] rounded-full shrink-0 flex items-center justify-center"
              style="background: #0057A8;"
            >
              <span
                class="text-white font-bold leading-none"
                style="font-size: 1.2px;"
              >✓</span>
            </span>
            <span class="text-neutral-700 break-words">{{ s.name }}</span>
          </div>
        </div>
      </section>

      <!-- Chứng chỉ -->
      <section v-if="data.certificates.length">
        <h2 class="flex items-center gap-[2px] mb-[3px] leading-none">
          <span
            class="font-bold uppercase whitespace-nowrap"
            style="font-size: 3.8px; color: #064C8A; letter-spacing: 0.3px;"
          >
            Chứng chỉ
          </span>
          <span class="flex-1 h-[0.5px]" style="background: #064C8A;" />
        </h2>
        <ul class="flex flex-col gap-[2px]" style="font-size: 2.3px;">
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
              style="font-size: 1.8px;"
            >{{ c.date }}</span>
          </li>
        </ul>
      </section>

      <!-- Hoạt động -->
      <section v-if="data.activities.length">
        <h2 class="flex items-center gap-[2px] mb-[3px] leading-none">
          <span
            class="font-bold uppercase whitespace-nowrap"
            style="font-size: 3.8px; color: #064C8A; letter-spacing: 0.3px;"
          >
            Hoạt động
          </span>
          <span class="flex-1 h-[0.5px]" style="background: #064C8A;" />
        </h2>
        <ul class="flex flex-col gap-[4px]" style="font-size: 2.3px;">
          <li v-for="(a, i) in data.activities" :key="i">
            <div class="flex items-baseline justify-between gap-[2px] flex-wrap">
              <strong class="text-neutral-900 break-words">{{ a.name }}</strong>
              <span
                v-if="a.time"
                class="text-neutral-500 italic whitespace-nowrap"
                style="font-size: 1.8px;"
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

      <!-- Sở thích -->
      <section v-if="data.interests && data.interests.length">
        <h2 class="flex items-center gap-[2px] mb-[3px] leading-none">
          <span
            class="font-bold uppercase whitespace-nowrap"
            style="font-size: 3.8px; color: #064C8A; letter-spacing: 0.3px;"
          >
            Sở thích
          </span>
          <span class="flex-1 h-[0.5px]" style="background: #064C8A;" />
        </h2>
        <ul class="flex flex-col gap-[1px]" style="font-size: 2.3px;">
          <li
            v-for="(it, i) in data.interests"
            :key="i"
            class="flex items-start gap-[2px] text-neutral-700"
          >
            <span
              class="mt-[1px] w-[1px] h-[1px] rounded-full shrink-0"
              style="background: #064C8A;"
            />
            <span class="break-words">{{ it }}</span>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>
