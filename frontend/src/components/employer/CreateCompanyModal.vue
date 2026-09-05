<script setup lang="ts">
/**
 * CreateCompanyModal — modal "Tạo công ty" dùng chung cho CompanyView và
 * CompanyMembersView khi user chưa thuộc công ty nào.
 *
 * Tại sao tách component:
 *   - Empty state của cả 2 trang đều cần CTA tạo công ty. Tránh duplicate form
 *     + validation logic ở 2 nơi bằng cách đặt modal vào component chung.
 *
 * Flow:
 *   1. Mở modal → reset form, focus vào input `name`.
 *   2. User nhập các field (chỉ `name` bắt buộc theo BE schema).
 *   3. Submit → `companyStore.create(payload)` → BE tự insert owner trong tx.
 *   4. Success → emit 'created' với Company object + đóng modal.
 *   5. Error → giữ form, hiển thị inline error (không toast để giữ ngữ cảnh).
 *
 * Quy ước validation:
 *   - `name` bắt buộc, 2–200 ký tự (match Zod schema ở BE).
 *   - `logoUrl`: được set qua component `ImageUploadField` (file upload lên
 *     MinIO → URL trả về từ BE đã validate rồi).
 *   - `website` optional, nếu nhập phải là URL hợp lệ.
 *   - `description` tối đa 5.000 ký tự (match BE).
 *
 * Permission: chỉ render nút mở modal khi user đã đăng nhập với role
 * `employer` hoặc `admin` (BE enforce, FE chỉ là UX).
 *
 * Public API (KHÔNG THAY ĐỔI):
 *   - props:  open: boolean
 *   - emits:  update:open (boolean), created (Company)
 *
 * Ghi chú thiết kế (v2):
 *   - Bỏ badge số thứ tự "1/2/3" trên các section — 3 khối (thương hiệu /
 *     thông tin cơ bản / giới thiệu) không phải một quy trình tuần tự bắt
 *     buộc, người dùng có thể điền theo bất kỳ thứ tự nào, nên đánh số dễ
 *     gây hiểu nhầm là các bước phải hoàn thành lần lượt.
 *   - Thay bằng dải màu bên trái (rule) + nhãn section, giữ được phân cấp
 *     thị giác mà không ngụ ý trình tự.
 *   - Nút hành động chính dùng đúng màu primary của hệ thống (trước đây là
 *     màu đen trung tính, không liên kết với thương hiệu).
 *   - Ô "Tên công ty" được nhấn mạnh rõ ràng nhất vì đây là trường bắt buộc
 *     duy nhất và quan trọng nhất.
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import {
  AlertCircle,
  Building2,
  Check,
  ChevronDown,
  Globe,
  Loader2,
  MapPin,
  ShieldCheck,
  Users,
  X,
} from 'lucide-vue-next';
import { useCompanyStore } from '@stores/company';
import { useLocations } from '@composables/useLocations';
import ImageUploadField from '@components/employer/ImageUploadField.vue';
import type { Company, CreateCompanyPayload } from '@/types/company';

const props = withDefaults(
  defineProps<{
    open: boolean;
  }>(),
  { open: false },
);

const emit = defineEmits<{
  /** Modal đóng (cancel/ESC/backdrop) */
  (e: 'update:open', value: boolean): void;
  /** Tạo thành công — emit full Company vừa tạo (parent sẽ fetchById + show toast) */
  (e: 'created', company: Company): void;
}>();

const companyStore = useCompanyStore();
const locations = useLocations();

/* ============================================================================
 * Form state
 * ==========================================================================*/
interface CreateFormState {
  name: string;
  logoUrl: string;
  industry: string;
  sizeRange: string;
  website: string;
  description: string;
  /** Tỉnh/Thành phố — lưu shortName (vd "Hà Nội") để khớp với data job.location.city. */
  city: string;
  /** Quận/Huyện — lưu tên district (vd "Ba Đình"). */
  district: string;
  /** Địa chỉ cụ thể (số nhà, ngõ, đường...). */
  streetAddress: string;
}

const SIZE_RANGE_OPTIONS = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];
const MAX_NAME = 200;
const MAX_DESCRIPTION = 5000;

