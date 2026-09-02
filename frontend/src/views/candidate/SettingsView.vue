<script setup lang="ts">
/**
 * SettingsView — trang Cài đặt cho candidate.
 *
 * Layout: 3 card (đồng bộ design system với ProfileView) trong `max-w-5xl` container.
 *   1. Tài khoản — avatar + name + email + role + status + link "Chỉnh sửa hồ sơ".
 *   2. Bảo mật — list "Phương thức đăng nhập" (email/password + OAuth đã link) +
 *      row "Mật khẩu" (chỉ hiện khi user có local password; click mở modal đổi MK).
 *      OAuth-only user thấy notice "Tài khoản dùng Google — không cần mật khẩu".
 *   3. Ngôn ngữ — dropdown chọn Tiếng Việt / English (UI only, chưa có backend).
 *
 * Provider detection: lấy từ `auth.user.hasPassword` + `auth.user.linkedProviders`
 * (đã populate qua GET /users/me — xem backend/src/router/user.ts).
 * Mặc định `hasPassword = true` nếu backend chưa trả field → user legacy không bị
 * mất khả năng đổi password.
 *
 * UX:
 *   - Card bo góc vừa (rounded-2xl), border + shadow rất nhẹ (đồng bộ ProfileView).
 *   - Typography hierarchy rõ (title 16-18px font-semibold, secondary 12-13px slate-500).
 *   - Icon Lucide đồng nhất; không emoji.
 *   - Click "Chỉnh sửa hồ sơ" → router.push('/candidate/profile').
 *   - Click "Đổi mật khẩu" → mở ChangePasswordModal (Teleport, có backdrop+Esc).
 */
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Globe,
  KeyRound,
  Languages,
  Lock,
  Mail,
  ShieldCheck,
  UserCircle,
  Settings as SettingsIcon,
  UserRound,
} from 'lucide-vue-next';
import { useAuthStore, type LinkedProvider, type OAuthProviderType } from '@stores/auth';
import ChangePasswordModal from '@components/candidate/ChangePasswordModal.vue';
import LanguageSelect, { type LanguageOption } from '@components/common/LanguageSelect.vue';

/* ============================================================================
 * Auth + router
 * ==========================================================================*/

const auth = useAuthStore();
const { user } = storeToRefs(auth);
const router = useRouter();

/* ============================================================================
 * Helpers
 * ==========================================================================*/

/** Label tiếng Việt cho OAuth provider — dùng chung `Globe` icon cho mọi OAuth
 *  provider (Lucide đã xóa icon brand `Facebook`/`Github`, phân biệt bằng text). */
const providerLabel = (provider: OAuthProviderType): string => {
  if (provider === 'google') return 'Google';
  if (provider === 'facebook') return 'Facebook';
  if (provider === 'github') return 'GitHub';
  return provider;
};

/** Initials cho avatar placeholder. */
const initials = computed<string>(() => {
  const n = (user.value?.fullName ?? user.value?.email.split('@')[0]) ?? '';
  return n ? n.charAt(0).toUpperCase() : '?';
});

const displayName = computed<string>(() => {
  const u = user.value;
  if (!u) return '';
  const fromProfile = u.fullName?.trim();
  if (fromProfile) return fromProfile;
  return u.email.split('@')[0];
});

const roleLabel = computed<string>(() => {
  const role = user.value?.role;
  if (role === 'candidate') return 'Ứng viên';
  if (role === 'employer') return 'Nhà tuyển dụng';
  if (role === 'admin') return 'Quản trị viên';
  return '—';
});

/** Status badge tone — đồng bộ logic với AccountInfoModal trước đây. */
const statusInfo = computed<{
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}>(() => {
  const status = user.value?.status;
  if (status === 'active') return { label: 'Đang hoạt động', tone: 'success' };
  if (status === 'pending') return { label: 'Chờ xác thực', tone: 'warning' };
  if (status === 'suspended') return { label: 'Tạm khóa', tone: 'danger' };
  if (status === 'banned') return { label: 'Đã bị cấm', tone: 'danger' };
  return { label: 'Không xác định', tone: 'neutral' };
});

