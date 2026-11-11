<script setup lang="ts">
/**
 * ScheduleInterviewModal — Lên lịch phỏng vấn bán tự động
 * Tự động tạo phòng họp Google Meet và đồng bộ Google Calendar
 */
import { computed, ref, watch } from 'vue';
import {
  Calendar,
  Video,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  ExternalLink,
  ChevronDown,
  Layers,
} from 'lucide-vue-next';
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { interviewApi, type BusyTimeSlot, type CalendarStatus } from '@/services/interview.api';
import { useAuthStore } from '@stores/auth';
import { useToastStore } from '@stores/toast';
import { extractErrorMessage } from '@/services/http';

dayjs.extend(isBetween);
dayjs.extend(customParseFormat);

const props = defineProps<{
  open: boolean;
  applicationId: string;
  candidateName: string;
  candidateEmail?: string | null;
  jobTitle?: string;
  companyName?: string;
  usedInterviewTypes?: string[];
  roundNumber?: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'scheduled', payload: { interviewId: string; meetingLink?: string | null; interviewType?: string }): void;
}>();

const authStore = useAuthStore();
const toast = useToastStore();

// Calendar connection state
const calendarStatus = ref<CalendarStatus>({ isConnected: false });
const loadingCalendarStatus = ref(false);

// Form state
const meetingFormat = ref<'online' | 'offline'>('online');
const interviewType = ref<string>('technical');
const scheduledDate = ref(dayjs().add(1, 'day').format('YYYY-MM-DD'));
const scheduledTime = ref('09:00');
const durationMin = ref(60);
const autoCreateMeet = ref(true);
const manualMeetingLink = ref('');
const location = ref('');
const notes = ref('');

const INTERVIEW_TYPE_OPTIONS = [
  { value: 'screening', label: 'Phỏng vấn sơ loại (Screening)' },
  { value: 'technical', label: 'Phỏng vấn kỹ thuật (Technical)' },
  { value: 'coding', label: 'Lập trình trực tiếp (Live Coding)' },
  { value: 'system_design', label: 'Thiết kế hệ thống (System Design)' },
  { value: 'hr', label: 'Phỏng vấn nhân sự (HR Interview)' },
  { value: 'culture_fit', label: 'Phù hợp văn hóa (Culture Fit)' },
  { value: 'panel', label: 'Phỏng vấn hội đồng (Panel)' },
  { value: 'final', label: 'Phỏng vấn vòng cuối (Final Interview)' },
  { value: 'other', label: 'Khác' },
];

const isTypeUsed = (type: string): boolean => {
  return Boolean(props.usedInterviewTypes?.includes(type));
};

// Đảm bảo khi mở modal, loại phỏng vấn được chọn là loại chưa từng sử dụng
watch(
  [() => props.open, () => props.usedInterviewTypes],
  ([isOpen, usedList]) => {
    if (isOpen) {
      const used = usedList ?? [];
      if (used.includes(interviewType.value)) {
        const available = INTERVIEW_TYPE_OPTIONS.find((opt) => !used.includes(opt.value));
        if (available) {
          interviewType.value = available.value;
        }
      }
    }
  },
  { immediate: true },
);

// Busy times checking
const busySlots = ref<BusyTimeSlot[]>([]);
const loadingBusyTimes = ref(false);
const submitting = ref(false);

const TIME_OPTIONS = [
  '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00',
  '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00',
];

const DURATION_OPTIONS = [
  { label: '30 phút', value: 30 },
  { label: '45 phút', value: 45 },
  { label: '60 phút (1 giờ)', value: 60 },
  { label: '90 phút', value: 90 },
];

const minDate = computed(() => dayjs().format('YYYY-MM-DD'));

