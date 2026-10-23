<script setup lang="ts">
/**
 * CompanyProfileForm.vue — Chế độ CHỈNH SỬA hồ sơ doanh nghiệp (Editorial Corporate).
 * Quản lý form nhập liệu, validate, tải ảnh logo tạm thời, và điều hướng section sticky.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  Building2,
  Check,
  ChevronRight,
  Plus,
  Trash2,
} from 'lucide-vue-next';
import CompanySelect, { type CompanySelectOption } from '@/views/employer/CompanySelect.vue';
import { useCompanySectionNav } from '@/composables/useCompanySectionNav';
import { useLocations } from '@/composables/useLocations';
import {
  cloneProfile,
  getInitials,
  getSocialMeta,
  isValidUrl,
  nextKvId,
  normalizeUrl,
  rowsToSocial,
  socialToRows,
  type CompanyProfile,
  type KvRow,
} from '@/utils/companyProfileUtils';

interface Props {
  profile: CompanyProfile;
  saving: boolean;
  serverErrors: Record<string, string>;
  saveError: string | null;
  /** 'create' khi tạo hồ sơ lần đầu (chưa có công ty), 'edit' khi sửa hồ sơ có sẵn. */
  mode?: 'create' | 'edit';
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'edit',
});

const isCreating = computed(() => props.mode === 'create');

const emit = defineEmits<{
  (e: 'save', profile: CompanyProfile, logoFile: File | null): void;
  (e: 'cancel'): void;
}>();

/* Quy mô: mock tĩnh (chỉnh sửa lẫn tạo đều dùng chung) */
const SIZES = ['1–10 nhân viên', '11–50 nhân viên', '51–200 nhân viên', '201–500 nhân viên', '500+ nhân viên'];
const DESC_LIMIT = 5000;

/* Bản nháp khi chỉnh sửa / tạo mới */
const draft = ref<CompanyProfile>(cloneProfile(props.profile));

/* Danh mục địa giới thật — useLocations (63 tỉnh / 696 quận, tự fallback API ngoài).
 * Province option value = shortName ("Hà Nội") khớp dữ liệu BE (address.city);
 * district option value = tên đầy đủ ("Quận Ba Đình"). */
const locations = useLocations();
onMounted(() => {
  void locations.fetch();
});

/** Danh sách tỉnh; giá trị hiện tại nằm ngoài danh mục được giữ lại làm option đầu
 *  để không bị âm thầm ghi đè thành rỗng khi lưu. */
const provinceOptions = computed<CompanySelectOption[]>(() => {
  const list: CompanySelectOption[] = locations.items.value.map((p) => ({ value: p.shortName, label: p.name }));
  const cur = draft.value.province;
  if (cur && !list.some((o) => o.value === cur)) list.unshift({ value: cur, label: cur });
  return list;
});

/** Districts của province đang chọn (lookup theo shortName → code). */
const districtOptions = computed<CompanySelectOption[]>(() => {
  const code = locations.findProvinceByName(draft.value.province)?.code ?? null;
  const list: CompanySelectOption[] =
    code !== null ? locations.getDistricts(code).map((d) => ({ value: d.name, label: d.name })) : [];
  const cur = draft.value.district;
  if (cur && !list.some((o) => o.value === cur)) list.unshift({ value: cur, label: cur });
  return list;
});

/** Đổi tỉnh → quận cũ có thể không thuộc tỉnh mới → reset về placeholder. */
function onDraftProvinceChange(): void {
  draft.value.district = '';
}

/* Lỗi validate form (key: tên lỗi, value: thông điệp hiển thị) */
const errors = ref<Record<string, string>>({});
const dismissedServerErrors = ref<string[]>([]);
const displayedErrors = computed<Record<string, string>>(() => {
  const server = Object.fromEntries(
    Object.entries(props.serverErrors).filter(([field]) => !dismissedServerErrors.value.includes(field)),
  );
  return { ...server, ...errors.value };
});

