<script setup lang="ts">
/**
 * ProfileView — Candidate Profile Dashboard.
 *
 * Mục tiêu UX: biến trang từ "form CRUD thông tin cá nhân" thành "dashboard
 * hồ sơ nghề nghiệp" — có overview, completion %, CTA rõ ràng cho field
 * trống, và section icon đồng bộ design system.
 *
 * Business logic giữ nguyên 100%:
 *   - GET/PATCH /candidates/profile (candidate.api.ts).
 *   - View ↔ Edit mode toggle, validation, dirty tracking, partial payload.
 *   - Toast feedback (success/error/info).
 *   - Cancel confirm khi dirty.
 *
 * UI redesign:
 *   - Card lớn hơn (max-w-5xl), padding 24–28px, border neutral + shadow rất
 *     nhẹ. Không dùng shadow nặng.
 *   - Section header: icon trong icon-container 36×36 primary-50, title 16px
 *     font-semibold, optional description 12px slate-500.
 *   - Field label 13px font-medium; field value 14-15px font-medium;
 *     secondary text 13px slate-500.
 *   - Empty state CTA "+ Thêm ..." thay cho "Chưa cập nhật" — click sẽ
 *     vào edit mode + focus field tương ứng.
 *   - Profile Overview card đầu trang: avatar lớn 80×80 / 96×96 + tên +
 *     email (verified badge) + location + progress bar hoàn thiện.
 *   - Social links: row-style với brand icon container, value rút gọn,
 *     ExternalLink icon khi có data, chevron khi CTA.
 *   - Career section: link "CV của tôi" → /candidate/resumes.
 */
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { storeToRefs } from 'pinia';
import {
  UserRound,
  Mail,
  Phone,
  MapPin,
  Linkedin,
  Github,
  Globe,
  Loader2,
  AlertCircle,
  Pencil,
  X,
  Save,
  Sparkles,
  TrendingUp,
  BadgeCheck,
  Plus,
  ChevronRight,
  Briefcase,
  FileText,
  Building2,
  Camera,
  type LucideIcon,
} from 'lucide-vue-next';
import { useAuthStore } from '@stores/auth';
import { useToastStore } from '@stores/toast';
import { useUploadStore } from '@stores/upload';
import {
  candidateApi,
  type CandidateProfile,
} from '@services/candidate.api';
import { userApi } from '@services/user.api';
import SocialRow from '@components/candidate/SocialRow.vue';
import LocationAutocomplete, {
  type LocationOption,
} from '@components/common/LocationAutocomplete.vue';
import { useLocations } from '@composables/useLocations';

/* ============================================================================
 * State
 * ==========================================================================*/

const profile = ref<CandidateProfile | null>(null);
const loading = ref(false);
const loadError = ref('');
const submitting = ref(false);

const toast = useToastStore();
const isEditing = ref(false);

interface FormState {
  fullName: string;
  phone: string;
  city: string;
  district: string;
  linkedin: string;
  github: string;
  portfolio: string;
}

const form = reactive<FormState>({
  fullName: '',
  phone: '',
  city: '',
  district: '',
  linkedin: '',
  github: '',
  portfolio: '',
});

const formErrors = reactive<Partial<Record<keyof FormState, string>>>({});

/* ============================================================================
 * Auth bindings — fallback avatar/name khi profile chưa load xong.
 * ==========================================================================*/
const auth = useAuthStore();
const { user } = storeToRefs(auth);

/* ============================================================================
 * Display helpers
 * ==========================================================================*/

const displayName = computed(() => {
  if (profile.value?.fullName) return profile.value.fullName;
  if (user.value?.fullName) return user.value.fullName;
  return 'Chưa cập nhật tên';
});

const displayEmail = computed(
  () => profile.value?.email ?? user.value?.email ?? '',
);

const displayAvatar = computed(
  () => profile.value?.avatarUrl ?? user.value?.avatarUrl ?? null,
);

/* ============================================================================
 * Avatar upload — click avatar trong overview → file picker → upload MinIO
 *                  → persist qua POST /auth/change-avatar → update local state.
 *
 * Flow chi tiết (xem `userApi.changeAvatar` JSDoc ở services/user.api.ts):
 *   1. View-level guard: kiểu MIME + size → fail-fast với message tiếng Việt.
 *   2. uploadStore.uploadImage(file, 'avatars') → POST /uploads/image → UploadResult.
 *   3. userApi.changeAvatar(url)               → POST /auth/change-avatar → DB update.
 *   4. Update `profile.value.avatarUrl` + `auth.user.avatarUrl` để mọi view
 *      render avatar mới ngay lập tức (sidebar, header, ...) — không cần re-fetch.
 *   5. Toast success → reset input value để chọn lại cùng file cũ vẫn trigger.
 *
 * Lưu ý:
 *   - Dùng `uploadStore.loading` (global) cho spinner vì avatar chỉ là 1 use case
 *     của store. Nếu user upload CV song song thì spinner vẫn đúng trạng thái.
 *   - KHÔNG có endpoint xoá avatar (changeAvatarSchema require URL) → nếu user
 *     muốn xoá avatar, backend cần thêm DELETE /auth/avatar. Để ngoài scope.
 * ==========================================================================*/

const uploadStore = useUploadStore();
const avatarInputRef = ref<HTMLInputElement | null>(null);

const avatarUploading = computed<boolean>(() => uploadStore.loading);
const avatarErrorMessage = computed<string | null>(() => uploadStore.error);