const statusBadgeClass = computed<string>(() => {
  const tone = statusInfo.value.tone;
  if (tone === 'success') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (tone === 'warning') return 'bg-amber-50 text-amber-700 ring-amber-200';
  if (tone === 'danger') return 'bg-red-50 text-red-700 ring-red-200';
  return 'bg-slate-100 text-slate-600 ring-slate-200';
});

const goToProfile = (): void => {
  router.push('/candidate/profile');
};

/* ============================================================================
 * Card 2 — Security
 *
 * Logic:
 * - hasPassword = user.hasPassword ?? true (fallback an toàn cho legacy user).
 * - linkedProviders: từ backend. Có thể rỗng nếu user chỉ dùng email/password.
 * - Primary method: nếu !hasPassword → OAuth đầu tiên. Nếu có hasPassword → email/password.
 *
 * Nếu chỉ có OAuth (no password) → KHÔNG show row "Mật khẩu", thay vào đó show
 * notice "Tài khoản này dùng Google/Facebook/GitHub — không cần mật khẩu JobMatchVN".
 * ==========================================================================*/

const hasPassword = computed<boolean>(() => user.value?.hasPassword ?? true);
const linkedProviders = computed<LinkedProvider[]>(() => user.value?.linkedProviders ?? []);

/** Tên provider chính (label ngắn) — dùng trong notice OAuth-only. */
const primaryProviderLabel = computed<string | null>(() => {
  const p = linkedProviders.value[0];
  return p ? providerLabel(p.provider) : null;
});

const passwordModalOpen = ref(false);

const openPasswordModal = (): void => {
  passwordModalOpen.value = true;
};

/* ============================================================================
 * Card 3 — Language dropdown (UI only)
 *
 * Chưa có i18n backend → chỉ lưu local state. Khi backend hỗ trợ sẽ gọi
 * userApi.updatePreference('language', lang) hoặc tương tự ở đây.
 * ==========================================================================*/

interface LanguageOptionList extends LanguageOption {
  code: 'vi' | 'en';
}

