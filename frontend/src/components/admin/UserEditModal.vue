<script setup lang="ts">
/**
 * UserEditModal — Modal chỉnh sửa trạng thái người dùng.
 *
 * Props: `userId` (string)
 * Flow: mount → fetch user → chọn status mới → Lưu → gọi store.changeStatus
 *        → đóng modal. Có thể mở từ View modal hoặc trực tiếp từ action menu.
 */
import { ref, watch, computed } from 'vue';
import AdminModal from './AdminModal.vue';
import UserStatusBadge from './UserStatusBadge.vue';
import { useAdminUsersStore } from '@stores/adminUsers';
import { Loader2, AlertCircle, RefreshCw, Save } from 'lucide-vue-next';
import type { UserStatus } from '@/utils/format';

const props = defineProps<{
  open: boolean;
  userId: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'saved'): void;
}>();

const store = useAdminUsersStore();
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const user = ref<Awaited<ReturnType<typeof store.fetchUserById>> | null>(null);
const selectedStatus = ref<UserStatus>('active');

const STATUS_OPTIONS: { value: UserStatus; label: string }[] = [
  { value: 'active', label: 'Đang hoạt động' },
  { value: 'suspended', label: 'Tạm khóa' },
  { value: 'pending', label: 'Chờ kích hoạt' },
  { value: 'banned', label: 'Cấm' },
];

async function load(): Promise<void> {
  if (!props.userId) return;
  loading.value = true;
  error.value = null;
  try {
    user.value = await store.fetchUserById(props.userId);
    if (user.value) {
      // Type-safe: user.status is string, but values match UserStatus
      selectedStatus.value = (user.value.status as UserStatus) || 'active';
    }
  } catch (e) {
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

const isDirty = computed(() =>
  user.value ? user.value.status !== selectedStatus.value : false,
);

async function save(): Promise<void> {
  if (!user.value || !isDirty.value) {
    emit('update:open', false);
    return;
  }
  saving.value = true;
  error.value = null;
  try {
    await store.changeStatus(user.value.id, selectedStatus.value);
    emit('saved');
    emit('update:open', false);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Cập nhật thất bại';
  } finally {
    saving.value = false;
  }
}

function close(): void {
  emit('update:open', false);
}
</script>

<template>
  <AdminModal
    :open="open"
    title="Chỉnh sửa người dùng"
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

    <!-- Edit form -->
    <div v-else-if="user" class="space-y-5">
      <!-- User info (read-only) -->
      <div class="flex items-center gap-3 rounded-lg p-3" style="background-color: var(--admin-surface-sunken);">
        <div
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
          style="background-color: var(--admin-accent-soft); color: var(--admin-accent-strong);"
        >
          {{ user.email.charAt(0).toUpperCase() }}
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium" style="color: var(--admin-text);">
            {{ user.fullName || user.email.split('@')[0] }}
          </p>
          <p class="truncate text-xs" style="color: var(--admin-text-muted);">{{ user.email }}</p>
        </div>
      </div>

      <!-- Status field -->
      <div>
        <label class="block text-sm font-medium" style="color: var(--admin-text);">
          Trạng thái
        </label>
        <div class="mt-2 space-y-2">
          <label
            v-for="opt in STATUS_OPTIONS"
            :key="opt.value"
            class="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition"
            :class="selectedStatus === opt.value ? 'border-indigo-500 bg-indigo-50/50' : 'hover:bg-gray-50'"
            :style="selectedStatus === opt.value
              ? 'border-color: var(--admin-accent);'
              : 'border-color: var(--admin-border-subtle);'"
          >
            <input
              v-model="selectedStatus"
              type="radio"
              :value="opt.value"
              :disabled="opt.value === user.status"
              class="h-4 w-4 cursor-pointer"
              style="accent-color: var(--admin-accent);"
            />
            <UserStatusBadge :status="opt.value" />
            <span class="ml-auto text-xs" style="color: var(--admin-text-muted);">
              {{ opt.value === user.status ? '(hiện tại)' : '' }}
            </span>
          </label>
        </div>
        <p v-if="isDirty" class="mt-2 text-xs" style="color: var(--admin-text-muted);">
          Trạng thái sẽ thay đổi từ <strong>{{ user.status }}</strong> → <strong>{{ selectedStatus }}</strong>.
        </p>
      </div>
    </div>

    <template #footer>
      <button
        type="button"
        class="rounded-md border px-3 py-1.5 text-sm transition"
        style="border-color: var(--admin-border-subtle); color: var(--admin-text);"
        @click="close"
      >
        Huỷ
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
        style="background-color: var(--admin-accent); color: white;"
        :disabled="saving || !isDirty"
        @click="save"
      >
        <Save v-if="!saving" class="h-3.5 w-3.5" />
        <Loader2 v-else class="h-3.5 w-3.5 animate-spin" />
        {{ saving ? 'Đang lưu...' : 'Lưu' }}
      </button>
    </template>
  </AdminModal>
</template>
