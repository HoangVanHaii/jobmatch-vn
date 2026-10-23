<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Calendar,
  Video,
  Clock,
  ExternalLink,
  Unplug,
  Loader2,
} from 'lucide-vue-next';
import { interviewApi, type CalendarStatus } from '@/services/interview.api';
import { useToastStore } from '@stores/toast';

const route = useRoute();
const router = useRouter();
const toast = useToastStore();

const loading = ref(true);
const connecting = ref(false);
const disconnecting = ref(false);
const status = ref<CalendarStatus>({ isConnected: false });
const showDisconnectModal = ref(false);

const fetchStatus = async (): Promise<void> => {
  try {
    loading.value = true;
    const res = await interviewApi.getCalendarStatus();
    if (res.data?.success && res.data.data) {
      status.value = res.data.data;
    }
  } catch (err: any) {
    console.error('Fetch calendar status failed:', err);
  } finally {
    loading.value = false;
  }
};

const handleConnect = async (): Promise<void> => {
  // Mở trước tab mới trực tiếp từ click event để tránh bị trình duyệt chặn popup sau lệnh gọi API async
  const newTab = window.open('about:blank', '_blank');
  try {
    connecting.value = true;
    const res = await interviewApi.getCalendarConnectUrl('/employer/settings?tab=dich-vu');
    if (res.data?.success && res.data.data?.url) {
      if (newTab) {
        newTab.location.href = res.data.data.url;
      } else {
        window.open(res.data.data.url, '_blank');
      }
    } else {
      if (newTab) newTab.close();
      toast.error('Không thể lấy đường dẫn kết nối Google. Vui lòng thử lại sau.');
    }
  } catch (err: any) {
    if (newTab) newTab.close();
    toast.error(err?.message || 'Không thể kết nối Google Calendar. Vui lòng thử lại.');
  } finally {
    connecting.value = false;
  }
};

const handleDisconnect = async (): Promise<void> => {
  try {
    disconnecting.value = true;
    await interviewApi.disconnectCalendar();
    status.value = { isConnected: false };
    showDisconnectModal.value = false;
    toast.success('Đã ngắt kết nối Google Calendar thành công.');
  } catch (err: any) {
    toast.error(err?.message || 'Ngắt kết nối thất bại. Vui lòng thử lại.');
  } finally {
    disconnecting.value = false;
  }
};

const openGoogleCalendar = (): void => {
  const email = status.value.calendarEmail;
  const url = email
    ? `https://calendar.google.com/calendar/r?authuser=${encodeURIComponent(email)}`
    : 'https://calendar.google.com';
  window.open(url, '_blank', 'noopener,noreferrer');
};

onMounted(async () => {
  if (route.query.calendar_connected === 'success') {
    toast.success('Kết nối Google Calendar thành công! Tài khoản đã sẵn sàng đồng bộ.');
    // Thông báo cho tab gốc nếu đây là tab mới mở
    if (window.opener) {
      try {
        window.opener.postMessage({ type: 'GOOGLE_CALENDAR_CONNECTED', success: true }, '*');
      } catch {
        // ignore
      }
    }
    try {
      localStorage.setItem('jobmatch_calendar_sync', String(Date.now()));
    } catch {
      // ignore
    }
    await router.replace({ query: { ...route.query, calendar_connected: undefined } });
  } else if (route.query.calendar_error) {
    const errorMsg = String(route.query.calendar_error);
    toast.error(`Kết nối Google Calendar thất bại: ${errorMsg}`);
    await router.replace({ query: { ...route.query, calendar_error: undefined } });
  }

  await fetchStatus();

  // Lắng nghe sự kiện đồng bộ từ tab OAuth mới mở
  const handleMessage = (event: MessageEvent) => {
    if (event.data?.type === 'GOOGLE_CALENDAR_CONNECTED') {
      fetchStatus();
    }
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key === 'jobmatch_calendar_sync') {
      fetchStatus();
    }
  };

  const handleFocus = () => {
    if (!status.value.isConnected) {
      fetchStatus();
    }
  };

  window.addEventListener('message', handleMessage);
  window.addEventListener('storage', handleStorage);
  window.addEventListener('focus', handleFocus);

  onUnmounted(() => {
    window.removeEventListener('message', handleMessage);
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener('focus', handleFocus);
  });
});
</script>