/** Validate phía trước để fail-fast với message tiếng Việt cụ thể.
 *  Trả về string error nếu invalid, null nếu OK. */
const validateAvatarFile = (file: File): string | null => {
  if (!file.type.startsWith('image/')) {
    return 'Vui lòng chọn file ảnh (JPG, PNG, WEBP, GIF).';
  }
  if (file.size > 5 * 1024 * 1024) {
    return 'Ảnh tối đa 5MB.';
  }
  return null;
};

const pickAvatar = (): void => {
  if (avatarUploading.value) return; // tránh click liên tục khi đang upload
  avatarInputRef.value?.click();
};

const handleAvatarChange = async (e: Event): Promise<void> => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  uploadStore.clearError();

  // 1. FE guard.
  const validationError = validateAvatarFile(file);
  if (validationError) {
    uploadStore.error = validationError;
    return;
  }

  // 2. Upload file lên MinIO qua store → trả `{ url, key, mime, size }`.
  const uploadResult = await uploadStore.uploadImage(file, 'avatars');
  if (!uploadResult) return; // store đã set error sẵn

  // 3. Persist URL vào user_profiles qua /auth/change-avatar.
  try {
    await userApi.changeAvatar(uploadResult.url);
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
    uploadStore.error =
      axiosErr?.response?.data?.error?.message ?? 'Cập nhật avatar thất bại.';
    return;
  }

  // 4. Cập nhật local state để mọi view render avatar mới ngay.
  if (profile.value) {
    profile.value.avatarUrl = uploadResult.url;
  }
  if (user.value) {
    auth.user = { ...user.value, avatarUrl: uploadResult.url };
  }

  toast.success('Đã cập nhật ảnh đại diện.');

  // 5. Reset input value để chọn lại cùng file vẫn trigger change event.
  target.value = '';
};

/** Location string rút gọn để hiển thị trong overview. */
const displayLocation = computed(() => {
  const city = profile.value?.location?.city?.trim();
  const district = profile.value?.location?.district?.trim();
  if (city && district) return `${district}, ${city}`;
  return city || district || '';
});

/* ============================================================================
 * Locations (tỉnh / quận-huyện)
 *
 * Dùng `useLocations` để fetch provinces + districts từ open-api.vn (depth=2)
 * 1 lần lúc mount. Cache ở module scope → remount không gọi lại.
 *
 * `currentProvince` map free-text city trong form → province code, dùng để
 * lookup districts tương ứng. Match case-insensitive với cả `name` lẫn
 * `shortName` để handle cả "Hà Nội" lẫn "Thành phố Hà Nội".
 *
 * `currentDistricts` reactive — UI sẽ tự update khi cache fill xong (khi
 * fetch xong lần đầu, các quận/huyện sẽ "pop in" trong datalist).
 *
 * Nếu user nhập city không match province nào (vd custom text cũ, hoặc
 * fallback 3 city không có districts) → currentProvince = null → datalist
 * rỗng cho district. Input vẫn cho free-text (datalist = suggestion only,
 * không validate).
 * ==========================================================================*/
const locations = useLocations();

const currentProvince = computed(() => {
  return locations.findProvinceByName(form.city);
});

const currentDistricts = computed(() => {
  const p = currentProvince.value;
  if (!p) return [];
  return locations.getDistricts(p.code);
});

/**
 * Helper cho template — vue-tsc thỉnh thoảng không auto-unwrap Ref khi truy
 * cập qua object literal return. Computed wrapper giúp infer rõ ràng.
 */
/**
 * Option list cho LocationAutocomplete — tỉnh/thành.
 *
 * Map từ `LocationItem` của composable sang shape mà LocationAutocomplete cần:
 *   - value:    chuỗi fill vào input khi user chọn → dùng `shortName`
 *               (vd "Hà Nội") để match với data job backend đang lưu.
 *   - label:    full name (vd "Thành phố Hà Nội") — hiện phụ bên phải option
 *               giúp user phân biệt khi search "Bà Rịa" vs "Bắc Ninh".
 *   - icon:     LucideMapPin + brand primary tone.
 */
const cityAutocompleteOptions = computed<LocationOption[]>(() =>
  locations.items.value.map((p) => ({
    value: p.shortName,
    label: p.name,
    icon: MapPin,
    iconClass: 'bg-primary-50 ring-primary-100 text-primary-600',
  })),
);

/**
 * Option list cho LocationAutocomplete — quận/huyện.
 *
 * Reactive — sẽ "pop in" khi `currentDistricts` fill xong sau khi location
 * fetch resolve. Trước khi user chọn province (hoặc nhập city không match)
 * thì list rỗng → dropdown panel không mở.
 *
 * `meta` = tên đầy đủ tỉnh cha (giúp user kiểm tra "Quận 1" thuộc HCM hay
 * thuộc Hà Nội — vì tên quận ở các tỉnh có thể trùng).
 */
const districtAutocompleteOptions = computed<LocationOption[]>(() =>
  currentDistricts.value.map((d) => ({
    value: d.name,
    meta: currentProvince.value?.name,
    icon: Building2,
    iconClass: 'bg-emerald-50 ring-emerald-100 text-emerald-700',
  })),
);

/**
 * User chọn province từ dropdown → reset district. Lý do:
 *   - User có thể chọn nhầm province → district cũ thuộc tỉnh cũ.
 *   - Reset chủ động tránh payload backend lưu district không khớp city.
 *
 * CHỈ reset khi user chọn từ dropdown (không phải khi gõ tay), vì:
 *   - Khi gõ, user có thể đang cố ý edit city nhưng vẫn muốn giữ district text.
 *   - Khi select option, intent rõ ràng → an toàn reset.
 *
 * LocationAutocomplete emit `select` khi click option / Enter / arrow nav.
 */