const form = reactive<CreateFormState>({
  name: '',
  logoUrl: '',
  industry: '',
  sizeRange: '',
  website: '',
  description: '',
  city: '',
  district: '',
  streetAddress: '',
});

/** Province code (number) đang được chọn — tách riêng để lookup district qua `getDistricts(code)`. */
const selectedProvinceCode = ref<number | null>(null);
/** Loading riêng cho lần fetch location đầu tiên (để hiển thị skeleton ngắn trong dropdown). */
const locationsLoading = ref(false);

const saving = ref(false);
const formError = ref<string | null>(null);
const nameInputEl = ref<HTMLInputElement | null>(null);

/* ============================================================================
 * Size dropdown (custom — thay thẻ <select> xấu bằng listbox đẹp hơn)
 * ==========================================================================*/
const sizeDropdownOpen = ref(false);
const sizeDropdownEl = ref<HTMLDivElement | null>(null);

const toggleSizeDropdown = (): void => {
  if (saving.value) return;
  sizeDropdownOpen.value = !sizeDropdownOpen.value;
};
const closeSizeDropdown = (): void => {
  sizeDropdownOpen.value = false;
};
const selectSize = (value: string): void => {
  form.sizeRange = value;
  closeSizeDropdown();
};

/** Label hiển thị trên trigger — empty = placeholder, có value = "X nhân viên". */
const selectedSizeLabel = computed<string>(() => {
  const v = form.sizeRange;
  if (!v) return 'Chọn quy mô';
  return `${v} nhân viên`;
});

/** Click-outside + ESC để đóng dropdown. ESC đã có handler riêng ở dưới (keydown). */
const handleDocClickSize = (e: MouseEvent): void => {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (!target.closest('[data-size-dropdown]')) closeSizeDropdown();
};

watch(sizeDropdownOpen, (open) => {
  if (open) {
    window.addEventListener('click', handleDocClickSize);
  } else {
    window.removeEventListener('click', handleDocClickSize);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('click', handleDocClickSize);
});

/* ============================================================================
 * Computed helpers cho UI
 * ==========================================================================*/
/** Đếm ký tự tên — hiển thị counter khi user nhập nhiều. */
const showNameCounter = computed<boolean>(() => form.name.length > 120);

/* ============================================================================
 * Reset form khi mở modal
 * ==========================================================================*/
watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      // Reset state mỗi lần mở — tránh giữ data cũ khi cancel/reopen.
      form.name = '';
      form.logoUrl = '';
      form.industry = '';
      form.sizeRange = '';
      form.website = '';
      form.description = '';
      form.city = '';
      form.district = '';
      form.streetAddress = '';
      selectedProvinceCode.value = null;
      formError.value = null;
      saving.value = false;

      // Fetch danh sách tỉnh/thành (idempotent — cached ở module scope).
      // Không block UI: hiển thị loading trong dropdown khi đang tải.
      locationsLoading.value = true;
      void locations.fetch().finally(() => {
        locationsLoading.value = false;
      });

      // Focus input name sau khi transition mở xong.
      await nextTick();
      nameInputEl.value?.focus();
    }
  },
);

/** Districts tương ứng với province đang chọn — reactive, update khi cache thay đổi. */
const currentDistricts = computed(() => {
  if (selectedProvinceCode.value === null) return [];
  return locations.getDistricts(selectedProvinceCode.value);
});

/** Reset district + sync city name khi province đổi.
 *  - city lưu shortName (vd "Hà Nội") để khớp với data job.location.city.
 *  - district reset vì district cũ có thể không thuộc province mới. */
watch(selectedProvinceCode, (code) => {
  form.district = '';
  if (code === null) {
    form.city = '';
    return;
  }
  const found = locations.items.value.find((p) => p.code === code);
  form.city = found?.shortName ?? '';
});

/* ============================================================================
 * Close handlers
 * ==========================================================================*/
const close = (): void => {
  if (saving.value) return; // Không cho đóng khi đang submit
  emit('update:open', false);
};

/* ============================================================================
 * Validation
 * ==========================================================================*/