function clearFieldError(field: string): void {
  errors.value[field] = '';
  if (!dismissedServerErrors.value.includes(field)) dismissedServerErrors.value.push(field);
}

/* Logo preview object URL */
let logoObjectUrl: string | null = null;
let logoFile: File | null = null;
const logoError = ref<string | null>(null);
const logoPreview = ref<string | null>(props.profile.logoUrl);

function revokeLocalBlob(): void {
  if (logoObjectUrl && logoObjectUrl.startsWith('blob:') && logoObjectUrl !== props.profile.logoUrl) {
    URL.revokeObjectURL(logoObjectUrl);
    logoObjectUrl = null;
  }
}

function onLogoChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    logoError.value = 'Tệp phải là ảnh (PNG, JPG, SVG…).';
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    logoError.value = 'Ảnh tối đa 2MB.';
    return;
  }
  logoError.value = null;
  revokeLocalBlob();
  logoObjectUrl = URL.createObjectURL(file);
  logoFile = file;
  logoPreview.value = logoObjectUrl;
}

/** Hàng nhập liệu mạng xã hội trong form chỉnh sửa. */
const socialRows = ref<KvRow[]>(socialToRows(props.profile.social));

function addSocialRow(): void {
  socialRows.value.push({ id: nextKvId(), key: '', value: '' });
}

function removeSocialRow(idx: number): void {
  socialRows.value.splice(idx, 1);
}

const descCount = computed(() => draft.value.description.length);

/** Trang đang có thay đổi chưa lưu hay không (so draft/socialRows/logo với props.profile). */
const isDirty = computed(() => {
  const d = draft.value;
  const p = props.profile;
  if (logoPreview.value !== p.logoUrl) return true;
  if (d.name.trim() !== p.name) return true;
  if (d.industry.trim() !== p.industry) return true;
  if ((d.website.trim() ? normalizeUrl(d.website.trim()) : '') !== p.website) return true;
  if (d.province !== p.province || d.district !== p.district) return true;
  if (d.address.trim() !== p.address) return true;
  if (d.description.trim() !== p.description) return true;
  return JSON.stringify(rowsToSocial(socialRows.value)) !== JSON.stringify(p.social);
});

/** Validate form; trả về true nếu hợp lệ (errors đã được đổ thông điệp). */
function validateForm(): boolean {
  errors.value = {};
  if (!draft.value.name.trim()) {
    errors.value.name = 'Vui lòng nhập tên doanh nghiệp';
  } else if (draft.value.name.trim().length < 2) {
    // backend bắt buộc name trim min 2 ký tự (createCompanySchema)
    errors.value.name = 'Tên doanh nghiệp tối thiểu 2 ký tự';
  }
  const website = draft.value.website.trim();
  if (website && !isValidUrl(website)) {
    errors.value.website = 'Đường dẫn không hợp lệ';
  }
  const seen = new Map<string, number>();
  for (const r of socialRows.value) {
    const key = r.key.trim().toLowerCase();
    if (!key) continue;
    const url = r.value.trim();
    if (url && !isValidUrl(url)) {
      errors.value[`social-url-${r.id}`] = 'Đường dẫn không hợp lệ';
    }
    if (seen.has(key)) {
      errors.value[`social-key-${r.id}`] = 'Liên kết bị trùng loại';
    } else {
      seen.set(key, r.id);
    }
  }
  return Object.keys(errors.value).length === 0;
}

function focusIn(secId: string, inputId: string): void {
  rootEl.value?.querySelector<HTMLElement>(`#${secId}`)?.scrollIntoView({ behavior: 'auto', block: 'start' });
  rootEl.value?.querySelector<HTMLElement>(`#${inputId}`)?.focus({ preventScroll: true });
}

