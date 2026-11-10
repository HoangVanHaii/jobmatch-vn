<script setup lang="ts">
/**
 * Employer Profile & Settings View — Trang hồ sơ & Cài đặt dành cho Nhà tuyển dụng
 * Gồm các tab:
 *  1. Thông tin cá nhân & Chức vụ
 *  2. Công ty tuyển dụng
 *  3. Địa chỉ làm việc
 *  4. Mạng xã hội
 *  5. Đổi mật khẩu
 *  6. Dịch vụ (Google Calendar, Meet sync, tự động hóa phỏng vấn)
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@stores/auth';
import { useToastStore } from '@stores/toast';
import { uploadApi } from '@services/upload.api';
import { authApi } from '@services/auth.api';
import { userApi } from '@services/user.api';
import { companyApi } from '@services/company.api';
import { interviewApi, type CalendarStatus } from '@services/interview.api';
import { useLocations } from '@composables/useLocations';
import { extractErrorMessage, extractErrorCode } from '@services/http';
import type { MyCompany, Company } from '@/types/company';
import GoogleCalendarConnectCard from '@/components/employer/GoogleCalendarConnectCard.vue';
import {
  User,
  Camera,
  Mail,
  Phone,
  Briefcase,
  Building2,
  MapPin,
  MapPinned,
  Globe,
  Lock,
  KeyRound,
  Check,
  X,
  Pencil,
  Plus as PlusIcon,
  Trash2,
  Eye,
  EyeOff,
  Calendar,
  Sparkles,
  Video,
  Clock,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  Navigation,
  RotateCw,
  Home,
  Loader2,
  Linkedin,
  Facebook,
  Twitter,
  Youtube,
  Instagram,
  Layers,
  Bot,
  MessageSquare
} from 'lucide-vue-next';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToastStore();

// ===== Trạng thái tải profile =====
const isProfileLoading = ref<boolean>(true);
let isProfileMounted = true;

// ===== Profile user data =====
interface EmployerProfileData {
  userId?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  coverUrl?: string;
  location?: {
    city?: string;
    district?: string;
    address?: string;
    lat?: number;
    lng?: number;
  };
  social?: Record<string, string>;
  preferences?: Record<string, unknown>;
  metadata?: {
    title?: string;
    department?: string;
    bio?: string;
    [key: string]: unknown;
  };
}

const savedProfile = ref<EmployerProfileData | null>(null);

// Computed profile info
const profileName = computed(() => {
  return auth.user?.fullName?.trim() || savedProfile.value?.fullName?.trim() || 'Nhà tuyển dụng';
});

const profileAvatar = computed(() => {
  return auth.user?.avatarUrl || savedProfile.value?.avatarUrl || '';
});

const profileInitial = computed(() => {
  return profileName.value.charAt(0).toUpperCase() || 'E';
});

const profileEmail = computed(() => {
  return auth.user?.email || savedProfile.value?.email || '';
});

// Title / Department / Bio from metadata
const profileTitle = computed(() => {
  return savedProfile.value?.metadata?.title || '';
});

const profileDepartment = computed(() => {
  return savedProfile.value?.metadata?.department || '';
});

const profileBio = computed(() => {
  return savedProfile.value?.metadata?.bio || '';
});

const profilePhone = computed(() => {
  return savedProfile.value?.phone || '';
});

// ===== Cover photo =====
const DEFAULT_COVER =
  'https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=1400&q=80';

const isCoverImageLoaded = ref<boolean>(false);
const coverImageRef = ref<HTMLImageElement | null>(null);

const resolvedCoverUrl = computed<string | null>(() => {
  if (isProfileLoading.value) return null;
  return savedProfile.value?.coverUrl || DEFAULT_COVER;
});

const onCoverImageLoad = (): void => {
  isCoverImageLoaded.value = true;
};
const onCoverImageError = (): void => {
  isCoverImageLoaded.value = true;
};

// ===== Tabs =====
export type EmployerProfileTab =
  | 'Thông tin'
  | 'Công ty'
  | 'Địa chỉ'
  | 'Mạng xã hội'
  | 'Đổi mật khẩu'
  | 'Dịch vụ';

const profileTabs: readonly EmployerProfileTab[] = [
  'Thông tin',
  'Công ty',
  'Địa chỉ',
  'Mạng xã hội',
  'Đổi mật khẩu',
  'Dịch vụ',
];

const activeProfileTab = ref<EmployerProfileTab>('Thông tin');

// Đồng bộ tab từ URL query nếu có (ví dụ: ?tab=dich-vu)
const parseTabFromQuery = (tabQuery: unknown): EmployerProfileTab => {
  if (typeof tabQuery !== 'string') return 'Thông tin';
  const q = tabQuery.toLowerCase();
  if (q === 'dich-vu' || q === 'services' || q === 'calendar') return 'Dịch vụ';
  if (q === 'cong-ty' || q === 'company') return 'Công ty';
  if (q === 'dia-chi' || q === 'address') return 'Địa chỉ';
  if (q === 'mang-xa-hoi' || q === 'social') return 'Mạng xã hội';
  if (q === 'doi-mat-khau' || q === 'password') return 'Đổi mật khẩu';
  return 'Thông tin';
};

const switchTab = (tab: EmployerProfileTab): void => {
  activeProfileTab.value = tab;
};

// ===== Calendar Status (cho badge tab Dịch vụ) =====
const calendarStatus = ref<CalendarStatus>({ isConnected: false });

const checkCalendarStatus = async (): Promise<void> => {
  try {
    const res = await interviewApi.getCalendarStatus();
    if (res.data?.success && res.data.data) {
      calendarStatus.value = res.data.data;
    }
  } catch {
    // ignore
  }
};

// ===== Mạng xã hội =====
const savedSocial = ref<Record<string, string>>({
  linkedin: '',
  website: '',
  facebook: '',
});

interface SocialItem {
  key: string;
  label: string;
  placeholder: string;
  value: string;
  icon: any;
  isCustom?: boolean;
}

const getSocialIcon = (keyOrName: string) => {
  const k = keyOrName.toLowerCase();
  if (k.includes('linkedin')) return Linkedin;
  if (k.includes('facebook') || k.includes('fb')) return Facebook;
  if (k.includes('twitter') || k.includes('tweet') || k === 'x') return Twitter;
  if (k.includes('youtube') || k.includes('yt')) return Youtube;
  if (k.includes('instagram') || k.includes('insta')) return Instagram;
  return Globe;
};

const formatSocialLabel = (key: string): string => {
  if (key === 'linkedin') return 'LinkedIn';
  if (key === 'website') return 'Website doanh nghiệp';
  if (key === 'facebook') return 'Facebook';
  if (key === 'twitter') return 'Twitter / X';
  if (key === 'youtube') return 'YouTube';
  if (key === 'instagram') return 'Instagram';
  return key
    .split(/[_-\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
};

const socialItems = computed<SocialItem[]>(() => {
  const baseKeys = ['linkedin', 'website', 'facebook'];
  const items: SocialItem[] = [
    {
      key: 'linkedin',
      label: 'LinkedIn',
      placeholder: 'https://linkedin.com/in/ten-cua-ban',
      value: savedSocial.value.linkedin || '',
      icon: Linkedin,
      isCustom: false,
    },
    {
      key: 'website',
      label: 'Website doanh nghiệp / cá nhân',
      placeholder: 'https://cong-ty-cua-ban.com',
      value: savedSocial.value.website || '',
      icon: Globe,
      isCustom: false,
    },
    {
      key: 'facebook',
      label: 'Facebook',
      placeholder: 'https://facebook.com/ten-trang',
      value: savedSocial.value.facebook || '',
      icon: Facebook,
      isCustom: false,
    },
  ];

  for (const [k, val] of Object.entries(savedSocial.value)) {
    if (!baseKeys.includes(k) && val) {
      items.push({
        key: k,
        label: formatSocialLabel(k),
        placeholder: 'https://...',
        value: val,
        icon: getSocialIcon(k),
        isCustom: true,
      });
    }
  }

  return items;
});

const socialCount = computed(() => {
  const count = Object.values(savedSocial.value).filter(Boolean).length;
  return count > 0 ? count : undefined;
});

const shortUrl = (url: string): string =>
  url.replace(/^https?:\/\//, '').replace(/\/$/, '');

// Inline edit cho Mạng xã hội
const editingSocialKey = ref<string | null>(null);
const socialDraft = ref<string>('');

const startEditSingleSocial = (key: string, currentValue?: string): void => {
  editingSocialKey.value = key;
  socialDraft.value = currentValue ?? '';
};

const cancelEditSingleSocial = (): void => {
  editingSocialKey.value = null;
  socialDraft.value = '';
};

const saveSingleSocial = async (key: string): Promise<void> => {
  let val = socialDraft.value.trim();
  if (val && !/^https?:\/\//i.test(val)) {
    val = `https://${val}`;
  }
  if (val) {
    try {
      new URL(val);
    } catch {
      toast.push({
        variant: 'error',
        title: 'URL không hợp lệ',
        body: 'Vui lòng nhập đường dẫn hợp lệ (ví dụ: https://...)',
      });
      return;
    }
  }

  try {
    const updated = { ...savedSocial.value, [key]: val };
    if (!val && !['linkedin', 'website', 'facebook'].includes(key)) {
      delete updated[key];
    }
    await authApi.upsertProfile({ social: updated });
    savedSocial.value = updated;
    cancelEditSingleSocial();
    toast.push({ variant: 'success', title: 'Đã cập nhật mạng xã hội' });
  } catch (err: unknown) {
    toast.push({
      variant: 'error',
      title: 'Cập nhật thất bại',
      body: extractErrorMessage(err, 'Vui lòng thử lại'),
    });
  }
};

// Thêm mạng xã hội mới
const isAddingSocial = ref(false);
const newSocialName = ref('');
const newSocialUrl = ref('');
const addingSocialLoading = ref(false);

const startAddSocial = (): void => {
  newSocialName.value = '';
  newSocialUrl.value = '';
  isAddingSocial.value = true;
};

const cancelAddSocial = (): void => {
  isAddingSocial.value = false;
  newSocialName.value = '';
  newSocialUrl.value = '';
};

const saveNewSocial = async (): Promise<void> => {
  const name = newSocialName.value.trim();
  let url = newSocialUrl.value.trim();

  if (!name) {
    toast.push({
      variant: 'error',
      title: 'Thiếu tên mạng xã hội',
      body: 'Vui lòng nhập tên mạng xã hội (ví dụ: YouTube, Twitter, GitHub...)',
    });
    return;
  }
  if (!url) {
    toast.push({
      variant: 'error',
      title: 'Thiếu liên kết',
      body: 'Vui lòng nhập đường dẫn URL liên kết',
    });
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    new URL(url);
  } catch {
    toast.push({
      variant: 'error',
      title: 'URL không hợp lệ',
      body: 'Vui lòng nhập đường dẫn hợp lệ (ví dụ: https://...)',
    });
    return;
  }

  const key =
    name.toLowerCase().replace(/[\s\-_]+/g, '_').replace(/[^a-z0-9_]/g, '') ||
    `social_${Date.now()}`;

  addingSocialLoading.value = true;
  try {
    const updated = { ...savedSocial.value, [key]: url };
    await authApi.upsertProfile({ social: updated });
    savedSocial.value = updated;
    cancelAddSocial();
    toast.push({
      variant: 'success',
      title: 'Đã thêm mạng xã hội',
      body: `${name}: ${shortUrl(url)}`,
    });
  } catch (err: unknown) {
    toast.push({
      variant: 'error',
      title: 'Thêm thất bại',
      body: extractErrorMessage(err, 'Vui lòng thử lại'),
    });
  } finally {
    addingSocialLoading.value = false;
  }
};

const deleteSocial = async (key: string, label: string): Promise<void> => {
  try {
    const updated = { ...savedSocial.value };
    delete updated[key];
    await authApi.upsertProfile({ social: updated });
    savedSocial.value = updated;
    toast.push({
      variant: 'success',
      title: 'Đã xóa liên kết',
      body: `Đã xóa liên kết ${label}`,
    });
  } catch (err: unknown) {
    toast.push({
      variant: 'error',
      title: 'Xóa thất bại',
      body: extractErrorMessage(err, 'Vui lòng thử lại'),
    });
  }
};

// ===== Inline edit Thông tin cá nhân =====
const editingInfoKey = ref<string | null>(null);
const infoDraft = ref<string>('');

const startEditInfo = (key: string, currentValue?: string): void => {
  editingInfoKey.value = key;
  infoDraft.value = currentValue ?? '';
};

const cancelEditInfo = (): void => {
  editingInfoKey.value = null;
  infoDraft.value = '';
};

const saveInfo = async (key: 'fullName' | 'title' | 'department' | 'phone' | 'bio'): Promise<void> => {
  const val = infoDraft.value.trim();

  if (key === 'fullName') {
    if (val.length < 2) {
      toast.push({ variant: 'error', title: 'Họ tên quá ngắn', body: 'Tối thiểu 2 ký tự' });
      return;
    }
  }

  try {
    if (key === 'fullName') {
      await authApi.upsertProfile({ fullName: val });
      if (auth.user) auth.user = { ...auth.user, fullName: val };
      if (savedProfile.value) savedProfile.value.fullName = val;
    } else if (key === 'phone') {
      await authApi.upsertProfile({ phone: val });
      if (savedProfile.value) savedProfile.value.phone = val;
    } else {
      // title, department, bio thuộc metadata
      const currentMeta = savedProfile.value?.metadata || {};
      const updatedMeta = { ...currentMeta, [key]: val };
      await authApi.upsertProfile({ metadata: updatedMeta });
      if (savedProfile.value) {
        savedProfile.value.metadata = updatedMeta;
      }
    }

    cancelEditInfo();
    toast.push({ variant: 'success', title: 'Đã cập nhật thông tin' });
  } catch (err: unknown) {
    toast.push({
      variant: 'error',
      title: 'Cập nhật thất bại',
      body: extractErrorMessage(err, 'Vui lòng thử lại'),
    });
  }
};

// ===== Công ty tuyển dụng =====
const companyLoading = ref(false);
const myCompany = ref<MyCompany | null>(null);
const fullCompany = ref<Company | null>(null);

const loadCompanyData = async (): Promise<void> => {
  try {
    companyLoading.value = true;
    const res = await companyApi.getMyCompany();
    if (res.data?.success && res.data.data) {
      myCompany.value = res.data.data;
      if (myCompany.value.id) {
        const fullRes = await companyApi.getById(myCompany.value.id);
        if (fullRes.data?.success && fullRes.data.data) {
          fullCompany.value = fullRes.data.data;
        }
      }
    }
  } catch {
    // ignore
  } finally {
    companyLoading.value = false;
  }
};

// ===== Địa chỉ & Tích hợp Bản đồ =====
const {
  items: provinces,
  loading: locationsLoading,
  fetch: fetchLocations,
  getDistricts,
} = useLocations();

const isEditingAddress = ref(false);
const savingAddress = ref(false);
const geocodingLoading = ref(false);

const draftProvinceCode = ref<number | null>(79);
const draftDistrictCode = ref<number | null>(null);
const draftStreet = ref<string>('');

const savedProvinceCode = ref<number | null>(79);
const savedDistrictCode = ref<number | null>(null);
const savedStreet = ref<string>('');

const pickedLat = ref<number | null>(null);
const pickedLng = ref<number | null>(null);
const previewBbox = ref<string | null>(null);
const previewMarker = ref<string | null>(null);

const DEFAULT_MAP_BBOX = '106.65,10.73,106.78,10.82';
const DEFAULT_MAP_MARKER = '10.775,10.775';

const mapEmbedUrl = computed<string | null>(() => {
  if (isProfileLoading.value) return null;
  if (previewBbox.value && previewMarker.value) {
    return `https://www.openstreetmap.org/export/embed.html?bbox=${previewBbox.value}&layer=mapnik&marker=${previewMarker.value}`;
  }
  return `https://www.openstreetmap.org/export/embed.html?bbox=${DEFAULT_MAP_BBOX}&layer=mapnik&marker=${DEFAULT_MAP_MARKER}`;
});

const provinceName = (code: number | null): string => {
  if (!code) return '';
  return provinces.value.find((p) => p.code === code)?.name ?? '';
};

const districtName = (provinceCode: number | null, districtCode: number | null): string => {
  if (!provinceCode || !districtCode) return '';
  return getDistricts(provinceCode).find((d) => d.code === districtCode)?.name ?? '';
};

const availableDistricts = computed(() => {
  const code = isEditingAddress.value ? draftProvinceCode.value : savedProvinceCode.value;
  return code ? getDistricts(code) : [];
});

const fullAddressString = computed(() => {
  const parts = [
    savedStreet.value,
    districtName(savedProvinceCode.value, savedDistrictCode.value),
    provinceName(savedProvinceCode.value),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '';
});

const startEditAddress = async (): Promise<void> => {
  if (provinces.value.length === 0) {
    await fetchLocations();
  }
  draftProvinceCode.value = savedProvinceCode.value;
  draftDistrictCode.value = savedDistrictCode.value;
  draftStreet.value = savedStreet.value;
  isEditingAddress.value = true;
};

const cancelEditAddress = (): void => {
  isEditingAddress.value = false;
  draftProvinceCode.value = savedProvinceCode.value;
  draftDistrictCode.value = savedDistrictCode.value;
  draftStreet.value = savedStreet.value;
};

const onProvinceChange = (): void => {
  draftDistrictCode.value = null;
};

let activeGeocodingController: AbortController | null = null;

const createGeocodingSignal = (controller: AbortController, timeoutMs = 8000): AbortSignal => {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    if (typeof AbortSignal.any === 'function') {
      return AbortSignal.any([controller.signal, timeoutSignal]);
    }
    timeoutSignal.addEventListener(
      'abort',
      () => {
        if (!controller.signal.aborted) {
          controller.abort(timeoutSignal.reason);
        }
      },
      { once: true },
    );
    return controller.signal;
  }

  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
    }
  }, timeoutMs);

  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller.signal;
};

const previewAddressOnMap = async (): Promise<void> => {
  if (!draftProvinceCode.value) {
    toast.push({
      variant: 'error',
      title: 'Chưa chọn Tỉnh / Thành phố',
      body: 'Vui lòng chọn ít nhất Tỉnh / Thành phố để kiểm tra vị trí',
    });
    return;
  }

  const province = provinceName(draftProvinceCode.value);
  const district = districtName(draftProvinceCode.value, draftDistrictCode.value);
  const street = draftStreet.value.trim();

  const queries = [
    [street, district, province, 'Vietnam'].filter(Boolean).join(', '),
    [street, district, province].filter(Boolean).join(', '),
    [district, province, 'Vietnam'].filter(Boolean).join(', '),
    [district, province].filter(Boolean).join(', '),
    [province, 'Vietnam'].filter(Boolean).join(', '),
  ].filter((q) => q.length > 0);

  if (activeGeocodingController) {
    activeGeocodingController.abort(new DOMException('Request replaced.', 'AbortError'));
  }
  const controller = new AbortController();
  activeGeocodingController = controller;

  geocodingLoading.value = true;
  let hasHttpError = false;
  let lastHttpStatus = 200;

  try {
    for (const q of queries) {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`;
      const signal = createGeocodingSignal(controller, 8000);
      const res = await fetch(url, { signal });
      if (!res.ok) {
        hasHttpError = true;
        lastHttpStatus = res.status;
        continue;
      }
      const data = (await res.json()) as {
        features?: Array<{
          geometry: { coordinates: [number, number] };
          properties?: { name?: string; extent?: [number, number, number, number] };
        }>;
      };
      const features = data.features ?? [];
      if (features.length === 0) continue;

      if (!isProfileMounted || activeGeocodingController !== controller) return;

      const f = features[0];
      const [lon, lat] = f.geometry.coordinates;
      let minLon: number, minLat: number, maxLon: number, maxLat: number;
      if (f.properties?.extent && f.properties.extent.length === 4) {
        [minLon, minLat, maxLon, maxLat] = f.properties.extent;
      } else {
        const pad = 0.005;
        minLon = lon - pad;
        minLat = lat - pad;
        maxLon = lon + pad;
        maxLat = lat + pad;
      }
      pickedLat.value = lat;
      pickedLng.value = lon;
      previewBbox.value = `${minLon},${minLat},${maxLon},${maxLat}`;
      previewMarker.value = `${lat},${lon}`;

      const locationLabel = [street, district, province].filter(Boolean).join(', ');
      toast.push({
        variant: 'success',
        title: 'Đã tìm thấy tọa độ!',
        body: `${lat.toFixed(4)}, ${lon.toFixed(4)} — ${f.properties?.name || locationLabel}`,
      });
      return;
    }

    if (!isProfileMounted || activeGeocodingController !== controller) return;

    if (hasHttpError) {
      toast.push({
        variant: 'error',
        title: 'Máy chủ định vị gặp sự cố',
        body: `Máy chủ định vị phản hồi mã lỗi HTTP ${lastHttpStatus}. Vui lòng thử lại sau.`,
      });
      return;
    }

    toast.push({
      variant: 'error',
      title: 'Không tìm thấy tọa độ chính xác',
      body: 'Không thể định vị được địa chỉ này trên bản đồ. Bạn có thể kiểm tra lại tên đường hoặc quận/huyện.',
    });
  } catch (err: unknown) {
    if (!isProfileMounted || activeGeocodingController !== controller) return;

    const isTimeout =
      (err instanceof DOMException && (err.name === 'TimeoutError' || err.code === 23)) ||
      (err instanceof Error &&
        (err.name === 'TimeoutError' ||
          err.message.toLowerCase().includes('timeout') ||
          err.message.toLowerCase().includes('timed out')));

    toast.push({
      variant: 'error',
      title: isTimeout ? 'Hết thời gian phản hồi' : 'Lỗi định vị bản đồ',
      body: isTimeout
        ? 'Quá thời gian phản hồi từ máy chủ định vị (8s). Vui lòng thử lại sau.'
        : err instanceof Error
          ? err.message
          : 'Vui lòng thử lại sau',
    });
  } finally {
    if (activeGeocodingController === controller) {
      geocodingLoading.value = false;
      activeGeocodingController = null;
    }
  }
};

const refreshMapLocation = async (): Promise<void> => {
  draftProvinceCode.value = savedProvinceCode.value;
  draftDistrictCode.value = savedDistrictCode.value;
  draftStreet.value = savedStreet.value;
  await previewAddressOnMap();
  if (pickedLat.value !== null && pickedLng.value !== null) {
    try {
      await authApi.upsertProfile({
        location: {
          lat: pickedLat.value,
          lng: pickedLng.value,
        },
      });
      if (savedProfile.value?.location) {
        savedProfile.value.location.lat = pickedLat.value;
        savedProfile.value.location.lng = pickedLng.value;
      }
    } catch {
      // ignore
    }
  }
};

const saveAddress = async (): Promise<void> => {
  if (!draftProvinceCode.value) {
    toast.push({
      variant: 'error',
      title: 'Chưa chọn Tỉnh / Thành phố',
      body: 'Vui lòng chọn Tỉnh / Thành phố trước khi lưu',
    });
    return;
  }

  savingAddress.value = true;
  try {
    const city = provinceName(draftProvinceCode.value);
    const district = districtName(draftProvinceCode.value, draftDistrictCode.value);
    const address = draftStreet.value.trim();

    if (pickedLat.value === null || pickedLng.value === null) {
      await previewAddressOnMap();
    }

    await authApi.upsertProfile({
      location: {
        city,
        district: district || '',
        address: address || '',
        lat: pickedLat.value ?? undefined,
        lng: pickedLng.value ?? undefined,
      },
    });

    savedProvinceCode.value = draftProvinceCode.value;
    savedDistrictCode.value = draftDistrictCode.value;
    savedStreet.value = address;
    isEditingAddress.value = false;

    if (savedProfile.value) {
      savedProfile.value.location = {
        city,
        district,
        address,
        lat: pickedLat.value ?? undefined,
        lng: pickedLng.value ?? undefined,
      };
    }

    toast.push({
      variant: 'success',
      title: 'Đã lưu địa chỉ thành công',
      body: [address, district, city].filter(Boolean).join(', '),
    });
  } catch (err: unknown) {
    toast.push({
      variant: 'error',
      title: 'Lưu địa chỉ thất bại',
      body: extractErrorMessage(err, 'Vui lòng thử lại'),
    });
  } finally {
    savingAddress.value = false;
  }
};

// ===== Đổi mật khẩu =====
const passwordForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});

const showCurrentPassword = ref(false);
const showNewPassword = ref(false);
const showConfirmPassword = ref(false);
const isSubmittingPassword = ref(false);

const passwordTouched = reactive({
  current: false,
  new: false,
  confirm: false,
});

const pwdCriteria = computed(() => {
  const pwd = passwordForm.newPassword;
  const current = passwordForm.currentPassword;
  const confirm = passwordForm.confirmPassword;

  return {
    minLength: pwd.length >= 8 && pwd.length <= 72,
    hasUpper: /[A-Z]/.test(pwd),
    hasLower: /[a-z]/.test(pwd),
    hasNumber: /[0-9]/.test(pwd),
    isDifferent: Boolean(pwd && current && pwd !== current),
    isMatch: Boolean(confirm && confirm === pwd),
  };
});

const isPasswordFormValid = computed<boolean>(() => {
  const isCurrentFilled = passwordForm.currentPassword.length > 0;
  const c = pwdCriteria.value;
  return isCurrentFilled && c.minLength && c.hasUpper && c.hasLower && c.hasNumber && c.isDifferent && c.isMatch;
});

const resetPasswordForm = (): void => {
  passwordForm.currentPassword = '';
  passwordForm.newPassword = '';
  passwordForm.confirmPassword = '';
  showCurrentPassword.value = false;
  showNewPassword.value = false;
  showConfirmPassword.value = false;
  passwordTouched.current = false;
  passwordTouched.new = false;
  passwordTouched.confirm = false;
};

const handleChangePassword = async (): Promise<void> => {
  passwordTouched.current = true;
  passwordTouched.new = true;
  passwordTouched.confirm = true;

  if (!isPasswordFormValid.value || isSubmittingPassword.value) return;

  isSubmittingPassword.value = true;
  try {
    await userApi.changePassword(passwordForm.currentPassword, passwordForm.newPassword);
    toast.push({
      variant: 'success',
      title: 'Đã đổi mật khẩu',
      body: 'Mật khẩu tài khoản đã được cập nhật thành công.',
    });
    resetPasswordForm();
  } catch (err: unknown) {
    const code = extractErrorCode(err);
    let msg = extractErrorMessage(err, 'Đổi mật khẩu thất bại. Vui lòng thử lại.');
    if (code === 'INVALID_PASSWORD') {
      msg = 'Mật khẩu hiện tại không chính xác';
    } else if (code === 'SAME_PASSWORD') {
      msg = 'Mật khẩu mới phải khác mật khẩu hiện tại';
    }
    toast.push({
      variant: 'error',
      title: 'Đổi mật khẩu thất bại',
      body: msg,
    });
  } finally {
    isSubmittingPassword.value = false;
  }
};

// ===== Upload Avatar & Cover =====
const coverInputEl = ref<HTMLInputElement | null>(null);
const avatarInputEl = ref<HTMLInputElement | null>(null);
const uploadingCover = ref(false);
const uploadingAvatar = ref(false);

const onPickCover = (): void => {
  coverInputEl.value?.click();
};

const onPickAvatar = (): void => {
  avatarInputEl.value?.click();
};

const onCoverFileChange = async (e: Event): Promise<void> => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  if (file.size > 10 * 1024 * 1024) {
    toast.push({
      variant: 'error',
      title: 'Ảnh quá lớn',
      body: 'Dung lượng ảnh bìa tối đa là 10MB',
    });
    target.value = '';
    return;
  }

  uploadingCover.value = true;
  try {
    const result = await uploadApi.uploadImage(file, 'covers');
    const coverUrl = result.data.data.url;
    await authApi.upsertProfile({ coverUrl });
    if (savedProfile.value) savedProfile.value.coverUrl = coverUrl;
    toast.push({ variant: 'success', title: 'Đã cập nhật ảnh bìa' });
  } catch (err: unknown) {
    toast.push({
      variant: 'error',
      title: 'Upload ảnh bìa thất bại',
      body: extractErrorMessage(err, 'Vui lòng thử lại'),
    });
  } finally {
    uploadingCover.value = false;
    target.value = '';
  }
};

const onAvatarFileChange = async (e: Event): Promise<void> => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  if (file.size > 10 * 1024 * 1024) {
    toast.push({
      variant: 'error',
      title: 'Ảnh quá lớn',
      body: 'Dung lượng ảnh đại diện tối đa là 10MB',
    });
    target.value = '';
    return;
  }

  uploadingAvatar.value = true;
  try {
    const result = await uploadApi.uploadImage(file, 'avatars');
    const avatarUrl = result.data.data.url;
    await userApi.changeAvatar(avatarUrl);
    if (auth.user) auth.user = { ...auth.user, avatarUrl };
    if (savedProfile.value) savedProfile.value.avatarUrl = avatarUrl;
    toast.push({ variant: 'success', title: 'Đã cập nhật ảnh đại diện' });
  } catch (err: unknown) {
    toast.push({
      variant: 'error',
      title: 'Upload ảnh đại diện thất bại',
      body: extractErrorMessage(err, 'Vui lòng thử lại'),
    });
  } finally {
    uploadingAvatar.value = false;
    target.value = '';
  }
};

const displayedCompletion = ref(0);
let completionRafId: number | null = null;

const animateCompletion = (from: number, to: number): void => {
  if (completionRafId !== null) {
    cancelAnimationFrame(completionRafId);
    completionRafId = null;
  }
  const start = performance.now();
  const duration = 1200;
  const tick = (now: number): void => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    displayedCompletion.value = Math.round(from + (to - from) * eased);
    if (t < 1) {
      completionRafId = requestAnimationFrame(tick);
    } else {
      completionRafId = null;
    }
  };
  completionRafId = requestAnimationFrame(tick);
};

// ===== Initial Load =====
const loadProfile = async (): Promise<void> => {
  isProfileLoading.value = true;
  try {
    const res = await authApi.getProfile();
    if (res.data?.success && res.data.data) {
      const p = res.data.data;
      savedProfile.value = p;

      if (p.social) {
        savedSocial.value = {
          linkedin: p.social.linkedin || '',
          website: p.social.website || '',
          facebook: p.social.facebook || '',
          ...p.social,
        };
      }

      if (p.location?.city) {
        if (provinces.value.length === 0) {
          await fetchLocations();
        }
        const matchProv = provinces.value.find(
          (pr) =>
            pr.name.toLowerCase().includes(p.location.city.toLowerCase()) ||
            p.location.city.toLowerCase().includes(pr.shortName.toLowerCase()),
        );
        if (matchProv) {
          savedProvinceCode.value = matchProv.code;
          if (p.location.district) {
            const dists = getDistricts(matchProv.code);
            const matchDist = dists.find((d) =>
              d.name.toLowerCase().includes(p.location.district.toLowerCase()),
            );
            if (matchDist) savedDistrictCode.value = matchDist.code;
          }
        }
        savedStreet.value = p.location.address || '';
        if (p.location.lat != null && p.location.lng != null) {
          const lat = p.location.lat;
          const lng = p.location.lng;
          pickedLat.value = lat;
          pickedLng.value = lng;
          const pad = 0.005;
          previewBbox.value = `${lng - pad},${lat - pad},${lng + pad},${lat + pad}`;
          previewMarker.value = `${lat},${lng}`;
        }
      }
    }
  } catch (err) {
    console.warn('[EmployerSettings] loadProfile failed:', err);
  } finally {
    isProfileLoading.value = false;
  }
};

watch(
  () => route.query.tab,
  (newTab) => {
    if (newTab) {
      activeProfileTab.value = parseTabFromQuery(newTab);
    }
  },
  { immediate: true },
);

onMounted(async () => {
  isProfileMounted = true;
  await Promise.all([
    loadProfile(),
    loadCompanyData(),
    checkCalendarStatus(),
  ]);
});

onBeforeUnmount(() => {
  isProfileMounted = false;
  if (activeGeocodingController) {
    activeGeocodingController.abort();
    activeGeocodingController = null;
  }
  if (completionRafId !== null) {
    cancelAnimationFrame(completionRafId);
    completionRafId = null;
  }
});
</script>

<template>
  <div class="font-poppins w-full min-h-full flex-1 bg-white">
    <!-- Main container -->
    <main class="w-full mx-auto max-w-[1200px] overflow-hidden border border-slate-200/90 bg-white shadow-sm">
      <!-- ===== Cover + Profile Header Card ===== -->
      <div class="border-b border-slate-200 bg-white">
        <!-- Cover container: cố định h-60/h-72, z-20 để avatar nổi trên tabs bar -->
        <div class="relative h-60 sm:h-72 bg-slate-100 z-20">
          <!-- Skeleton shimmer khi tải cover -->
          <div
            v-if="isProfileLoading || !isCoverImageLoaded"
            class="absolute inset-0 z-0 bg-slate-200/90 animate-pulse overflow-hidden"
            aria-hidden="true"
          >
            <div class="h-full w-full bg-gradient-to-r from-slate-200 via-slate-100/60 to-slate-200" />
          </div>

          <!-- Cover Image Container (overflow-hidden ở đây để cắt ảnh bìa mà không cắt avatar) -->
          <div
            class="absolute inset-0 overflow-hidden transition-opacity duration-300"
            :class="!isProfileLoading && isCoverImageLoaded ? 'opacity-100' : 'opacity-0'"
          >
            <img
              v-if="resolvedCoverUrl"
              ref="coverImageRef"
              :src="resolvedCoverUrl"
              alt="Ảnh bìa hồ sơ nhà tuyển dụng"
              class="h-full w-full object-cover"
              loading="eager"
              decoding="async"
              @load="onCoverImageLoad"
              @error="onCoverImageError"
            />
            <!-- Gradient overlays -->
            <div class="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
          </div>

          <!-- Nút Đổi ảnh bìa: z-40 để luôn click được -->
          <button
            type="button"
            class="absolute bottom-4 right-4 z-40 flex items-center gap-2 rounded-lg bg-black/60 backdrop-blur-md px-3.5 py-2 text-xs sm:text-sm font-medium text-white transition hover:bg-black/80 shadow-md cursor-pointer pointer-events-auto"
            aria-label="Đổi ảnh bìa"
            :disabled="uploadingCover || isProfileLoading"
            @click="onPickCover"
          >
            <Camera :size="16" />
            <span>{{ uploadingCover ? 'Đang tải...' : 'Đổi ảnh bìa' }}</span>
          </button>

          <!-- Avatar & Thông tin cơ bản nổi trên Cover -->
          <div class="absolute inset-x-0 bottom-0 flex items-end gap-3 sm:gap-5 px-4 sm:px-8 z-30 pointer-events-none">
            <!-- Avatar wrapper với translateY(30%) chìm 30% xuống thanh tabs, z-30 nổi hoàn toàn -->
            <div class="pointer-events-auto relative z-30" style="transform: translateY(30%);">
              <!-- Skeleton Avatar -->
              <div
                v-if="isProfileLoading"
                class="relative h-28 w-28 sm:h-36 sm:w-36 shrink-0 rounded-full border-4 border-white bg-slate-200 shadow-xl overflow-hidden animate-pulse"
              />

              <!-- Avatar Thật -->
              <button
                v-else
                type="button"
                class="group relative h-28 w-28 sm:h-36 sm:w-36 shrink-0 cursor-pointer overflow-hidden rounded-full border-4 border-white bg-slate-100 shadow-xl transition hover:brightness-95 duration-300"
                aria-label="Đổi ảnh đại diện"
                @click="onPickAvatar"
              >
                <!-- Initial placeholder -->
                <div
                  class="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-2xl sm:text-4xl font-bold text-white shadow-inner"
                >
                  {{ profileInitial }}
                </div>

                <!-- Avatar image (nếu có) -->
                <div
                  v-if="profileAvatar"
                  class="absolute inset-0 h-full w-full rounded-full bg-cover bg-center object-cover"
                  :style="{ backgroundImage: `url('${profileAvatar}')` }"
                />

                <!-- Camera hover overlay -->
                <div
                  class="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition group-hover:opacity-100"
                >
                  <Camera :size="24" class="text-white" />
                </div>

                <!-- Loading overlay -->
                <div
                  v-if="uploadingAvatar"
                  class="absolute inset-0 flex items-center justify-center rounded-full bg-black/60"
                >
                  <Loader2 :size="22" class="animate-spin text-white" />
                </div>
              </button>
            </div>

            <!-- Tên & Chức vụ nổi trên Cover: giới hạn max-w để không che nút đổi ảnh bìa -->
            <div class="pointer-events-auto mb-2 sm:mb-4 min-w-0 flex-1 sm:flex-initial max-w-[calc(100%-190px)] sm:max-w-none">
              <div v-if="isProfileLoading" class="h-8 w-48 rounded bg-white/30 backdrop-blur-sm animate-pulse mb-1.5" />
              <div v-else class="flex flex-wrap items-center gap-2">
                <h1 class="text-xl sm:text-3xl font-bold text-white drop-shadow-md truncate">
                  {{ profileName }}
                </h1>
                <span class="inline-flex items-center gap-1 rounded-full bg-blue-500/90 backdrop-blur-md px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm">
                  <Building2 :size="12" />
                  Nhà tuyển dụng
                </span>
                <span
                  v-if="calendarStatus.isConnected"
                  class="inline-flex items-center gap-1 rounded-full bg-emerald-500/90 backdrop-blur-md px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm"
                  title="Đã kết nối Google Calendar"
                >
                  <CheckCircle2 :size="12" />
                  Google Calendar
                </span>
              </div>

              <!-- Subtitle: Chức danh hoặc tên công ty -->
              <p v-if="!isProfileLoading" class="text-xs sm:text-sm text-slate-200 drop-shadow truncate mt-0.5">
                {{ profileTitle ? profileTitle : 'Chuyên viên Nhân sự & Tuyển dụng' }}
                <span v-if="myCompany?.name" class="text-slate-300"> • {{ myCompany.name }}</span>
              </p>
            </div>
          </div>
        </div>

        <!-- Profile Subheader: Tabs bar (z-10 để avatar z-30 nổi lên trên) -->
        <div class="relative px-4 sm:px-6 pt-12 sm:pt-0 pf-rise z-10">
          <div class="flex items-center justify-between gap-3">
            <!-- Spacer cho avatar trên desktop -->
            <div class="hidden sm:block w-40 sm:w-48 shrink-0" />

            <!-- Tabs Navigation -->
            <div class="flex gap-2 sm:gap-4 md:gap-6 flex-1 min-w-0 overflow-x-auto scrollbar-none  overflow-x-auto scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                v-for="(tab, idx) in profileTabs"
                :key="idx"
                type="button"
                class="relative -mb-px shrink-0 whitespace-nowrap py-3.5 text-xs sm:text-sm font-medium transition flex items-center gap-1.5"
                :class="
                  activeProfileTab === tab
                    ? 'text-blue-600 font-semibold'
                    : 'text-slate-500 hover:text-slate-800'
                "
                @click="switchTab(tab)"
              >
                <!-- Icon cho từng tab -->
                <User v-if="tab === 'Thông tin'" :size="15" />
                <Building2 v-else-if="tab === 'Công ty'" :size="15" />
                <MapPin v-else-if="tab === 'Địa chỉ'" :size="15" />
                <Globe v-else-if="tab === 'Mạng xã hội'" :size="15" />
                <KeyRound v-else-if="tab === 'Đổi mật khẩu'" :size="15" />
                <Sparkles v-else-if="tab === 'Dịch vụ'" :size="15" class="text-amber-500" />

                <span>{{ tab }}</span>

                <!-- Badge số mạng xã hội -->
                <span
                  v-if="tab === 'Mạng xã hội' && socialCount !== undefined"
                  class="rounded-full bg-slate-100 px-1.5 py-0.2 text-[10px] font-semibold text-slate-600"
                >
                  {{ socialCount }}
                </span>

                <!-- Badge tab Dịch vụ (Đã kết nối) -->
                <span
                  v-if="tab === 'Dịch vụ' && calendarStatus.isConnected"
                  class="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"
                  title="Google Calendar đã kết nối"
                />

                <!-- Active tab underline -->
                <span
                  v-if="activeProfileTab === tab"
                  class="absolute bottom-0 left-0 right-0 h-[2.5px] rounded-full bg-blue-600"
                />
              </button>
            </div>

          
          </div>
        </div>
      </div>

      <!-- ===== Tab Content Area ===== -->
      <div class="min-h-[480px] p-4 sm:p-6 lg:p-8">
        <Transition name="profile-tab-fade" mode="out-in">
          <!-- ================= TAB 1: THÔNG TIN CÁ NHÂN ================= -->
          <section v-if="activeProfileTab === 'Thông tin'" key="tab-info" class="space-y-6">
            <div>
              <h2 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                Thông tin nhà tuyển dụng
              </h2>
              <p class="text-sm text-slate-500 mt-0.5">
                Quản lý thông tin định danh, vị trí công tác và thông tin liên hệ đại diện tuyển dụng.
              </p>
            </div>

            <hr class="border-slate-100" />

            <div class="grid grid-cols-1 gap-x-12 gap-y-6 md:grid-cols-2">
              <!-- Left Column -->
              <div class="space-y-6">
                <!-- Họ và tên -->
                <div class="group flex items-start gap-3.5">
                  <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 shadow-sm">
                    <User :size="20" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Họ và tên</p>
                    <div class="mt-1 flex items-center gap-1.5">
                      <template v-if="editingInfoKey === 'fullName'">
                        <input
                          v-model="infoDraft"
                          type="text"
                          class="flex-1 rounded-lg border border-blue-400 bg-white px-2.5 py-1 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-100"
                          @keyup.enter="saveInfo('fullName')"
                          @keyup.escape="cancelEditInfo"
                        />
                        <button
                          type="button"
                          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                          @click="saveInfo('fullName')"
                        >
                          <Check :size="14" />
                        </button>
                        <button
                          type="button"
                          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          @click="cancelEditInfo"
                        >
                          <X :size="14" />
                        </button>
                      </template>
                      <template v-else>
                        <p class="text-sm font-medium text-slate-900">{{ profileName }}</p>
                        <button
                          type="button"
                          class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-blue-600 transition"
                          @click="startEditInfo('fullName', profileName)"
                        >
                          <Pencil :size="13" />
                        </button>
                      </template>
                    </div>
                  </div>
                </div>

                <!-- Chức danh / Vị trí tuyển dụng -->
                <div class="group flex items-start gap-3.5">
                  <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-600 shadow-sm">
                    <Briefcase :size="20" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Chức vụ / Vị trí</p>
                    <div class="mt-1 flex items-center gap-1.5">
                      <template v-if="editingInfoKey === 'title'">
                        <input
                          v-model="infoDraft"
                          type="text"
                          placeholder="Ví dụ: Talent Acquisition Lead, Trưởng phòng Nhân sự..."
                          class="flex-1 rounded-lg border border-blue-400 bg-white px-2.5 py-1 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-100"
                          @keyup.enter="saveInfo('title')"
                          @keyup.escape="cancelEditInfo"
                        />
                        <button
                          type="button"
                          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                          @click="saveInfo('title')"
                        >
                          <Check :size="14" />
                        </button>
                        <button
                          type="button"
                          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          @click="cancelEditInfo"
                        >
                          <X :size="14" />
                        </button>
                      </template>
                      <template v-else>
                        <p v-if="profileTitle" class="text-sm font-medium text-slate-900">{{ profileTitle }}</p>
                        <button
                          v-else
                          type="button"
                          class="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                          @click="startEditInfo('title', '')"
                        >
                          <PlusIcon :size="14" />
                          Thêm chức vụ
                        </button>
                        <button
                          v-if="profileTitle"
                          type="button"
                          class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-blue-600 transition"
                          @click="startEditInfo('title', profileTitle)"
                        >
                          <Pencil :size="13" />
                        </button>
                      </template>
                    </div>
                  </div>
                </div>

                <!-- Phòng ban / Bộ phận -->
                <div class="group flex items-start gap-3.5">
                  <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 shadow-sm">
                    <Building2 :size="20" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Phòng ban / Đơn vị</p>
                    <div class="mt-1 flex items-center gap-1.5">
                      <template v-if="editingInfoKey === 'department'">
                        <input
                          v-model="infoDraft"
                          type="text"
                          placeholder="Ví dụ: Khối Nhân sự & Đào tạo, Ban Tuyển dụng..."
                          class="flex-1 rounded-lg border border-blue-400 bg-white px-2.5 py-1 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-100"
                          @keyup.enter="saveInfo('department')"
                          @keyup.escape="cancelEditInfo"
                        />
                        <button
                          type="button"
                          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                          @click="saveInfo('department')"
                        >
                          <Check :size="14" />
                        </button>
                        <button
                          type="button"
                          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          @click="cancelEditInfo"
                        >
                          <X :size="14" />
                        </button>
                      </template>
                      <template v-else>
                        <p v-if="profileDepartment" class="text-sm font-medium text-slate-900">{{ profileDepartment }}</p>
                        <button
                          v-else
                          type="button"
                          class="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                          @click="startEditInfo('department', '')"
                        >
                          <PlusIcon :size="14" />
                          Thêm phòng ban
                        </button>
                        <button
                          v-if="profileDepartment"
                          type="button"
                          class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-blue-600 transition"
                          @click="startEditInfo('department', profileDepartment)"
                        >
                          <Pencil :size="13" />
                        </button>
                      </template>
                    </div>
                  </div>
                </div>

                <!-- Giới thiệu / Bio -->
                <div class="group flex items-start gap-3.5">
                  <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 shadow-sm">
                    <MessageSquare :size="20" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Giới thiệu ngắn</p>
                    <div class="mt-1">
                      <template v-if="editingInfoKey === 'bio'">
                        <textarea
                          v-model="infoDraft"
                          rows="3"
                          placeholder="Mô tả ngắn gọn về bản thân hoặc định hướng tuyển dụng..."
                          class="w-full rounded-lg border border-blue-400 bg-white p-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        <div class="mt-1 flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            class="px-3 py-1 rounded-md text-xs text-slate-600 hover:bg-slate-100"
                            @click="cancelEditInfo"
                          >
                            Hủy
                          </button>
                          <button
                            type="button"
                            class="px-3 py-1 rounded-md bg-blue-600 text-xs font-medium text-white hover:bg-blue-700"
                            @click="saveInfo('bio')"
                          >
                            Lưu
                          </button>
                        </div>
                      </template>
                      <template v-else>
                        <p v-if="profileBio" class="text-sm text-slate-700 whitespace-pre-line leading-relaxed">
                          {{ profileBio }}
                        </p>
                        <button
                          v-else
                          type="button"
                          class="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                          @click="startEditInfo('bio', '')"
                        >
                          <PlusIcon :size="14" />
                          Thêm lời giới thiệu
                        </button>
                        <button
                          v-if="profileBio"
                          type="button"
                          class="mt-1 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600 transition"
                          @click="startEditInfo('bio', profileBio)"
                        >
                          <Pencil :size="12" /> Sửa giới thiệu
                        </button>
                      </template>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Right Column -->
              <div class="space-y-6">
                <!-- Email (Readonly) -->
                <div class="flex items-start gap-3.5">
                  <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 shadow-sm">
                    <Mail :size="20" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Email đăng nhập</p>
                    <div class="mt-1 flex items-center gap-2">
                      <p class="text-sm font-medium text-slate-900">{{ profileEmail }}</p>
                      <span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        <ShieldCheck :size="12" />
                        Đã xác thực
                      </span>
                    </div>
                    <p class="text-xs text-slate-400 mt-1">Email là thông tin định danh không thể thay đổi trực tiếp.</p>
                  </div>
                </div>

                <!-- Số điện thoại -->
                <div class="group flex items-start gap-3.5">
                  <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 shadow-sm">
                    <Phone :size="20" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Số điện thoại liên hệ</p>
                    <div class="mt-1 flex items-center gap-1.5">
                      <template v-if="editingInfoKey === 'phone'">
                        <input
                          v-model="infoDraft"
                          type="tel"
                          placeholder="Ví dụ: 0912 345 678"
                          class="flex-1 rounded-lg border border-blue-400 bg-white px-2.5 py-1 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-100"
                          @keyup.enter="saveInfo('phone')"
                          @keyup.escape="cancelEditInfo"
                        />
                        <button
                          type="button"
                          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                          @click="saveInfo('phone')"
                        >
                          <Check :size="14" />
                        </button>
                        <button
                          type="button"
                          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          @click="cancelEditInfo"
                        >
                          <X :size="14" />
                        </button>
                      </template>
                      <template v-else>
                        <p v-if="profilePhone" class="text-sm font-medium text-slate-900">{{ profilePhone }}</p>
                        <button
                          v-else
                          type="button"
                          class="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                          @click="startEditInfo('phone', '')"
                        >
                          <PlusIcon :size="14" />
                          Thêm số điện thoại
                        </button>
                        <button
                          v-if="profilePhone"
                          type="button"
                          class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-blue-600 transition"
                          @click="startEditInfo('phone', profilePhone)"
                        >
                          <Pencil :size="13" />
                        </button>
                      </template>
                    </div>
                  </div>
                </div>

                <!-- Quyền hạn tài khoản -->
                <div class="flex items-start gap-3.5">
                  <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 shadow-sm">
                    <ShieldCheck :size="20" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Vai trò trong hệ thống</p>
                    <p class="text-sm font-medium text-slate-900 mt-1">Nhà tuyển dụng / Quản lý tuyển dụng (Employer)</p>
                    <p class="text-xs text-slate-500 mt-0.5">
                      Được phép đăng tin tuyển dụng, phê duyệt hồ sơ, thiết lập lịch phỏng vấn và quản lý thành viên công ty.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- ================= TAB 2: CÔNG TY ================= -->
          <section v-else-if="activeProfileTab === 'Công ty'" key="tab-company" class="space-y-6">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                  Công ty tuyển dụng
                </h2>
                <p class="text-sm text-slate-500 mt-0.5">
                  Doanh nghiệp mà tài khoản của bạn đang đại diện tuyển dụng trên hệ thống.
                </p>
              </div>
              <router-link
                to="/employer/company"
                class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <span>Hồ sơ công ty chi tiết</span>
                <ExternalLink :size="14" />
              </router-link>
            </div>

            <hr class="border-slate-100" />

            <!-- Company Card -->
            <div v-if="myCompany" class="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm">
              <div class="flex flex-col sm:flex-row items-start sm:items-center gap-5">
                <!-- Company Logo -->
                <div class="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-slate-100 bg-slate-50 p-2 shadow-inner">
                  <img
                    v-if="myCompany.logoUrl"
                    :src="myCompany.logoUrl"
                    :alt="myCompany.name"
                    class="h-full w-full object-contain"
                  />
                  <div v-else class="flex h-full w-full items-center justify-center font-bold text-slate-400 text-xl">
                    {{ myCompany.name.charAt(0) }}
                  </div>
                </div>

                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <h3 class="text-xl font-bold text-slate-900 truncate">
                      {{ myCompany.name }}
                    </h3>
                    <span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      <CheckCircle2 :size="12" /> Doanh nghiệp đã kích hoạt
                    </span>
                  </div>

                  <p v-if="fullCompany?.description" class="text-sm text-slate-600 line-clamp-2 mt-1.5">
                    {{ fullCompany.description }}
                  </p>

                  <div class="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
                    <span v-if="fullCompany?.website" class="flex items-center gap-1">
                      <Globe :size="14" class="text-slate-400" />
                      <a :href="fullCompany.website" target="_blank" class="hover:text-blue-600 hover:underline">
                        {{ shortUrl(fullCompany.website) }}
                      </a>
                    </span>
                    <span v-if="fullCompany?.sizeRange" class="flex items-center gap-1">
                      <User :size="14" class="text-slate-400" />
                      Quy mô: {{ fullCompany.sizeRange }}
                    </span>
                    <span v-if="fullCompany?.industry" class="flex items-center gap-1">
                      <Briefcase :size="14" class="text-slate-400" />
                      Lĩnh vực: {{ fullCompany.industry }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Quick action links -->
              <div class="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                <router-link
                  to="/employer/company"
                  class="rounded-lg bg-blue-600 px-4 py-2 text-xs sm:text-sm font-medium text-white shadow transition hover:bg-blue-700"
                >
                  Chỉnh sửa thông tin công ty
                </router-link>
                <router-link
                  to="/employer/company/members"
                  class="rounded-lg border border-slate-200 px-4 py-2 text-xs sm:text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Quản lý thành viên (HR Team)
                </router-link>
              </div>
            </div>

            <!-- Empty Company State -->
            <div v-else class="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center">
              <Building2 :size="40" class="mx-auto text-slate-300 mb-3" />
              <h3 class="text-base font-bold text-slate-900">Chưa liên kết công ty tuyển dụng</h3>
              <p class="text-xs sm:text-sm text-slate-500 max-w-md mx-auto mt-1">
                Tạo trang công ty hoặc chấp nhận lời mời tham gia từ doanh nghiệp để bắt đầu đăng tin tuyển dụng và tìm kiếm ứng viên.
              </p>
              <div class="mt-4">
                <router-link
                  to="/employer/company"
                  class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-700"
                >
                  <PlusIcon :size="16" />
                  Tạo trang công ty mới
                </router-link>
              </div>
            </div>
          </section>

          <!-- ================= TAB 3: ĐỊA CHỈ LÀM VIỆC ================= -->
          <section v-else-if="activeProfileTab === 'Địa chỉ'" key="tab-address" class="space-y-6">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                  Địa chỉ
                </h2>
                <p class="text-sm text-slate-500 mt-0.5">
                  Nơi bạn đang sinh sống và làm việc.
                </p>
              </div>

              <button
                v-if="!isEditingAddress"
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-blue-600 hover:border-blue-200 cursor-pointer"
                @click="startEditAddress"
              >
                <Pencil :size="13" />
                <span>Chỉnh sửa</span>
              </button>
            </div>

            <hr class="border-slate-100" />

            <div class="grid grid-cols-1 gap-x-12 gap-y-6 md:grid-cols-2">
              <!-- LEFT column: Chế độ Xem (View) hoặc Chế độ Sửa (Edit) -->
              <div>
                <!-- VIEW MODE: Hiển thị các trường đồng bộ pattern tab Thông tin -->
                <div v-if="!isEditingAddress" class="space-y-5">
                  <!-- 1. Tỉnh / Thành phố -->
                  <div class="group flex items-start gap-3">
                    <div
                      class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                    >
                      <Building2 :size="20" />
                    </div>

                    <div class="min-w-0 flex-1">
                      <p class="text-sm text-slate-700">
                        Tỉnh / Thành phố
                      </p>
                      <div class="mt-0.5 flex items-center gap-1.5">
                        <template v-if="savedProvinceCode && provinceName(savedProvinceCode)">
                          <p class="text-sm font-medium text-slate-900">
                            {{ provinceName(savedProvinceCode) }}
                          </p>
                          <button
                            type="button"
                            class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-blue-600 transition cursor-pointer"
                            aria-label="Sửa Tỉnh/Thành phố"
                            @click="startEditAddress"
                          >
                            <Pencil :size="12" />
                          </button>
                        </template>
                        <button
                          v-else
                          type="button"
                          class="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline cursor-pointer"
                          aria-label="Thêm Tỉnh/Thành phố"
                          @click="startEditAddress"
                        >
                          <PlusIcon :size="14" />
                          Thêm
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- 2. Quận / Huyện -->
                  <div class="group flex items-start gap-3">
                    <div
                      class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                    >
                      <Navigation :size="20" />
                    </div>

                    <div class="min-w-0 flex-1">
                      <p class="text-sm text-slate-700">
                        Quận / Huyện
                      </p>
                      <div class="mt-0.5 flex items-center gap-1.5">
                        <template v-if="savedDistrictCode && districtName(savedProvinceCode, savedDistrictCode)">
                          <p class="text-sm font-medium text-slate-900">
                            {{ districtName(savedProvinceCode, savedDistrictCode) }}
                          </p>
                          <button
                            type="button"
                            class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-blue-600 transition cursor-pointer"
                            aria-label="Sửa Quận/Huyện"
                            @click="startEditAddress"
                          >
                            <Pencil :size="12" />
                          </button>
                        </template>
                        <div v-else-if="isProfileLoading" class="flex items-center">
                          <span class="inline-block h-4 w-28 rounded bg-slate-100 animate-pulse" aria-hidden="true" />
                        </div>
                        <button
                          v-else
                          type="button"
                          class="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline cursor-pointer"
                          aria-label="Thêm Quận/Huyện"
                          @click="startEditAddress"
                        >
                          <PlusIcon :size="14" />
                          Thêm
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- 3. Địa chỉ chi tiết (số nhà, đường) -->
                  <div class="group flex items-start gap-3">
                    <div
                      class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                    >
                      <Home :size="20" />
                    </div>

                    <div class="min-w-0 flex-1">
                      <p class="text-sm text-slate-700">
                        Địa chỉ chi tiết (số nhà, đường)
                      </p>
                      <div class="mt-0.5 flex items-center gap-1.5">
                        <template v-if="savedStreet">
                          <p class="text-sm font-medium text-slate-900 truncate max-w-[280px]">
                            {{ savedStreet }}
                          </p>
                          <button
                            type="button"
                            class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-blue-600 transition cursor-pointer"
                            aria-label="Sửa địa chỉ chi tiết"
                            @click="startEditAddress"
                          >
                            <Pencil :size="12" />
                          </button>
                        </template>
                        <div v-else-if="isProfileLoading" class="flex items-center">
                          <span class="inline-block h-4 w-32 rounded bg-slate-100 animate-pulse" aria-hidden="true" />
                        </div>
                        <button
                          v-else
                          type="button"
                          class="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline cursor-pointer"
                          aria-label="Thêm địa chỉ chi tiết"
                          @click="startEditAddress"
                        >
                          <PlusIcon :size="14" />
                          Thêm
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- 4. Địa chỉ hoàn chỉnh & Trạng thái định vị -->
                  <div class="flex items-start gap-3">
                    <div
                      class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                    >
                      <MapPinned :size="20" />
                    </div>

                    <div class="min-w-0 flex-1">
                      <p class="text-sm text-slate-700">
                        Địa chỉ hoàn chỉnh
                      </p>
                      <p v-if="fullAddressString" class="mt-0.5 text-xs text-slate-600 leading-relaxed font-medium">
                        {{ fullAddressString }}
                      </p>
                      <div v-else-if="isProfileLoading" class="mt-0.5 flex items-center">
                        <span class="inline-block h-3.5 w-48 rounded bg-slate-100 animate-pulse" aria-hidden="true" />
                      </div>
                      <p v-else class="mt-0.5 text-xs text-slate-400">
                        Chưa thiết lập địa chỉ
                      </p>

                      <div class="mt-1 flex items-center gap-1.5 text-[11px]">
                        <template v-if="pickedLat !== null && pickedLng !== null">
                          <span class="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                          <span class="text-emerald-700 font-medium">
                            Đã định vị tọa độ ({{ pickedLat.toFixed(4) }}, {{ pickedLng.toFixed(4) }})
                          </span>
                        </template>
                        <template v-else>
                          <span class="inline-block h-2 w-2 rounded-full bg-amber-500" />
                          <span class="text-amber-700 font-medium">
                            Chưa xác định tọa độ bản đồ
                          </span>
                        </template>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- EDIT MODE: Gọi API ngoài cho Tỉnh/Quận + Ô nhập địa chỉ chi tiết có nút Kiểm tra & Lấy tọa độ -->
                <div v-else class="space-y-4 rounded-xl border border-blue-200 bg-blue-50/30 p-5 shadow-sm">
                  <div class="flex items-center justify-between pb-2 border-b border-blue-100">
                    <div class="flex items-center gap-2">
                      <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
                        <Pencil :size="15" />
                      </div>
                      <div>
                        <h3 class="text-sm font-semibold text-slate-900">Chỉnh sửa địa chỉ</h3>
                        <p class="text-xs text-slate-500">Tải danh sách tỉnh/huyện từ API và định vị tọa độ</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      class="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-600 transition cursor-pointer"
                      aria-label="Đóng"
                      @click="cancelEditAddress"
                    >
                      <X :size="16" />
                    </button>
                  </div>

                  <!-- 1. Tỉnh / Thành phố (API call ngoài) -->
                  <div>
                    <label class="mb-1 block text-xs font-medium text-slate-700">
                      Tỉnh / Thành phố
                      <span v-if="locationsLoading" class="ml-1 text-[11px] font-normal text-blue-600 animate-pulse">(Đang gọi API tải danh sách...)</span>
                    </label>
                    <select
                      v-model.number="draftProvinceCode"
                      class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 cursor-pointer"
                      :disabled="locationsLoading && provinces.length === 0"
                      @change="onProvinceChange"
                    >
                      <option :value="null">-- Chọn tỉnh/thành --</option>
                      <option v-for="p in provinces" :key="p.code" :value="p.code">
                        {{ p.name }}
                      </option>
                    </select>
                  </div>

                  <!-- 2. Quận / Huyện (API call ngoài theo tỉnh) -->
                  <div>
                    <label class="mb-1 block text-xs font-medium text-slate-700">
                      Quận / Huyện
                      <span v-if="!draftProvinceCode" class="ml-1 text-[11px] font-normal text-slate-400">(Vui lòng chọn Tỉnh/Thành trước)</span>
                    </label>
                    <select
                      v-model.number="draftDistrictCode"
                      class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400 cursor-pointer"
                      :disabled="!draftProvinceCode"
                    >
                      <option :value="null">-- Chọn quận/huyện --</option>
                      <option v-for="d in availableDistricts" :key="d.code" :value="d.code">
                        {{ d.name }}
                      </option>
                    </select>
                  </div>

                  <!-- 3. Địa chỉ chi tiết (số nhà, đường) + Nút Kiểm tra và Lấy tọa độ -->
                  <div>
                    <label class="mb-1 block text-xs font-medium text-slate-700">
                      Địa chỉ chi tiết (số nhà, đường, phường)
                    </label>
                    <div class="flex gap-2">
                      <input
                        v-model="draftStreet"
                        type="text"
                        placeholder="Vd: 12 Nguyễn Huệ, Phường Bến Nghé"
                        class="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400 transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        @keyup.enter="previewAddressOnMap"
                      />

                      <button
                        type="button"
                        class="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3.5 py-2 text-xs font-medium text-blue-700 shadow-sm transition hover:bg-blue-50 hover:border-blue-400 disabled:opacity-50 cursor-pointer"
                        :disabled="geocodingLoading || !draftProvinceCode"
                        title="Kiểm tra địa chỉ và lấy tọa độ ghim bản đồ"
                        @click="previewAddressOnMap"
                      >
                        <Loader2 v-if="geocodingLoading" :size="14" class="animate-spin text-blue-600" />
                        <MapPin v-else :size="14" class="text-blue-600" />
                        <span>{{ geocodingLoading ? 'Đang tìm...' : 'Kiểm tra' }}</span>
                      </button>
                    </div>
                    <p class="mt-1 text-[11px] text-slate-500">
                      Bấm <strong>"Kiểm tra"</strong> để tìm và ghim tọa độ chính xác lên bản đồ bên phải trước khi lưu.
                    </p>
                  </div>

                  <!-- Actions: Hủy + Lưu địa chỉ -->
                  <div class="flex items-center justify-end gap-2 pt-2 border-t border-blue-100">
                    <button
                      type="button"
                      class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                      @click="cancelEditAddress"
                    >
                      Hủy
                    </button>

                    <button
                      type="button"
                      class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition shadow-sm disabled:opacity-50 cursor-pointer"
                      :disabled="savingAddress"
                      @click="saveAddress"
                    >
                      <Loader2 v-if="savingAddress" :size="14" class="animate-spin" />
                      <Check v-else :size="14" />
                      <span>{{ savingAddress ? 'Đang lưu...' : 'Lưu địa chỉ' }}</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- RIGHT column: Bản đồ xem trước OpenStreetMap -->
              <div class="space-y-2">
                <div class="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                  <div class="mb-3 flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                        <MapPin :size="16" />
                      </div>
                      <div>
                        <h4 class="text-sm font-semibold text-slate-900">Bản đồ vị trí</h4>
                        <p class="text-[11px] text-slate-500">Xem trước vị trí trên OpenStreetMap</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-blue-600 disabled:opacity-50 cursor-pointer"
                      :disabled="geocodingLoading"
                      title="Tìm lại tọa độ theo địa chỉ hiện tại"
                      @click="refreshMapLocation"
                    >
                      <RotateCw :size="13" :class="{ 'animate-spin': geocodingLoading }" />
                      <span>{{ geocodingLoading ? 'Đang tìm...' : 'Định vị lại' }}</span>
                    </button>
                  </div>

                  <!-- Map iframe container: kích thước cố định h-64 w-full để chống layout shift -->
                  <div class="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-inner h-64 w-full">
                    <!-- Location badge overlay on map -->
                    <div
                      v-if="fullAddressString && mapEmbedUrl"
                      class="pointer-events-none absolute left-2 top-2 z-10 max-w-[85%] truncate rounded-md bg-white/95 px-2 py-1 text-[11px] font-medium text-slate-800 shadow backdrop-blur-sm"
                    >
                      📍 {{ fullAddressString }}
                    </div>

                    <!-- Placeholder khi đang tải profile: giữ layout ổn định, chống double-load iframe -->
                    <div
                      v-if="!mapEmbedUrl"
                      class="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-50 text-slate-400"
                    >
                      <Loader2 :size="20" class="animate-spin text-blue-500" />
                      <span class="text-xs font-medium text-slate-500">Đang tải bản đồ...</span>
                    </div>

                    <!-- Iframe bản đồ: chỉ render khi mapEmbedUrl đã sẵn sàng -->
                    <iframe
                      v-else
                      :src="mapEmbedUrl"
                      class="h-64 w-full"
                      style="border: 0"
                      loading="lazy"
                      referrerpolicy="no-referrer-when-downgrade"
                      title="OpenStreetMap preview"
                    />

                    <!-- Overlay che watermark OSM ở góc dưới-phải -->
                    <div
                      v-if="mapEmbedUrl"
                      class="pointer-events-none absolute bottom-0 right-0 h-6 w-24 bg-white"
                      aria-hidden="true"
                    />
                  </div>

                  <!-- Bottom info bar -->
                  <div class="mt-2.5 flex items-center justify-between text-[11px] text-slate-500">
                    <span v-if="pickedLat !== null && pickedLng !== null">
                      Tọa độ: <span class="font-mono text-slate-700">{{ pickedLat.toFixed(5) }}, {{ pickedLng.toFixed(5) }}</span>
                    </span>
                    <span v-else class="text-amber-600">
                      Chưa xác định tọa độ chính xác
                    </span>

                    <span class="text-slate-400">© OpenStreetMap</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- ================= TAB 4: MẠNG XÃ HỘI ================= -->
          <section v-else-if="activeProfileTab === 'Mạng xã hội'" key="tab-social" class="space-y-6">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                  Mạng xã hội & Kênh truyền thông
                </h2>
                <p class="text-sm text-slate-500 mt-0.5">
                  Liên kết trang mạng xã hội và kênh thương hiệu của bạn giúp tăng độ uy tín với ứng viên.
                </p>
              </div>
              <button
                v-if="!isAddingSocial"
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3.5 py-2 text-xs sm:text-sm font-semibold text-blue-600 transition hover:bg-blue-100"
                @click="startAddSocial"
              >
                <PlusIcon :size="15" />
                <span>Thêm kênh khác</span>
              </button>
            </div>

            <hr class="border-slate-100" />

            <!-- Form thêm kênh mạng xã hội mới -->
            <div v-if="isAddingSocial" class="rounded-2xl border border-blue-200 bg-blue-50/40 p-5 space-y-3">
              <h3 class="text-sm font-bold text-slate-900">Thêm liên kết mạng xã hội mới</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-semibold text-slate-700 mb-1">Tên mạng xã hội</label>
                  <input
                    v-model="newSocialName"
                    type="text"
                    placeholder="Ví dụ: YouTube, TikTok, Twitter..."
                    class="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-700 mb-1">Đường dẫn URL</label>
                  <input
                    v-model="newSocialUrl"
                    type="url"
                    placeholder="https://..."
                    class="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div class="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  class="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                  @click="cancelAddSocial"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-blue-700"
                  :disabled="addingSocialLoading"
                  @click="saveNewSocial"
                >
                  <Check :size="14" />
                  {{ addingSocialLoading ? 'Đang thêm...' : 'Lưu liên kết' }}
                </button>
              </div>
            </div>

            <!-- Danh sách mạng xã hội -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div
                v-for="item in socialItems"
                :key="item.key"
                class="group rounded-2xl border border-slate-200/90 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm"
              >
                <div class="flex items-start gap-3.5">
                  <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 shadow-sm">
                    <component :is="item.icon" :size="20" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center justify-between">
                      <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        {{ item.label }}
                      </p>
                      <button
                        v-if="item.isCustom"
                        type="button"
                        class="text-slate-400 hover:text-rose-600 transition"
                        title="Xóa mạng xã hội này"
                        @click="deleteSocial(item.key, item.label)"
                      >
                        <Trash2 :size="13" />
                      </button>
                    </div>

                    <!-- Inline editing -->
                    <div class="mt-1 flex items-center gap-1.5">
                      <template v-if="editingSocialKey === item.key">
                        <input
                          v-model="socialDraft"
                          type="url"
                          class="flex-1 rounded-lg border border-blue-400 bg-white px-2.5 py-1 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-100"
                          :placeholder="item.placeholder"
                          @keyup.enter="saveSingleSocial(item.key)"
                          @keyup.escape="cancelEditSingleSocial"
                        />
                        <button
                          type="button"
                          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                          @click="saveSingleSocial(item.key)"
                        >
                          <Check :size="14" />
                        </button>
                        <button
                          type="button"
                          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          @click="cancelEditSingleSocial"
                        >
                          <X :size="14" />
                        </button>
                      </template>
                      <template v-else>
                        <a
                          v-if="item.value"
                          :href="item.value"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-sm font-medium text-blue-600 hover:underline truncate max-w-[280px]"
                        >
                          {{ shortUrl(item.value) }}
                        </a>
                        <button
                          v-else
                          type="button"
                          class="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-blue-600 transition"
                          @click="startEditSingleSocial(item.key, '')"
                        >
                          <PlusIcon :size="14" /> Thêm đường dẫn
                        </button>

                        <button
                          v-if="item.value"
                          type="button"
                          class="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-blue-600 transition"
                          @click="startEditSingleSocial(item.key, item.value)"
                        >
                          <Pencil :size="13" />
                        </button>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- ================= TAB 5: ĐỔI MẬT KHẨU ================= -->
          <section v-else-if="activeProfileTab === 'Đổi mật khẩu'" key="tab-password" class="max-w-4xl space-y-6">
            <div>
              <h2 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                Bảo mật & Đổi mật khẩu
              </h2>
              <p class="text-sm text-slate-500 mt-0.5">
                Cập nhật mật khẩu thường xuyên giúp bảo vệ tài khoản nhà tuyển dụng và dữ liệu ứng viên của bạn.
              </p>
            </div>

            <hr class="border-slate-100" />

            <form @submit.prevent="handleChangePassword">
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                <!-- Cột trái: 3 input fields -->
                <div class="space-y-4">
                  <!-- Mật khẩu hiện tại -->
                  <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                      Mật khẩu hiện tại <span class="text-rose-500">*</span>
                    </label>
                    <div class="relative">
                      <input
                        v-model="passwordForm.currentPassword"
                        :type="showCurrentPassword ? 'text' : 'password'"
                        placeholder="Nhập mật khẩu bạn đang sử dụng"
                        class="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        @blur="passwordTouched.current = true"
                      />
                      <button
                        type="button"
                        class="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                        @click="showCurrentPassword = !showCurrentPassword"
                      >
                        <EyeOff v-if="showCurrentPassword" :size="16" />
                        <Eye v-else :size="16" />
                      </button>
                    </div>
                  </div>

                  <!-- Mật khẩu mới -->
                  <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                      Mật khẩu mới <span class="text-rose-500">*</span>
                    </label>
                    <div class="relative">
                      <input
                        v-model="passwordForm.newPassword"
                        :type="showNewPassword ? 'text' : 'password'"
                        placeholder="Nhập mật khẩu mới (tối thiểu 8 ký tự)"
                        class="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        @blur="passwordTouched.new = true"
                      />
                      <button
                        type="button"
                        class="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                        @click="showNewPassword = !showNewPassword"
                      >
                        <EyeOff v-if="showNewPassword" :size="16" />
                        <Eye v-else :size="16" />
                      </button>
                    </div>
                  </div>

                  <!-- Xác nhận mật khẩu mới -->
                  <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                      Xác nhận mật khẩu mới <span class="text-rose-500">*</span>
                    </label>
                    <div class="relative">
                      <input
                        v-model="passwordForm.confirmPassword"
                        :type="showConfirmPassword ? 'text' : 'password'"
                        placeholder="Nhập lại mật khẩu mới"
                        class="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        @blur="passwordTouched.confirm = true"
                      />
                      <button
                        type="button"
                        class="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                        @click="showConfirmPassword = !showConfirmPassword"
                      >
                        <EyeOff v-if="showConfirmPassword" :size="16" />
                        <Eye v-else :size="16" />
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Cột phải: Yêu cầu mật khẩu & Nút Cập nhật mật khẩu -->
                <div class="space-y-4">
                  <!-- Yêu cầu mật khẩu -->
                  <div class="rounded-xl bg-slate-50 border border-slate-200/80 p-4 text-xs space-y-2.5 text-slate-600">
                    <p class="font-semibold text-slate-700 text-xs">Yêu cầu bảo mật mật khẩu:</p>
                    <div class="space-y-2 text-[12px]">
                      <!-- Tối thiểu 8 ký tự -->
                      <div
                        class="flex items-center gap-2 transition-colors duration-200"
                        :class="pwdCriteria.minLength ? 'text-emerald-700 font-medium' : 'text-slate-500'"
                      >
                        <span
                          class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-all duration-200"
                          :class="pwdCriteria.minLength ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'"
                        >
                          <Check v-if="pwdCriteria.minLength" :size="11" class="stroke-[3]" />
                          <span v-else class="h-1 w-1 rounded-full bg-slate-400" />
                        </span>
                        <span>Tối thiểu 8 ký tự</span>
                      </div>

                      <!-- Chữ in hoa -->
                      <div
                        class="flex items-center gap-2 transition-colors duration-200"
                        :class="pwdCriteria.hasUpper ? 'text-emerald-700 font-medium' : 'text-slate-500'"
                      >
                        <span
                          class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-all duration-200"
                          :class="pwdCriteria.hasUpper ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'"
                        >
                          <Check v-if="pwdCriteria.hasUpper" :size="11" class="stroke-[3]" />
                          <span v-else class="h-1 w-1 rounded-full bg-slate-400" />
                        </span>
                        <span>Chứa ít nhất 1 chữ in hoa (A-Z)</span>
                      </div>

                      <!-- Chữ in thường -->
                      <div
                        class="flex items-center gap-2 transition-colors duration-200"
                        :class="pwdCriteria.hasLower ? 'text-emerald-700 font-medium' : 'text-slate-500'"
                      >
                        <span
                          class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-all duration-200"
                          :class="pwdCriteria.hasLower ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'"
                        >
                          <Check v-if="pwdCriteria.hasLower" :size="11" class="stroke-[3]" />
                          <span v-else class="h-1 w-1 rounded-full bg-slate-400" />
                        </span>
                        <span>Chứa ít nhất 1 chữ in thường (a-z)</span>
                      </div>

                      <!-- Chữ số -->
                      <div
                        class="flex items-center gap-2 transition-colors duration-200"
                        :class="pwdCriteria.hasNumber ? 'text-emerald-700 font-medium' : 'text-slate-500'"
                      >
                        <span
                          class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-all duration-200"
                          :class="pwdCriteria.hasNumber ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'"
                        >
                          <Check v-if="pwdCriteria.hasNumber" :size="11" class="stroke-[3]" />
                          <span v-else class="h-1 w-1 rounded-full bg-slate-400" />
                        </span>
                        <span>Chứa ít nhất 1 chữ số (0-9)</span>
                      </div>

                      <!-- Khác mật khẩu hiện tại -->
                      <div
                        class="flex items-center gap-2 transition-colors duration-200"
                        :class="pwdCriteria.isDifferent ? 'text-emerald-700 font-medium' : 'text-slate-500'"
                      >
                        <span
                          class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-all duration-200"
                          :class="pwdCriteria.isDifferent ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'"
                        >
                          <Check v-if="pwdCriteria.isDifferent" :size="11" class="stroke-[3]" />
                          <span v-else class="h-1 w-1 rounded-full bg-slate-400" />
                        </span>
                        <span>Khác mật khẩu hiện tại</span>
                      </div>

                      <!-- Trùng khớp mật khẩu xác nhận -->
                      <div
                        class="flex items-center gap-2 transition-colors duration-200"
                        :class="pwdCriteria.isMatch ? 'text-emerald-700 font-medium' : 'text-slate-500'"
                      >
                        <span
                          class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-all duration-200"
                          :class="pwdCriteria.isMatch ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'"
                        >
                          <Check v-if="pwdCriteria.isMatch" :size="11" class="stroke-[3]" />
                          <span v-else class="h-1 w-1 rounded-full bg-slate-400" />
                        </span>
                        <span>Mật khẩu xác nhận trùng khớp</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <button
                      type="submit"
                      class="w-full rounded-md bg-[#5b4eea] px-6 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      :disabled="!isPasswordFormValid || isSubmittingPassword"
                    >
                      {{ isSubmittingPassword ? 'Đang cập nhật...' : 'Cập nhật mật khẩu' }}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </section>

          <!-- ================= TAB 6: DỊCH VỤ ================= -->
          <section v-else-if="activeProfileTab === 'Dịch vụ'" key="tab-services" class="space-y-6">
            <div>
              <h2 class="text-2xl font-bold text-slate-900 tracking-tight">
                Dịch vụ tích hợp
              </h2>
              <p class="text-sm text-slate-500 mt-1">
                Kết nối tài khoản bên thứ ba để tự động xếp lịch và tạo phòng phỏng vấn.
              </p>
            </div>

            <!-- Card Dịch vụ tích hợp (Google Calendar & Meet) -->
            <GoogleCalendarConnectCard />
          </section>
        </Transition>
      </div>
    </main>

    <!-- Hidden file inputs -->
    <input
      ref="avatarInputEl"
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif"
      class="hidden"
      aria-label="Tải lên ảnh đại diện"
      @change="onAvatarFileChange"
    />
    <input
      ref="coverInputEl"
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif"
      class="hidden"
      aria-label="Tải lên ảnh bìa"
      @change="onCoverFileChange"
    />
  </div>
</template>

<style scoped>
/* Hiệu ứng chuyển động SaaS */
@media (prefers-reduced-motion: no-preference) {
  .pf-rise {
    animation: pf-rise 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
}

@keyframes pf-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Tab transition fade & subtle slide */
.profile-tab-fade-enter-active {
  transition:
    opacity 200ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: opacity, transform;
}

.profile-tab-fade-leave-active {
  transition: opacity 70ms ease-out;
}

.profile-tab-fade-enter-from {
  opacity: 0;
  transform: translateY(5px);
}

.profile-tab-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .pf-rise {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
  .profile-tab-fade-enter-active,
  .profile-tab-fade-leave-active {
    transition: none !important;
  }
  .profile-tab-fade-enter-from,
  .profile-tab-fade-leave-to {
    opacity: 1 !important;
    transform: none !important;
  }
}
</style>