/** `logoUrl` được set bởi ImageUploadField (URL trả về từ BE) — không cần validate URL ở đây. */
const isValidUrl = (s: string): boolean => {
  if (!s) return true; // optional
  try {
    const u = new URL(s.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

const validate = (): string | null => {
  const name = form.name.trim();
  if (name.length < 2) return 'Tên công ty phải có ít nhất 2 ký tự.';
  if (name.length > MAX_NAME) return `Tên công ty không được vượt quá ${MAX_NAME} ký tự.`;
  if (!isValidUrl(form.website.trim())) return 'Website không hợp lệ (phải bắt đầu bằng http:// hoặc https://).';
  if (form.description.length > MAX_DESCRIPTION) {
    return `Mô tả không được vượt quá ${MAX_DESCRIPTION} ký tự.`;
  }
  return null;
};

/* ============================================================================
 * Submit
 * ==========================================================================*/
const submit = async (): Promise<void> => {
  formError.value = null;
  const err = validate();
  if (err) {
    formError.value = err;
    return;
  }

  // Build address Record<unknown> theo cùng convention với job.location:
  // { city, district, address }. Chỉ include key nào có giá trị.
  const address: Record<string, unknown> = {};
  const cityVal = form.city.trim();
  const districtVal = form.district.trim();
  const streetVal = form.streetAddress.trim();
  if (cityVal) address.city = cityVal;
  if (districtVal) address.district = districtVal;
  if (streetVal) address.address = streetVal;

  const payload: CreateCompanyPayload = {
    name: form.name.trim(),
    logoUrl: form.logoUrl.trim() || undefined,
    industry: form.industry.trim() || undefined,
    sizeRange: form.sizeRange.trim() || undefined,
    website: form.website.trim() || undefined,
    description: form.description.trim() || undefined,
    address: Object.keys(address).length > 0 ? address : undefined,
  };

  saving.value = true;
  try {
    const created = await companyStore.create(payload);
    if (created) {
      emit('created', created);
      emit('update:open', false);
    } else {
      formError.value = companyStore.error ?? 'Không thể tạo công ty. Vui lòng thử lại.';
    }
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra.';
  } finally {
    saving.value = false;
  }
};

/* ============================================================================
 * ESC handler (đóng dropdown trước, nếu không có dropdown mới đóng modal)
 * ==========================================================================*/
const onKeydown = (e: KeyboardEvent): void => {
  if (!props.open) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (sizeDropdownOpen.value) {
      closeSizeDropdown();
    } else {
      close();
    }
  }
};

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      window.addEventListener('keydown', onKeydown);
    } else {
      window.removeEventListener('keydown', onKeydown);
    }
  },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-company-modal-title"
        @mousedown.self="close"
      >
        <div class="absolute inset-0 bg-slate-900/55 backdrop-blur-[2px]" />

        <div
          class="relative z-10 w-full max-w-3xl max-h-[92vh] sm:max-h-[90vh] rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200/70 flex flex-col overflow-hidden"
          @mousedown.stop
        >
          <!-- =================== HEADER =================== -->
          <header class="relative px-6 sm:px-8 pt-6 sm:pt-7 pb-5 border-b border-gray-100">
            <div class="flex items-start gap-4">
              <div class="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary-600">
                <Building2 class="h-5 w-5 text-white" />
              </div>
              <div class="flex-1 min-w-0 pr-10">
                <h2 id="create-company-modal-title" class="text-lg sm:text-xl font-semibold text-gray-900 tracking-tight">
                  Tạo hồ sơ công ty
                </h2>
                <p class="mt-1 text-sm text-gray-500 leading-relaxed">
                  Thiết lập hồ sơ doanh nghiệp để bắt đầu tuyển dụng và xây dựng đội ngũ.
                </p>
              </div>
              <button
                v-if="!saving"
                type="button"
                class="absolute top-5 right-5 sm:top-6 sm:right-6 inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300"
                title="Đóng"
                aria-label="Đóng"
                @click="close"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
          </header>

          <!-- =================== BODY (scrollable) =================== -->
          <div class="modal-body flex-1 overflow-y-auto overflow-x-hidden">
            <div class="px-6 sm:px-8 py-6 space-y-8">

              <!-- ===== SECTION · BRANDING ===== -->
              <section class="border-l-2 border-primary-200 pl-4">
                <header class="mb-4">
                  <h3 class="text-sm font-semibold text-gray-900">Thương hiệu</h3>
                  <p class="mt-0.5 text-xs text-gray-500">
                    Hình ảnh giúp ứng viên nhận diện công ty của bạn.
                  </p>
                </header>

                <!-- Logo -->
                <div class="max-w-[200px]">
                  <div class="flex items-center gap-2 mb-2">
                    <span class="text-sm font-medium text-gray-900">Logo công ty</span>
                    <span class="text-[11px] text-gray-400">tỉ lệ 1:1</span>
                  </div>
                  <ImageUploadField
                    v-model:url="form.logoUrl"
                    folder="logos"
                    shape="square"
                    label=""
                    hide-label
                    :disabled="saving"
                  />
                </div>
              </section>

              <!-- ===== SECTION · BASIC INFO ===== -->
              <section class="border-l-2 border-primary-200 pl-4">
                <header class="mb-4">
                  <h3 class="text-sm font-semibold text-gray-900">Thông tin cơ bản</h3>
                  <p class="mt-0.5 text-xs text-gray-500">
                    Những thông tin chính về doanh nghiệp.
                  </p>
                </header>

                <div class="space-y-4">
                  <!-- Company name — trường quan trọng nhất, chiếm không gian rõ ràng -->
                  <div>
                    <div class="flex items-center justify-between mb-1.5">
                      <label for="company-name" class="block text-sm font-medium text-gray-900">
                        Tên công ty
                        <span class="text-red-500">*</span>
                      </label>
                      <span
                        v-if="showNameCounter"
                        class="text-[11px] tabular-nums"
                        :class="form.name.length > 190 ? 'text-red-600' : 'text-gray-400'"
                      >
                        {{ form.name.length }} / {{ MAX_NAME }}
                      </span>
                    </div>
                    <input
                      id="company-name"
                      ref="nameInputEl"
                      v-model="form.name"
                      type="text"
                      :maxlength="MAX_NAME"
                      placeholder="VD: Công ty TNHH JobMatch"
                      autocomplete="off"
                      class="w-full h-12 px-4 text-base rounded-xl border border-gray-200 bg-gray-50/60 placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 transition disabled:opacity-60 disabled:cursor-not-allowed"
                      :disabled="saving"
                      @keyup.enter="submit"
                    />
                    <p class="text-[11px] text-gray-500 mt-1.5">
                      Slug sẽ được hệ thống tự động tạo từ tên công ty.
                    </p>
                  </div>

                  <!-- Industry + Size -->
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label for="company-industry" class="block text-sm font-medium text-gray-900 mb-1.5">
                        Ngành nghề
                      </label>
                      <input
                        id="company-industry"
                        v-model="form.industry"
                        type="text"
                        maxlength="100"
                        placeholder="VD: Công nghệ thông tin"
                        class="w-full h-11 px-3.5 text-sm rounded-lg border border-gray-200 bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 transition disabled:opacity-60 disabled:cursor-not-allowed"
                        :disabled="saving"
                      />
                    </div>
                    <div data-size-dropdown>
                      <label for="company-size" class="block text-sm font-medium text-gray-900 mb-1.5">
                        Quy mô công ty
                      </label>
                      <!-- Custom listbox thay thế <select> — đẹp hơn, đồng bộ design system -->
                      <div class="relative">
                        <button
                          id="company-size"
                          type="button"
                          class="w-full h-11 pl-3.5 pr-3 text-sm rounded-lg border bg-white transition flex items-center gap-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 disabled:opacity-60 disabled:cursor-not-allowed"
                          :class="sizeDropdownOpen
                            ? 'border-primary-400 ring-2 ring-primary-500/30'
                            : 'border-gray-200 hover:border-gray-300'"
                          :disabled="saving"
                          :aria-expanded="sizeDropdownOpen"
                          :aria-haspopup="'listbox'"
                          @click="toggleSizeDropdown"
                        >
                          <Users
                            class="w-4 h-4 shrink-0"
                            :class="form.sizeRange ? 'text-gray-500' : 'text-gray-300'"
                          />
                          <span
                            class="flex-1 text-left truncate"
                            :class="form.sizeRange ? 'text-gray-900' : 'text-gray-400'"
                          >
                            {{ selectedSizeLabel }}
                          </span>
                          <ChevronDown
                            class="w-4 h-4 text-gray-400 shrink-0 transition-transform"
                            :class="{ 'rotate-180': sizeDropdownOpen }"
                          />
                        </button>

                        <!-- Popover -->
                        <Transition name="popover">
                          <div
                            v-if="sizeDropdownOpen"
                            ref="sizeDropdownEl"
                            class="size-pop absolute left-0 right-0 top-full mt-1.5 z-20 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg py-1 focus:outline-none"
                            role="listbox"
                          >
                            <button
                              type="button"
                              role="option"
                              :aria-selected="form.sizeRange === ''"
                              class="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 flex items-center justify-between disabled:opacity-60 disabled:cursor-not-allowed"
                              :class="form.sizeRange === '' ? 'text-primary-700 font-medium' : 'text-gray-500'"
                              :disabled="saving"
                              @click="selectSize('')"
                            >
                              <span class="flex items-center gap-2">
                                <span class="w-4 h-4 inline-flex items-center justify-center">
                                  <Check v-if="form.sizeRange === ''" class="w-3.5 h-3.5 text-primary-600" />
                                </span>
                                <span>Chọn quy mô</span>
                              </span>
                            </button>
                            <div class="h-px bg-gray-100 my-1" />
                            <button
                              v-for="opt in SIZE_RANGE_OPTIONS"
                              :key="opt"
                              type="button"
                              role="option"
                              :aria-selected="form.sizeRange === opt"
                              class="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 flex items-center justify-between disabled:opacity-60 disabled:cursor-not-allowed"
                              :class="form.sizeRange === opt ? 'bg-primary-50/60 text-primary-700 font-medium' : 'text-gray-700'"
                              :disabled="saving"
                              @click="selectSize(opt)"
                            >
                              <span class="flex items-center gap-2">
                                <span class="w-4 h-4 inline-flex items-center justify-center">
                                  <Check v-if="form.sizeRange === opt" class="w-3.5 h-3.5 text-primary-600" />
                                </span>
                                <span>{{ opt }} nhân viên</span>
                              </span>
                            </button>
                          </div>
                        </Transition>
                      </div>
                    </div>
                  </div>

                  <!-- Website -->
                  <div>
                    <label for="company-website" class="block text-sm font-medium text-gray-900 mb-1.5">
                      Website
                    </label>
                    <div class="relative">
                      <Globe class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                      <input
                        id="company-website"
                        v-model="form.website"
                        type="url"
                        maxlength="500"
                        placeholder="https://example.com"
                        class="w-full h-11 pl-10 pr-3.5 text-sm rounded-lg border border-gray-200 bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 transition disabled:opacity-60 disabled:cursor-not-allowed"
                        :disabled="saving"
                      />
                    </div>
                  </div>
                </div>
              </section>

              <!-- ===== SECTION · ADDRESS ===== -->
              <section class="border-l-2 border-primary-200 pl-4">
                <header class="mb-4">
                  <h3 class="text-sm font-semibold text-gray-900">Địa chỉ</h3>
                  <p class="mt-0.5 text-xs text-gray-500">
                    Thông tin địa chỉ giúp ứng viên biết nơi làm việc.
                  </p>
                </header>

                <div class="space-y-4">
                  <!-- Province + District -->
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <!-- Province -->
                    <div>
                      <label for="company-province" class="text-sm font-medium text-gray-900 mb-1.5 inline-flex items-center gap-1.5">
                        <MapPin class="w-3.5 h-3.5 text-gray-500" />
                        Tỉnh/Thành phố
                      </label>
                      <div class="relative">
                        <select
                          id="company-province"
                          v-model="selectedProvinceCode"
                          :disabled="locations.loading.value && locations.items.value.length === 0"
                          class="w-full h-11 pl-3.5 pr-9 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 transition disabled:opacity-60 disabled:cursor-not-allowed appearance-none bg-no-repeat bg-right"
                          style="background-image: url('data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236b7280%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpolyline points=%226 9 12 15 18 9%22/%3E%3C/svg%3E'); background-position: right 12px center; background-size: 14px;"
                        >
                          <option :value="null">
                            {{ locations.loading.value && locations.items.value.length === 0 ? 'Đang tải...' : 'Chọn tỉnh/thành' }}
                          </option>
                          <option v-for="p in locations.items.value" :key="p.code" :value="p.code">
                            {{ p.name }}
                          </option>
                        </select>
                      </div>
                    </div>

                    <!-- District -->
                    <div>
                      <label for="company-district" class="text-sm font-medium text-gray-900 mb-1.5 inline-flex items-center gap-1.5">
                        <MapPin class="w-3.5 h-3.5 text-gray-500" />
                        Quận/Huyện
                      </label>
                      <div class="relative">
                        <select
                          id="company-district"
                          v-model="form.district"
                          :disabled="selectedProvinceCode === null || currentDistricts.length === 0"
                          class="w-full h-11 pl-3.5 pr-9 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 transition disabled:opacity-60 disabled:cursor-not-allowed appearance-none bg-no-repeat bg-right"
                          style="background-image: url('data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236b7280%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpolyline points=%226 9 12 15 18 9%22/%3E%3C/svg%3E'); background-position: right 12px center; background-size: 14px;"
                        >
                          <option value="">
                            <span v-if="selectedProvinceCode === null">Chọn tỉnh trước</span>
                            <span v-else-if="currentDistricts.length === 0">Không có dữ liệu</span>
                            <span v-else>Chọn quận/huyện</span>
                          </option>
                          <option v-for="d in currentDistricts" :key="d.code" :value="d.name">
                            {{ d.name }}
                          </option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <!-- Street address -->
                  <div>
                    <label for="company-street" class="text-sm font-medium text-gray-900 mb-1.5 inline-flex items-center gap-1.5">
                      <MapPin class="w-3.5 h-3.5 text-gray-500" />
                      Địa chỉ cụ thể
                      <span class="text-[11px] text-gray-400 font-normal">— số nhà, ngõ, đường...</span>
                    </label>
                    <input
                      id="company-street"
                      v-model="form.streetAddress"
                      type="text"
                      maxlength="500"
                      placeholder="VD: 123 Nguyễn Văn Cừ, Phường Ngọc Lâm"
                      class="w-full h-11 px-3.5 text-sm rounded-xl border border-gray-200 bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 transition disabled:opacity-60 disabled:cursor-not-allowed"
                      :disabled="saving"
                    />
                  </div>

                  <!-- Helper / current selection summary -->
                  <div
                    v-if="form.city || form.district || form.streetAddress"
                    class="flex items-start gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100"
                  >
                    <MapPin class="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
                    <p class="text-xs text-gray-600 break-words min-w-0">
                      <span v-if="form.streetAddress">{{ form.streetAddress }}</span>
                      <span v-if="form.district"> <span v-if="form.streetAddress">·</span> {{ form.district }}</span>
                      <span v-if="form.city"> <span v-if="form.district || form.streetAddress">·</span> {{ form.city }}</span>
                    </p>
                  </div>
                </div>
              </section>

              <!-- ===== SECTION · DESCRIPTION ===== -->
              <section class="border-l-2 border-primary-200 pl-4">
                <header class="mb-4">
                  <h3 class="text-sm font-semibold text-gray-900">Giới thiệu</h3>
                  <p class="mt-0.5 text-xs text-gray-500">
                    Giúp ứng viên hiểu thêm về công ty, sản phẩm và văn hóa làm việc.
                  </p>
                </header>

                <div>
                  <textarea
                    v-model="form.description"
                    rows="6"
                    :maxlength="MAX_DESCRIPTION"
                    placeholder="Chia sẻ về công ty, sản phẩm, văn hóa và môi trường làm việc..."
                    class="w-full min-h-[140px] px-3.5 py-2.5 text-sm rounded-lg border border-gray-200 bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 transition resize-y disabled:opacity-60 disabled:cursor-not-allowed"
                    :disabled="saving"
                  />
                  <div class="flex items-center justify-between mt-1.5">
                    <p class="text-[11px] text-gray-500">
                      Không bắt buộc — bạn có thể bổ sung sau.
                    </p>
                    <p
                      class="text-[11px] tabular-nums"
                      :class="form.description.length > MAX_DESCRIPTION - 200 ? 'text-amber-600' : 'text-gray-400'"
                    >
                      {{ form.description.length }} / {{ MAX_DESCRIPTION.toLocaleString('vi-VN') }}
                    </p>
                  </div>
                </div>
              </section>

              <!-- ===== INLINE ERROR ===== -->
              <Transition name="error">
                <div
                  v-if="formError"
                  class="rounded-xl border border-red-200/80 bg-red-50/70 px-4 py-3 flex items-start gap-3"
                  role="alert"
                >
                  <div class="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full bg-red-100">
                    <AlertCircle class="w-3.5 h-3.5 text-red-600" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium text-red-900">Không thể tạo công ty</p>
                    <p class="text-xs text-red-700 mt-0.5">{{ formError }}</p>
                  </div>
                </div>
              </Transition>
            </div>
          </div>

          <!-- =================== FOOTER (sticky) =================== -->
          <footer class="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 px-6 sm:px-8 py-4 border-t border-gray-100 bg-gray-50/60">
            <div class="flex items-center gap-2 text-xs text-gray-500">
              <ShieldCheck class="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Bạn sẽ tự động trở thành chủ sở hữu.</span>
            </div>
            <div class="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                class="flex-1 sm:flex-none inline-flex items-center justify-center h-11 px-4 text-sm font-medium rounded-lg text-gray-600 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="saving"
                @click="close"
              >
                Hủy
              </button>
              <button
                type="button"
                class="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 h-11 px-5 text-sm font-semibold rounded-lg text-white bg-primary-600 hover:bg-primary-700 transition focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                :disabled="saving"
                @click="submit"
              >
                <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
                <span>{{ saving ? 'Đang tạo...' : 'Tạo công ty' }}</span>
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Modal animation — fade backdrop + scale + translateY cho cảm giác "nổi" nhẹ. */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}
.modal-enter-active > div:last-child,
.modal-leave-active > div:last-child {
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from > div:last-child,
.modal-leave-to > div:last-child {
  transform: scale(0.98) translateY(8px);
  opacity: 0;
}

/* Error alert slide-down + fade-in. */
.error-enter-active,
.error-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.error-enter-from,
.error-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* Dropdown popover fade + slide-down. */
.popover-enter-active,
.popover-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}
.popover-enter-from,
.popover-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* Thin scrollbar cho popover "Chọn quy mô công ty" — 3px, hover đậm hơn. */
.size-pop {
  scrollbar-width: thin;
  scrollbar-color: rgb(209 213 219) transparent;
}
.size-pop::-webkit-scrollbar {
  width: 3px;
}
.size-pop::-webkit-scrollbar-track {
  background: transparent;
}
.size-pop::-webkit-scrollbar-thumb {
  background-color: rgb(209 213 219);
  border-radius: 9999px;
}
.size-pop::-webkit-scrollbar-thumb:hover {
  background-color: rgb(156 163 175);
}

/* Thin scrollbar cho body modal — chỉ hiện khi scroll, không chiếm chỗ. */
.modal-body {
  scrollbar-width: thin;
  scrollbar-color: rgb(209 213 219) transparent;
}
.modal-body::-webkit-scrollbar {
  width: 4px;
}
.modal-body::-webkit-scrollbar-track {
  background: transparent;
}
.modal-body::-webkit-scrollbar-thumb {
  background-color: rgb(209 213 219);
  border-radius: 9999px;
}
.modal-body::-webkit-scrollbar-thumb:hover {
  background-color: rgb(156 163 175);
}
</style>