// Kiểm tra khung giờ đã chọn có bị trùng lịch bận không
const isTimeBusy = (timeStr: string): boolean => {
  if (!busySlots.value.length) return false;
  const slotStart = dayjs(`${scheduledDate.value}T${timeStr}:00`);
  const slotEnd = slotStart.add(durationMin.value, 'minute');

  return busySlots.value.some((b) => {
    const bStart = dayjs(b.start);
    const bEnd = dayjs(b.end);
    return slotStart.isBefore(bEnd) && slotEnd.isAfter(bStart);
  });
};

const currentSlotBusy = computed(() => isTimeBusy(scheduledTime.value));

const loadCalendarStatus = async (): Promise<void> => {
  loadingCalendarStatus.value = true;
  try {
    const res = await interviewApi.getCalendarStatus();
    if (res.data?.success && res.data.data) {
      calendarStatus.value = res.data.data;
      if (calendarStatus.value.isConnected) {
        autoCreateMeet.value = true;
      }
    }
  } catch {
    // best-effort
  } finally {
    loadingCalendarStatus.value = false;
  }
};

const loadBusyTimes = async (): Promise<void> => {
  if (!calendarStatus.value.isConnected || !scheduledDate.value) {
    busySlots.value = [];
    return;
  }
  loadingBusyTimes.value = true;
  try {
    const res = await interviewApi.getBusyTimes(scheduledDate.value);
    if (res.data?.success && res.data.data) {
      busySlots.value = res.data.data.busyTimes || [];
    }
  } catch {
    busySlots.value = [];
  } finally {
    loadingBusyTimes.value = false;
  }
};

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      void loadCalendarStatus().then(() => {
        void loadBusyTimes();
      });
    }
  },
  { immediate: true },
);

watch(
  () => scheduledDate.value,
  () => {
    if (props.open) {
      void loadBusyTimes();
    }
  },
);

const handleClose = (): void => {
  if (!submitting.value) {
    emit('close');
  }
};

