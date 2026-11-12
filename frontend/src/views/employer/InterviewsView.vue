<script setup lang="ts">
/**
 * InterviewsView — Trang Quản lý & Lên lịch Phỏng vấn (Interview Scheduler)
 * Kết nối dữ liệu thật từ Backend API (/api/v1/interviews):
 * - Hỗ trợ lọc theo khoảng thời gian tuần / ngày thực tế
 * - Chế độ xem: Ngày & Tuần
 * - Bộ lọc đa năng bên trái: Loại hình, vị trí, người phỏng vấn, trạng thái, khả dụng
 * - Bảng lịch dạng time-grid trực quan với line giờ hiện tại và các card lịch màu pastel
 * - Thanh thống kê tổng kết động ở đáy trang
 * - Panel chi tiết buổi phỏng vấn (Interview Details drawer) trượt mở bên phải khi click vào buổi hẹn
 */
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import {
  Calendar as CalendarIcon,
  Clock,
  Video,
  Users,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  Mail,
  Phone,
  FileText,
  Download,
  ExternalLink,
  CheckCircle2,
  SlidersHorizontal,
  ChevronDown,
  Loader2,
  RefreshCw,
  BarChart3,
  Printer,
  Layers,
} from 'lucide-vue-next';
import ScheduleInterviewModal from '@/components/employer/ScheduleInterviewModal.vue';
import GoogleCalendarConnectCard from '@/components/employer/GoogleCalendarConnectCard.vue';
import { interviewApi, type InterviewListItem } from '@/services/interview.api';
import { exportInterviewReportDocx } from '@/utils/interviewReportDocx';

// ---------------------------------------------------------------------------
// Types & Data Structures
// ---------------------------------------------------------------------------
export type ViewMode = 'day' | 'week';

export type InterviewStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'rescheduled';

export type InterviewType =
  | 'Phỏng vấn Kỹ thuật'
  | 'Phỏng vấn Lập trình'
  | 'Thiết kế Hệ thống'
  | 'Phỏng vấn Nhân sự'
  | 'Phỏng vấn Hội đồng'
  | string;

export interface Interviewer {
  id: string;
  name: string;
  role: string;
  avatar?: string | null;
  email?: string;
}

export interface InterviewEvent {
  id: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone?: string;
  candidateAvatar?: string;
  jobTitle: string;
  interviewType: InterviewType;
  status: InterviewStatus;
  date: string; // YYYY-MM-DD
  dayOfWeek: number; // 1 = Thứ 2, 2 = Thứ 3, ..., 7 = Chủ nhật
  startTime: string; // '09:00'
  endTime: string; // '10:00'
  startHourDecimal: number; // 9.0 (dùng để tính vị trí top/height trên grid)
  durationHours: number; // 1.0
  location: string;
  meetingLink?: string;
  confirmedAt?: string | null;
  createdAt?: string;
  interviewers: Interviewer[];
  notes?: string;
  attachmentName?: string;
  attachmentSize?: string;
  colorTheme: 'purple' | 'amber' | 'blue' | 'green' | 'rose';
}

// ---------------------------------------------------------------------------
// Real API Data State
// ---------------------------------------------------------------------------
const rawInterviews = ref<InterviewListItem[]>([]);
const isLoading = ref(false);
const fetchError = ref<string | null>(null);

// ---------------------------------------------------------------------------
// State Controls
// ---------------------------------------------------------------------------
const viewMode = ref<ViewMode>('week'); // 'day' | 'week'
const searchQuery = ref('');
const filterSidebarOpen = ref(false);
const selectedInterview = ref<InterviewEvent | null>(null);
const showScheduleModal = ref(false);
const showCalendarIntegration = ref(false);

// Ref container scroll của bảng lịch
const timelineScrollContainer = ref<HTMLDivElement | null>(null);

// Filter states
const selectedType = ref('All Types');
const selectedJob = ref('All Jobs');
const selectedInterviewer = ref('All Interviewers');
const selectedLocation = ref('All Locations');
const showOnlyAvailable = ref(false);

const statusFilters = ref<Record<InterviewStatus, boolean>>({
  scheduled: true,
  in_progress: true,
  completed: true,
  cancelled: true,
  rescheduled: true,
});

// Đếm số lượng bộ lọc đang hoạt động
const activeFilterCount = computed(() => {
  let count = 0;
  if (selectedType.value !== 'All Types') count++;
  if (selectedJob.value !== 'All Jobs') count++;
  if (selectedInterviewer.value !== 'All Interviewers') count++;
  if (selectedLocation.value !== 'All Locations') count++;
  if (showOnlyAvailable.value) count++;
  const allStatusesChecked = Object.values(statusFilters.value).every(Boolean);
  if (!allStatusesChecked) count++;
  return count;
});

// Time & Days structure: 06:00 -> 19:00
const startHourBase = 6;
const timeSlots = [
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'
];

export interface WeekDayItem {
  dayOfWeek: number;
  nameVi: string;
  dateNum: number;
  monthNum: number;
  year: number;
  fullDate: string;
}

const DAY_NAMES_VI = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6'];

// Ngày được chọn hiện tại (khởi tạo ngày hôm nay)
const nowInitial = new Date();
const currentJsDay = nowInitial.getDay();
const defaultDayOfWeek = currentJsDay >= 1 && currentJsDay <= 5 ? currentJsDay : 1;