const onCitySelect = (_opt: LocationOption): void => {
  form.district = '';
};

/* ============================================================================
 * Profile completion %
 *
 * Tính từ data thật của profile (không hard-code). Mỗi filled field được
 * tính điểm theo trọng số — tổng 100%.
 *
 * Lưu ý:
 *   - Một field optional mà null/rỗng → 0 điểm.
 *   - Social: chỉ cần 1/3 link cũng được +5 điểm khuyến khích.
 *   - Location: city + district mỗi cái 10 điểm.
 * ==========================================================================*/
const completionBreakdown = computed(() => {
  const p = profile.value;
  const items: Array<{ label: string; filled: boolean }> = [];
  let earned = 0;

  // fullName — 20 điểm (quan trọng nhất).
  const fullNameFilled = Boolean(p?.fullName?.trim());
  if (fullNameFilled) earned += 20;
  items.push({ label: 'Họ và tên', filled: fullNameFilled });

  // phone — 15 điểm.
  const phoneFilled = Boolean(p?.phone?.trim());
  if (phoneFilled) earned += 15;
  items.push({ label: 'Số điện thoại', filled: phoneFilled });

  // avatar — 15 điểm.
  const avatarFilled = Boolean(p?.avatarUrl?.trim());
  if (avatarFilled) earned += 15;
  items.push({ label: 'Ảnh đại diện', filled: avatarFilled });

  // city — 10 điểm.
  const cityFilled = Boolean(p?.location?.city?.trim());
  if (cityFilled) earned += 10;
  items.push({ label: 'Tỉnh / Thành phố', filled: cityFilled });

  // district — 10 điểm.
  const districtFilled = Boolean(p?.location?.district?.trim());
  if (districtFilled) earned += 10;
  items.push({ label: 'Quận / Huyện', filled: districtFilled });

  // social — 10 điểm cho mỗi link (max 30).
  const linkedinFilled = Boolean(p?.social?.linkedin?.trim());
  const githubFilled = Boolean(p?.social?.github?.trim());
  const portfolioFilled = Boolean(p?.social?.portfolio?.trim());
  if (linkedinFilled) earned += 10;
  if (githubFilled) earned += 10;
  if (portfolioFilled) earned += 10;
  items.push({ label: 'LinkedIn', filled: linkedinFilled });
  items.push({ label: 'GitHub', filled: githubFilled });
  items.push({ label: 'Portfolio', filled: portfolioFilled });

  return { percentage: Math.min(100, earned), items };
});

const completionPercentage = computed(() => completionBreakdown.value.percentage);

const completionHint = computed(() => {
  const p = completionPercentage.value;
  if (p >= 90) return 'Hồ sơ rất ấn tượng!';
  if (p >= 70) return 'Hồ sơ khá tốt — thêm vài mục để hoàn thiện.';
  if (p >= 40) return 'Hoàn thiện hồ sơ để tăng cơ hội được nhà tuyển dụng chú ý.';
  return 'Bắt đầu xây dựng hồ sơ chuyên nghiệp của bạn.';
});

/* ============================================================================
 * Loading + sync
 * ==========================================================================*/

const loadProfile = async (): Promise<void> => {
  loading.value = true;
  loadError.value = '';
  try {
    const { data } = await candidateApi.getProfile();
    profile.value = data.data;
    syncFormFromProfile(data.data);
  } catch (e: any) {
    loadError.value =
      e?.response?.data?.error?.message ?? 'Không thể tải hồ sơ';
  } finally {
    loading.value = false;
  }
};

const syncFormFromProfile = (p: CandidateProfile): void => {
  form.fullName = p.fullName ?? '';
  form.phone = p.phone ?? '';
  form.city = p.location?.city ?? '';
  form.district = p.location?.district ?? '';
  form.linkedin = p.social?.linkedin ?? '';
  form.github = p.social?.github ?? '';
  form.portfolio = p.social?.portfolio ?? '';
};

onMounted(() => {
  // Locations fetch song song với profile — độc lập nhau, không cần đợi nhau.
  // useLocations() tự dedupe + cache ở module scope, nên gọi nhiều lần vẫn OK.
  void locations.fetch();
  void loadProfile();
});

/* ============================================================================
 * Edit mode + helpers
 * ==========================================================================*/

const startEdit = (): void => {
  if (!profile.value) return;
  isEditing.value = true;
};

const cancelEdit = (): void => {
  if (
    isDirty.value &&
    !confirm('Bạn có thay đổi chưa lưu. Hủy và quay lại dữ liệu cũ?')
  ) {
    return;
  }
  if (profile.value) syncFormFromProfile(profile.value);
  Object.keys(formErrors).forEach((k) => {
    delete formErrors[k as keyof FormState];
  });
  isEditing.value = false;
};

/**
 * Click CTA "+ Thêm ..." ở view mode → vào edit mode + focus field.
 * Reuse flow chỉnh sửa hiện tại — không tạo flow riêng.
 */