/** Cuộn tới section chứa lỗi đầu tiên và focus ô tương ứng. */
function focusFirstError(): void {
  if (displayedErrors.value.name) {
    focusIn('sec-brand', 'f-name');
    return;
  }
  if (displayedErrors.value.website) {
    focusIn('sec-general', 'f-website');
    return;
  }
  const socialErr = Object.keys(displayedErrors.value).find((k) => k.startsWith('social-'));
  if (socialErr) {
    focusIn('sec-social', socialErr);
  }
}

watch(
  () => props.serverErrors,
  async (serverErrors) => {
    dismissedServerErrors.value = [];
    if (Object.keys(serverErrors).length > 0) {
      await nextTick();
      focusFirstError();
    }
  },
);

function saveEdit(): void {
  if (props.saving) return;
  if (!validateForm()) {
    focusFirstError();
    return;
  }
  const website = draft.value.website.trim();
  const updatedProfile: CompanyProfile = {
    ...cloneProfile(draft.value),
    name: draft.value.name.trim(),
    industry: draft.value.industry.trim(),
    website: website ? normalizeUrl(website) : '',
    address: draft.value.address.trim(),
    description: draft.value.description.trim(),
    logoUrl: logoPreview.value,
    social: rowsToSocial(socialRows.value),
  };
  emit('save', updatedProfile, logoFile);
}

function cancelEdit(): void {
  revokeLocalBlob();
  emit('cancel');
}

/** Hủy có xác nhận nếu đang có thay đổi chưa lưu. */
function requestCancel(): void {
  if (props.saving) return;
  if (isDirty.value && !window.confirm('Bạn có thay đổi chưa lưu. Hủy bỏ các thay đổi?')) return;
  cancelEdit();
}

/* Điều hướng section và scroll-spy */
const rootEl = ref<HTMLElement | null>(null);
const editHeaderEl = ref<HTMLElement | null>(null);

const { editSections, activeSection, isStuck, scrollToSection } = useCompanySectionNav(
  rootEl,
  editHeaderEl,
);

onBeforeUnmount(() => {
  revokeLocalBlob();
});
</script>

