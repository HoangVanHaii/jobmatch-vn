<script setup lang="ts">
/**
 * CompanyProfileView.vue — Chế độ XEM hồ sơ doanh nghiệp (Editorial Corporate).
 * Nhận profile và cờ thông báo lưu từ cha, phát sự kiện @edit khi bấm nút chỉnh sửa.
 */
import { computed } from 'vue';
import {
  Building2,
  Check,
  ExternalLink,
  Globe,
  Pencil,
} from 'lucide-vue-next';
import {
  getInitials,
  getSocialMeta,
  normalizeUrl,
  type CompanyProfile,
} from '@/utils/companyProfileUtils';

interface Props {
  profile: CompanyProfile;
  savedNotice: boolean;
}

const props = defineProps<Props>();

defineEmits<{
  (e: 'edit'): void;
}>();

/** Các ô thông tin doanh nghiệp ở chế độ xem (website hiển thị ở khối 03). */
const companyFacts = computed(() => [
  { label: 'Ngành nghề', value: props.profile.industry },
  { label: 'Quy mô', value: props.profile.size },
  { label: 'Tỉnh / Thành phố', value: props.profile.province },
]);

/** Chỉ các liên kết có URL hợp lệ (đủ điều kiện render ở chế độ xem). */
const visibleSocial = computed(() =>
  Object.entries(props.profile.social ?? {}).filter(([, url]) => normalizeUrl(url) !== ''),
);
</script>