const focusField = (field: keyof FormState): void => {
  if (!profile.value) return;
  isEditing.value = true;
  void nextTick(() => {
    const el = document.getElementById(`profile-${field}`) as HTMLInputElement | null;
    el?.focus();
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
};

const isDirty = computed(() => {
  if (!profile.value) return false;
  return (
    (form.fullName.trim() || '') !== (profile.value.fullName || '') ||
    (form.phone.trim() || '') !== (profile.value.phone || '') ||
    (form.city.trim() || '') !== (profile.value.location?.city || '') ||
    (form.district.trim() || '') !== (profile.value.location?.district || '') ||
    (form.linkedin.trim() || '') !== (profile.value.social?.linkedin || '') ||
    (form.github.trim() || '') !== (profile.value.social?.github || '') ||
    (form.portfolio.trim() || '') !== (profile.value.social?.portfolio || '')
  );
});

/* ============================================================================
 * Validation
 * ==========================================================================*/

const validateForm = (): boolean => {
  Object.keys(formErrors).forEach((k) => {
    delete formErrors[k as keyof FormState];
  });

  const fullName = form.fullName.trim();
  if (fullName.length === 0) {
    formErrors.fullName = 'Vui lòng nhập họ tên';
  } else if (fullName.length < 2) {
    formErrors.fullName = 'Họ tên phải có ít nhất 2 ký tự';
  } else if (fullName.length > 100) {
    formErrors.fullName = 'Họ tên không quá 100 ký tự';
  }

  const phone = form.phone.trim();
  if (phone.length > 0 && !/^[\d\s+\-()]+$/.test(phone)) {
    formErrors.phone = 'Số điện thoại chỉ chứa chữ số và các ký tự + - ( )';
  }

  const urlFields: Array<['linkedin' | 'github' | 'portfolio', string]> = [
    ['linkedin', form.linkedin],
    ['github', form.github],
    ['portfolio', form.portfolio],
  ];
  for (const [key, raw] of urlFields) {
    const v = raw.trim();
    if (v.length === 0) continue;
    try {
      const u = new URL(v);
      if (!/^https?:$/.test(u.protocol)) {
        formErrors[key] = 'URL phải bắt đầu bằng http:// hoặc https://';
      }
    } catch {
      formErrors[key] = 'URL không hợp lệ';
    }
  }

  return Object.keys(formErrors).length === 0;
};

/* ============================================================================
 * Save
 * ==========================================================================*/

const save = async (): Promise<void> => {
  if (!validateForm()) return;
  submitting.value = true;
  try {
    const payload: Parameters<typeof candidateApi.updateProfile>[0] = {};

    const newFullName = form.fullName.trim();
    if (newFullName !== (profile.value?.fullName ?? '')) {
      payload.fullName = newFullName;
    }

    const newPhone = form.phone.trim();
    if (newPhone !== (profile.value?.phone ?? '')) {
      payload.phone = newPhone || undefined;
    }

    const oldLoc = profile.value?.location ?? null;
    const newCity = form.city.trim();
    const newDistrict = form.district.trim();
    const newLoc: { city?: string; district?: string } = {};
    let locChanged = false;
    if (newCity !== (oldLoc?.city ?? '')) {
      newLoc.city = newCity;
      locChanged = true;
    }
    if (newDistrict !== (oldLoc?.district ?? '')) {
      newLoc.district = newDistrict;
      locChanged = true;
    }
    if (locChanged) payload.location = newLoc;

    const oldSoc = profile.value?.social ?? null;
    const newSoc: { linkedin?: string; github?: string; portfolio?: string } = {};
    let socChanged = false;
    const socialFields: Array<['linkedin' | 'github' | 'portfolio', string]> = [
      ['linkedin', form.linkedin],
      ['github', form.github],
      ['portfolio', form.portfolio],
    ];
    for (const [key, raw] of socialFields) {
      const v = raw.trim();
      const oldVal = oldSoc?.[key] ?? '';
      if (v !== oldVal) {
        (newSoc[key] as string | undefined) = v || undefined;
        socChanged = true;
      }
    }
    if (socChanged) payload.social = newSoc;

    if (Object.keys(payload).length === 0) {
      toast.info('Không có thay đổi nào để lưu.');
      isEditing.value = false;
      return;
    }

    const { data } = await candidateApi.updateProfile(payload);
    profile.value = data.data;
    if (data.data.fullName && user.value) {
      auth.user = { ...user.value, fullName: data.data.fullName };
    }
    toast.success('Đã lưu hồ sơ thành công.');
    isEditing.value = false;
  } catch (e: any) {
    toast.error(
      e?.response?.data?.error?.message ?? 'Lưu hồ sơ thất bại.',
      { title: 'Lỗi' },
    );
  } finally {
    submitting.value = false;
  }
};

/* ============================================================================
 * UI helpers — section header + social row
 * ==========================================================================*/

interface SectionMeta {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Container bg theo tone primary. */
  iconWrapClass: string;
}

const SECTION_META: Record<'personal' | 'location' | 'social' | 'career', SectionMeta> = {
  personal: {
    title: 'Thông tin cá nhân',
    description: 'Tên, số điện thoại và email của bạn',
    icon: UserRound,
    iconWrapClass: 'bg-primary-50 ring-1 ring-primary-100 text-primary-600',
  },
  location: {
    title: 'Địa chỉ',
    description: 'Nơi bạn đang sinh sống',
    icon: MapPin,
    iconWrapClass: 'bg-primary-50 ring-1 ring-primary-100 text-primary-600',
  },
  social: {
    title: 'Liên kết mạng xã hội',
    description: 'Giúp nhà tuyển dụng tìm hiểu thêm về bạn',
    icon: Globe,
    iconWrapClass: 'bg-primary-50 ring-1 ring-primary-100 text-primary-600',
  },
  career: {
    title: 'Hồ sơ nghề nghiệp',
    description: 'CV và các thông tin nghề nghiệp',
    icon: Briefcase,
    iconWrapClass: 'bg-primary-50 ring-1 ring-primary-100 text-primary-600',
  },
};
</script>

<template>
  <div class="min-h-screen bg-[#F7F8FA]">
    <div class="mx-auto max-w-5xl px-4 sm:px-6 py-8 md:py-11">

      <!-- ============================== PAGE HEADER ============================== -->
      <header
        class="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
      >
        <div class="flex items-center gap-3.5">
          <div
            class="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 shadow-sm shrink-0"
          >
            <UserRound class="h-5 w-5 text-white" />
          </div>
          <div class="min-w-0">
            <h1 class="text-2xl md:text-[26px] font-bold tracking-tight text-slate-900 leading-tight">
              Hồ sơ của tôi
            </h1>
            <p class="text-sm text-slate-500 mt-0.5">
              Quản lý thông tin cá nhân và hồ sơ nghề nghiệp.
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 self-stretch md:self-auto">
          <button
            v-if="!isEditing"
            type="button"
            class="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-primary-600 text-sm font-semibold text-white shadow-sm shadow-primary-600/20 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!profile"
            @click="startEdit"
          >
            <Pencil class="h-4 w-4" />
            Chỉnh sửa
          </button>
          <template v-else>
            <button
              type="button"
              class="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="submitting"
              @click="cancelEdit"
            >
              <X class="h-4 w-4" />
              Huỷ
            </button>
            <button
              type="button"
              class="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-primary-600 text-sm font-semibold text-white shadow-sm shadow-primary-600/20 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="submitting || !isDirty"
              @click="save"
            >
              <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
              <Save v-else class="h-4 w-4" />
              {{ submitting ? 'Đang lưu...' : 'Lưu thay đổi' }}
            </button>
          </template>
        </div>
      </header>

      <!-- ============================== LOADING STATE ============================== -->
      <div
        v-if="loading && !profile"
        class="bg-white rounded-2xl border border-slate-200/70 flex flex-col items-center justify-center gap-3 min-h-[60vh]"
        role="status"
        aria-live="polite"
      >
        <div
          class="h-12 w-12 rounded-full bg-primary-50 ring-1 ring-primary-100 inline-flex items-center justify-center"
        >
          <Loader2 class="h-6 w-6 text-primary-600 animate-spin" />
        </div>
        <p class="text-sm font-medium text-slate-600">Đang tải hồ sơ…</p>
      </div>

      <!-- ============================== LOAD ERROR ============================== -->
      <div
        v-else-if="loadError && !profile"
        class="bg-white rounded-2xl border border-slate-200/70 p-8 text-center"
      >
        <div
          class="mx-auto h-12 w-12 rounded-full bg-red-50 ring-1 ring-red-100 inline-flex items-center justify-center mb-3"
        >
          <AlertCircle class="h-6 w-6 text-red-500" />
        </div>
        <p class="text-sm text-red-700 mb-4">{{ loadError }}</p>
        <button
          type="button"
          class="inline-flex items-center justify-center gap-1.5 h-9 px-4 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition"
          @click="loadProfile"
        >
          Thử lại
        </button>
      </div>

      <!-- ============================== PROFILE CONTENT ============================== -->
      <div v-else-if="profile" class="space-y-5">

        <!-- ====== PROFILE OVERVIEW ====== -->
        <section
          class="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-900/[0.02] overflow-hidden"
        >
          <div class="p-6 sm:p-7">
            <div class="flex flex-col sm:flex-row sm:items-start gap-5">
              <!-- Avatar — click để upload (max 5MB, image/*, folder='avatars') -->
              <div class="shrink-0 group relative">
                <button
                  type="button"
                  class="relative flex items-center justify-center h-20 w-20 sm:h-24 sm:w-24 rounded-2xl bg-gradient-to-br from-primary-100 to-primary-50 ring-1 ring-primary-100 overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition disabled:cursor-not-allowed disabled:opacity-70"
                  :disabled="avatarUploading"
                  :aria-label="displayAvatar ? 'Đổi ảnh đại diện' : 'Thêm ảnh đại diện'"
                  @click="pickAvatar"
                >
                  <img
                    v-if="displayAvatar"
                    :src="displayAvatar"
                    :alt="displayName"
                    class="h-full w-full object-cover transition"
                    :class="{ 'opacity-60': avatarUploading }"
                    @error="($event.target as HTMLImageElement).style.display = 'none'"
                  />
                  <UserRound v-else class="h-9 w-9 sm:h-11 sm:w-11 text-primary-600" />
                </button>

                <!-- Hover overlay (idle) — gợi ý "Đổi ảnh" -->
                <span
                  v-if="!avatarUploading"
                  class="absolute inset-0 flex items-center justify-center gap-1.5 rounded-2xl bg-slate-900/55 text-white opacity-0 group-hover:opacity-100 transition pointer-events-none"
                >
                  <Camera class="h-4 w-4" aria-hidden="true" />
                  <span class="text-xs font-medium">Đổi ảnh</span>
                </span>

                <!-- Upload overlay (active) — spinner, luôn hiển thị -->
                <span
                  v-if="avatarUploading"
                  class="absolute inset-0 flex items-center justify-center rounded-2xl bg-slate-900/65 text-white pointer-events-none"
                >
                  <Loader2 class="h-5 w-5 animate-spin" aria-hidden="true" />
                </span>

                <!-- Hidden file input — trigger bằng JS qua pickAvatar() -->
                <input
                  ref="avatarInputRef"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  class="hidden"
                  @change="handleAvatarChange"
                />

                <!-- Inline error message dưới avatar (chỉ hiện khi upload fail) -->
                <p
                  v-if="avatarErrorMessage"
                  role="alert"
                  class="mt-1.5 ml-1 max-w-[6rem] sm:max-w-[7rem] text-[11px] leading-tight text-red-600 inline-flex items-start gap-1"
                >
                  <AlertCircle class="h-3 w-3 mt-0.5 shrink-0" />
                  <span class="break-words">{{ avatarErrorMessage }}</span>
                </p>
              </div>

              <!-- Identity -->
              <div class="flex-1 min-w-0">
                <div class="flex items-start justify-between gap-3 flex-wrap">
                  <div class="min-w-0">
                    <h2 class="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 truncate">
                      {{ displayName }}
                    </h2>
                    <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                      <span class="inline-flex items-center gap-1.5 text-slate-600 min-w-0">
                        <Mail class="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span class="truncate">{{ displayEmail }}</span>
                      </span>
                      <span
                        class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100"
                      >
                        <BadgeCheck class="h-3 w-3" />
                        Đã xác thực
                      </span>
                    </div>
                    <p
                      v-if="displayLocation"
                      class="mt-1.5 inline-flex items-center gap-1.5 text-sm text-slate-500"
                    >
                      <MapPin class="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      {{ displayLocation }}
                    </p>
                  </div>
                </div>

                <!-- Completion -->
                <div class="mt-5">
                  <div class="flex items-center justify-between mb-1.5">
                    <span class="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Mức độ hoàn thiện hồ sơ
                    </span>
                    <span class="text-sm font-bold text-primary-700 tabular-nums">
                      {{ completionPercentage }}%
                    </span>
                  </div>
                  <div
                    class="h-2 w-full rounded-full bg-slate-100 overflow-hidden"
                    :aria-label="`Mức độ hoàn thiện hồ sơ ${completionPercentage}%`"
                    role="progressbar"
                    :aria-valuenow="completionPercentage"
                    aria-valuemin="0"
                    aria-valuemax="100"
                  >
                    <div
                      class="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-600 shadow-[0_0_8px_rgba(37,99,235,0.35)] transition-[width] duration-700 ease-out"
                      :style="{ width: completionPercentage + '%' }"
                    />
                  </div>
                  <p
                    class="mt-2 text-xs text-slate-500 inline-flex items-center gap-1.5"
                  >
                    <Sparkles class="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    {{ completionHint }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ============================== PERSONAL INFO ============================== -->
        <section
          class="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-900/[0.02] overflow-hidden"
        >
          <header
            class="px-6 sm:px-7 pt-6 pb-4 flex items-center gap-3 border-b border-slate-100"
          >
            <span
              :class="[
                'inline-flex h-9 w-9 items-center justify-center rounded-lg shrink-0',
                SECTION_META.personal.iconWrapClass,
              ]"
            >
              <component :is="SECTION_META.personal.icon" class="h-4 w-4" />
            </span>
            <div class="flex-1 min-w-0">
              <h3 class="text-base font-semibold text-slate-900">
                {{ SECTION_META.personal.title }}
              </h3>
              <p class="text-xs text-slate-500 mt-0.5">
                {{ SECTION_META.personal.description }}
              </p>
            </div>
          </header>

          <div class="px-6 sm:px-7 py-6 space-y-5">
            <!-- Họ và tên -->
            <div>
              <label
                for="profile-fullName"
                class="block text-sm font-medium text-slate-700 mb-1.5"
              >
                Họ và tên
                <span class="text-red-500">*</span>
              </label>
              <div v-if="!isEditing">
                <p class="text-[15px] font-medium text-slate-900">
                  {{ profile.fullName || '—' }}
                </p>
                <button
                  v-if="!profile.fullName"
                  type="button"
                  class="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700 transition"
                  @click="focusField('fullName')"
                >
                  <Plus class="h-3.5 w-3.5" />
                  Thêm họ và tên
                </button>
              </div>
              <template v-else>
                <input
                  id="profile-fullName"
                  v-model="form.fullName"
                  type="text"
                  maxlength="100"
                  autocomplete="name"
                  class="block w-full rounded-lg border bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:outline-none focus:ring-2"
                  :class="formErrors.fullName
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500/30'
                    : 'border-slate-300 focus:border-primary-500 focus:ring-primary-500/30'"
                  placeholder="Nguyễn Văn A"
                />
                <p v-if="formErrors.fullName" class="mt-1 text-xs text-red-600">
                  {{ formErrors.fullName }}
                </p>
              </template>
            </div>

            <!-- Số điện thoại -->
            <div>
              <label
                for="profile-phone"
                class="block text-sm font-medium text-slate-700 mb-1.5"
              >
                Số điện thoại
              </label>
              <div v-if="!isEditing">
                <div v-if="profile.phone" class="flex items-center gap-2 text-[15px] font-medium text-slate-900">
                  <Phone class="h-4 w-4 text-slate-400 shrink-0" />
                  {{ profile.phone }}
                </div>
                <button
                  v-else
                  type="button"
                  class="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700 transition"
                  @click="focusField('phone')"
                >
                  <Plus class="h-3.5 w-3.5" />
                  Thêm số điện thoại
                </button>
              </div>
              <template v-else>
                <div class="relative">
                  <span
                    class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  >
                    <Phone class="h-4 w-4" />
                  </span>
                  <input
                    id="profile-phone"
                    v-model="form.phone"
                    type="tel"
                    maxlength="20"
                    autocomplete="tel"
                    class="block w-full rounded-lg border bg-white pl-9 pr-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:outline-none focus:ring-2"
                    :class="formErrors.phone
                      ? 'border-red-300 focus:border-red-500 focus:ring-red-500/30'
                      : 'border-slate-300 focus:border-primary-500 focus:ring-primary-500/30'"
                    placeholder="0901234567"
                  />
                </div>
                <p v-if="formErrors.phone" class="mt-1 text-xs text-red-600">
                  {{ formErrors.phone }}
                </p>
              </template>
            </div>

            <!-- Email (read-only) -->
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1.5">
                Email
              </label>
              <div
                class="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-200/60 px-3.5 py-2 text-sm"
              >
                <Mail class="h-4 w-4 text-slate-400 shrink-0" />
                <span class="text-slate-700 truncate flex-1">{{ displayEmail }}</span>
                <span
                  class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100 shrink-0"
                >
                  <BadgeCheck class="h-3 w-3" />
                  Đã xác thực
                </span>
              </div>
              <p class="mt-1.5 text-[11px] text-slate-400 inline-flex items-center gap-1">
                <Sparkles class="h-3 w-3 text-amber-500" />
                Email là bất biến — đổi email cần xác thực OTP riêng.
              </p>
            </div>
          </div>
        </section>

        <!-- ============================== LOCATION ============================== -->
        <section
          class="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-900/[0.02] overflow-hidden"
        >
          <header
            class="px-6 sm:px-7 pt-6 pb-4 flex items-center gap-3 border-b border-slate-100"
          >
            <span
              :class="[
                'inline-flex h-9 w-9 items-center justify-center rounded-lg shrink-0',
                SECTION_META.location.iconWrapClass,
              ]"
            >
              <component :is="SECTION_META.location.icon" class="h-4 w-4" />
            </span>
            <div class="flex-1 min-w-0">
              <h3 class="text-base font-semibold text-slate-900">
                {{ SECTION_META.location.title }}
              </h3>
              <p class="text-xs text-slate-500 mt-0.5">
                {{ SECTION_META.location.description }}
              </p>
            </div>
          </header>

          <div class="px-6 sm:px-7 py-6">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <!-- Tỉnh/Thành phố -->
              <div>
                <label
                  for="profile-city"
                  class="block text-sm font-medium text-slate-700 mb-1.5"
                >
                  Tỉnh / Thành phố
                </label>
                <div v-if="!isEditing">
                  <p class="text-[15px] font-medium text-slate-900">
                    {{ profile.location?.city || '—' }}
                  </p>
                  <button
                    v-if="!profile.location?.city"
                    type="button"
                    class="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700 transition"
                    @click="focusField('city')"
                  >
                    <Plus class="h-3.5 w-3.5" />
                    Thêm tỉnh / thành phố
                  </button>
                </div>
                <LocationAutocomplete
                  v-else
                  id="profile-city"
                  v-model="form.city"
                  :options="cityAutocompleteOptions"
                  placeholder="TP. Hồ Chí Minh"
                  :max-options="80"
                  @select="onCitySelect"
                />
              </div>

              <!-- Quận/Huyện -->
              <div>
                <label
                  for="profile-district"
                  class="block text-sm font-medium text-slate-700 mb-1.5"
                >
                  Quận / Huyện
                </label>
                <div v-if="!isEditing">
                  <p class="text-[15px] font-medium text-slate-900">
                    {{ profile.location?.district || '—' }}
                  </p>
                  <button
                    v-if="!profile.location?.district"
                    type="button"
                    class="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700 transition"
                    @click="focusField('district')"
                  >
                    <Plus class="h-3.5 w-3.5" />
                    Thêm quận / huyện
                  </button>
                </div>
                <LocationAutocomplete
                  v-else
                  id="profile-district"
                  v-model="form.district"
                  :options="districtAutocompleteOptions"
                  :placeholder="currentProvince ? 'Chọn hoặc nhập quận/huyện' : 'Nhập quận/huyện'"
                  :disabled="locations.loading && districtAutocompleteOptions.length === 0"
                  :max-options="80"
                />
                <p
                  v-if="!currentProvince && form.city"
                  class="mt-1 text-[11px] text-slate-400"
                >
                  Chọn tỉnh/thành để xem gợi ý quận/huyện.
                </p>
              </div>
            </div>
          </div>
        </section>

        <!-- ============================== SOCIAL LINKS ============================== -->
        <section
          class="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-900/[0.02] overflow-hidden"
        >
          <header
            class="px-6 sm:px-7 pt-6 pb-4 flex items-center gap-3 border-b border-slate-100"
          >
            <span
              :class="[
                'inline-flex h-9 w-9 items-center justify-center rounded-lg shrink-0',
                SECTION_META.social.iconWrapClass,
              ]"
            >
              <component :is="SECTION_META.social.icon" class="h-4 w-4" />
            </span>
            <div class="flex-1 min-w-0">
              <h3 class="text-base font-semibold text-slate-900">
                {{ SECTION_META.social.title }}
              </h3>
              <p class="text-xs text-slate-500 mt-0.5">
                {{ SECTION_META.social.description }}
              </p>
            </div>
          </header>

          <div class="px-6 sm:px-7 py-6 space-y-3">
            <!-- LinkedIn -->
            <SocialRow
              v-if="!isEditing"
              icon="linkedin"
              label="LinkedIn"
              :value="profile.social?.linkedin"
              empty-cta="Thêm LinkedIn"
              @add="focusField('linkedin')"
            />
            <div v-else>
              <label for="profile-linkedin" class="sr-only">LinkedIn</label>
              <div class="relative">
                <span
                  class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                >
                  <Linkedin class="h-4 w-4" />
                </span>
                <input
                  id="profile-linkedin"
                  v-model="form.linkedin"
                  type="url"
                  maxlength="500"
                  class="block w-full rounded-lg border bg-white pl-9 pr-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:outline-none focus:ring-2"
                  :class="formErrors.linkedin
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500/30'
                    : 'border-slate-300 focus:border-primary-500 focus:ring-primary-500/30'"
                  placeholder="https://linkedin.com/in/username"
                />
              </div>
              <p v-if="formErrors.linkedin" class="mt-1 text-xs text-red-600">
                {{ formErrors.linkedin }}
              </p>
            </div>

            <!-- GitHub -->
            <SocialRow
              v-if="!isEditing"
              icon="github"
              label="GitHub"
              :value="profile.social?.github"
              empty-cta="Thêm GitHub"
              @add="focusField('github')"
            />
            <div v-else>
              <label for="profile-github" class="sr-only">GitHub</label>
              <div class="relative">
                <span
                  class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                >
                  <Github class="h-4 w-4" />
                </span>
                <input
                  id="profile-github"
                  v-model="form.github"
                  type="url"
                  maxlength="500"
                  class="block w-full rounded-lg border bg-white pl-9 pr-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:outline-none focus:ring-2"
                  :class="formErrors.github
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500/30'
                    : 'border-slate-300 focus:border-primary-500 focus:ring-primary-500/30'"
                  placeholder="https://github.com/username"
                />
              </div>
              <p v-if="formErrors.github" class="mt-1 text-xs text-red-600">
                {{ formErrors.github }}
              </p>
            </div>

            <!-- Portfolio -->
            <SocialRow
              v-if="!isEditing"
              icon="portfolio"
              label="Portfolio"
              :value="profile.social?.portfolio"
              empty-cta="Thêm Portfolio"
              @add="focusField('portfolio')"
            />
            <div v-else>
              <label for="profile-portfolio" class="sr-only">Portfolio</label>
              <div class="relative">
                <span
                  class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                >
                  <Globe class="h-4 w-4" />
                </span>
                <input
                  id="profile-portfolio"
                  v-model="form.portfolio"
                  type="url"
                  maxlength="500"
                  class="block w-full rounded-lg border bg-white pl-9 pr-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:outline-none focus:ring-2"
                  :class="formErrors.portfolio
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500/30'
                    : 'border-slate-300 focus:border-primary-500 focus:ring-primary-500/30'"
                  placeholder="https://yourportfolio.com"
                />
              </div>
              <p v-if="formErrors.portfolio" class="mt-1 text-xs text-red-600">
                {{ formErrors.portfolio }}
              </p>
            </div>
          </div>
        </section>

        <!-- ============================== CAREER ============================== -->
        <section
          class="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-900/[0.02] overflow-hidden"
        >
          <header
            class="px-6 sm:px-7 pt-6 pb-4 flex items-center gap-3 border-b border-slate-100"
          >
            <span
              :class="[
                'inline-flex h-9 w-9 items-center justify-center rounded-lg shrink-0',
                SECTION_META.career.iconWrapClass,
              ]"
            >
              <component :is="SECTION_META.career.icon" class="h-4 w-4" />
            </span>
            <div class="flex-1 min-w-0">
              <h3 class="text-base font-semibold text-slate-900">
                {{ SECTION_META.career.title }}
              </h3>
              <p class="text-xs text-slate-500 mt-0.5">
                {{ SECTION_META.career.description }}
              </p>
            </div>
          </header>

          <div class="px-6 sm:px-7 py-6 space-y-3">
            <RouterLink
              :to="{ name: 'my-resumes' }"
              class="group flex items-center gap-3.5 rounded-xl border border-slate-200/70 bg-white p-3.5 transition-all hover:border-primary-300 hover:shadow-sm hover:bg-primary-50/30 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
            >
              <span
                class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 ring-1 ring-primary-100 text-primary-600 transition group-hover:bg-primary-100"
              >
                <FileText class="h-5 w-5" />
              </span>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-slate-900">CV của tôi</p>
                <p class="text-xs text-slate-500 mt-0.5">
                  Tạo và quản lý CV chuyên nghiệp
                </p>
              </div>
              <ChevronRight
                class="h-4 w-4 text-slate-400 transition group-hover:text-primary-600 group-hover:translate-x-0.5"
              />
            </RouterLink>

            <p class="text-xs text-slate-400 inline-flex items-center gap-1.5 pt-1">
              <TrendingUp class="h-3.5 w-3.5" />
              Tạo CV đầu tiên để nhà tuyển dụng dễ dàng tìm thấy bạn.
            </p>
          </div>
        </section>

      </div>
    </div>
  </div>
</template>

<!-- ============================================================================
 * Inline component SocialRow đã được tách ra file riêng
 * @/components/candidate/SocialRow.vue — import ở <script setup> trên đầu file.
 * Tách riêng để tránh duplicate-import giữa <script setup> và <script> thường.
 * ==========================================================================-->