<template>
  <div class="rounded-md border border-slate-200/90 bg-white shadow-sm overflow-hidden transition-all">
    <!-- Loading skeleton -->
    <div v-if="loading" class="p-6 flex items-center justify-between">
      <div class="flex items-center gap-4">
        <div class="h-14 w-14 rounded-2xl bg-slate-100 animate-pulse shrink-0" />
        <div class="space-y-2">
          <div class="h-4 w-48 rounded bg-slate-100 animate-pulse" />
          <div class="h-3 w-72 rounded bg-slate-100 animate-pulse" />
        </div>
      </div>
      <div class="h-10 w-32 rounded-xl bg-slate-100 animate-pulse" />
    </div>

    <!-- Main Card Body -->
    <div v-else class="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
      <!-- Left side: Google Logo + Info -->
      <div class="flex items-start sm:items-center gap-4">
        <!-- Google Logo in rounded square card -->
        <div class="h-14 w-14 shrink-0 rounded-2xl border border-slate-200 bg-white flex items-center justify-center p-3 shadow-xs">
          <svg class="h-7 w-7" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
          </svg>
        </div>

        <!-- Title & Subtitle with Badge -->
        <div>
          <div class="flex flex-wrap items-center gap-2.5">
            <h3 class="text-base sm:text-[17px] font-bold text-slate-900 tracking-tight">
              Google Calendar & Meet
            </h3>

            <!-- Status Badge -->
            <span
              v-if="status.isConnected"
              class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200/50"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Đã kết nối
              <span v-if="status.calendarEmail" class="text-[11px] font-normal text-emerald-600 font-mono">
                ({{ status.calendarEmail }})
              </span>
            </span>
            <span
              v-else
              class="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-slate-400" />
              Chưa kết nối
            </span>
          </div>

          <p class="text-sm text-slate-500 mt-1">
            Tự sinh link Meet và nhận biết giờ rảnh của bạn khi xếp lịch phỏng vấn.
          </p>
        </div>
      </div>

      <!-- Right side: Action Button -->
      <div class="shrink-0 flex items-center gap-2.5 sm:self-center">
        <!-- When Connected -->
        <template v-if="status.isConnected">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition"
            @click="openGoogleCalendar"
          >
            <ExternalLink :size="14" class="text-slate-500" />
            Mở Calendar
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50/60 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100/70 transition"
            @click="showDisconnectModal = true"
          >
            <Unplug :size="14" />
            Ngắt kết nối
          </button>
        </template>

        <!-- When Not Connected (Solid bright blue button as in screenshot) -->
        <button
          v-else
          type="button"
          :disabled="connecting"
          class="inline-flex items-center justify-center gap-2 rounded-md bg-[#5b4eea] px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-95 disabled:opacity-60 cursor-pointer"
          @click="handleConnect"
        >
          <Loader2 v-if="connecting" class="h-4 w-4 animate-spin text-white" />
          <span>{{ connecting ? 'Đang kết nối...' : 'Kết nối Google' }}</span>
        </button>
      </div>
    </div>

    <!-- Bottom Features Strip (3 columns with vertical dividers) -->
    <div class="border-t border-slate-100 bg-slate-50/70 px-4 sm:px-6 py-3.5">
      <div class="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/60 text-xs sm:text-[13px] text-slate-600">
        <div class="flex items-center gap-3 py-2 sm:py-0 sm:px-4 first:sm:pl-0">
          <Calendar :size="18" class="text-slate-400 shrink-0" />
          <span>Đồng bộ lịch phỏng vấn hai chiều</span>
        </div>
        <div class="flex items-center gap-3 py-2 sm:py-0 sm:px-4">
          <Video :size="18" class="text-slate-400 shrink-0" />
          <span>Tự tạo link Google Meet cho mỗi buổi</span>
        </div>
        <div class="flex items-center gap-3 py-2 sm:py-0 sm:px-4 last:sm:pr-0">
          <Clock :size="18" class="text-slate-400 shrink-0" />
          <span>Tự loại bỏ khung giờ bạn đã bận</span>
        </div>
      </div>
    </div>

    <!-- Confirm Disconnect Modal -->
    <div v-if="showDisconnectModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-fade-in">
      <div class="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-gray-100">
        <div class="flex items-start gap-4">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
            <Unplug class="h-5 w-5" />
          </div>
          <div class="space-y-1">
            <h4 class="text-base font-semibold text-gray-900">Ngắt kết nối Google Calendar?</h4>
            <p class="text-sm text-gray-500">
              Sau khi ngắt kết nối, hệ thống sẽ không thể tự động tạo link Google Meet và đồng bộ giờ rảnh cho các buổi phỏng vấn sắp tới.
            </p>
          </div>
        </div>

        <div class="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            class="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none"
            :disabled="disconnecting"
            @click="showDisconnectModal = false"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none disabled:opacity-60"
            :disabled="disconnecting"
            @click="handleDisconnect"
          >
            <Loader2 v-if="disconnecting" class="h-4 w-4 animate-spin" />
            <span>{{ disconnecting ? 'Đang ngắt...' : 'Xác nhận ngắt' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