<template>
  <main>
    <!-- Hero -->
    <section class="pt-10">
      <div class="mx-auto grid max-w-[1240px] grid-cols-1 items-start gap-7 px-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] lg:gap-16">
        <div class="c3-fade">
          <p class="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-600">Hồ sơ doanh nghiệp / 01</p>
          <h1
            tabindex="-1"
            class="c3-page-title m-0 max-w-[18ch] break-words text-[clamp(26px,3.2vw,38px)] font-bold leading-[1.2] tracking-[-0.01em] outline-none"
          >
            Nơi câu chuyện<br />
            <em class="not-italic text-blue-600">doanh nghiệp</em> bắt đầu.
          </h1>
          <p class="mt-3.5 max-w-[56ch] text-[14.5px] leading-[1.7] text-slate-500">
            Trang hồ sơ là bộ mặt của doanh nghiệp trên JobMatch VN — nơi giới thiệu
            thương hiệu, văn hóa và cơ hội làm việc đến với ứng viên trên khắp Việt Nam.
          </p>
        </div>

        <div class="c3-fade c3-d1 flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 transition-colors duration-200 hover:border-slate-300 motion-reduce:transition-none">
          <div class="flex items-center gap-3.5">
            <div class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              <img v-if="profile.logoUrl" :src="profile.logoUrl" alt="Logo công ty" class="h-full w-full object-cover" />
              <Building2 v-else-if="!getInitials(profile.name)" :size="22" class="text-slate-500" />
              <span v-else class="font-semibold text-slate-900">{{ getInitials(profile.name) }}</span>
            </div>
            <div>
              <h2 class="m-0 break-words text-xl font-semibold leading-normal">{{ profile.name }}</h2>
              <p class="mt-1.5 text-[13px] font-medium text-slate-900">{{ profile.industry }} · {{ profile.size }}</p>
              <p class="mt-0.5 text-[13px] text-slate-500">{{ profile.district }}, {{ profile.province }}</p>
            </div>
          </div>
          <button
            type="button"
            class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-transparent bg-[#5b4eea] px-5 py-[11px] text-[13px] font-semibold tracking-[0.04em] text-white transition-colors duration-150 hover:bg-blue-700 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-blue-600/40 motion-reduce:transition-none"
            @click="$emit('edit')"
          >
            <Pencil :size="15" />
            Chỉnh sửa hồ sơ
          </button>
        </div>
      </div>
    </section>

    <!-- Thông báo lưu thành công -->
    <div class="mx-auto max-w-[1240px] px-6">
      <transition name="notice">
        <p
          v-if="savedNotice"
          class="mt-5 inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-[18px] py-3 text-[13px] text-green-700"
          role="status"
        >
          <Check :size="15" />
          Đã lưu thay đổi.
        </p>
      </transition>
    </div>

    <!-- ======================= Nội dung biên tập ======================= -->
    <div class="mx-auto max-w-[1240px] px-6 pb-20 pt-14">
      <!-- 01 / Giới thiệu -->
      <section class="c3-fade c3-d2 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-12">
        <div class="flex items-baseline gap-3">
          <span class="text-xs font-semibold tracking-[0.08em] text-blue-600">01</span>
          <h2 class="m-0 text-[19px] font-semibold tracking-[-0.01em]">Giới thiệu</h2>
        </div>
        <div>
          <p class="m-0 max-w-[68ch] whitespace-pre-line break-words text-[15px] leading-[1.8]">{{ profile.description }}</p>
        </div>
      </section>

      <hr class="my-11 border-0 border-t border-slate-200" />

      <!-- 02 / Thông tin doanh nghiệp -->
      <section class="c3-fade c3-d3 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-12">
        <div class="flex items-baseline gap-3">
          <span class="text-xs font-semibold tracking-[0.08em] text-blue-600">02</span>
          <h2 class="m-0 text-[19px] font-semibold tracking-[-0.01em]">Thông tin doanh nghiệp</h2>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2">
          <div
            v-for="f in companyFacts"
            :key="f.label"
            class="flex flex-col gap-[5px] border-b border-slate-200 py-4 pr-5 last:border-b-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0"
          >
            <span class="text-[11px] uppercase tracking-[0.18em] text-slate-500">{{ f.label }}</span>
            <span class="break-words text-[15px] font-medium">{{ f.value }}</span>
          </div>
        </div>
      </section>

      <hr class="my-11 border-0 border-t border-slate-200" />

      <!-- 03 / Địa chỉ và liên hệ -->
      <section class="c3-fade c3-d3 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-12">
        <div class="flex items-baseline gap-3">
          <span class="text-xs font-semibold tracking-[0.08em] text-blue-600">03</span>
          <h2 class="m-0 text-[19px] font-semibold tracking-[-0.01em]">Địa chỉ và liên hệ</h2>
        </div>
        <div class="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <address class="flex flex-col gap-1 not-italic">
            <span class="text-[17px] font-medium text-slate-900">{{ profile.address }}</span>
            <span class="text-[15px] leading-[1.6] text-slate-500">{{ profile.district }}, {{ profile.province }}</span>
            <span class="text-[15px] leading-[1.6] text-slate-500">Việt Nam</span>
          </address>
          <a
            v-if="profile.website"
            class="inline-flex w-fit items-center gap-2 border-b border-blue-600 pb-0.5 text-sm text-slate-900 no-underline"
            :href="normalizeUrl(profile.website)"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Globe :size="15" />
            {{ profile.website }}
          </a>
        </div>
      </section>

      <!-- 04 / Mạng xã hội — chỉ hiển thị khi có dữ liệu hợp lệ (như CompanyView.vue) -->
      <template v-if="visibleSocial.length > 0">
        <hr class="my-11 border-0 border-t border-slate-200" />

        <section class="c3-fade c3-d3 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-12">
          <div class="flex items-baseline gap-3">
            <span class="text-xs font-semibold tracking-[0.08em] text-blue-600">04</span>
            <h2 class="m-0 text-[19px] font-semibold tracking-[-0.01em]">Mạng xã hội</h2>
          </div>
          <div>
            <ul class="m-0 list-none p-0 [&>li+li]:border-t [&>li+li]:border-slate-200">
              <li v-for="[key, url] in visibleSocial" :key="key">
                <a
                  class="group flex items-center gap-3 rounded-lg py-3 pr-3 no-underline transition-colors duration-150 hover:bg-slate-50 motion-reduce:transition-none"
                  :href="normalizeUrl(url)"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span class="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors duration-150 group-hover:border-slate-300 group-hover:text-blue-600">
                    <component :is="getSocialMeta(key).icon" :size="16" aria-hidden="true" />
                  </span>
                  <span class="flex min-w-0 flex-col gap-px">
                    <span class="text-sm font-medium text-slate-900">{{ getSocialMeta(key).label }}</span>
                    <span class="max-w-[420px] truncate text-[12.5px] text-slate-500">{{ url.replace(/^https?:\/\//, '') }}</span>
                  </span>
                  <ExternalLink :size="14" class="ml-auto shrink-0 text-slate-400 transition-colors duration-150 group-hover:text-blue-600" aria-hidden="true" />
                </a>
              </li>
            </ul>
          </div>
        </section>
      </template>
    </div>

    <footer class="border-t border-slate-200 py-6">
      <div class="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-2 px-6 text-xs text-slate-500">
        <span>jobmatch.vn</span>
        <span>Hồ sơ doanh nghiệp</span>
      </div>
    </footer>
  </main>
</template>

