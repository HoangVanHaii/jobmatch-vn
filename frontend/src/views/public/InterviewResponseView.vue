<script setup lang="ts">
/**
 * InterviewResponseView — Trang PUBLIC cho ứng viên phản hồi lời mời phỏng vấn
 * URL: /interviews/respond?token=...&action=confirm|reschedule
 * Không cần đăng nhập, bảo mật bằng confirmationToken.
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  Calendar,
  Clock,
  MapPin,
  Video,
  Building2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  CalendarCheck2,
  ExternalLink,
  ChevronRight,
  Layers,
  UserCheck,
} from 'lucide-vue-next';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import { interviewApi, type PublicInterviewDetails } from '@/services/interview.api';
import { extractErrorMessage } from '@/services/http';

dayjs.locale('vi');

const route = useRoute();
const token = computed(() => String(route.query.token || ''));
const initialAction = computed(() => String(route.query.action || ''));

type PageState = 'loading' | 'error' | 'view' | 'success';

const state = ref<PageState>('loading');
const errorMsg = ref('');
const details = ref<PublicInterviewDetails | null>(null);

// Form dời lịch / từ chối
const activeTab = ref<'confirm' | 'reschedule' | 'reject'>('confirm');
const rescheduleReason = ref('');
const proposedTime = ref('');
const rejectReason = ref('');
const submitting = ref(false);
const successMessage = ref('');

const INTERVIEW_TYPE_LABELS: Record<string, string> = {
  screening: 'Phỏng vấn sơ loại (Screening)',
  technical: 'Phỏng vấn kỹ thuật (Technical)',
  coding: 'Phỏng vấn lập trình (Live Coding)',
  system_design: 'Thiết kế hệ thống (System Design)',
  hr: 'Phỏng vấn nhân sự (HR Interview)',
  culture_fit: 'Phù hợp văn hóa (Culture Fit)',
  panel: 'Phỏng vấn hội đồng (Panel)',
  final: 'Phỏng vấn vòng cuối (Final Interview)',
  other: 'Phỏng vấn',
};

const getInterviewTypeLabel = (type?: string | null): string => {
  if (!type) return 'Phỏng vấn';
  return INTERVIEW_TYPE_LABELS[type] || type;
};

const formatFullDate = (iso?: string | null): string => {
  if (!iso) return '';
  const d = dayjs(iso);
  return d.isValid() ? d.format('dddd, [ngày] DD/MM/YYYY') : '';
};

const formatTimeRange = (iso?: string | null, durationMin = 60): string => {
  if (!iso) return '';
  const start = dayjs(iso);
  const end = start.add(durationMin, 'minute');
  return `${start.format('HH:mm')} - ${end.format('HH:mm')}`;
};

const loadDetails = async (): Promise<void> => {
  if (!token.value) {
    state.value = 'error';
    errorMsg.value = 'Liên kết xác nhận không hợp lệ hoặc thiếu mã token.';
    return;
  }

  state.value = 'loading';
  try {
    const res = await interviewApi.getPublicDetails(token.value);
    details.value = res.data.data;

    // Thiết lập tab hành động theo query ban đầu nếu có
    if (initialAction.value === 'reschedule') {
      activeTab.value = 'reschedule';
    } else if (initialAction.value === 'reject') {
      activeTab.value = 'reject';
    } else {
      activeTab.value = 'confirm';
    }

    state.value = 'view';
  } catch (err) {
    state.value = 'error';
    errorMsg.value = extractErrorMessage(err, 'Liên kết xác nhận đã hết hạn hoặc không tồn tại.');
  }
};

const handleRespond = async (action: 'confirm' | 'reschedule' | 'reject'): Promise<void> => {
  if (!token.value) return;

  let reason = '';
  let proposed = '';

  if (action === 'reschedule') {
    if (!rescheduleReason.value.trim() && !proposedTime.value.trim()) {
      errorMsg.value = 'Vui lòng cho biết lý do hoặc khung thời gian bạn có thể tham gia.';
      return;
    }
    reason = rescheduleReason.value.trim();
    proposed = proposedTime.value.trim();
  } else if (action === 'reject') {
    reason = rejectReason.value.trim();
  }

  submitting.value = true;
  try {
    const res = await interviewApi.respondPublic({
      token: token.value,
      action,
      reason: reason || undefined,
      proposedTime: proposed || undefined,
    });

    successMessage.value = res.data.data.message || 'Phản hồi của bạn đã được gửi thành công.';
    if (details.value) {
      details.value.status = res.data.data.status;
    }
    state.value = 'success';
  } catch (err) {
    errorMsg.value = extractErrorMessage(err, 'Không thể gửi phản hồi. Vui lòng thử lại sau.');
  } finally {
    submitting.value = false;
  }
};

onMounted(loadDetails);
</script>

<template>
  <div class="min-h-screen bg-[#f8fafc] font-poppins flex flex-col justify-between text-[#1e293b]">
    <!-- Top Header -->
    <header class="border-b border-slate-200/80 bg-white px-4 py-3 sm:px-8">
      <div class="max-w-4xl mx-auto flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="h-8 w-8 rounded-lg bg-[#1769e8] text-white flex items-center justify-center font-bold text-base shadow-xs">
            JM
          </div>
          <span class="text-base font-bold tracking-tight text-slate-900">JobMatch VN</span>
        </div>
        <span class="text-xs text-slate-500 font-medium">Xác nhận lịch phỏng vấn</span>
      </div>
    </header>

    <!-- Main Container -->
    <main class="flex-1 flex items-center justify-center p-4 sm:p-6">
      <!-- Loading State -->
      <div v-if="state === 'loading'" class="text-center py-16">
        <Loader2 class="h-8 w-8 text-[#1769e8] animate-spin mx-auto mb-3" />
        <p class="text-xs text-slate-500 font-medium">Đang tải thông tin buổi phỏng vấn...</p>
      </div>

      <!-- Error State -->
      <div
        v-else-if="state === 'error'"
        class="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-6 sm:p-8 text-center shadow-lg animate-in fade-in"
      >
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600 mb-4">
          <XCircle class="h-7 w-7" />
        </div>
        <h2 class="text-base font-bold text-slate-900">Không tìm thấy thông tin</h2>
        <p class="text-xs text-slate-500 mt-2 leading-relaxed">
          {{ errorMsg || 'Đường dẫn xác nhận này có thể đã hết hạn hoặc không hợp lệ. Vui lòng kiểm tra lại email hoặc liên hệ với nhà tuyển dụng.' }}
        </p>
      </div>

      <!-- Success State -->
      <div
        v-else-if="state === 'success'"
        class="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-6 sm:p-8 text-center shadow-lg animate-in fade-in"
      >
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 mb-4">
          <CheckCircle2 class="h-7 w-7" />
        </div>
        <h2 class="text-lg font-bold text-slate-900">Đã ghi nhận phản hồi!</h2>
        <p class="text-xs text-slate-600 mt-2 leading-relaxed">
          {{ successMessage }}
        </p>

        <div v-if="details?.meetingLink && details.status === 'confirmed'" class="mt-6 rounded-xl bg-slate-50 p-4 border border-slate-200/80 text-left">
          <p class="text-xs font-semibold text-slate-800 mb-1 flex items-center gap-1.5">
            <Video class="h-4 w-4 text-[#1769e8]" />
            Phòng họp Google Meet
          </p>
          <a
            :href="details.meetingLink"
            target="_blank"
            class="text-xs font-semibold text-[#1769e8] hover:underline break-all inline-flex items-center gap-1"
          >
            {{ details.meetingLink }}
            <ExternalLink class="h-3 w-3 shrink-0" />
          </a>
        </div>

        <p class="text-[11px] text-slate-400 mt-6">
          Bạn có thể đóng tab này lại. Chúc bạn có một buổi phỏng vấn thành công tốt đẹp!
        </p>
      </div>

      <!-- Main Form / View Details -->
      <div
        v-else-if="details"
        class="w-full max-w-xl rounded-2xl bg-white border border-slate-200 shadow-xl overflow-hidden animate-in fade-in zoom-in-95"
      >
        <!-- Company & Job Banner Header -->
        <div class="bg-gradient-to-r from-blue-600 to-[#1769e8] p-4 text-white">
          <div class="flex items-start justify-between gap-4">
            <div>
              <span class="inline-flex items-center rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-semibold text-white mb-2 backdrop-blur-xs">
                Lời mời phỏng vấn • {{ getInterviewTypeLabel(details.interviewType) }}
              </span>
              <h1 class="text-lg sm:text-xl font-bold leading-snug">
                {{ details.jobTitle || 'Vị trí Ứng tuyển' }}
              </h1>
              <p class="text-xs text-blue-100 mt-1 flex items-center gap-1.5">
                <Building2 class="h-3.5 w-3.5" />
                {{ details.companyName || 'Nhà tuyển dụng' }}
              </p>
            </div>

            <div
              v-if="details.companyLogoUrl"
              class="h-12 w-12 rounded-xl bg-white shrink-0 overflow-hidden shadow-xs"
            >
              <img :src="details.companyLogoUrl" alt="Company Logo" class="h-full w-full object-cover" />
            </div>
          </div>
        </div>

        <div class="p-6 space-y-6">
          <!-- Status Banner nếu đã xác nhận hoặc đã hủy -->
          <div
            v-if="details.status === 'confirmed'"
            class="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-800 flex items-center gap-2.5"
          >
            <CheckCircle2 class="h-5 w-5 text-emerald-600 shrink-0" />
            <div>
              <span class="font-semibold">Lịch hẹn đã được xác nhận.</span>
              <p class="text-[11px] text-emerald-700 mt-0.5">Bạn đã đồng ý tham gia buổi phỏng vấn này.</p>
            </div>
          </div>

          <div
            v-else-if="details.status === 'cancelled'"
            class="rounded-xl border border-red-200 bg-red-50/70 p-3.5 text-xs text-red-800 flex items-center gap-2.5"
          >
            <AlertCircle class="h-5 w-5 text-red-600 shrink-0" />
            <div>
              <span class="font-semibold">Buổi phỏng vấn đã bị hủy.</span>
              <p class="text-[11px] text-red-700 mt-0.5">{{ details.cancelReason || 'Lịch hẹn này không còn hiệu lực.' }}</p>
            </div>
          </div>

          <!-- Thông tin buổi phỏng vấn -->
          <div class="rounded-xl border border-slate-100 bg-slate-50/70 p-4 space-y-3.5">
            <div v-if="details.interviewType" class="flex items-start gap-3">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                <Layers class="h-4 w-4" />
              </span>
              <div>
                <p class="text-xs text-slate-500 font-medium">Vòng phỏng vấn</p>
                <p class="text-xs font-semibold text-slate-900 mt-0.5">
                  {{ getInterviewTypeLabel(details.interviewType) }}
                </p>
              </div>
            </div>

            <div class="flex items-start gap-3" :class="details.interviewType ? 'pt-3 border-t border-slate-200/60' : ''">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-[#1769e8]">
                <Calendar class="h-4 w-4" />
              </span>
              <div>
                <p class="text-xs text-slate-500 font-medium">Thời gian diễn ra</p>
                <p class="text-sm font-semibold text-slate-900 mt-0.5 capitalize">
                  {{ formatFullDate(details.scheduledAt) }}
                </p>
                <p class="text-xs text-slate-600 font-medium">
                  {{ formatTimeRange(details.scheduledAt, details.durationMin) }} (Khoảng {{ details.durationMin }} phút)
                </p>
              </div>
            </div>

            <div class="flex items-start gap-3 pt-3 border-t border-slate-200/60">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <Video v-if="details.meetingLink" class="h-4 w-4" />
                <MapPin v-else class="h-4 w-4" />
              </span>
              <div class="min-w-0">
                <p class="text-xs text-slate-500 font-medium">Hình thức</p>
                <div v-if="details.meetingLink">
                  <p class="text-xs font-semibold text-slate-900 mt-0.5">Phỏng vấn Online (Google Meet)</p>
                  <a
                    :href="details.meetingLink"
                    target="_blank"
                    class="text-xs font-semibold text-[#1769e8] hover:underline mt-0.5 inline-flex items-center gap-1 break-all"
                  >
                    {{ details.meetingLink }}
                    <ExternalLink class="h-3 w-3 shrink-0" />
                  </a>
                </div>
                <div v-else>
                  <p class="text-xs font-semibold text-slate-900 mt-0.5">Phỏng vấn trực tiếp</p>
                  <p class="text-xs text-slate-600">{{ details.location || 'Tại văn phòng công ty' }}</p>
                </div>
              </div>
            </div>

            <!-- Người phỏng vấn -->
            <div v-if="details.interviewerName" class="flex items-start gap-3 pt-3 border-t border-slate-200/60">
              <div v-if="details.interviewerAvatar" class="h-8 w-8 rounded-lg overflow-hidden shrink-0 border border-slate-200/80">
                <img :src="details.interviewerAvatar" :alt="details.interviewerName" class="h-full w-full object-cover" />
              </div>
              <span v-else class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <UserCheck class="h-4 w-4" />
              </span>
              <div class="min-w-0">
                <p class="text-xs text-slate-500 font-medium">Người phỏng vấn</p>
                <p class="text-xs font-semibold text-slate-900 mt-0.5 truncate">
                  {{ details.interviewerName }}
                </p>
                <p v-if="details.interviewerEmail" class="text-[11px] text-slate-400 mt-0.5 truncate">
                  {{ details.interviewerEmail }}
                </p>
              </div>
            </div>
          </div>

          <!-- Khu vực tương tác: Xác nhận / Đổi lịch / Từ chối (chỉ khi pending) -->
          <div v-if="details.status === 'pending'" class="space-y-4">
            <!-- Tabs lựa chọn phản hồi -->
            <div class="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-xs font-semibold text-slate-600">
              <button
                type="button"
                class="rounded-lg py-2 transition cursor-pointer"
                :class="activeTab === 'confirm' ? 'bg-white text-slate-900 shadow-xs' : 'hover:text-slate-900'"
                @click="activeTab = 'confirm'"
              >
                Xác nhận
              </button>
              <button
                type="button"
                class="rounded-lg py-2 transition cursor-pointer"
                :class="activeTab === 'reschedule' ? 'bg-white text-slate-900 shadow-xs' : 'hover:text-slate-900'"
                @click="activeTab = 'reschedule'"
              >
                Đổi lịch hẹn
              </button>
              <button
                type="button"
                class="rounded-lg py-2 transition cursor-pointer"
                :class="activeTab === 'reject' ? 'bg-white text-slate-900 shadow-xs' : 'hover:text-slate-900'"
                @click="activeTab = 'reject'"
              >
                Từ chối
              </button>
            </div>

            <!-- Tab 1: Xác nhận -->
            <div v-if="activeTab === 'confirm'" class="space-y-4 text-center py-2">
              <p class="text-xs text-slate-600 leading-relaxed max-w-md mx-auto">
                Bằng việc bấm xác nhận, bạn cam kết sẽ sắp xếp thời gian tham gia đúng giờ hẹn. Nhà tuyển dụng sẽ nhận được thông báo ngay lập tức.
              </p>
              <button
                type="button"
                class="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#1769e8] px-5 py-3 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm transition cursor-pointer disabled:opacity-60"
                :disabled="submitting"
                @click="handleRespond('confirm')"
              >
                <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
                <CalendarCheck2 v-else class="h-4 w-4" />
                <span>Xác nhận tham gia phỏng vấn</span>
              </button>
            </div>

            <!-- Tab 2: Đổi lịch (Reschedule) -->
            <div v-else-if="activeTab === 'reschedule'" class="space-y-3.5">
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">
                  Khung thời gian bạn có thể tham gia <span class="text-red-500">*</span>
                </label>
                <input
                  v-model="proposedTime"
                  type="text"
                  placeholder="Ví dụ: Thứ Sáu (07/11) từ 14:00 - 16:00 hoặc sáng Thứ Hai tuần tới..."
                  class="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#1769e8] focus:outline-hidden focus:ring-1 focus:ring-[#1769e8]"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">
                  Lý do xin đổi lịch (không bắt buộc)
                </label>
                <textarea
                  v-model="rescheduleReason"
                  rows="2"
                  placeholder="Ví dụ: Do có lịch trùng đột xuất tại cơ quan hiện tại..."
                  class="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#1769e8] focus:outline-hidden focus:ring-1 focus:ring-[#1769e8] resize-none"
                ></textarea>
              </div>

              <button
                type="button"
                class="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-amber-700 shadow-sm transition cursor-pointer disabled:opacity-60"
                :disabled="submitting"
                @click="handleRespond('reschedule')"
              >
                <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
                <span>Gửi đề xuất đổi lịch</span>
              </button>
            </div>

            <!-- Tab 3: Từ chối (Reject) -->
            <div v-else-if="activeTab === 'reject'" class="space-y-3.5">
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">
                  Lý do từ chối (không bắt buộc)
                </label>
                <textarea
                  v-model="rejectReason"
                  rows="3"
                  placeholder="Ví dụ: Em đã nhận được offer từ công ty khác / định hướng chưa phù hợp..."
                  class="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#1769e8] focus:outline-hidden focus:ring-1 focus:ring-[#1769e8] resize-none"
                ></textarea>
              </div>

              <button
                type="button"
                class="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-red-700 shadow-sm transition cursor-pointer disabled:opacity-60"
                :disabled="submitting"
                @click="handleRespond('reject')"
              >
                <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
                <span>Xác nhận từ chối phỏng vấn</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="border-t border-slate-200/80 bg-white py-4 text-center text-xs text-slate-400">
      JobMatch VN &copy; 2026 · Nền tảng tuyển dụng và kết nối việc làm thông minh
    </footer>
  </div>
</template>