const handleSubmit = async (): Promise<void> => {
  if (!authStore.user?.id) {
    toast.push({ variant: 'error', title: 'Lỗi', body: 'Bạn chưa đăng nhập.' });
    return;
  }

  if (meetingFormat.value === 'offline' && !location.value.trim()) {
    toast.push({ variant: 'error', title: 'Chưa nhập địa điểm', body: 'Vui lòng nhập địa điểm phỏng vấn trực tiếp.' });
    return;
  }

  if (meetingFormat.value === 'online' && !calendarStatus.value.isConnected && !manualMeetingLink.value.trim()) {
    toast.push({
      variant: 'error',
      title: 'Chưa có link họp',
      body: 'Vui lòng kết nối Google Calendar để tự sinh link Meet, hoặc nhập link phòng họp trực tuyến.',
    });
    return;
  }

  if (isTypeUsed(interviewType.value)) {
    toast.push({
      variant: 'error',
      title: 'Loại phỏng vấn đã được sử dụng',
      body: 'Ứng viên đã từng tham gia loại phỏng vấn này. Vui lòng chọn loại phỏng vấn khác cho vòng mới.',
    });
    return;
  }

  const startIso = dayjs(`${scheduledDate.value}T${scheduledTime.value}:00+07:00`).toISOString();

  submitting.value = true;
  try {
    const res = await interviewApi.create({
      applicationId: props.applicationId,
      interviewerId: authStore.user.id,
      interviewType: interviewType.value,
      scheduledAt: startIso,
      durationMin: durationMin.value,
      location: meetingFormat.value === 'offline' ? location.value.trim() : undefined,
      meetingLink:
        meetingFormat.value === 'online' && !autoCreateMeet.value
          ? manualMeetingLink.value.trim()
          : undefined,
      autoCreateMeet: meetingFormat.value === 'online' && autoCreateMeet.value && calendarStatus.value.isConnected,
      notes: notes.value.trim() || undefined,
    });

    const data = res.data.data;
    toast.push({
      variant: 'success',
      title: 'Đã gửi lời mời phỏng vấn!',
      body: data.meetingLink
        ? `Đã tạo link Google Meet và gửi thư mời tới ${props.candidateEmail || props.candidateName}.`
        : `Lịch phỏng vấn đã được thiết lập thành công.`,
    });

    emit('scheduled', {
      interviewId: data.id,
      meetingLink: data.meetingLink,
      interviewType: interviewType.value,
    });
    emit('close');
  } catch (err) {
    toast.push({
      variant: 'error',
      title: 'Không thể tạo lịch phỏng vấn',
      body: extractErrorMessage(err, 'Vui lòng kiểm tra lại thông tin và thử lại.'),
    });
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs font-poppins"
    @click.self="handleClose"
  >
    <div
      class="w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-200"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-slate-100 px-6 py-4.5 bg-white">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-[#1769e8]">
            <Calendar class="h-5 w-5" />
          </div>
          <div>
            <h2 class="text-base font-semibold text-slate-900">
              Mời phỏng vấn ứng viên {{ roundNumber && roundNumber > 1 ? `(Vòng ${roundNumber})` : '' }}
            </h2>
            <p class="text-xs text-slate-500">
              {{ candidateName }} · Vị trí: <span class="font-medium text-slate-700">{{ jobTitle || 'Ứng tuyển' }}</span>
            </p>
          </div>
        </div>
        <button
          type="button"
          class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition cursor-pointer"
          @click="handleClose"
        >
          <X class="h-5 w-5" />
        </button>
      </div>

      <!-- Body / Form -->
      <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5 scrollbar-thin">
        <!-- Trạng thái Google Calendar Card -->
        <div
          v-if="calendarStatus.isConnected"
          class="rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-3.5 flex items-start justify-between gap-3"
        >
          <div class="flex items-center gap-2.5">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <CheckCircle2 class="h-4.5 w-4.5" />
            </span>
            <div>
              <div class="flex items-center gap-2">
                <span class="text-xs font-semibold text-emerald-900">Đã kết nối Google Calendar</span>
                <span class="inline-flex items-center rounded-full bg-emerald-200/70 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                  Tự động Meet
                </span>
              </div>
              <p class="text-[11px] text-emerald-700 mt-0.5">
                Tài khoản: <strong>{{ calendarStatus.calendarEmail }}</strong> · Sự kiện sẽ tự động thêm vào lịch & tạo link Meet.
              </p>
            </div>
          </div>
        </div>

        <div
          v-else
          class="rounded-xl border border-amber-200/90 bg-amber-50/70 p-3.5 flex items-start justify-between gap-3"
        >
          <div class="flex items-start gap-2.5">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 mt-0.5">
              <AlertCircle class="h-4.5 w-4.5" />
            </span>
            <div>
              <p class="text-xs font-semibold text-amber-900">Chưa kết nối Google Calendar</p>
              <p class="text-[11px] text-amber-800 mt-0.5">
                Kết nối Google Calendar để hệ thống tự động sinh link Google Meet và đồng bộ lịch phỏng vấn vào tài khoản của bạn.
              </p>
            </div>
          </div>
          <router-link
            to="/employer/settings?tab=dich-vu"
            target="_blank"
            class="shrink-0 inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-amber-700 transition"
          >
            Kết nối
            <ExternalLink class="h-3 w-3" />
          </router-link>
        </div>

        <!-- Loại phỏng vấn (Vòng phỏng vấn) -->
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
            <span class="flex items-center gap-1.5">
              <Layers class="h-3.5 w-3.5 text-slate-500" />
              Loại phỏng vấn {{ roundNumber ? `(Vòng ${roundNumber})` : '(Vòng phỏng vấn)' }}
            </span>
            <span v-if="usedInterviewTypes?.length" class="text-[10.5px] font-normal text-slate-400">
              ({{ usedInterviewTypes.length }} vòng đã hoàn thành)
            </span>
          </label>
          <div class="relative">
            <select
              v-model="interviewType"
              class="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-800 focus:border-[#1769e8] focus:outline-hidden focus:ring-1 focus:ring-[#1769e8] cursor-pointer"
            >
              <option
                v-for="opt in INTERVIEW_TYPE_OPTIONS"
                :key="opt.value"
                :value="opt.value"
                :disabled="isTypeUsed(opt.value)"
                :class="isTypeUsed(opt.value) ? 'text-slate-400 bg-slate-100 italic' : 'text-slate-800'"
              >
                {{ isTypeUsed(opt.value) ? `${opt.label} — (Đã tổ chức)` : opt.label }}
              </option>
            </select>
            <ChevronDown class="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          </div>
          <p v-if="usedInterviewTypes?.length" class="text-[10.5px] text-amber-600 mt-1">
            * Các loại phỏng vấn đã hoàn thành ở các vòng trước sẽ không được chọn lại.
          </p>
        </div>

        <!-- Hình thức phỏng vấn -->
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-2">Hình thức phỏng vấn</label>
          <div class="grid grid-cols-2 gap-3">
            <button
              type="button"
              class="flex items-center gap-3 rounded-xl border p-3 text-left transition cursor-pointer"
              :class="meetingFormat === 'online'
                ? 'border-[#1769e8] bg-blue-50/50 text-[#1769e8] ring-1 ring-[#1769e8]'
                : 'border-slate-200 hover:border-slate-300 text-slate-700'"
              @click="meetingFormat = 'online'"
            >
              <div
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                :class="meetingFormat === 'online' ? 'bg-[#1769e8] text-white' : 'bg-slate-100 text-slate-500'"
              >
                <Video class="h-4.5 w-4.5" />
              </div>
              <div>
                <p class="text-xs font-semibold">Phỏng vấn Online</p>
                <p class="text-[11px] text-slate-500">Google Meet / Họp từ xa</p>
              </div>
            </button>

            <button
              type="button"
              class="flex items-center gap-3 rounded-xl border p-3 text-left transition cursor-pointer"
              :class="meetingFormat === 'offline'
                ? 'border-[#1769e8] bg-blue-50/50 text-[#1769e8] ring-1 ring-[#1769e8]'
                : 'border-slate-200 hover:border-slate-300 text-slate-700'"
              @click="meetingFormat = 'offline'"
            >
              <div
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                :class="meetingFormat === 'offline' ? 'bg-[#1769e8] text-white' : 'bg-slate-100 text-slate-500'"
              >
                <MapPin class="h-4.5 w-4.5" />
              </div>
              <div>
                <p class="text-xs font-semibold">Phỏng vấn trực tiếp</p>
                <p class="text-[11px] text-slate-500">Tại trụ sở công ty</p>
              </div>
            </button>
          </div>
        </div>

        <!-- Ngày & Thời lượng -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1.5">Ngày phỏng vấn</label>
            <input
              v-model="scheduledDate"
              type="date"
              :min="minDate"
              class="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs text-slate-800 focus:border-[#1769e8] focus:outline-hidden focus:ring-1 focus:ring-[#1769e8]"
            />
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1.5">Thời lượng dự kiến</label>
            <select
              v-model="durationMin"
              class="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs text-slate-800 focus:border-[#1769e8] focus:outline-hidden focus:ring-1 focus:ring-[#1769e8]"
            >
              <option v-for="opt in DURATION_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
        </div>

        <!-- Khung giờ bắt đầu & Gợi ý lịch bận -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-xs font-semibold text-slate-700">Giờ bắt đầu</label>
            <span v-if="loadingBusyTimes" class="inline-flex items-center gap-1 text-[11px] text-slate-400">
              <Loader2 class="h-3 w-3 animate-spin" /> Đang kiểm tra lịch trống...
            </span>
            <span v-else-if="calendarStatus.isConnected" class="text-[11px] text-emerald-600 font-medium">
              Đồng bộ lịch Google
            </span>
          </div>

          <div class="grid grid-cols-4 sm:grid-cols-7 gap-2">
            <button
              v-for="t in TIME_OPTIONS"
              :key="t"
              type="button"
              class="relative rounded-lg border py-2 text-center text-xs font-medium transition cursor-pointer"
              :class="[
                scheduledTime === t
                  ? 'border-[#1769e8] bg-[#1769e8] text-white shadow-xs'
                  : isTimeBusy(t)
                  ? 'border-red-200 bg-red-50/50 text-red-600 hover:bg-red-50'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
              ]"
              @click="scheduledTime = t"
            >
              {{ t }}
              <span
                v-if="isTimeBusy(t)"
                class="absolute -top-1 -right-1 flex h-2 w-2 rounded-full bg-red-500 ring-2 ring-white"
                title="Khung giờ này bạn đã có lịch bận trên Google Calendar"
              />
            </button>
          </div>

          <!-- Cảnh báo nếu khung giờ được chọn bị bận -->
          <p v-if="currentSlotBusy" class="mt-2 flex items-center gap-1.5 text-[11px] text-amber-600">
            <AlertCircle class="h-3.5 w-3.5 shrink-0" />
            Khung giờ <strong>{{ scheduledTime }}</strong> có thể trùng với một lịch hẹn khác trên Google Calendar của bạn. Bạn vẫn có thể tiếp tục nếu muốn.
          </p>
        </div>

        <!-- Chi tiết phương thức: Online Meet vs Offline Location -->
        <div v-if="meetingFormat === 'online'" class="space-y-3">
          <div v-if="calendarStatus.isConnected" class="flex items-center justify-between rounded-xl border border-slate-200 p-3 bg-slate-50/50">
            <div>
              <p class="text-xs font-medium text-slate-800">Tự động tạo Google Meet link</p>
              <p class="text-[11px] text-slate-500">Link Meet sẽ được tạo tức thì và đính kèm vào thư mời</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input v-model="autoCreateMeet" type="checkbox" class="sr-only peer" />
              <div class="w-9 h-5 bg-slate-300 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#1769e8]"></div>
            </label>
          </div>

          <div v-if="!calendarStatus.isConnected || !autoCreateMeet">
            <label class="block text-xs font-semibold text-slate-700 mb-1.5">Link phòng họp trực tuyến</label>
            <input
              v-model="manualMeetingLink"
              type="url"
              placeholder="https://meet.google.com/xxx-xxxx-xxx hoặc Zoom / Teams..."
              class="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#1769e8] focus:outline-hidden focus:ring-1 focus:ring-[#1769e8]"
            />
          </div>
        </div>

        <div v-else>
          <label class="block text-xs font-semibold text-slate-700 mb-1.5">Địa chỉ phỏng vấn</label>
          <input
            v-model="location"
            type="text"
            placeholder="Ví dụ: Tầng 5, Tòa nhà Bitexco, Q.1, TP. Hồ Chí Minh"
            class="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#1769e8] focus:outline-hidden focus:ring-1 focus:ring-[#1769e8]"
          />
        </div>

        <!-- Ghi chú cho ứng viên -->
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1.5">Ghi chú gửi kèm cho ứng viên (không bắt buộc)</label>
          <textarea
            v-model="notes"
            rows="2"
            placeholder="Ví dụ: Vui lòng chuẩn bị laptop cá nhân và mở sẵn portfolio..."
            class="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#1769e8] focus:outline-hidden focus:ring-1 focus:ring-[#1769e8] resize-none"
          ></textarea>
        </div>
      </div>

      <!-- Footer Buttons -->
      <div class="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4 bg-slate-50/50">
        <button
          type="button"
          class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          :disabled="submitting"
          @click="handleClose"
        >
          Hủy bỏ
        </button>

        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-xl bg-[#1769e8] px-5 py-2 text-xs font-medium text-white hover:bg-blue-700 shadow-sm transition cursor-pointer disabled:opacity-60"
          :disabled="submitting"
          @click="handleSubmit"
        >
          <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
          <Calendar v-else class="h-4 w-4" />
          <span>Xác nhận & Gửi thư mời</span>
        </button>
      </div>
    </div>
  </div>
</template>