<template>
  <main ref="rootEl" class="mx-auto max-w-[1240px] px-6 pb-24 [--c3-header-h:0px]">
    <!-- Header chỉnh sửa: chỉ sticky từ lg (dưới lg tĩnh, pt-6 nhẹ); pt-12 (48px)
         là tổng khoảng cách tự nhiên cũ (pt-8 của main + pt-4) để vị trí tự nhiên
         trùng vị trí pinned — header không dịch chuyển khi cuộn. -->
    <header
      ref="editHeaderEl"
      class="c3-fade c3-d1 z-10 -mx-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b bg-white px-6 pb-4 pt-6 transition-colors duration-200 lg:sticky lg:top-0 lg:pt-12 motion-reduce:transition-none"
      :class="isStuck ? 'border-slate-200' : 'border-transparent'"
    >
      <div class="min-w-0">
        <p class="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-600">Hồ sơ doanh nghiệp / {{ isCreating ? 'Tạo mới' : 'Chỉnh sửa' }}</p>
        <h1
          tabindex="-1"
          class="c3-page-title m-0 text-[clamp(22px,2.6vw,30px)] font-bold leading-[1.2] tracking-[-0.01em] outline-none"
        >{{ isCreating ? 'Tạo hồ sơ doanh nghiệp' : 'Chỉnh sửa hồ sơ doanh nghiệp' }}</h1>
        <p class="mt-2.5 max-w-[60ch] text-[13.5px] text-slate-500">
          Thông tin sẽ hiển thị trên trang tuyển dụng của bạn.
        </p>
      </div>

      <button
        type="button"
        class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 self-start rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[13px] text-slate-600 transition-colors duration-150 hover:border-slate-300 hover:text-slate-900 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-blue-600/40 motion-reduce:transition-none max-sm:w-full max-sm:justify-center"
        @click="requestCancel"
        :disabled="saving"
      >
        <ChevronRight :size="15" class="rotate-180" aria-hidden="true" />
        {{ isCreating ? 'Quay lại' : 'Quay lại hồ sơ (hủy thay đổi)' }}
      </button>
    </header>

    <div class="mt-9 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,9fr)] lg:gap-14">
      <!-- Cột trái: mục lục + preview -->
      <aside class="c3-fade c3-d2" aria-label="Mục lục biểu mẫu">
        <div class="lg:sticky lg:top-[calc(var(--c3-header-h,0px)+36px)] lg:max-h-[calc(100svh-var(--c3-header-h,0px)-52px)] lg:overflow-y-auto">
          <div class="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 transition-colors duration-200 hover:border-slate-300 motion-reduce:transition-none">
            <div class="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              <img v-if="logoPreview" :src="logoPreview" alt="Xem trước logo" class="h-full w-full object-cover" />
              <span v-else-if="getInitials(draft.name)" class="text-[17px] font-semibold text-slate-900">{{ getInitials(draft.name) }}</span>
              <Building2 v-else :size="18" class="text-slate-500" />
            </div>
            <div class="min-w-0">
              <p class="m-0 break-words text-base font-semibold leading-normal">{{ draft.name || 'Chưa có tên' }}</p>
              <p class="mt-[3px] text-xs text-slate-500">{{ draft.industry }} · {{ draft.size }}</p>
            </div>
          </div>
          <nav aria-label="Các mục của biểu mẫu">
            <ol class="m-0 mt-2 list-none max-lg:flex max-lg:gap-1 max-lg:overflow-x-auto p-1.5">
              <li v-for="(s, i) in editSections" :key="s.id" class="mt-0.5 first:mt-0 max-lg:mt-0 max-lg:shrink-0">
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 px-3 py-2.5 text-left text-[13px] font-medium leading-5 transition-colors duration-150 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-blue-600/40 motion-reduce:transition-none max-lg:whitespace-nowrap"
                  :class="activeSection === s.id
                    ? 'bg-blue-50 text-blue-600'
                    : 'bg-transparent text-slate-500 hover:text-blue-600'"
                  :aria-current="activeSection === s.id ? 'location' : undefined"
                  :title="s.label"
                  @click="scrollToSection(s.id)"
                >
                  <span class="w-[22px] shrink-0 text-[13px] font-semibold text-blue-600">0{{ i + 1 }}</span>
                  <span class="min-w-0 truncate">{{ s.label }}</span>
                  <ChevronRight :size="14" class="ml-auto shrink-0 text-slate-400 max-lg:hidden" aria-hidden="true" />
                </button>
              </li>
            </ol>
          </nav>
        </div>
      </aside>

      <!-- Cột phải: form -->
      <form class="c3-fade c3-d3" @submit.prevent="saveEdit">
        <!-- 01 Nhận diện thương hiệu -->
        <section :id="editSections[0].id">
          <div class="mb-6 flex items-baseline gap-3">
            <span class="text-xs font-semibold tracking-[0.08em] text-blue-600">01</span>
            <h2 tabindex="-1" class="m-0 text-[19px] font-semibold tracking-[-0.01em] outline-none">Nhận diện thương hiệu</h2>
          </div>

          <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div class="flex min-w-0 flex-col gap-2">
              <span id="f-logo-label" class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700">Logo công ty</span>
              <div role="group" aria-labelledby="f-logo-label" class="flex items-center gap-[18px]">
                <div class="flex h-[88px] w-[88px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 transition-colors duration-200 hover:border-slate-300 motion-reduce:transition-none">
                  <img v-if="logoPreview" :src="logoPreview" alt="Logo đã chọn" class="h-full w-full object-cover" />
                  <Building2 v-else :size="26" class="text-slate-500" />
                </div>
                <div class="flex flex-col items-start gap-2.5 rounded-lg focus-within:ring-[3px] focus-within:ring-blue-600/40">
                  <p class="m-0 text-[12.5px] text-slate-500">{{ isCreating ? 'Bạn có thể thêm logo sau khi tạo hồ sơ.' : 'Ảnh vuông, tối thiểu 200×200px.' }}</p>
                  <label
                    for="f-logo"
                    class="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-[11px] text-[13px] font-semibold tracking-[0.04em] text-slate-700 transition-colors duration-150 hover:border-slate-300 motion-reduce:transition-none"
                    :class="isCreating ? 'pointer-events-none opacity-50' : 'cursor-pointer'"
                  >
                    Chọn ảnh logo
                  </label>
                  <input id="f-logo" type="file" accept="image/*" class="sr-only" :disabled="saving || isCreating" @change="onLogoChange" />
                </div>
              </div>
              <p v-if="logoError" class="text-xs text-red-600">{{ logoError }}</p>
            </div>

            <div class="flex min-w-0 flex-col gap-2">
              <label class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700" for="f-name">Tên doanh nghiệp</label>
              <input
                id="f-name"
                v-model="draft.name"
                type="text"
                class="w-full rounded-lg border bg-white px-3.5 py-3 text-sm text-slate-900 transition duration-150 placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-blue-600/15 motion-reduce:transition-none"
                :class="displayedErrors.name ? 'border-red-300 focus:border-red-500' : 'border-slate-200 focus:border-blue-600'"
                :aria-invalid="displayedErrors.name ? 'true' : undefined"
                :aria-describedby="displayedErrors.name ? 'f-name-err' : undefined"
                placeholder="Tên công ty"
                @input="clearFieldError('name')"
              />
              <p v-if="displayedErrors.name" id="f-name-err" class="text-xs text-red-600" role="alert">{{ displayedErrors.name }}</p>
            </div>
          </div>
        </section>

        <hr class="my-11 border-0 border-t border-slate-200" />

        <!-- 02 Thông tin chung -->
        <section :id="editSections[1].id">
          <div class="mb-6 flex items-baseline gap-3">
            <span class="text-xs font-semibold tracking-[0.08em] text-blue-600">02</span>
            <h2 tabindex="-1" class="m-0 text-[19px] font-semibold tracking-[-0.01em] outline-none">Thông tin chung</h2>
          </div>
          <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div class="flex min-w-0 flex-col gap-2">
              <label class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700" for="f-industry">Ngành nghề</label>
              <input
                id="f-industry"
                v-model="draft.industry"
                type="text"
                class="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 transition duration-150 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-[3px] focus:ring-blue-600/15 motion-reduce:transition-none"
                placeholder="VD: Thương mại và Dịch vụ"
              />
            </div>
            <div class="flex min-w-0 flex-col gap-2">
              <label class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700" for="f-size">Quy mô doanh nghiệp</label>
              <CompanySelect id="f-size" v-model="draft.size" :options="SIZES" />
            </div>
          </div>
          <div class="mt-6 flex min-w-0 flex-col gap-2">
            <label class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700" for="f-website">Website</label>
            <input
              id="f-website"
              v-model="draft.website"
              type="text"
              class="w-full rounded-lg border bg-white px-3.5 py-3 text-sm text-slate-900 transition duration-150 placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-blue-600/15 motion-reduce:transition-none"
              :class="displayedErrors.website ? 'border-red-300 focus:border-red-500' : 'border-slate-200 focus:border-blue-600'"
              :aria-invalid="displayedErrors.website ? 'true' : undefined"
              :aria-describedby="displayedErrors.website ? 'f-website-err' : undefined"
              placeholder="https://example.com"
              @input="clearFieldError('website')"
            />
            <p v-if="displayedErrors.website" id="f-website-err" class="text-xs text-red-600" role="alert">{{ displayedErrors.website }}</p>
          </div>
        </section>

        <hr class="my-11 border-0 border-t border-slate-200" />

        <!-- 03 Địa chỉ -->
        <section :id="editSections[2].id">
          <div class="mb-6 flex items-baseline gap-3">
            <span class="text-xs font-semibold tracking-[0.08em] text-blue-600">03</span>
            <h2 tabindex="-1" class="m-0 text-[19px] font-semibold tracking-[-0.01em] outline-none">Địa chỉ</h2>
          </div>
          <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div class="flex min-w-0 flex-col gap-2">
              <label class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700" for="f-province">Tỉnh / Thành phố</label>
              <CompanySelect id="f-province" v-model="draft.province" :options="provinceOptions" @change="onDraftProvinceChange" />
            </div>
            <div class="flex min-w-0 flex-col gap-2">
              <label class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700" for="f-district">Quận / Huyện</label>
              <CompanySelect id="f-district" v-model="draft.district" :options="districtOptions" />
            </div>
          </div>
          <div class="mt-6 flex min-w-0 flex-col gap-2">
            <label class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700" for="f-address">Địa chỉ chi tiết</label>
            <input
              id="f-address"
              v-model="draft.address"
              type="text"
              class="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 transition duration-150 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-[3px] focus:ring-blue-600/15 motion-reduce:transition-none"
              placeholder="Số nhà, tên đường, phường/xã"
            />
          </div>
        </section>

        <hr class="my-11 border-0 border-t border-slate-200" />

        <!-- 04 Giới thiệu -->
        <section :id="editSections[3].id">
          <div class="mb-6 flex items-baseline gap-3">
            <span class="text-xs font-semibold tracking-[0.08em] text-blue-600">04</span>
            <h2 tabindex="-1" class="m-0 text-[19px] font-semibold tracking-[-0.01em] outline-none">Giới thiệu</h2>
          </div>
          <div class="flex min-w-0 flex-col gap-2">
            <label class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700" for="f-desc">Mô tả doanh nghiệp</label>
            <textarea
              id="f-desc"
              v-model="draft.description"
              rows="7"
              :maxlength="DESC_LIMIT"
              class="min-h-[160px] w-full resize-y rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm leading-[1.7] text-slate-900 transition duration-150 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-[3px] focus:ring-blue-600/15 motion-reduce:transition-none"
              placeholder="Câu chuyện, sứ mệnh và văn hóa doanh nghiệp…"
            ></textarea>
            <p
              class="mt-0.5 text-right text-xs"
              :class="descCount >= DESC_LIMIT ? 'text-amber-700' : 'text-slate-500'"
            >
              {{ descCount }} / {{ DESC_LIMIT }} ký tự
            </p>
          </div>
        </section>

        <hr class="my-11 border-0 border-t border-slate-200" />

        <!-- 05 Mạng xã hội -->
        <section
          :id="editSections[4].id"
          class="min-h-[calc(100svh-var(--c3-header-h,0px)-104px)]"
        >
          <div class="mb-1 flex items-baseline gap-3">
            <span class="text-xs font-semibold tracking-[0.08em] text-blue-600">05</span>
            <h2 tabindex="-1" class="m-0 text-[19px] font-semibold tracking-[-0.01em] outline-none">Mạng xã hội</h2>
          </div>
          <p class="mb-6 mt-1 text-[13px] text-slate-500">Thêm các liên kết giúp ứng viên tìm hiểu thêm về doanh nghiệp của bạn.</p>

          <div class="flex min-w-0 flex-col gap-2">
            <div class="mb-3 flex items-center justify-between gap-3">
              <span class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700">Danh sách liên kết</span>
              <button
                type="button"
                class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[12.5px] font-semibold tracking-[0.04em] text-slate-700 transition-colors duration-150 hover:border-slate-300 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-blue-600/40 motion-reduce:transition-none"
                @click="addSocialRow"
              >
                <Plus :size="14" />
                Thêm liên kết
              </button>
            </div>

            <p v-if="socialRows.length === 0" class="mt-1 text-[13px] text-slate-500">
              Chưa có liên kết mạng xã hội nào.
            </p>
            <div v-else class="flex flex-col gap-3">
              <div
                v-for="(row, idx) in socialRows"
                :key="row.id"
                class="grid grid-cols-[minmax(120px,150px)_minmax(0,1fr)_auto] items-center gap-2.5 max-[560px]:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div class="max-[560px]:col-span-full">
                  <div class="relative">
                    <component :is="getSocialMeta(row.key).icon" :size="15" aria-hidden="true" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      :id="`social-key-${row.id}`"
                      v-model="row.key"
                      type="text"
                      class="w-full rounded-lg border bg-white py-3 pl-9 pr-3.5 text-sm text-slate-900 transition duration-150 placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-blue-600/15 motion-reduce:transition-none"
                      :class="errors[`social-key-${row.id}`] ? 'border-red-300 focus:border-red-500' : 'border-slate-200 focus:border-blue-600'"
                      :aria-invalid="errors[`social-key-${row.id}`] ? 'true' : undefined"
                      :aria-describedby="errors[`social-key-${row.id}`] ? `social-key-err-${row.id}` : undefined"
                      placeholder="linkedin"
                      :aria-label="`Loại liên kết ${row.key || row.id}`"
                      @input="errors[`social-key-${row.id}`] = ''"
                    />
                  </div>
                  <p v-if="errors[`social-key-${row.id}`]" :id="`social-key-err-${row.id}`" class="mt-1 text-xs text-red-600" role="alert">
                    {{ errors[`social-key-${row.id}`] }}
                  </p>
                </div>
                <div class="min-w-0">
                  <input
                    :id="`social-url-${row.id}`"
                    v-model="row.value"
                    type="text"
                    class="w-full rounded-lg border bg-white px-3.5 py-3 text-sm text-slate-900 transition duration-150 placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-blue-600/15 motion-reduce:transition-none"
                    :class="errors[`social-url-${row.id}`] ? 'border-red-300 focus:border-red-500' : 'border-slate-200 focus:border-blue-600'"
                    :aria-invalid="errors[`social-url-${row.id}`] ? 'true' : undefined"
                    :aria-describedby="errors[`social-url-${row.id}`] ? `social-url-err-${row.id}` : undefined"
                    placeholder="https://..."
                    :aria-label="`Đường dẫn liên kết ${row.key || row.id}`"
                    @input="errors[`social-url-${row.id}`] = ''"
                  />
                  <p v-if="errors[`social-url-${row.id}`]" :id="`social-url-err-${row.id}`" class="mt-1 text-xs text-red-600" role="alert">
                    {{ errors[`social-url-${row.id}`] }}
                  </p>
                </div>
                <button
                  type="button"
                  class="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors duration-150 hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-blue-600/40 motion-reduce:transition-none"
                  :aria-label="`Xoá liên kết ${row.key || row.id}`"
                  title="Xoá hàng"
                  @click="removeSocialRow(idx)"
                >
                  <Trash2 :size="15" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Hành động -->
        <div class="sticky bottom-0 mt-10 flex justify-end gap-3 border-t border-slate-200 bg-white pb-[max(18px,env(safe-area-inset-bottom))] pt-[18px]">
          <p v-if="saveError" class="mr-auto text-xs text-red-600" role="alert">{{ saveError }}</p>
          <button
            type="button"
            class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-[11px] text-[13px] font-semibold tracking-[0.04em] text-slate-700 transition-colors duration-150 hover:border-slate-300 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-blue-600/40 motion-reduce:transition-none"
            @click="requestCancel"
            :disabled="saving"
          >
            Hủy
          </button>
          <button
            type="submit"
            class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-transparent bg-[#5b4eea] px-5 py-[11px] text-[13px] font-semibold tracking-[0.04em] text-white transition-colors duration-150 hover:bg-blue-700 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-blue-600/40 motion-reduce:transition-none"
            :disabled="saving"
            :aria-busy="saving ? 'true' : undefined"
          >
            <Check :size="15" />
            {{ saving ? (isCreating ? 'Đang tạo…' : 'Đang lưu…') : (isCreating ? 'Tạo hồ sơ' : 'Lưu thay đổi') }}
          </button>
        </div>
      </form>
    </div>
  </main>
</template>