/** Danh sách ngôn ngữ hiện đang hỗ trợ. UI-only — chưa sync backend. */
const LANGUAGES: LanguageOptionList[] = [
  { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
];

/** Code ngôn ngữ đang chọn — bind v-model với LanguageSelect component. */
const selectedLanguageCode = ref<LanguageOptionList['code']>(LANGUAGES[0]!.code);
</script>

<template>
  <div class="min-h-full bg-gray-50">
    <!-- Page header -->
    <div class="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
      <div class="flex items-center gap-3">
        <div
          class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100 text-primary-700 shrink-0"
        >
          <SettingsIcon class="h-6 w-6" />
        </div>
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight truncate">
            Cài đặt
          </h1>
          <p class="text-xs sm:text-sm text-slate-500 mt-0.5 truncate">
            Quản lý tài khoản, bảo mật và tùy chọn của bạn
          </p>
        </div>
      </div>
    </div>

    <!-- Main content -->
    <div class="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      <!-- ============================================================ -->
      <!-- CARD 1: Tài khoản -->
      <!-- ============================================================ -->
      <section
        class="bg-white rounded-2xl border border-slate-200 shadow-sm shadow-slate-900/[0.02]"
      >
        <div class="p-5 sm:p-7">
          <!-- Section header -->
          <div class="flex items-start gap-3 mb-5">
            <div
              class="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-700 shrink-0"
            >
              <UserCircle class="h-5 w-5" />
            </div>
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-slate-900">Tài khoản</h2>
              <p class="text-xs text-slate-500 mt-0.5">
                Thông tin cơ bản từ tài khoản đăng nhập của bạn
              </p>
            </div>
          </div>

          <!-- Avatar + identity -->
          <div class="flex items-start gap-4 mb-5">
            <div
              class="relative h-16 w-16 sm:h-20 sm:w-20 shrink-0 rounded-2xl overflow-hidden ring-2 ring-slate-200 bg-gradient-to-br from-primary-100 to-primary-200 flex items-center justify-center"
            >
              <img
                v-if="user?.avatarUrl"
                :src="user.avatarUrl"
                :alt="displayName"
                class="h-full w-full object-cover"
              />
              <span v-else class="text-2xl sm:text-3xl font-semibold text-primary-700">
                {{ initials }}
              </span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-base sm:text-lg font-semibold text-slate-900 truncate">
                {{ displayName || '—' }}
              </p>
              <p class="text-sm text-slate-500 truncate mt-0.5">
                {{ user?.email || '—' }}
              </p>
              <span
                class="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1"
                :class="statusBadgeClass"
              >
                <CheckCircle2 v-if="statusInfo.tone === 'success'" class="h-3 w-3" />
                <span
                  v-else
                  class="inline-block h-1.5 w-1.5 rounded-full bg-current"
                  aria-hidden="true"
                />
                {{ statusInfo.label }}
              </span>
            </div>
          </div>

          <!-- Info rows -->
          <div class="rounded-xl border border-slate-200 bg-slate-50/60 divide-y divide-slate-200">
            <div class="flex items-center gap-3 px-3.5 py-3">
              <Mail class="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
              <div class="flex-1 min-w-0">
                <p class="text-[11px] text-slate-500 leading-tight">Email</p>
                <p class="text-sm font-medium text-slate-900 truncate leading-tight mt-0.5">
                  {{ user?.email || '—' }}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-3 px-3.5 py-3">
              <ShieldCheck class="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
              <div class="flex-1 min-w-0">
                <p class="text-[11px] text-slate-500 leading-tight">Vai trò</p>
                <p class="text-sm font-medium text-slate-900 truncate leading-tight mt-0.5">
                  {{ roleLabel }}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-3 px-3.5 py-3">
              <UserRound class="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
              <div class="flex-1 min-w-0">
                <p class="text-[11px] text-slate-500 leading-tight">Họ tên</p>
                <p class="text-sm font-medium text-slate-900 truncate leading-tight mt-0.5">
                  {{ displayName || '—' }}
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            class="mt-5 inline-flex items-center justify-center gap-2 rounded-lg border border-primary-300 bg-primary-50 px-4 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-100 hover:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition"
            @click="goToProfile"
          >
            <UserCircle class="h-4 w-4" />
            Chỉnh sửa hồ sơ
            <ExternalLink class="h-3.5 w-3.5" />
          </button>
        </div>
      </section>

      <!-- ============================================================ -->
      <!-- CARD 2: Bảo mật -->
      <!-- ============================================================ -->
      <section
        class="bg-white rounded-2xl border border-slate-200 shadow-sm shadow-slate-900/[0.02]"
      >
        <div class="p-5 sm:p-7">
          <!-- Section header -->
          <div class="flex items-start gap-3 mb-5">
            <div
              class="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-700 shrink-0"
            >
              <ShieldCheck class="h-5 w-5" />
            </div>
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-slate-900">Bảo mật</h2>
              <p class="text-xs text-slate-500 mt-0.5">
                Phương thức đăng nhập và mật khẩu của bạn
              </p>
            </div>
          </div>

          <!-- Phương thức đăng nhập -->
          <div>
            <h3 class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Phương thức đăng nhập
            </h3>
            <div class="rounded-xl border border-slate-200 bg-slate-50/60 divide-y divide-slate-200">
              <!-- Local email/password (nếu có) -->
              <div
                v-if="hasPassword"
                class="flex items-center gap-3 px-3.5 py-3"
              >
                <div
                  class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white ring-1 ring-slate-200 text-slate-600 shrink-0"
                >
                  <Mail class="h-4 w-4" />
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-slate-900 truncate">Email và mật khẩu</p>
                  <p class="text-[11px] text-slate-500 truncate mt-0.5">
                    {{ user?.email || '—' }}
                  </p>
                </div>
                <span
                  class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                >
                  <CheckCircle2 class="h-3 w-3" />
                  Đã thiết lập
                </span>
              </div>

              <!-- OAuth providers đã link -->
              <div
                v-for="lp in linkedProviders"
                :key="lp.provider"
                class="flex items-center gap-3 px-3.5 py-3"
              >
                <div
                  class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white ring-1 ring-slate-200 text-slate-600 shrink-0"
                >
                  <Globe class="h-4 w-4" />
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-slate-900 truncate">
                    Đăng nhập bằng {{ providerLabel(lp.provider) }}
                  </p>
                  <p v-if="lp.providerEmail" class="text-[11px] text-slate-500 truncate mt-0.5">
                    {{ lp.providerEmail }}
                  </p>
                </div>
                <span
                  class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                >
                  <CheckCircle2 class="h-3 w-3" />
                  Đã kết nối
                </span>
              </div>

              <!-- Empty state: không có method nào (hiếm — fallback khi backend chưa trả field) -->
              <div
                v-if="!hasPassword && linkedProviders.length === 0"
                class="flex items-center gap-3 px-3.5 py-3 text-sm text-slate-500"
              >
                Chưa có phương thức đăng nhập nào được liên kết.
              </div>
            </div>
          </div>

          <!-- Mật khẩu section -->
          <div class="mt-5">
            <h3 class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Mật khẩu
            </h3>

            <!-- Có local password → show row với button mở modal -->
            <div
              v-if="hasPassword"
              class="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-3"
            >
              <div
                class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white ring-1 ring-slate-200 text-slate-600 shrink-0"
              >
                <Lock class="h-4 w-4" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-slate-900 truncate">Mật khẩu</p>
                <p class="text-[11px] text-slate-500 truncate mt-0.5">
                  Mật khẩu của bạn đã được thiết lập
                </p>
              </div>
              <button
                type="button"
                class="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition shrink-0"
                @click="openPasswordModal"
              >
                <KeyRound class="h-3.5 w-3.5" />
                Đổi mật khẩu
              </button>
            </div>

            <!-- OAuth-only → show notice + disable password change -->
            <div
              v-else
              class="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-3"
            >
              <div
                class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white ring-1 ring-slate-200 text-slate-500 shrink-0 mt-0.5"
              >
                <Lock class="h-4 w-4" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-slate-900">
                  Không dùng mật khẩu JobMatchVN
                </p>
                <p class="text-[11px] text-slate-500 leading-snug mt-1">
                  Tài khoản này sử dụng
                  <span v-if="primaryProviderLabel" class="font-medium text-slate-700">
                    {{ primaryProviderLabel }}
                  </span>
                  <span v-else>OAuth</span>
                  để đăng nhập. Bạn không cần mật khẩu JobMatchVN.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ============================================================ -->
      <!-- CARD 3: Ngôn ngữ -->
      <!-- ============================================================ -->
      <section
        class="bg-white rounded-2xl border border-slate-200 shadow-sm shadow-slate-900/[0.02]"
      >
        <div class="p-5 sm:p-7">
          <!-- Section header -->
          <div class="flex items-start gap-3 mb-5">
            <div
              class="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-700 shrink-0"
            >
              <Languages class="h-5 w-5" />
            </div>
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-slate-900">Ngôn ngữ</h2>
              <p class="text-xs text-slate-500 mt-0.5">
                Chọn ngôn ngữ bạn muốn sử dụng trên JobMatchVN
              </p>
            </div>
          </div>

          <!--
            Custom combobox (LanguageSelect) thay cho native <select>:
              - Toàn bộ panel là <li role="option"> styled Tailwind → match design
                system thay vì OS-default "<option>" xấu.
              - Teleport panel ra <body> + z-[1000] escape mọi stacking/overflow
                của ancestor.
              - Auto-flip lên trên khi button ở cuối viewport, xuống khi ở đầu →
                không clip ở bất kỳ vị trí nào.
              - Keyboard nav đầy đủ (Arrow/Home/End/Enter/Space/Esc) + a11y ARIA
                listbox pattern.
          -->
          <LanguageSelect
            v-model="selectedLanguageCode"
            :options="LANGUAGES"
            aria-label="Chọn ngôn ngữ"
            wrapper-class="max-w-sm"
          />

          <!-- Hint -->
          <p class="mt-3 text-[11px] text-slate-500 leading-snug">
            <AlertCircle class="inline h-3 w-3 mr-0.5 -mt-0.5" aria-hidden="true" />
            Tính năng đa ngôn ngữ đang được phát triển — lựa chọn hiện chỉ áp dụng cho giao diện
            cài đặt.
          </p>
        </div>
      </section>
    </div>

    <!-- Password change modal — chỉ mount khi click nút ở Card 2. -->
    <ChangePasswordModal :open="passwordModalOpen" @update:open="passwordModalOpen = $event" />
  </div>
</template>

<style scoped>
/* Page-level styles. Khi cần transition / scoped CSS cho component mới sẽ khai báo ở đây. */
</style>