const selectedDate = ref<Date>(new Date());
const activeDayOfWeek = ref(defaultDayOfWeek);

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay(); // 0 = CN, 1 = T2, ..., 6 = T7
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDateISO(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDisplayDate(dateStr?: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return `${d} Tháng ${m}, ${y}`;
}

function formatDateTimeVN(dateInput?: string | Date | null): string {
  if (!dateInput) return '';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${hh}:${mm} ngày ${dd}/${month}/${yyyy}`;
}

function getInitials(name?: string | null): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  const last = parts[parts.length - 1];
  return last.charAt(0).toUpperCase();
}

const currentRealDate = ref(new Date());

const nowTimeInfo = ref({
  fullDate: formatDateISO(new Date()),
  decimalHour: new Date().getHours() + new Date().getMinutes() / 60 + new Date().getSeconds() / 3600,
  timeString: `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`,
});

function updateRealTime() {
  const now = new Date();
  currentRealDate.value = now;
  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();
  nowTimeInfo.value = {
    fullDate: formatDateISO(now),
    decimalHour: h + m / 60 + s / 3600,
    timeString: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
  };
}

const todayDateStr = computed(() => formatDateISO(currentRealDate.value));

// 5 ngày làm việc (Thứ 2 -> Thứ 6) của tuần chứa selectedDate
const weekDays = computed<WeekDayItem[]>(() => {
  const monday = getMonday(selectedDate.value);
  const days: WeekDayItem[] = [];

  for (let i = 0; i < 5; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    days.push({
      dayOfWeek: i + 1,
      nameVi: DAY_NAMES_VI[i],
      dateNum: cur.getDate(),
      monthNum: cur.getMonth() + 1,
      year: cur.getFullYear(),
      fullDate: formatDateISO(cur),
    });
  }
  return days;
});

// Nhãn dải tuần hiển thị ở mode Week (ví dụ: "09 – 13 Thg 11, 2026")
const weekRangeLabel = computed(() => {
  const days = weekDays.value;
  if (!days.length) return '';
  const first = days[0];
  const last = days[days.length - 1];
  const pad = (n: number) => String(n).padStart(2, '0');
  if (first.year === last.year) {
    if (first.monthNum === last.monthNum) {
      return `${pad(first.dateNum)} – ${pad(last.dateNum)} Thg ${first.monthNum}, ${first.year}`;
    }
    return `${pad(first.dateNum)} Thg ${first.monthNum} – ${pad(last.dateNum)} Thg ${last.monthNum}, ${first.year}`;
  }
  return `${pad(first.dateNum)} Thg ${first.monthNum}, ${first.year} – ${pad(last.dateNum)} Thg ${last.monthNum}, ${last.year}`;
});

// Khoảng ngày của tuần hiện tại để fetch API
const currentWeekBounds = computed(() => {
  const monday = getMonday(selectedDate.value);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return {
    startDate: monday.toISOString(),
    endDate: sunday.toISOString(),
    mondayKey: formatDateISO(monday),
  };
});

// Helper: Styling badge trạng thái
const STATUS_META: Record<InterviewStatus, { label: string; color: string; dot: string; bg: string }> = {
  scheduled: { label: 'Đã lên lịch', color: 'text-blue-700', dot: 'bg-blue-500', bg: 'bg-blue-50 border-blue-200' },
  in_progress: { label: 'Đang diễn ra', color: 'text-cyan-700', dot: 'bg-cyan-500', bg: 'bg-cyan-50 border-cyan-200' },
  completed: { label: 'Hoàn thành', color: 'text-emerald-700', dot: 'bg-emerald-500', bg: 'bg-emerald-50 border-emerald-200' },
  cancelled: { label: 'Đã hủy', color: 'text-rose-700', dot: 'bg-rose-500', bg: 'bg-rose-50 border-rose-200' },
  rescheduled: { label: 'Đã dời lịch', color: 'text-amber-700', dot: 'bg-amber-500', bg: 'bg-amber-50 border-amber-200' },
};

// Helper: Màu sắc card sự kiện
const THEME_STYLES: Record<
  InterviewEvent['colorTheme'],
  { bg: string; border: string; text: string; subText: string; dot: string }
> = {
  purple: {
    bg: 'bg-[#f5f2ff]',
    border: 'border-[#dfd6fe]',
    text: 'text-[#5b21b6]',
    subText: 'text-[#6d28d9]',
    dot: 'bg-[#7c3aed]',
  },
  amber: {
    bg: 'bg-[#fffbeb]',
    border: 'border-[#fef3c7]',
    text: 'text-[#92400e]',
    subText: 'text-[#b45309]',
    dot: 'bg-[#f59e0b]',
  },
  blue: {
    bg: 'bg-[#eff6ff]',
    border: 'border-[#dbeafe]',
    text: 'text-[#1e40af]',
    subText: 'text-[#2563eb]',
    dot: 'bg-[#3b82f6]',
  },
  green: {
    bg: 'bg-[#f0fdf4]',
    border: 'border-[#dcfce7]',
    text: 'text-[#166534]',
    subText: 'text-[#15803d]',
    dot: 'bg-[#22c55e]',
  },
  rose: {
    bg: 'bg-[#fff1f2]',
    border: 'border-[#ffe4e6]',
    text: 'text-[#9f1239]',
    subText: 'text-[#be123c]',
    dot: 'bg-[#f43f5e]',
  },
};

// ---------------------------------------------------------------------------
// API Mappers
// ---------------------------------------------------------------------------
function formatTimeHHmm(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function resolveInterviewType(rawType?: string | null): InterviewType {
  const t = (rawType || '').toLowerCase();
  if (t.includes('coding') || t.includes('lập trình')) return 'Phỏng vấn Lập trình';
  if (t.includes('system') || t.includes('hệ thống')) return 'Thiết kế Hệ thống';
  if (t.includes('panel') || t.includes('hội đồng')) return 'Phỏng vấn Hội đồng';
  if (t.includes('hr') || t.includes('phone') || t.includes('screening') || t.includes('behavioral') || t.includes('nhân sự')) {
    return 'Phỏng vấn Nhân sự';
  }
  if (t.includes('technical') || t.includes('kỹ thuật')) return 'Phỏng vấn Kỹ thuật';
  return rawType || 'Phỏng vấn Chuyên môn';
}

function resolveInterviewStatus(rawStatus?: string | null): InterviewStatus {
  const s = (rawStatus || '').toLowerCase();
  if (s === 'completed') return 'completed';
  if (s === 'in_progress') return 'in_progress';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'rescheduled') return 'rescheduled';
  return 'scheduled';
}

function resolveColorTheme(typeStr: string, id: string): 'purple' | 'amber' | 'blue' | 'green' | 'rose' {
  const lower = (typeStr || '').toLowerCase();
  if (lower.includes('lập trình') || lower.includes('kỹ thuật') || lower.includes('coding') || lower.includes('technical')) return 'blue';
  if (lower.includes('nhân sự') || lower.includes('hr') || lower.includes('phone')) return 'amber';
  if (lower.includes('hệ thống') || lower.includes('system')) return 'purple';
  if (lower.includes('hội đồng') || lower.includes('panel')) return 'green';
  const palette: Array<'purple' | 'amber' | 'blue' | 'green' | 'rose'> = ['purple', 'amber', 'blue', 'green', 'rose'];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

function mapToInterviewEvent(item: InterviewListItem): InterviewEvent {
  const start = new Date(item.scheduledAt);
  const durationMin = item.durationMin || 60;
  const end = new Date(start.getTime() + durationMin * 60 * 1000);
  const jsDay = start.getDay();
  const dayOfWeek = jsDay === 0 ? 7 : jsDay;
  const typeResolved = resolveInterviewType(item.interviewType);
  const startHourDecimal = start.getHours() + start.getMinutes() / 60;
  const durationHours = durationMin / 60;

  const interviewers: Interviewer[] = [];
  if (item.interviewerName) {
    interviewers.push({
      id: item.interviewerId,
      name: item.interviewerName,
      role: 'Người phỏng vấn',
      avatar: item.interviewerAvatar || null,
      email: item.interviewerEmail || undefined,
    });
  }

  return {
    id: item.id,
    candidateName: item.candidateName || 'Ứng viên',
    candidateEmail: item.candidateEmail || '',
    candidatePhone: item.candidatePhone || undefined,
    candidateAvatar: item.candidateAvatar || undefined,
    jobTitle: item.jobTitle || 'Chưa phân loại vị trí',
    interviewType: typeResolved,
    status: resolveInterviewStatus(item.status),
    date: formatDateISO(start),
    dayOfWeek,
    startTime: formatTimeHHmm(start),
    endTime: formatTimeHHmm(end),
    startHourDecimal,
    durationHours,
    location: item.location || (item.meetingLink ? 'Google Meet' : 'Văn phòng'),
    meetingLink: item.meetingLink || undefined,
    confirmedAt: item.confirmedAt || null,
    createdAt: item.createdAt,
    interviewers,
    colorTheme: resolveColorTheme(typeResolved, item.id),
  };
}

const allEvents = computed<InterviewEvent[]>(() => {
  return rawInterviews.value.map(mapToInterviewEvent);
});

// Dynamic options from real data
const availableJobs = computed(() => {
  const set = new Set<string>();
  for (const evt of allEvents.value) {
    if (evt.jobTitle && evt.jobTitle !== 'Chưa phân loại vị trí') {
      set.add(evt.jobTitle);
    }
  }
  return Array.from(set);
});

const availableInterviewers = computed(() => {
  const map = new Map<string, Interviewer>();
  for (const evt of allEvents.value) {
    for (const int of evt.interviewers) {
      if (int.name && int.name !== 'Người phỏng vấn') {
        map.set(int.name, int);
      }
    }
  }
  return Array.from(map.values());
});

// ---------------------------------------------------------------------------
// Bottom Stats Computation
// ---------------------------------------------------------------------------
const totalInterviewsCount = computed(() => allEvents.value.length);
const uniqueCandidatesCount = computed(() => {
  const set = new Set(allEvents.value.map((e) => e.candidateEmail || e.candidateName));
  return set.size;
});
const totalDurationHours = computed(() => {
  const totalMin = allEvents.value.reduce((sum, e) => sum + e.durationHours * 60, 0);
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  if (h === 0) return `${m} phút`;
  return m > 0 ? `${h}h ${m}p` : `${h} giờ`;
});
const panelCoveragePercent = computed(() => {
  if (allEvents.value.length === 0) return 100;
  const covered = allEvents.value.filter((e) => e.interviewers.length > 0).length;
  return Math.round((covered / allEvents.value.length) * 100);
});

// ---------------------------------------------------------------------------
// Report Modal State & Computations
// ---------------------------------------------------------------------------
const showReportModal = ref(false);
const isExportingDocx = ref(false);

const printReport = () => {
  window.print();
};

const handleExportDocx = async () => {
  isExportingDocx.value = true;
  try {
    const periodLabel =
      viewMode.value === 'week'
        ? `Tuần ${weekRangeLabel.value}`
        : `${currentDayInfo.value.nameVi}, ${currentDayInfo.value.dateNum}/${currentDayInfo.value.monthNum}/${currentDayInfo.value.year}`;

    await exportInterviewReportDocx({
      periodLabel,
      companyName: 'Doanh nghiệp tuyển dụng JobMatch VN',
      reporterName: 'Bộ phận Tuyển dụng (HR)',
      totalInterviews: totalInterviewsCount.value,
      totalCandidates: uniqueCandidatesCount.value,
      totalDuration: totalDurationHours.value,
      panelCoverage: panelCoveragePercent.value,
      statusBreakdown: statusBreakdown.value,
      typeBreakdown: typeBreakdown.value,
      jobBreakdown: jobBreakdown.value,
      events: allEvents.value,
    });
  } catch (err) {
    console.error('Lỗi khi xuất file Word:', err);
  } finally {
    isExportingDocx.value = false;
  }
};

const statusBreakdown = computed(() => {
  const counts: Record<InterviewStatus, number> = {
    scheduled: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0,
    rescheduled: 0,
  };
  for (const evt of allEvents.value) {
    if (counts[evt.status] !== undefined) {
      counts[evt.status]++;
    }
  }
  return counts;
});

const typeBreakdown = computed(() => {
  const map: Record<string, number> = {};
  for (const evt of allEvents.value) {
    const t = evt.interviewType || 'Khác';
    map[t] = (map[t] || 0) + 1;
  }
  return Object.entries(map).map(([type, count]) => ({
    type,
    count,
    percent: allEvents.value.length ? Math.round((count / allEvents.value.length) * 100) : 0,
  }));
});

const jobBreakdown = computed(() => {
  const map: Record<string, number> = {};
  for (const evt of allEvents.value) {
    const j = evt.jobTitle || 'Chưa phân loại';
    map[j] = (map[j] || 0) + 1;
  }
  return Object.entries(map)
    .map(([job, count]) => ({ job, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
});

// ---------------------------------------------------------------------------
// Fetch Data API & Real-time Sync
// ---------------------------------------------------------------------------
let timeIntervalId: number | null = null;
let pollIntervalId: number | null = null;

async function fetchInterviews(arg?: unknown) {
  const isSilent = arg === true;
  if (!isSilent) {
    isLoading.value = true;
  }
  fetchError.value = null;
  try {
    const res = await interviewApi.list({
      startDate: currentWeekBounds.value.startDate,
      endDate: currentWeekBounds.value.endDate,
      limit: 100,
    });
    if (res.data?.success && res.data?.data) {
      rawInterviews.value = res.data.data.rows || [];
    } else {
      rawInterviews.value = [];
    }
  } catch (err: any) {
    console.error('Lỗi tải danh sách phỏng vấn:', err);
    if (!isSilent) {
      fetchError.value = err?.response?.data?.message || 'Không thể tải danh sách phỏng vấn. Vui lòng thử lại sau.';
      rawInterviews.value = [];
    }
  } finally {
    if (!isSilent) {
      isLoading.value = false;
    }
  }
}

watch(
  () => currentWeekBounds.value.mondayKey,
  () => {
    fetchInterviews();
  }
);

watch(allEvents, (newEvents) => {
  if (selectedInterview.value) {
    const found = newEvents.find((e) => e.id === selectedInterview.value?.id);
    selectedInterview.value = found || null;
  }
});

function onWindowFocus() {
  updateRealTime();
  fetchInterviews(true);
}

onMounted(() => {
  fetchInterviews();

  // Khởi động đồng hồ thời gian thực cập nhật mỗi giây cho vạch chỉ giờ hiện tại (Red Line)
  updateRealTime();
  timeIntervalId = window.setInterval(updateRealTime, 1000);

  // Định kỳ 30s đồng bộ ngầm dữ liệu phỏng vấn mới nhất
  pollIntervalId = window.setInterval(() => {
    fetchInterviews(true);
  }, 30000);

  window.addEventListener('focus', onWindowFocus);
});

onUnmounted(() => {
  if (timeIntervalId !== null) {
    window.clearInterval(timeIntervalId);
  }
  if (pollIntervalId !== null) {
    window.clearInterval(pollIntervalId);
  }
  window.removeEventListener('focus', onWindowFocus);
});

// ---------------------------------------------------------------------------
// Filter Computation
// ---------------------------------------------------------------------------
// Ngày hiện tại đang chọn
const currentDayInfo = computed(() => {
  return weekDays.value.find((d) => d.dayOfWeek === activeDayOfWeek.value) || weekDays.value[0];
});

const filteredInterviews = computed(() => {
  return allEvents.value.filter((evt) => {
    // Mode Day: Chỉ hiện các sự kiện của ngày đang chọn
    if (viewMode.value === 'day' && evt.date !== currentDayInfo.value.fullDate) {
      return false;
    }

    // Status filter
    if (!statusFilters.value[evt.status]) return false;

    // Search query
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase().trim();
      const matchName = evt.candidateName.toLowerCase().includes(q);
      const matchJob = evt.jobTitle.toLowerCase().includes(q);
      const matchType = evt.interviewType.toLowerCase().includes(q);
      if (!matchName && !matchJob && !matchType) return false;
    }

    // Type filter
    if (selectedType.value !== 'All Types' && evt.interviewType !== selectedType.value) {
      return false;
    }

    // Job filter
    if (selectedJob.value !== 'All Jobs' && evt.jobTitle !== selectedJob.value) {
      return false;
    }

    // Interviewer filter
    if (selectedInterviewer.value !== 'All Interviewers') {
      const hasInterviewer = evt.interviewers.some((int) => int.name === selectedInterviewer.value);
      if (!hasInterviewer) return false;
    }

    // Location filter
    if (selectedLocation.value !== 'All Locations') {
      if (selectedLocation.value === 'Google Meet' && !evt.location.toLowerCase().includes('meet')) return false;
      if (selectedLocation.value === 'Văn phòng' && !evt.location.toLowerCase().includes('văn phòng')) return false;
    }

    return true;
  });
});

// Danh sách người phỏng vấn trong 1 ngày cụ thể
const getDayInterviewers = (fullDate: string): Interviewer[] => {
  const dayEvents = filteredInterviews.value.filter((e) => e.date === fullDate);
  const map = new Map<string, Interviewer>();
  for (const evt of dayEvents) {
    for (const int of evt.interviewers) {
      if (int.name && int.name !== 'Người phỏng vấn' && !map.has(int.name)) {
        map.set(int.name, int);
      }
    }
  }
  return Array.from(map.values());
};

// Clear all filters
const clearAllFilters = (): void => {
  selectedType.value = 'All Types';
  selectedJob.value = 'All Jobs';
  selectedInterviewer.value = 'All Interviewers';
  selectedLocation.value = 'All Locations';
  showOnlyAvailable.value = false;
  searchQuery.value = '';
  statusFilters.value = {
    scheduled: true,
    in_progress: true,
    completed: true,
    cancelled: true,
    rescheduled: true,
  };
};

// Chiều cao 1 tiếng trên timeline: mode week là 108px, mode day tăng lên 120px để khoảng cách giữa các mốc giờ dài và thoáng đãng
const hourHeight = computed(() => (viewMode.value === 'week' ? 108 : 120));

// Cuộn bảng lịch tới mốc giờ chỉ định (mặc định khung 13h)
const scrollToHour = (hour: number = 13, smooth: boolean = true) => {
  if (!timelineScrollContainer.value) return;
  const container = timelineScrollContainer.value;
  const targetHourTop = (hour - startHourBase) * hourHeight.value;
  // Căn chỉnh để mốc giờ và nội dung thông báo nằm ở giữa khung nhìn
  const scrollTarget = Math.max(0, targetHourTop - container.clientHeight / 2 + hourHeight.value / 2);
  container.scrollTo({
    top: scrollTarget,
    behavior: smooth ? 'smooth' : 'auto',
  });
};

// Tự động cuộn đến khung 13h khi danh sách trống (không có lịch phỏng vấn nào)
watch(
  [() => filteredInterviews.value.length, () => isLoading.value, () => activeDayOfWeek.value, () => selectedDate.value, () => viewMode.value],
  () => {
    if (!isLoading.value && filteredInterviews.value.length === 0) {
      nextTick(() => {
        scrollToHour(13, true);
      });
    }
  }
);

// Đồng bộ buổi phỏng vấn được chọn cho ngày mới (chỉ cập nhật nếu panel chi tiết đang mở, không tự ý bật mở khi đang đóng)
const syncSelectedInterviewForDay = (dayNum: number) => {
  if (!selectedInterview.value) return;
  const targetDay = weekDays.value.find((d) => d.dayOfWeek === dayNum);
  if (!targetDay) {
    selectedInterview.value = null;
    return;
  }
  const dayEvents = allEvents.value.filter((e) => e.date === targetDay.fullDate);
  if (dayEvents.length > 0) {
    selectedInterview.value = dayEvents[0];
  } else {
    selectedInterview.value = null;
  }
};

const selectDay = (dayNum: number) => {
  activeDayOfWeek.value = dayNum;
  const monday = getMonday(selectedDate.value);
  const cur = new Date(monday);
  cur.setDate(monday.getDate() + (dayNum - 1));
  selectedDate.value = cur;
  syncSelectedInterviewForDay(dayNum);
};

const goToToday = () => {
  const now = new Date();
  selectedDate.value = now;

  const jsDay = now.getDay();
  const dayNum = jsDay >= 1 && jsDay <= 5 ? jsDay : 1;

  activeDayOfWeek.value = dayNum;
  syncSelectedInterviewForDay(dayNum);
};

const goToPrev = () => {
  if (viewMode.value === 'week') {
    const prev = new Date(selectedDate.value);
    prev.setDate(prev.getDate() - 7);
    selectedDate.value = prev;
    syncSelectedInterviewForDay(activeDayOfWeek.value);
  } else {
    if (activeDayOfWeek.value > 1) {
      activeDayOfWeek.value--;
      const monday = getMonday(selectedDate.value);
      const cur = new Date(monday);
      cur.setDate(monday.getDate() + (activeDayOfWeek.value - 1));
      selectedDate.value = cur;
      syncSelectedInterviewForDay(activeDayOfWeek.value);
    } else {
      const prev = new Date(selectedDate.value);
      prev.setDate(prev.getDate() - 7);
      selectedDate.value = prev;
      activeDayOfWeek.value = 5;
      syncSelectedInterviewForDay(5);
    }
  }
};

const goToNext = () => {
  if (viewMode.value === 'week') {
    const next = new Date(selectedDate.value);
    next.setDate(next.getDate() + 7);
    selectedDate.value = next;
    syncSelectedInterviewForDay(activeDayOfWeek.value);
  } else {
    if (activeDayOfWeek.value < 5) {
      activeDayOfWeek.value++;
      const monday = getMonday(selectedDate.value);
      const cur = new Date(monday);
      cur.setDate(monday.getDate() + (activeDayOfWeek.value - 1));
      selectedDate.value = cur;
      syncSelectedInterviewForDay(activeDayOfWeek.value);
    } else {
      const next = new Date(selectedDate.value);
      next.setDate(next.getDate() + 7);
      selectedDate.value = next;
      activeDayOfWeek.value = 1;
      syncSelectedInterviewForDay(1);
    }
  }
};

// Date picker input ref & handlers khi bấm vào icon Calendar
const datePickerInput = ref<HTMLInputElement | null>(null);

const onDateInputChange = (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (!target.value) return;
  const [y, m, d] = target.value.split('-').map(Number);
  const picked = new Date(y, m - 1, d);
  selectedDate.value = picked;

  const jsDay = picked.getDay(); // 0 = CN, 1 = T2, ..., 6 = T7
  const dayNum = jsDay >= 1 && jsDay <= 5 ? jsDay : 1;

  activeDayOfWeek.value = dayNum;
  syncSelectedInterviewForDay(dayNum);
};

const triggerDatePicker = () => {
  if (datePickerInput.value) {
    if ('showPicker' in HTMLInputElement.prototype) {
      try {
        datePickerInput.value.showPicker();
      } catch {
        datePickerInput.value.click();
      }
    } else {
      datePickerInput.value.click();
    }
  }
};

// ---------------------------------------------------------------------------
// Xử lý va chạm thời gian & Hiệu ứng xếp chồng ngang (chỉ áp dụng khi CÙNG GIỜ BẮT ĐẦU)
// ---------------------------------------------------------------------------
export interface EventStackLayout {
  stackIndex: number;
  totalInGroup: number;
}

// Map lưu thông tin vị trí xếp chồng cho các buổi phỏng vấn CÙNG GIỜ BẮT ĐẦU
const eventStackLayoutMap = computed<Map<string, EventStackLayout>>(() => {
  const map = new Map<string, EventStackLayout>();

  // Nhóm các sự kiện theo ngày + giờ bắt đầu chính xác (chỉ cùng giờ bắt đầu mới xếp chồng)
  const eventsBySlot = new Map<string, InterviewEvent[]>();
  for (const evt of filteredInterviews.value) {
    const key = `${evt.date}_${evt.startTime}`;
    const list = eventsBySlot.get(key) || [];
    list.push(evt);
    eventsBySlot.set(key, list);
  }

  // Xử lý từng nhóm cùng giờ bắt đầu
  for (const [, slotEvents] of eventsBySlot.entries()) {
    if (slotEvents.length === 1) {
      map.set(slotEvents[0].id, { stackIndex: 0, totalInGroup: 1 });
      continue;
    }

    // Khi có từ 2 sự kiện cùng giờ bắt đầu trở lên -> xếp chồng theo thứ tự
    const totalInGroup = slotEvents.length;
    slotEvents.forEach((evt, idx) => {
      map.set(evt.id, {
        stackIndex: idx,
        totalInGroup,
      });
    });
  }

  return map;
});

const getEventLayout = (evtId: string): EventStackLayout => {
  return eventStackLayoutMap.value.get(evtId) || { stackIndex: 0, totalInGroup: 1 };
};

// Tính toán vị trí top, height, left, width, z-index và shadow cho Event card theo hiệu ứng xếp chồng ngang
const calculateEventPosition = (evt: InterviewEvent) => {
  const h = hourHeight.value;
  const top = (evt.startHourDecimal - startHourBase) * h;
  const height = evt.durationHours * h - 4; // Trừ khoảng hở giữa các sự kiện

  const layout = getEventLayout(evt.id);
  const { stackIndex, totalInGroup } = layout;

  if (viewMode.value === 'week') {
    if (totalInGroup <= 1) {
      return {
        top: `${Math.max(0, top + 2)}px`,
        height: `${Math.max(38, height)}px`,
        left: '6px',
        right: '6px',
        zIndex: 10,
      };
    }

    // Chế độ Week: mỗi thẻ lệch sang phải ~18px, độ rộng chiếm phần lớn để vẫn đọc được nội dung
    const stepPx = Math.min(22, Math.max(14, Math.floor(42 / totalInGroup)));
    const maxOffset = (totalInGroup - 1) * stepPx;
    const leftOffset = 6 + stackIndex * stepPx;

    return {
      top: `${Math.max(0, top + 2)}px`,
      height: `${Math.max(38, height)}px`,
      left: `${leftOffset}px`,
      width: `calc(100% - ${maxOffset + 12}px)`,
      zIndex: 10 + stackIndex,
      boxShadow: stackIndex > 0 ? '-4px 0 12px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)' : undefined,
    };
  } else {
    // Chế độ Day: Chiều ngang rộng rãi, mỗi thẻ lệch sang phải ~44px
    if (totalInGroup <= 1) {
      return {
        top: `${Math.max(0, top + 2)}px`,
        height: `${Math.max(38, height)}px`,
        left: '16px',
        right: '16px',
        zIndex: 10,
      };
    }

    const stepPx = Math.min(48, Math.max(28, Math.floor(120 / totalInGroup)));
    const maxOffset = (totalInGroup - 1) * stepPx;
    const leftOffset = 20 + stackIndex * stepPx;

    return {
      top: `${Math.max(0, top + 2)}px`,
      height: `${Math.max(38, height)}px`,
      left: `${leftOffset}px`,
      width: `calc(100% - ${maxOffset + 40}px)`,
      zIndex: 10 + stackIndex,
      boxShadow: stackIndex > 0 ? '-6px 0 16px rgba(0,0,0,0.14), 0 4px 10px rgba(0,0,0,0.08)' : undefined,
    };
  }
};

const selectEvent = (evt: InterviewEvent): void => {
  selectedInterview.value = evt;
};
</script>

<template>
 <div class="font-poppins w-full h-[calc(100vh-49px)] md:h-screen max-h-screen bg-[#fafbfc] text-[#1e293b] flex flex-col overflow-hidden">
    <header class="border-b border-[#edf1f7] bg-white px-5 py-3.5 lg:px-8 shrink-0">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div class="flex items-center gap-3">
            <h1 class="text-xl font-bold text-gray-900 tracking-tight">Lịch phỏng vấn</h1>
          </div>
          <p class="text-xs text-[#64748b] mt-0.5">
            Lên lịch và điều phối các buổi phỏng vấn thuận tiện với hỗ trợ từ AI.
          </p>
        </div>

        <!-- Search + Google Calendar Button -->
        <div class="flex flex-wrap items-center gap-2.5">
          <!-- Search box -->
          <div class="relative w-full sm:w-72">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Tìm kiếm ứng viên, vị trí, buổi phỏng vấn..."
              class="h-9 w-full rounded-xl border border-gray-200 bg-gray-50/70 pl-8 pr-12 text-xs text-gray-800 placeholder-gray-400 outline-none transition focus:border-primary-500 focus:bg-white focus:ring-2 focus:ring-primary-100"
            />
          </div>

          <!-- Google Calendar Quick Toggle Button -->
          <button
            type="button"
            class="inline-flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 shadow-xs hover:bg-gray-50 transition cursor-pointer"
            title="Kết nối Lịch Google"
            @click="showCalendarIntegration = !showCalendarIntegration"
          >
            <CalendarIcon class="h-3.5 w-3.5 text-primary-600" />
            <span class="hidden sm:inline">Google Calendar</span>
          </button>
        </div>
      </div>

      <!-- Collapsible Google Calendar integration card -->
      <div v-if="showCalendarIntegration" class="mt-4 pt-4 border-t border-gray-100 animate-in fade-in duration-200">
        <GoogleCalendarConnectCard />
      </div>
    </header>

    <!-- ==================== SUB-TOOLBAR ==================== -->
    <div class="border-b border-[#edf1f7] bg-white px-5 py-2.5 lg:px-8 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
      <!-- Left side: Filters Button + Date navigation -->
      <div class="flex flex-wrap items-center gap-2 sm:gap-2.5">
        <!-- Toggle left filter panel button -->
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 font-semibold shadow-2xs transition cursor-pointer"
          :class="filterSidebarOpen
            ? 'border-primary-400 bg-primary-50 text-primary-700'
            : activeFilterCount > 0
              ? 'border-primary-300 bg-white text-primary-700'
              : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'"
          title="Bật/Tắt bộ lọc"
          @click="filterSidebarOpen = !filterSidebarOpen"
        >
          <SlidersHorizontal class="h-3.5 w-3.5" />
          <span>Bộ lọc</span>
          <span
            v-if="activeFilterCount > 0"
            class="grid h-4 min-w-4 place-items-center rounded-full bg-primary-600 px-1 text-[10px] font-bold text-white leading-none"
          >
            {{ activeFilterCount }}
          </span>
        </button>

        <div class="h-4 w-px bg-gray-200 hidden sm:block"></div>

        <!-- Today Button -->
        <button
          type="button"
          class="h-8 rounded-lg border border-gray-200 bg-white px-3 font-semibold text-gray-700 hover:bg-gray-50 shadow-2xs transition cursor-pointer"
          title="Về ngày hiện tại"
          @click="goToToday"
        >
          Hôm nay
        </button>

        <!-- Refresh Data Button -->
        <button
          type="button"
          class="grid h-8 w-8 place-items-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 shadow-2xs transition cursor-pointer"
          title="Tải lại lịch phỏng vấn"
          :disabled="isLoading"
          @click="fetchInterviews"
        >
          <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': isLoading }" />
        </button>

        <div class="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 shadow-2xs">
          <button
            type="button"
            class="grid h-7 w-7 place-items-center rounded text-gray-600 hover:bg-gray-100 transition cursor-pointer"
            :title="viewMode === 'day' ? 'Ngày trước' : 'Tuần trước'"
            @click="goToPrev"
          >
            <ChevronLeft class="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            class="grid h-7 w-7 place-items-center rounded text-gray-600 hover:bg-gray-100 transition cursor-pointer"
            :title="viewMode === 'day' ? 'Ngày tiếp theo' : 'Tuần tiếp theo'"
            @click="goToNext"
          >
            <ChevronRight class="h-3.5 w-3.5" />
          </button>
        </div>

        <div class="flex items-center gap-1.5 px-1 font-semibold text-gray-800">
          <span v-if="viewMode === 'week'">{{ weekRangeLabel }}</span>
          <span v-else>{{ currentDayInfo.nameVi }}, {{ currentDayInfo.dateNum }} Tháng {{ currentDayInfo.monthNum }}, {{ currentDayInfo.year }}</span>
          
          <!-- Icon Calendar có thể bấm để đổi ngày -->
          <div class="relative inline-flex items-center">
            <button
              type="button"
              class="grid h-7 w-7 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-[#4338ca] active:scale-95 transition cursor-pointer"
              title="Bấm để chọn ngày khác"
              @click="triggerDatePicker"
            >
              <CalendarIcon class="h-4 w-4 pointer-events-none" />
            </button>
            <input
              ref="datePickerInput"
              type="date"
              :value="currentDayInfo.fullDate"
              class="pointer-events-none opacity-0 absolute w-0 h-0"
              tabindex="-1"
              aria-hidden="true"
              @change="onDateInputChange"
            />
          </div>
        </div>

        <div class="relative ml-2 hidden sm:block">
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs text-gray-600 hover:bg-gray-50 transition cursor-pointer"
          >
            <span>(GMT+07:00) Giờ VN</span>
            <ChevronDown class="h-3 w-3 text-gray-400" />
          </button>
        </div>
      </div>

      <!-- Right side: Mode Switch (Ngày / Tuần) -->
      <div class="flex items-center gap-2">
        <div class="inline-flex rounded-lg bg-gray-100 p-1 font-semibold text-gray-600">
          <button
            type="button"
            class="rounded-md px-3 py-1 transition-all cursor-pointer"
            :class="viewMode === 'day' ? 'bg-white text-gray-900 shadow-xs' : 'hover:text-gray-900'"
            @click="viewMode = 'day'"
          >
            Ngày
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1 transition-all cursor-pointer"
            :class="viewMode === 'week' ? 'bg-white text-gray-900 shadow-xs' : 'hover:text-gray-900'"
            @click="viewMode = 'week'"
          >
            Tuần
          </button>
        </div>
      </div>
    </div>

    <!-- ==================== MAIN CONTENT BODY ==================== -->
    <div class="flex-1 min-h-0 flex overflow-hidden relative">
      <!-- Backdrop mờ nhẹ khi mở Filter -->
      <Transition name="fade-fast">
        <div
          v-if="filterSidebarOpen"
          class="absolute inset-0 bg-slate-900/10 z-20 backdrop-blur-[0.5px]"
          @click="filterSidebarOpen = false"
        />
      </Transition>

      <!-- 1. LEFT FILTER OVERLAY DRAWER -->
      <Transition name="slide-left">
        <aside
          v-if="filterSidebarOpen"
          class="absolute inset-y-0 left-0 z-30 w-72 bg-white border-r border-gray-200 shadow-2xl flex flex-col text-xs overflow-y-auto scrollbar-thin"
        >
          <div class="p-5 flex flex-col gap-5 min-h-full">
            <!-- Header: Title + Active Count + Clear all + Close X Button -->
            <div class="flex items-center justify-between pb-3 border-b border-gray-100">
              <div class="flex items-center gap-2">
                <div class="grid h-7 w-7 place-items-center rounded-lg bg-gray-100 text-gray-700">
                  <SlidersHorizontal class="h-3.5 w-3.5" />
                </div>
                <h3 class="font-bold text-gray-900 text-sm">Bộ lọc tìm kiếm</h3>
                <span
                  v-if="activeFilterCount > 0"
                  class="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-bold text-primary-700 border border-primary-200"
                >
                  {{ activeFilterCount }}
                </span>
              </div>

              <div class="flex items-center gap-2">
                <button
                  v-if="activeFilterCount > 0"
                  type="button"
                  class="text-[11px] font-semibold text-primary-600 hover:text-primary-700 underline cursor-pointer"
                  @click="clearAllFilters"
                >
                  Xóa tất cả
                </button>
                <button
                  type="button"
                  class="grid h-7 w-7 place-items-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition cursor-pointer"
                  title="Đóng bộ lọc"
                  @click="filterSidebarOpen = false"
                >
                  <X class="h-4 w-4" />
                </button>
              </div>
            </div>

            <!-- Filter: Interview Type -->
            <div class="space-y-1.5">
              <label class="font-semibold text-gray-700">Loại hình phỏng vấn</label>
              <div class="relative">
                <select
                  v-model="selectedType"
                  class="w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 py-2 pr-8 text-xs text-gray-800 outline-none focus:border-primary-500 transition cursor-pointer"
                >
                  <option value="All Types">Tất cả loại hình</option>
                  <option value="Phỏng vấn Kỹ thuật">Phỏng vấn Kỹ thuật</option>
                  <option value="Phỏng vấn Lập trình">Phỏng vấn Lập trình</option>
                  <option value="Thiết kế Hệ thống">Thiết kế Hệ thống</option>
                  <option value="Phỏng vấn Nhân sự">Phỏng vấn Nhân sự</option>
                  <option value="Phỏng vấn Hội đồng">Phỏng vấn Hội đồng</option>
                </select>
                <ChevronDown class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              </div>
            </div>

            <!-- Filter: Job -->
            <div class="space-y-1.5">
              <label class="font-semibold text-gray-700">Vị trí ứng tuyển</label>
              <div class="relative">
                <select
                  v-model="selectedJob"
                  class="w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 py-2 pr-8 text-xs text-gray-800 outline-none focus:border-primary-500 transition cursor-pointer"
                >
                  <option value="All Jobs">Tất cả vị trí</option>
                  <option v-for="job in availableJobs" :key="job" :value="job">
                    {{ job }}
                  </option>
                </select>
                <ChevronDown class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              </div>
            </div>

            <!-- Filter: Interviewers -->
            <div class="space-y-1.5">
              <label class="font-semibold text-gray-700">Người phỏng vấn</label>
              <div class="relative">
                <select
                  v-model="selectedInterviewer"
                  class="w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 py-2 pr-8 text-xs text-gray-800 outline-none focus:border-primary-500 transition cursor-pointer"
                >
                  <option value="All Interviewers">Tất cả người phỏng vấn</option>
                  <option v-for="int in availableInterviewers" :key="int.id" :value="int.name">
                    {{ int.name }}
                  </option>
                </select>
                <ChevronDown class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              </div>
            </div>

            <!-- Filter: Location -->
            <div class="space-y-1.5">
              <label class="font-semibold text-gray-700">Địa điểm / Hình thức</label>
              <div class="relative">
                <select
                  v-model="selectedLocation"
                  class="w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 py-2 pr-8 text-xs text-gray-800 outline-none focus:border-primary-500 transition cursor-pointer"
                >
                  <option value="All Locations">Tất cả hình thức</option>
                  <option value="Google Meet">Google Meet (Trực tuyến)</option>
                  <option value="Văn phòng">Văn phòng (Trực tiếp)</option>
                </select>
                <ChevronDown class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              </div>
            </div>

            <!-- Filter: Status -->
            <div class="space-y-2 pt-2 border-t border-gray-100">
              <label class="font-semibold text-gray-700 block mb-1">Trạng thái</label>
              <div
                v-for="(meta, key) in STATUS_META"
                :key="key"
                class="flex items-center justify-between text-xs cursor-pointer select-none"
                @click="statusFilters[key] = !statusFilters[key]"
              >
                <div class="flex items-center gap-2">
                  <span class="h-2 w-2 rounded-full" :class="meta.dot"></span>
                  <span class="text-gray-700">{{ meta.label }}</span>
                </div>
                <input
                  type="checkbox"
                  :checked="statusFilters[key]"
                  class="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                  @click.stop
                  @change="statusFilters[key] = ($event.target as HTMLInputElement).checked"
                />
              </div>
            </div>

            <!-- Filter: Availability -->
            <div class="space-y-2 pt-2 border-t border-gray-100">
              <label class="font-semibold text-gray-700 block">Khung giờ trống</label>
              <label class="flex items-center gap-2.5 text-xs text-gray-700 cursor-pointer select-none">
                <input
                  v-model="showOnlyAvailable"
                  type="checkbox"
                  class="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                />
                <span>Chỉ hiển thị các khung giờ trống</span>
              </label>
            </div>

            <!-- AI Promo Card -->
            <div class="mt-auto rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-center">
              <div class="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-white text-primary-600 shadow-xs mb-2.5">
                <CalendarIcon class="h-5 w-5" />
              </div>
              <h4 class="text-xs font-bold text-gray-900 leading-snug">Tự động hóa lịch phỏng vấn</h4>
              <p class="text-[11px] text-gray-500 mt-1 leading-relaxed">
                Để AI tự động tìm thời gian phỏng vấn phù hợp và tránh xung đột lịch trình.
              </p>
              <button
                type="button"
                class="mt-3 w-full rounded-lg bg-white border border-gray-200 py-1.5 text-xs font-semibold text-gray-800 shadow-2xs hover:bg-gray-50 transition cursor-pointer"
              >
                Tìm hiểu thêm
              </button>
            </div>
          </div>
        </aside>
      </Transition>

      <!-- 2. CENTER SCHEDULE GRID -->
      <section class="flex-1 min-h-0 flex flex-col min-w-0 bg-white overflow-hidden">
        <!-- GRID TIME SLOTS & EVENT CARDS SCROLLABLE CONTAINER -->
        <div
          ref="timelineScrollContainer"
          class="relative flex-1 min-h-0 overflow-y-auto overflow-x-auto scrollbar-thin"
        >
          <!-- GRID HEADER ROW: Sticky top-0 -->
          <div
            class="sticky top-0 z-20 border-b border-[#edf1f7] bg-[#fcfdfe] grid shadow-2xs"
            :style="{
              gridTemplateColumns: viewMode === 'week' ? '64px repeat(5, minmax(130px, 1fr))' : '64px 1fr',
              minWidth: viewMode === 'week' ? '714px' : 'auto',
            }"
          >
            <!-- Cột thời gian góc trên bên trái -->
            <div class="h-14 border-r border-[#edf1f7] flex items-center justify-center text-[11px] font-semibold text-gray-400 bg-[#fcfdfe]">
              GMT+7
            </div>

            <!-- A. Khi ở MODE WEEK: Hàng đầu hiển thị các thứ & ngày trong tuần -->
            <template v-if="viewMode === 'week'">
              <div
                v-for="d in weekDays"
                :key="d.dayOfWeek"
                class="h-14 border-r border-[#edf1f7] px-3 flex items-center justify-between transition bg-[#fcfdfe] cursor-pointer hover:bg-indigo-50/40"
                :class="d.dayOfWeek === activeDayOfWeek ? 'bg-indigo-50/50' : ''"
                :title="`Xem ${d.nameVi} (${d.dateNum}/${d.monthNum})`"
                @click="selectDay(d.dayOfWeek)"
              >
                <!-- Tiêu đề ngày định dạng Thứ - Ngày (không dùng vòng tròn) -->
                <div class="flex flex-col justify-center min-w-0">
                  <div
                    class="text-xs font-bold truncate"
                    :class="d.fullDate === todayDateStr ? 'text-[#4338ca] font-extrabold' : 'text-gray-800'"
                  >
                    {{ d.nameVi }} - {{ String(d.dateNum).padStart(2, '0') }}
                  </div>
                  <span class="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">
                    Thg {{ d.monthNum }}, {{ d.year }}
                  </span>
                </div>

                <!-- Avatar người phỏng vấn trong ngày (hoặc chữ cái đầu nếu không có avatar) -->
                <div
                  v-if="getDayInterviewers(d.fullDate).length > 0"
                  class="flex -space-x-1.5 overflow-hidden shrink-0 items-center"
                >
                  <template v-for="int in getDayInterviewers(d.fullDate)" :key="int.id || int.name">
                    <img
                      v-if="int.avatar"
                      :src="int.avatar"
                      :alt="int.name"
                      :title="`Người phỏng vấn: ${int.name}`"
                      class="inline-block h-6 w-6 rounded-full ring-2 ring-white object-cover shrink-0 aspect-square"
                    />
                    <div
                      v-else
                      :title="`Người phỏng vấn: ${int.name}`"
                      class="inline-grid h-6 w-6 rounded-full ring-2 ring-white place-items-center bg-blue-100 text-[10px] font-bold text-blue-700 shrink-0 aspect-square select-none"
                    >
                      {{ getInitials(int.name) }}
                    </div>
                  </template>
                </div>
              </div>
            </template>

            <!-- B. Khi ở MODE DAY: Hàng đầu hiển thị nhãn ngày & bộ nút chọn ngày nhanh Thứ 2 -> Thứ 6 -->
            <template v-else>
              <div class="h-14 border-r border-[#edf1f7] px-4 flex items-center justify-between bg-[#fcfdfe] gap-3">
                <!-- Thông tin ngày đang chọn -->
                <div class="flex items-center gap-3 min-w-0">
                  <div class="text-xs font-semibold text-gray-500 truncate">
                    Lịch trình ngày:
                    <span class="font-bold text-gray-900 ml-1">
                      {{ currentDayInfo.nameVi }}, {{ currentDayInfo.dateNum }} Tháng {{ currentDayInfo.monthNum }}, {{ currentDayInfo.year }}
                    </span>
                  </div>
                  <div class="hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-semibold shrink-0">
                    <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                    <span>{{ filteredInterviews.length }} buổi phỏng vấn</span>
                  </div>
                </div>

                <!-- Dãy nút chọn ngày nhanh Thứ 2 - Thứ 6 -->
                <div class="flex items-center gap-1 bg-gray-100 p-1 rounded-xl shrink-0">
                  <button
                    v-for="d in weekDays"
                    :key="d.dayOfWeek"
                    type="button"
                    class="px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
                    :class="activeDayOfWeek === d.dayOfWeek
                      ? 'bg-white text-primary-700 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'"
                    :title="`Xem ${d.nameVi} (${d.dateNum}/${d.monthNum})`"
                    @click="selectDay(d.dayOfWeek)"
                  >
                    <span>{{ d.nameVi }}</span>
                    <span
                      class="h-4.5 min-w-4.5 px-1 grid place-items-center rounded-full text-[10px] font-bold"
                      :class="d.fullDate === todayDateStr ? 'bg-[#4338ca] text-white' : 'bg-gray-200 text-gray-600'"
                    >
                      {{ d.dateNum }}
                    </span>
                  </button>
                </div>
              </div>
            </template>
          </div>

          <!-- TIMELINE GRID: Các khung giờ và event cards -->
          <div
            class="relative grid"
            :style="{
              gridTemplateColumns: viewMode === 'week' ? '64px repeat(5, minmax(130px, 1fr))' : '64px 1fr',
              minWidth: viewMode === 'week' ? '714px' : 'auto',
              minHeight: `${timeSlots.length * hourHeight}px`,
            }"
          >
            <!-- Loading spinner overlay -->
            <div
              v-if="isLoading"
              class="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center z-30 pointer-events-none"
            >
              <div class="flex items-center gap-2 px-4 py-2 rounded-xl bg-white shadow-md border border-gray-100 text-xs font-semibold text-gray-700">
                <Loader2 class="h-4 w-4 animate-spin text-primary-600" />
                <span>Đang đồng bộ dữ liệu phỏng vấn...</span>
              </div>
            </div>

            <!-- Empty state overlay khi không có phỏng vấn nào (nằm ở khoảng giữa khung 13h - 14h) -->
            <div
              v-if="!isLoading && filteredInterviews.length === 0"
              class="absolute inset-0 flex flex-col items-center justify-center p-6 text-center pointer-events-none z-10"
            >
              <div class="rounded-2xl border border-gray-200/90 bg-white/95 backdrop-blur-sm p-6 shadow-md flex flex-col items-center max-w-sm pointer-events-auto">
                <div class="h-12 w-12 rounded-2xl bg-indigo-50 text-[#4338ca] flex items-center justify-center mb-3 shadow-2xs">
                  <CalendarIcon class="h-6 w-6" />
                </div>
                <p class="text-sm font-bold text-gray-800">Chưa có lịch phỏng vấn nào</p>
                <p class="text-xs text-gray-500 mt-1 leading-relaxed">
                  {{ viewMode === 'day' ? `Không có lịch phỏng vấn nào vào ${currentDayInfo.nameVi} (${currentDayInfo.dateNum}/${currentDayInfo.monthNum})` : 'Không có lịch phỏng vấn nào trong tuần này' }}
                </p>
                <p v-if="activeFilterCount > 0" class="text-[11px] text-primary-600 mt-2 font-medium">
                  (Đang áp dụng {{ activeFilterCount }} bộ lọc — bạn có thể xóa bộ lọc để xem toàn bộ)
                </p>
              </div>
            </div>

            <!-- 1. Cột hiển thị giờ bên trái (06:00 - 19:00) -->
            <div class="border-r border-[#edf1f7] bg-white select-none">
              <div
                v-for="time in timeSlots"
                :key="time"
                class="border-b border-[#edf1f7] pr-2 pt-2 text-right text-[11px] font-semibold text-gray-400"
                :style="{ height: `${hourHeight}px` }"
              >
                {{ time }}
              </div>
            </div>

            <!-- 2. Các cột ngày trong lịch (Mode Week) -->
            <template v-if="viewMode === 'week'">
              <div
                v-for="d in weekDays"
                :key="d.dayOfWeek"
                class="relative border-r border-[#edf1f7] bg-white"
              >
                <!-- Kẻ vạch các giờ ngang -->
                <div
                  v-for="time in timeSlots"
                  :key="time"
                  class="border-b border-[#f1f5f9]"
                  :style="{ height: `${hourHeight}px` }"
                ></div>

                <!-- Red Current Time Line nếu là hôm nay -->
                <div
                  v-if="d.fullDate === todayDateStr && nowTimeInfo.decimalHour >= startHourBase && nowTimeInfo.decimalHour <= 20"
                  class="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
                  :style="{ top: `calc((${nowTimeInfo.decimalHour} - ${startHourBase}) * ${hourHeight}px)` }"
                >
                  <span class="absolute -left-1.5 -top-2 rounded bg-rose-600 px-1 py-0.5 text-[9px] font-bold text-white shadow-xs">
                    {{ nowTimeInfo.timeString }}
                  </span>
                  <div class="w-full border-t-2 border-rose-500"></div>
                </div>

                <!-- Event Cards của ngày này -->
                <div
                  v-for="evt in filteredInterviews.filter(e => e.date === d.fullDate)"
                  :key="evt.id"
                  class="absolute z-10 rounded-xl border text-left cursor-pointer transition-all duration-200 hover:!z-30 hover:scale-[1.02] hover:shadow-xl overflow-hidden"
                  :class="[
                    THEME_STYLES[evt.colorTheme].bg,
                    THEME_STYLES[evt.colorTheme].border,
                    selectedInterview?.id === evt.id ? '!z-25 ring-2 ring-primary-500 shadow-sm' : '',
                    evt.durationHours <= 0.55 ? 'p-1.5 sm:p-2' : 'p-2.5'
                  ]"
                  :style="calculateEventPosition(evt)"
                  @click="selectEvent(evt)"
                >
                  <!-- Time & Calendar Icon & Stack indicator -->
                  <div class="flex items-center justify-between text-[10px] font-medium" :class="THEME_STYLES[evt.colorTheme].subText">
                    <span class="truncate">{{ evt.startTime }} - {{ evt.endTime }}</span>
                    <div class="flex items-center gap-1 shrink-0">
                      <span
                        v-if="getEventLayout(evt.id).totalInGroup > 1"
                        class="inline-flex items-center gap-0.5 rounded px-1 py-0.2 bg-black/5 text-[8.5px] font-bold"
                        :title="`Trùng ${getEventLayout(evt.id).totalInGroup} lịch (${getEventLayout(evt.id).stackIndex + 1}/${getEventLayout(evt.id).totalInGroup})`"
                      >
                        <Layers class="h-2.5 w-2.5 opacity-70" />
                        {{ getEventLayout(evt.id).stackIndex + 1 }}/{{ getEventLayout(evt.id).totalInGroup }}
                      </span>
                      <CalendarIcon class="h-3 w-3 opacity-60 shrink-0" />
                    </div>
                  </div>

                  <!-- Candidate Avatar & Name + Interviewer Avatar on Card -->
                  <div class="flex items-center justify-between gap-1 mt-0.5 min-w-0">
                    <div class="flex items-center gap-1.5 min-w-0">
                      <img
                        v-if="evt.candidateAvatar"
                        :src="evt.candidateAvatar"
                        :alt="evt.candidateName"
                        class="h-4 w-4 rounded-full object-cover shrink-0 ring-1 ring-black/5 aspect-square"
                      />
                      <div
                        v-else
                        class="h-4 w-4 shrink-0 rounded-full bg-primary-100 text-[8.5px] font-bold text-primary-700 flex items-center justify-center select-none aspect-square"
                      >
                        {{ getInitials(evt.candidateName) }}
                      </div>
                      <h4 class="text-xs font-bold truncate" :class="THEME_STYLES[evt.colorTheme].text">
                        {{ evt.candidateName }}
                      </h4>
                    </div>

                    <!-- Interviewers avatar stack on card -->
                    <div v-if="evt.interviewers.length > 0" class="flex -space-x-1 shrink-0 items-center">
                      <template v-for="int in evt.interviewers" :key="int.id || int.name">
                        <img
                          v-if="int.avatar"
                          :src="int.avatar"
                          :alt="int.name"
                          :title="`Người PV: ${int.name}`"
                          class="inline-block h-4 w-4 rounded-full ring-1 ring-white object-cover shrink-0 aspect-square"
                        />
                        <div
                          v-else
                          :title="`Người PV: ${int.name}`"
                          class="inline-grid h-4 w-4 rounded-full ring-1 ring-white place-items-center bg-blue-100 text-[8px] font-bold text-blue-700 shrink-0 aspect-square select-none"
                        >
                          {{ getInitials(int.name) }}
                        </div>
                      </template>
                    </div>
                  </div>

                  <!-- Job Title & Type: chỉ hiện nếu thời lượng đủ dài (> 35 phút) -->
                  <template v-if="evt.durationHours > 0.58">
                    <p class="text-[10px] text-gray-500 truncate mt-0.5">
                      {{ evt.jobTitle }}
                    </p>
                    <p class="text-[10px] font-medium truncate mt-0.5" :class="THEME_STYLES[evt.colorTheme].subText">
                      • {{ evt.interviewType }}
                    </p>
                  </template>
                </div>
              </div>
            </template>

            <!-- Mode Day: 1 Cột toàn màn hình -->
            <template v-else>
              <div class="relative border-r border-[#edf1f7] bg-white">
                <!-- Kẻ vạch các giờ ngang -->
                <div
                  v-for="time in timeSlots"
                  :key="time"
                  class="border-b border-[#f1f5f9]"
                  :style="{ height: `${hourHeight}px` }"
                ></div>

                <!-- Red Current Time Line (chỉ hiển thị khi đang xem ngày hôm nay) -->
                <div
                  v-if="currentDayInfo.fullDate === todayDateStr && nowTimeInfo.decimalHour >= startHourBase && nowTimeInfo.decimalHour <= 20"
                  class="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
                  :style="{ top: `calc((${nowTimeInfo.decimalHour} - ${startHourBase}) * ${hourHeight}px)` }"
                >
                  <span class="absolute -left-1.5 -top-2 rounded bg-rose-600 px-1 py-0.5 text-[9px] font-bold text-white shadow-xs">
                    {{ nowTimeInfo.timeString }}
                  </span>
                  <div class="w-full border-t-2 border-rose-500"></div>
                </div>

                <!-- Event Cards trong ngày đang chọn -->
                <div
                  v-for="evt in filteredInterviews"
                  :key="evt.id"
                  class="absolute z-10 rounded-xl border text-left cursor-pointer transition-all duration-200 hover:!z-30 hover:scale-[1.01] hover:shadow-2xl overflow-hidden"
                  :class="[
                    THEME_STYLES[evt.colorTheme].bg,
                    THEME_STYLES[evt.colorTheme].border,
                    selectedInterview?.id === evt.id ? '!z-25 ring-2 ring-primary-500 shadow-sm' : '',
                    evt.durationHours <= 0.55 ? 'p-2 sm:p-2.5' : 'p-3.5 sm:p-4'
                  ]"
                  :style="calculateEventPosition(evt)"
                  @click="selectEvent(evt)"
                >
                  <!-- Layout compact khi thời lượng <= 30 phút (1 hàng ngang) -->
                  <template v-if="evt.durationHours <= 0.55">
                    <div class="flex items-center justify-between gap-3 h-full">
                      <div class="flex items-center gap-2 min-w-0">
                        <img
                          v-if="evt.candidateAvatar"
                          :src="evt.candidateAvatar"
                          :alt="evt.candidateName"
                          class="h-5 w-5 rounded-full object-cover shrink-0 ring-1 ring-black/5 aspect-square"
                        />
                        <div
                          v-else
                          class="h-5 w-5 shrink-0 rounded-full bg-primary-100 text-[10px] font-bold text-primary-700 flex items-center justify-center select-none aspect-square"
                        >
                          {{ getInitials(evt.candidateName) }}
                        </div>
                        <h4 class="text-sm font-bold truncate" :class="THEME_STYLES[evt.colorTheme].text">
                          {{ evt.candidateName }}
                        </h4>
                        <span class="text-xs text-gray-500 truncate hidden sm:inline">
                          • {{ evt.jobTitle }}
                        </span>
                        <span class="inline-flex items-center rounded-full bg-white/70 px-1.5 py-0.2 text-[10px] font-semibold text-gray-600 hidden md:inline">
                          {{ evt.interviewType }}
                        </span>
                        <span
                          v-if="getEventLayout(evt.id).totalInGroup > 1"
                          class="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.2 text-[10px] font-bold text-amber-800"
                          :title="`Trùng khung giờ (${getEventLayout(evt.id).stackIndex + 1}/${getEventLayout(evt.id).totalInGroup})`"
                        >
                          <Layers class="h-2.5 w-2.5 text-amber-600" />
                          {{ getEventLayout(evt.id).stackIndex + 1 }}/{{ getEventLayout(evt.id).totalInGroup }}
                        </span>
                      </div>

                      <div class="flex items-center gap-2.5 shrink-0 text-xs font-medium" :class="THEME_STYLES[evt.colorTheme].subText">
                        <span class="font-bold text-[11px] sm:text-xs">{{ evt.startTime }} - {{ evt.endTime }}</span>
                        <span class="hidden sm:inline-flex items-center gap-1 rounded bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                          {{ evt.location }}
                        </span>
                      </div>
                    </div>
                  </template>

                  <!-- Layout đầy đủ khi thời lượng >= 45 phút -->
                  <template v-else>
                    <div class="flex items-center justify-between text-xs font-medium" :class="THEME_STYLES[evt.colorTheme].subText">
                      <div class="flex items-center gap-2">
                        <span class="font-bold">{{ evt.startTime }} - {{ evt.endTime }} ({{ Math.round(evt.durationHours * 60) }} phút)</span>
                        <span
                          v-if="getEventLayout(evt.id).totalInGroup > 1"
                          class="inline-flex items-center gap-1 rounded-md bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-800"
                          :title="`Khung giờ trùng ${getEventLayout(evt.id).totalInGroup} buổi phỏng vấn`"
                        >
                          <Layers class="h-3 w-3 text-amber-600" />
                          Trùng lịch ({{ getEventLayout(evt.id).stackIndex + 1 }}/{{ getEventLayout(evt.id).totalInGroup }})
                        </span>
                      </div>
                      <span class="inline-flex items-center gap-1 rounded bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                        {{ evt.location }}
                      </span>
                    </div>

                    <div class="mt-1.5 flex items-center justify-between">
                      <div>
                        <div class="flex items-center gap-2 min-w-0">
                          <img
                            v-if="evt.candidateAvatar"
                            :src="evt.candidateAvatar"
                            :alt="evt.candidateName"
                            class="h-6 w-6 rounded-full object-cover shrink-0 ring-1 ring-black/5 aspect-square"
                          />
                          <div
                            v-else
                            class="h-6 w-6 shrink-0 rounded-full bg-primary-100 text-[10.5px] font-bold text-primary-700 flex items-center justify-center select-none aspect-square"
                          >
                            {{ getInitials(evt.candidateName) }}
                          </div>
                          <h4 class="text-sm font-bold truncate" :class="THEME_STYLES[evt.colorTheme].text">
                            {{ evt.candidateName }}
                          </h4>
                        </div>
                        <p class="text-xs text-gray-600 mt-1">
                          {{ evt.jobTitle }} • <span class="font-semibold">{{ evt.interviewType }}</span>
                        </p>
                      </div>

                      <div class="flex items-center gap-2.5">
                        <!-- Interviewers avatar stack -->
                        <div class="flex -space-x-1.5 overflow-hidden">
                          <template v-for="int in evt.interviewers" :key="int.id">
                            <img
                              v-if="int.avatar"
                              :src="int.avatar"
                              :alt="int.name"
                              :title="int.name"
                              class="inline-block h-6 w-6 rounded-full ring-2 ring-white object-cover shrink-0 aspect-square"
                            />
                            <div
                              v-else
                              :title="int.name"
                              class="inline-grid h-6 w-6 rounded-full ring-2 ring-white place-items-center bg-blue-100 text-[10px] font-bold text-blue-700 shrink-0 aspect-square select-none"
                            >
                              {{ getInitials(int.name) }}
                            </div>
                          </template>
                        </div>
                      </div>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- 3. BOTTOM STATS SUMMARY BAR -->
        <footer class="border-t border-[#edf1f7] bg-white px-5 py-3 flex flex-wrap items-center justify-between gap-4 text-xs shrink-0 z-10">
          <!-- Metric pills -->
          <div class="flex flex-wrap items-center gap-4 sm:gap-6 text-gray-600">
            <!-- Interviews count -->
            <div class="flex items-center gap-2">
              <div class="grid h-7 w-7 place-items-center rounded-lg bg-blue-50 text-blue-600">
                <Video class="h-3.5 w-3.5" />
              </div>
              <div>
                <span class="font-bold text-gray-900 text-sm">{{ totalInterviewsCount }}</span>
                <span class="text-gray-500 ml-1 text-[11px]">Buổi phỏng vấn</span>
              </div>
            </div>

            <!-- Candidates count -->
            <div class="flex items-center gap-2">
              <div class="grid h-7 w-7 place-items-center rounded-lg bg-purple-50 text-purple-600">
                <Users class="h-3.5 w-3.5" />
              </div>
              <div>
                <span class="font-bold text-gray-900 text-sm">{{ uniqueCandidatesCount }}</span>
                <span class="text-gray-500 ml-1 text-[11px]">Ứng viên</span>
              </div>
            </div>

            <!-- Total duration -->
            <div class="flex items-center gap-2">
              <div class="grid h-7 w-7 place-items-center rounded-lg bg-amber-50 text-amber-600">
                <Clock class="h-3.5 w-3.5" />
              </div>
              <div>
                <span class="font-bold text-gray-900 text-sm">{{ totalDurationHours }}</span>
                <span class="text-gray-500 ml-1 text-[11px]">Tổng thời lượng</span>
              </div>
            </div>

            <!-- Panel Coverage -->
            <div class="flex items-center gap-2">
              <div class="grid h-7 w-7 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
                <Users class="h-3.5 w-3.5" />
              </div>
              <div>
                <span class="font-bold text-gray-900 text-sm">{{ panelCoveragePercent }}%</span>
                <span class="text-gray-500 ml-1 text-[11px]">Đã phân công PV</span>
              </div>
            </div>
          </div>

          <!-- Nút Xem báo cáo ở góc phải dưới -->
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-700 shadow-2xs hover:bg-gray-50 hover:text-gray-900 hover:border-gray-300 transition cursor-pointer"
              @click="showReportModal = true"
            >
              <BarChart3 class="h-3.5 w-3.5 text-primary-600" />
              <span>Xem báo cáo</span>
            </button>
          </div>
        </footer>
      </section>

      <!-- 4. RIGHT DRAWER: INTERVIEW DETAILS -->
      <Transition name="drawer-right">
        <aside
          v-if="selectedInterview"
          class="drawer-aside shrink-0 border-l border-[#edf1f7] bg-white overflow-y-auto overflow-x-hidden scrollbar-thin z-20"
        >
          <div class="w-80 lg:w-96 p-6 flex flex-col justify-between min-h-full">
            <div class="space-y-5">
              <!-- Header: Title + Close Button -->
              <div class="flex items-center justify-between pb-3 border-b border-gray-100">
                <h3 class="font-bold text-gray-900 text-sm">Chi tiết buổi phỏng vấn</h3>
                <button
                  type="button"
                  class="grid h-7 w-7 place-items-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition cursor-pointer"
                  title="Đóng chi tiết"
                  @click="selectedInterview = null"
                >
                  <X class="h-4 w-4" />
                </button>
              </div>

              <!-- Status badge -->
              <div>
                <div class="flex items-center gap-2">
                  <span
                    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border"
                    :class="[STATUS_META[selectedInterview.status].bg, STATUS_META[selectedInterview.status].color]"
                  >
                    <span class="h-1.5 w-1.5 rounded-full" :class="STATUS_META[selectedInterview.status].dot"></span>
                    {{ STATUS_META[selectedInterview.status].label }}
                  </span>
                  <span
                    v-if="selectedInterview.confirmedAt"
                    class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-200"
                  >
                    <CheckCircle2 class="h-3 w-3" />
                    Đã xác nhận
                  </span>
                </div>

                <h2 class="text-base font-bold text-gray-900 mt-2">
                  Phỏng vấn {{ selectedInterview.jobTitle }}
                </h2>
              </div>

              <!-- Candidate Card with Quick Actions -->
              <div class="flex items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-gray-50/70 p-3">
                <div class="flex items-center gap-3 min-w-0 flex-1">
                  <img
                    v-if="selectedInterview.candidateAvatar"
                    :src="selectedInterview.candidateAvatar"
                    :alt="selectedInterview.candidateName"
                    class="h-10 w-10 shrink-0 aspect-square rounded-full object-cover ring-2 ring-white shadow-2xs"
                  />
                  <div
                    v-else
                    class="grid h-10 w-10 shrink-0 aspect-square place-items-center rounded-full bg-primary-100 font-bold text-primary-700 text-sm select-none"
                  >
                    {{ getInitials(selectedInterview.candidateName) }}
                  </div>
                  <div class="min-w-0 flex-1">
                    <h4 class="font-bold text-gray-900 text-xs truncate" :title="selectedInterview.candidateName">{{ selectedInterview.candidateName }}</h4>
                    <p class="text-[11px] text-gray-500 truncate" :title="selectedInterview.jobTitle">{{ selectedInterview.jobTitle }}</p>
                  </div>
                </div>

                <!-- Contact action icons -->
                <div class="flex items-center gap-1 text-gray-400 shrink-0">
                  <a
                    :href="`mailto:${selectedInterview.candidateEmail}`"
                    class="grid h-7 w-7 place-items-center rounded-lg hover:bg-white hover:text-primary-600 transition shadow-2xs"
                    title="Gửi Email"
                  >
                    <Mail class="h-3.5 w-3.5" />
                  </a>
                  <a
                    v-if="selectedInterview.candidatePhone"
                    :href="`tel:${selectedInterview.candidatePhone}`"
                    class="grid h-7 w-7 place-items-center rounded-lg hover:bg-white hover:text-emerald-600 transition shadow-2xs"
                    title="Gọi điện"
                  >
                    <Phone class="h-3.5 w-3.5" />
                  </a>
                  <button
                    type="button"
                    class="grid h-7 w-7 place-items-center rounded-lg hover:bg-white hover:text-gray-700 transition shadow-2xs cursor-pointer"
                    title="Sao chép thông tin"
                  >
                    <ExternalLink class="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <!-- Detail rows -->
              <div class="space-y-4 text-xs text-gray-600">
                <!-- Date & Time -->
                <div class="flex items-start gap-3">
                  <CalendarIcon class="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                  <div>
                    <p class="font-semibold text-gray-900">{{ formatDisplayDate(selectedInterview.date) }}</p>
                    <p class="text-[11px] text-gray-500">{{ selectedInterview.startTime }} – {{ selectedInterview.endTime }} ({{ Math.round(selectedInterview.durationHours * 60) }} phút)</p>
                  </div>
                </div>

                <!-- Confirmation Date -->
                <div class="flex items-start gap-3">
                  <CheckCircle2
                    class="h-4 w-4 shrink-0 mt-0.5"
                    :class="selectedInterview.confirmedAt ? 'text-emerald-500' : 'text-amber-500'"
                  />
                  <div>
                    <p class="text-[11px] text-gray-400">Thời gian xác nhận</p>
                    <p v-if="selectedInterview.confirmedAt" class="font-semibold text-emerald-700 text-xs mt-0.5">
                      {{ formatDateTimeVN(selectedInterview.confirmedAt) }}
                    </p>
                    <p v-else class="text-xs text-amber-600 mt-0.5 font-medium">
                      Chờ ứng viên phản hồi
                    </p>
                  </div>
                </div>

                <!-- Interview Type -->
                <div class="flex items-start gap-3">
                  <Clock class="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                  <div>
                    <p class="text-[11px] text-gray-400">Loại hình phỏng vấn</p>
                    <p class="font-semibold text-gray-900">{{ selectedInterview.interviewType }}</p>
                  </div>
                </div>

                <!-- Location / Platform -->
                <div class="flex items-start gap-3">
                  <Video class="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                  <div class="flex-1">
                    <p class="text-[11px] text-gray-400">Địa điểm / Phòng họp</p>
                    <div class="flex items-center justify-between mt-0.5">
                      <p class="font-semibold text-gray-900">{{ selectedInterview.location }}</p>
                      <a
                        v-if="selectedInterview.meetingLink"
                        :href="selectedInterview.meetingLink"
                        target="_blank"
                        class="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 transition"
                      >
                        Vào phòng họp
                        <ExternalLink class="h-2.5 w-2.5" />
                      </a>
                    </div>
                  </div>
                </div>

                <!-- Interviewers -->
                <div class="flex items-start gap-3">
                  <Users class="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                  <div>
                    <p class="text-[11px] text-gray-400">Người phỏng vấn ({{ selectedInterview.interviewers.length }})</p>
                    <div class="flex flex-col gap-1.5 mt-1.5">
                      <div
                        v-for="int in selectedInterview.interviewers"
                        :key="int.id"
                        class="flex items-center gap-2"
                      >
                        <img
                          v-if="int.avatar"
                          :src="int.avatar"
                          :alt="int.name"
                          class="inline-block h-6 w-6 rounded-full ring-1 ring-gray-200 object-cover shrink-0 aspect-square"
                        />
                        <div
                          v-else
                          class="grid h-6 w-6 shrink-0 aspect-square place-items-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700 ring-1 ring-blue-200 select-none"
                        >
                          {{ getInitials(int.name) }}
                        </div>
                        <div class="flex flex-col min-w-0">
                          <span class="text-xs font-medium text-gray-800 truncate">{{ int.name }}</span>
                          <span v-if="int.email" class="text-[10px] text-gray-400 truncate">{{ int.email }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Notes -->
                <div v-if="selectedInterview.notes" class="flex items-start gap-3">
                  <FileText class="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                  <div>
                    <p class="text-[11px] text-gray-400">Ghi chú</p>
                    <p class="text-[11.5px] text-gray-700 mt-0.5 leading-relaxed bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                      {{ selectedInterview.notes }}
                    </p>
                  </div>
                </div>

                <!-- Attachment -->
                <div v-if="selectedInterview.attachmentName" class="flex items-start gap-3">
                  <Download class="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                  <div class="flex-1">
                    <p class="text-[11px] text-gray-400">Tệp đính kèm</p>
                    <div class="mt-1 flex items-center justify-between rounded-xl border border-gray-200 bg-white p-2.5">
                      <div class="flex items-center gap-2">
                        <div class="grid h-7 w-7 place-items-center rounded bg-rose-50 text-rose-600">
                          <FileText class="h-4 w-4" />
                        </div>
                        <div>
                          <p class="font-semibold text-gray-900 text-[11px] truncate w-36">{{ selectedInterview.attachmentName }}</p>
                          <p class="text-[10px] text-gray-400">{{ selectedInterview.attachmentSize }}</p>
                        </div>
                      </div>
                      <button type="button" class="grid h-6 w-6 place-items-center rounded text-gray-400 hover:text-gray-700 transition cursor-pointer">
                        <Download class="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Footer Actions: Reschedule & Close -->
            <div class="pt-5 border-t border-gray-100 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                class="rounded-xl border border-gray-200 bg-white py-2 text-xs font-semibold text-gray-700 shadow-2xs hover:bg-gray-50 transition cursor-pointer"
                @click="showScheduleModal = true"
              >
                Dời lịch phỏng vấn
              </button>
              <button
                type="button"
                class="rounded-xl bg-[#4338ca] hover:bg-[#3730a3] py-2 text-xs font-semibold text-white shadow-sm transition cursor-pointer"
                @click="selectedInterview = null"
              >
                Đóng
              </button>
            </div>
          </div>
        </aside>
      </Transition>
    </div>

    <!-- Modal dời lịch phỏng vấn (Reschedule) cho buổi phỏng vấn đã chọn -->
    <ScheduleInterviewModal
      :open="showScheduleModal"
      :application-id="selectedInterview?.id ? (rawInterviews.find(r => r.id === selectedInterview?.id)?.applicationId || '') : ''"
      :candidate-name="selectedInterview?.candidateName || ''"
      :candidate-email="selectedInterview?.candidateEmail || ''"
      :job-title="selectedInterview?.jobTitle || ''"
      @close="showScheduleModal = false"
      @scheduled="fetchInterviews"
    />

    <!-- Modal Báo cáo Tổng quan Phỏng vấn -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="showReportModal"
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
          @click.self="showReportModal = false"
        >
          <div
            class="relative w-full max-w-3xl max-h-[90vh] bg-white rounded-2xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
          >
            <!-- Modal Header -->
            <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
              <div class="flex items-center gap-3">
                <div class="h-10 w-10 rounded-xl bg-indigo-50 text-[#4338ca] flex items-center justify-center shadow-2xs">
                  <BarChart3 class="h-5 w-5" />
                </div>
                <div>
                  <h3 class="text-base font-bold text-gray-900">Báo cáo Tổng quan Phỏng vấn</h3>
                  <p class="text-xs text-gray-500 mt-0.5">
                    Kỳ xem: <span class="font-semibold text-gray-700">{{ viewMode === 'week' ? `Tuần ${weekRangeLabel}` : `${currentDayInfo.nameVi}, ${currentDayInfo.dateNum} Tháng ${currentDayInfo.monthNum}, ${currentDayInfo.year}` }}</span>
                  </p>
                </div>
              </div>

              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition cursor-pointer disabled:opacity-50"
                  :disabled="isExportingDocx"
                  title="Xuất báo cáo sang file Word (.docx)"
                  @click="handleExportDocx"
                >
                  <FileText class="h-3.5 w-3.5" />
                  <span>{{ isExportingDocx ? 'Đang xuất...' : 'Xuất Word (.docx)' }}</span>
                </button>
                <button
                  type="button"
                  class="rounded-lg p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
                  title="In báo cáo"
                  @click="printReport"
                >
                  <Printer class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  class="rounded-lg p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
                  title="Đóng"
                  @click="showReportModal = false"
                >
                  <X class="h-5 w-5" />
                </button>
              </div>
            </div>

            <!-- Modal Body (Scrollable) -->
            <div class="p-6 overflow-y-auto space-y-6 flex-1 text-xs text-gray-700 scrollbar-thin">
              <!-- 4 Thẻ KPI chính -->
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div class="p-3.5 rounded-xl bg-blue-50/70 border border-blue-100/80">
                  <span class="text-[11px] font-medium text-blue-600 block">Tổng buổi phỏng vấn</span>
                  <div class="flex items-baseline gap-1 mt-1">
                    <span class="text-2xl font-bold text-blue-900">{{ totalInterviewsCount }}</span>
                    <span class="text-[10px] text-blue-500">buổi</span>
                  </div>
                </div>

                <div class="p-3.5 rounded-xl bg-purple-50/70 border border-purple-100/80">
                  <span class="text-[11px] font-medium text-purple-600 block">Số ứng viên</span>
                  <div class="flex items-baseline gap-1 mt-1">
                    <span class="text-2xl font-bold text-purple-900">{{ uniqueCandidatesCount }}</span>
                    <span class="text-[10px] text-purple-500">người</span>
                  </div>
                </div>

                <div class="p-3.5 rounded-xl bg-amber-50/70 border border-amber-100/80">
                  <span class="text-[11px] font-medium text-amber-600 block">Tổng thời lượng</span>
                  <div class="flex items-baseline gap-1 mt-1">
                    <span class="text-2xl font-bold text-amber-900">{{ totalDurationHours }}</span>
                  </div>
                </div>

                <div class="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-100/80">
                  <span class="text-[11px] font-medium text-indigo-600 block">Đã phân công PV</span>
                  <div class="flex items-baseline gap-1 mt-1">
                    <span class="text-2xl font-bold text-indigo-900">{{ panelCoveragePercent }}%</span>
                  </div>
                </div>
              </div>

              <!-- Tình trạng buổi phỏng vấn (Status Breakdown) -->
              <div>
                <h4 class="text-xs font-bold text-gray-900 uppercase tracking-wider mb-2.5">
                  Tình trạng buổi phỏng vấn
                </h4>
                <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <div class="p-2.5 rounded-xl border border-blue-200 bg-blue-50/50 flex flex-col justify-between">
                    <span class="text-[10px] text-blue-700 font-medium">Đã lên lịch</span>
                    <span class="text-lg font-bold text-blue-900 mt-1">{{ statusBreakdown.scheduled }}</span>
                  </div>

                  <div class="p-2.5 rounded-xl border border-cyan-200 bg-cyan-50/50 flex flex-col justify-between">
                    <span class="text-[10px] text-cyan-700 font-medium">Đang diễn ra</span>
                    <span class="text-lg font-bold text-cyan-900 mt-1">{{ statusBreakdown.in_progress }}</span>
                  </div>

                  <div class="p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/50 flex flex-col justify-between">
                    <span class="text-[10px] text-emerald-700 font-medium">Hoàn thành</span>
                    <span class="text-lg font-bold text-emerald-900 mt-1">{{ statusBreakdown.completed }}</span>
                  </div>

                  <div class="p-2.5 rounded-xl border border-amber-200 bg-amber-50/50 flex flex-col justify-between">
                    <span class="text-[10px] text-amber-700 font-medium">Đã dời lịch</span>
                    <span class="text-lg font-bold text-amber-900 mt-1">{{ statusBreakdown.rescheduled }}</span>
                  </div>

                  <div class="p-2.5 rounded-xl border border-rose-200 bg-rose-50/50 flex flex-col justify-between">
                    <span class="text-[10px] text-rose-700 font-medium">Đã hủy</span>
                    <span class="text-lg font-bold text-rose-900 mt-1">{{ statusBreakdown.cancelled }}</span>
                  </div>
                </div>
              </div>

              <!-- Phân bố theo loại hình & Top vị trí -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <!-- Theo loại hình -->
                <div class="p-4 rounded-xl border border-gray-200 bg-gray-50/40">
                  <h4 class="text-xs font-bold text-gray-900 mb-3 flex items-center justify-between">
                    <span>Loại hình phỏng vấn</span>
                    <span class="text-[10px] font-normal text-gray-500">{{ typeBreakdown.length }} loại hình</span>
                  </h4>
                  <div v-if="typeBreakdown.length === 0" class="text-center py-4 text-gray-400">
                    Chưa có dữ liệu
                  </div>
                  <div v-else class="space-y-2">
                    <div v-for="item in typeBreakdown" :key="item.type">
                      <div class="flex items-center justify-between text-[11px] mb-1">
                        <span class="font-medium text-gray-700 truncate">{{ item.type }}</span>
                        <span class="font-bold text-gray-900 shrink-0 ml-2">{{ item.count }} ({{ item.percent }}%)</span>
                      </div>
                      <div class="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                        <div class="h-full bg-[#4338ca] rounded-full transition-all duration-300" :style="{ width: `${item.percent}%` }"></div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Theo vị trí tuyển dụng -->
                <div class="p-4 rounded-xl border border-gray-200 bg-gray-50/40">
                  <h4 class="text-xs font-bold text-gray-900 mb-3 flex items-center justify-between">
                    <span>Top vị trí tuyển dụng</span>
                    <span class="text-[10px] font-normal text-gray-500">{{ availableJobs.length }} vị trí</span>
                  </h4>
                  <div v-if="jobBreakdown.length === 0" class="text-center py-4 text-gray-400">
                    Chưa có dữ liệu
                  </div>
                  <div v-else class="space-y-2">
                    <div
                      v-for="(item, idx) in jobBreakdown"
                      :key="item.job"
                      class="flex items-center justify-between py-1 border-b border-gray-100 last:border-0"
                    >
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="h-4.5 w-4.5 rounded-full bg-gray-200 text-gray-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                          {{ idx + 1 }}
                        </span>
                        <span class="font-medium text-gray-800 truncate text-[11px]" :title="item.job">{{ item.job }}</span>
                      </div>
                      <span class="font-bold text-primary-700 bg-primary-50 px-2 py-0.5 rounded-md text-[10px] shrink-0 ml-2">
                        {{ item.count }} buổi
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Danh sách chi tiết các buổi phỏng vấn -->
              <div>
                <h4 class="text-xs font-bold text-gray-900 uppercase tracking-wider mb-2.5">
                  Danh sách phỏng vấn ({{ allEvents.length }})
                </h4>
                <div class="border border-gray-200 rounded-xl overflow-hidden bg-white">
                  <div class="max-h-52 overflow-y-auto scrollbar-thin">
                    <table class="w-full text-left text-[11px]">
                      <thead class="bg-gray-50 border-b border-gray-200 text-gray-500 sticky top-0">
                        <tr>
                          <th class="py-2 px-3 font-semibold">Ứng viên</th>
                          <th class="py-2 px-3 font-semibold">Vị trí</th>
                          <th class="py-2 px-3 font-semibold">Người phỏng vấn</th>
                          <th class="py-2 px-3 font-semibold">Loại hình</th>
                          <th class="py-2 px-3 font-semibold">Thời gian</th>
                          <th class="py-2 px-3 font-semibold">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-gray-100 text-gray-700">
                        <tr v-if="allEvents.length === 0">
                          <td colspan="6" class="py-6 text-center text-gray-400">Không có lịch phỏng vấn nào</td>
                        </tr>
                        <tr v-for="evt in allEvents" :key="evt.id" class="hover:bg-gray-50/70 transition">
                          <td class="py-2 px-3 font-bold text-gray-900 truncate max-w-[120px]">{{ evt.candidateName }}</td>
                          <td class="py-2 px-3 truncate max-w-[140px] text-gray-600">{{ evt.jobTitle }}</td>
                          <td class="py-2 px-3 truncate max-w-[130px] text-gray-600">
                            {{ evt.interviewers.map(i => i.name).filter(n => n && n !== 'Người phỏng vấn').join(', ') || 'Chưa gán' }}
                          </td>
                          <td class="py-2 px-3 text-gray-600 truncate max-w-[110px]">{{ evt.interviewType }}</td>
                          <td class="py-2 px-3 text-gray-500 whitespace-nowrap">{{ evt.startTime }} - {{ evt.endTime }} ({{ evt.date }})</td>
                          <td class="py-2 px-3">
                            <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" :class="[STATUS_META[evt.status].bg, STATUS_META[evt.status].color]">
                              <span class="h-1 w-1 rounded-full" :class="STATUS_META[evt.status].dot"></span>
                              <span>{{ STATUS_META[evt.status].label }}</span>
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <!-- Modal Footer -->
            <div class="px-6 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50 shrink-0">
              <span class="text-[11px] text-gray-400">Dữ liệu tổng hợp thời gian thực từ hệ thống</span>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 shadow-2xs hover:bg-gray-100 transition cursor-pointer"
                  @click="showReportModal = false"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  class="rounded-xl bg-[#4338ca] hover:bg-[#3730a3] px-4 py-2 text-xs font-semibold text-white shadow-sm flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                  :disabled="isExportingDocx"
                  @click="handleExportDocx"
                >
                  <FileText class="h-3.5 w-3.5" />
                  <span>{{ isExportingDocx ? 'Đang tạo file...' : 'Tải file Word (.docx)' }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* Left Filter Overlay Transitions */
.slide-left-enter-active,
.slide-left-leave-active {
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1),
              opacity 0.2s ease;
}

.slide-left-enter-from,
.slide-left-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}

.slide-left-enter-to,
.slide-left-leave-from {
  transform: translateX(0);
  opacity: 1;
}

/* Backdrop Fade */
.fade-fast-enter-active,
.fade-fast-leave-active {
  transition: opacity 0.2s ease;
}

.fade-fast-enter-from,
.fade-fast-leave-to {
  opacity: 0;
}

/* Right Details Drawer Transitions */
.drawer-right-enter-active,
.drawer-right-leave-active {
  transition: max-width 0.3s cubic-bezier(0.25, 1, 0.5, 1),
              opacity 0.25s ease;
  overflow: hidden !important;
}

.drawer-right-enter-from,
.drawer-right-leave-to {
  max-width: 0 !important;
  opacity: 0;
  border-color: transparent !important;
}

.drawer-right-enter-to,
.drawer-right-leave-from {
  max-width: 420px;
  opacity: 1;
}

.scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent;
}
.scrollbar-thin::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 9999px;
}
.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
</style>
