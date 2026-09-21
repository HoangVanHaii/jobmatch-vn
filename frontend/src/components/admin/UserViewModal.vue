<script setup lang="ts">
/**
 * UserViewModal — Modal xem chi tiết user (read-only).
 *
 * Props: `userId` (string)
 * Flow: mount → fetch user via store.fetchUserById → hiển thị data
 *
 * Sections:
 *   1. Avatar + Name + Email
 *   2. Basic info (Role, Status, Created, Last activity)
 *   3. Tài khoản & Bảo mật (Password status, OAuth providers)
 */
import { ref, watch, computed } from 'vue';
import AdminModal from './AdminModal.vue';
import UserStatusBadge from './UserStatusBadge.vue';
import RoleBadge from './RoleBadge.vue';
import { useAdminUsersStore } from '@stores/adminUsers';
import { useToastStore } from '@stores/toast';
import {
  formatDate, relativeTime, initialsFromName, roleLabel, type UserRole,
} from '@/utils/format';
import {
  Loader2, AlertCircle, RefreshCw, KeyRound, Link2, Mail,
  CheckCircle2, XCircle, Globe, Facebook, Github,
} from 'lucide-vue-next';

const props = defineProps<{
  open: boolean;
  userId: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

const store = useAdminUsersStore();
const loading = ref(false);
const error = ref<string | null>(null);
const user = ref<Awaited<ReturnType<typeof store.fetchUserById>> | null>(null);

async function load(): Promise<void> {
  if (!props.userId) return;
  loading.value = true;
  error.value = null;
  console.log('[UserViewModal] loading user', props.userId);
  try {
    user.value = await store.fetchUserById(props.userId);
    console.log('[UserViewModal] loaded user', user.value);
  } catch (e) {
    console.error('[UserViewModal] load failed', e);
    error.value = e instanceof Error ? e.message : 'Không tải được người dùng';
    user.value = null;
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.open, props.userId],
  ([isOpen]) => {
    if (isOpen && props.userId) load();
  },
  { immediate: true },
);

function close(): void {
  emit('update:open', false);
}

/* ============================================================================
 * Computed — danh sách provider hiển thị trong section OAuth.
 * Mỗi provider có icon riêng + màu brand tương ứng.
 * ==========================================================================*/
interface ProviderDisplay {
  key: 'google' | 'facebook' | 'github';
  label: string;
  email: string | null;
  color: string;       // tailwind text color
  bg: string;         // tailwind bg color for icon
  icon: typeof Globe;
}

// Map provider key → display config
const PROVIDER_CONFIG: Record<'google' | 'facebook' | 'github', {
  label: string; color: string; bg: string; icon: typeof Globe;
}> = {
  google:  { label: 'Google',  color: 'text-red-500',    bg: 'bg-red-50',    icon: Globe },
  facebook: { label: 'Facebook', color: 'text-blue-600',   bg: 'bg-blue-50',   icon: Facebook },
  github:  { label: 'GitHub',  color: 'text-gray-900',   bg: 'bg-gray-100',  icon: Github },
};

const linkedProviders = computed<ProviderDisplay[]>(() => {
  const list = user.value?.linkedProviders ?? [];
  return list
    .filter((p) => p.provider === 'google' || p.provider === 'facebook' || p.provider === 'github')
    .map((p) => {
      const cfg = PROVIDER_CONFIG[p.provider];
      return {
        key: p.provider,
        label: cfg.label,
        email: p.providerEmail ?? null,
        color: cfg.color,
        bg: cfg.bg,
        icon: cfg.icon,
      };
    });
});

const hasPassword = computed(() => user.value?.hasPassword === true);
const isPending = computed(() => user.value?.status === 'pending');

const toast = useToastStore();

/* ============================================================================
 * Action handlers (BE chưa có endpoint → dùng toast placeholder).
 * Sau này sẽ thay bằng call API thật (POST /admin/users/:id/reset-password,
 * POST /admin/users/:id/resend-verification, v.v.).
 * ==========================================================================*/
function resetPassword(): void {
  if (!user.value) return;
  toast.success(`Đã gửi email reset mật khẩu đến ${user.value.email}`);
}
function resendVerification(): void {
  if (!user.value) return;
  toast.success(`Đã gửi lại email xác minh đến ${user.value.email}`);
}
</script>

<template>
  <AdminModal
    :open="open"
    title="Chi tiết người dùng"
    size="md"
    @update:open="close"
  >
    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center gap-2 py-8" style="color: var(--admin-text-muted);">
      <Loader2 class="h-4 w-4 animate-spin" />
      <span class="text-sm">Đang tải...</span>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-col items-center gap-3 py-6">
      <AlertCircle class="h-5 w-5 text-red-500" />
      <p class="text-sm" style="color: var(--admin-text-muted);">{{ error }}</p>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition"
        style="border-color: var(--admin-border-subtle); color: var(--admin-text);"
        @click="load"
      >
        <RefreshCw class="h-3.5 w-3.5" />
        Thử lại
      </button>
    </div>

    <!-- Data -->
    <div v-else-if="user" class="space-y-6">
      <!-- Header: avatar + name + email -->
      <div class="flex items-center gap-4">
        <div
          class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
          style="background-color: var(--admin-accent-soft); color: var(--admin-accent-strong);"
        >
          {{ initialsFromName(user.fullName, user.email) }}
        </div>
        <div class="min-w-0">
          <p class="truncate text-base font-semibold" style="color: var(--admin-text);">
            {{ user.fullName || user.email.split('@')[0] }}
          </p>
          <p class="truncate text-sm" style="color: var(--admin-text-muted);">
            {{ user.email }}
          </p>
        </div>
      </div>

      <!-- Section 1: Thông tin cơ bản -->
      <div>
        <h4 class="mb-2.5 text-[11px] font-semibold uppercase tracking-wider" style="color: var(--admin-text-muted);">
          Thông tin cơ bản
        </h4>
        <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt class="font-medium" style="color: var(--admin-text-muted);">Vai trò</dt>
            <dd class="mt-1">
              <RoleBadge :role="user.role" />
            </dd>
          </div>
          <div>
            <dt class="font-medium" style="color: var(--admin-text-muted);">Trạng thái</dt>
            <dd class="mt-1">
              <UserStatusBadge :status="user.status" />
            </dd>
          </div>
          <div>
            <dt class="font-medium" style="color: var(--admin-text-muted);">Ngày tham gia</dt>
            <dd class="mt-1 tabular-nums" style="color: var(--admin-text);">
              {{ formatDate(user.createdAt) }}
            </dd>
          </div>
          <div>
            <dt class="font-medium" style="color: var(--admin-text-muted);">Hoạt động gần nhất</dt>
            <dd class="mt-1" style="color: var(--admin-text);">
              {{ relativeTime(user.updatedAt) }}
            </dd>
          </div>
        </dl>
      </div>

      <!-- Section 2: Tài khoản & Bảo mật -->
      <div>
        <h4 class="mb-2.5 text-[11px] font-semibold uppercase tracking-wider" style="color: var(--admin-text-muted);">
          Tài khoản &amp; Bảo mật
        </h4>
        <div class="space-y-3">
          <!-- Mật khẩu -->
          <div
            class="flex items-center gap-3 rounded-md border px-3 py-2"
            style="border-color: var(--admin-border-subtle);"
          >
            <div
              class="flex h-8 w-8 items-center justify-center rounded-md"
              style="background-color: var(--admin-surface-sunken);"
            >
              <KeyRound class="h-4 w-4" style="color: var(--admin-text-muted);" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium" style="color: var(--admin-text);">Mật khẩu</p>
              <p class="text-xs" style="color: var(--admin-text-muted);">
                {{ hasPassword ? 'Đã thiết lập' : 'Chưa có — chỉ đăng nhập qua OAuth' }}
              </p>
            </div>
            <CheckCircle2 v-if="hasPassword" class="h-4 w-4 shrink-0 text-emerald-500" />
            <XCircle v-else class="h-4 w-4 shrink-0 text-gray-400" />
          </div>

          <!-- OAuth providers -->
          <div
            class="rounded-md border px-3 py-2"
            style="border-color: var(--admin-border-subtle);"
          >
            <div class="flex items-center gap-2 pb-2">
              <Link2 class="h-3.5 w-3.5" style="color: var(--admin-text-muted);" />
              <p class="text-sm font-medium" style="color: var(--admin-text);">
                OAuth liên kết
              </p>
              <span class="ml-auto text-xs" style="color: var(--admin-text-muted);">
                ({{ linkedProviders.length }})
              </span>
            </div>
            <div v-if="linkedProviders.length > 0" class="space-y-2">
              <div
                v-for="p in linkedProviders"
                :key="p.key"
                class="flex items-center gap-3 rounded-md px-2 py-1.5"
                :style="`background-color: var(--admin-surface-sunken);`"
              >
                <div
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                  :class="p.bg"
                >
                  <component :is="p.icon" class="h-3.5 w-3.5" :class="p.color" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium" style="color: var(--admin-text);">
                    {{ p.label }}
                  </p>
                  <p v-if="p.email" class="truncate text-xs" style="color: var(--admin-text-muted);">
                    {{ p.email }}
                  </p>
                  <p v-else class="truncate text-xs" style="color: var(--admin-text-muted);">
                    (không có email)
                  </p>
                </div>
              </div>
            </div>
            <p v-else class="text-xs" style="color: var(--admin-text-muted);">
              Chưa liên kết OAuth nào.
            </p>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-2">
        <button
          v-if="isPending"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition"
          style="border-color: var(--admin-border-subtle); color: var(--admin-text);"
          @click="resendVerification"
        >
          <Mail class="h-3.5 w-3.5" />
          Gửi lại email xác minh
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition"
          style="border-color: var(--admin-border-subtle); color: var(--admin-text);"
          @click="resetPassword"
        >
          <KeyRound class="h-3.5 w-3.5" />
          Đặt lại mật khẩu
        </button>
        <button
          type="button"
          class="rounded-md border px-3 py-1.5 text-sm transition"
          style="border-color: var(--admin-border-subtle); color: var(--admin-text);"
          @click="close"
        >
          Đóng
        </button>
      </div>
    </template>
  </AdminModal>
</template>
