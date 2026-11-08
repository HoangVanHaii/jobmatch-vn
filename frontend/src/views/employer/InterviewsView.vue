<script setup lang="ts">
/**
 * InterviewsView — Trang Quản lý & Lên lịch Phỏng vấn (Interview Scheduler)
 * Mockup thiết kế theo chuẩn TalentFlow:
 * - Không có sidebar TalentFlow (tận dụng EmployerLayout của JobMatchVN)
 * - Chế độ xem: Day (Ngày) & Week (Tuần), không có chế độ Agenda
 * - Hàng đầu bảng lịch: để trống ở mode Day, hiển thị thứ & ngày ở mode Week
 * - Bộ lọc đa năng bên trái: Loại hình, vị trí, trạng thái, khả dụng
 * - Bảng lịch dạng time-grid trực quan với line giờ hiện tại và các card lịch màu pastel
 * - Thanh thống kê tổng kết ở đáy trang
 * - Panel chi tiết buổi phỏng vấn (Interview Details drawer) trượt mở bên phải khi click vào buổi hẹn
 */
import { ref, computed } from 'vue';
import {
  Calendar as CalendarIcon,
  Clock,
  Video,
  Users,
  Search,
  Bell,
  Plus,
  ChevronLeft,
  ChevronRight,
  Filter,
  Check,
  X,
  Mail,
  Phone,
  FileText,
  Download,
  ExternalLink,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  SlidersHorizontal,
  ChevronDown,
} from 'lucide-vue-next';
import ScheduleInterviewModal from '@/components/employer/ScheduleInterviewModal.vue';
import GoogleCalendarConnectCard from '@/components/employer/GoogleCalendarConnectCard.vue';

// ---------------------------------------------------------------------------
// Types & Data Structures
// ---------------------------------------------------------------------------
export type ViewMode = 'day' | 'week';

export type InterviewStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'rescheduled';

export type InterviewType = 'Technical Interview' | 'Coding Interview' | 'System Design' | 'HR Interview' | 'Panel Interview';

export interface Interviewer {
  id: string;
  name: string;
  role: string;
  avatar: string;
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
  interviewers: Interviewer[];
  notes?: string;
  attachmentName?: string;
  attachmentSize?: string;
  colorTheme: 'purple' | 'amber' | 'blue' | 'green' | 'rose';
}

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------
const MOCK_INTERVIEWERS: Interviewer[] = [
  { id: 'int-1', name: 'Esther Howard', role: 'Engineering Manager', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop&crop=face' },
  { id: 'int-2', name: 'Brooklyn Simmons', role: 'Senior Developer', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face' },
  { id: 'int-3', name: 'Cody Fisher', role: 'Tech Lead', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop&crop=face' },
  { id: 'int-4', name: 'Leslie Alexander', role: 'HR Manager', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=face' },
  { id: 'int-5', name: 'Darlene Robertson', role: 'Product Manager', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&h=100&fit=crop&crop=face' },
];

const MOCK_INTERVIEWS: InterviewEvent[] = [
  // Thứ 2 (Day 1)
  {
    id: 'evt-1',
    candidateName: 'Sarah Johnson',
    candidateEmail: 'sarah.johnson@example.com',
    candidatePhone: '+84 901 234 567',
    candidateAvatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120&h=120&fit=crop&crop=face',
    jobTitle: 'Frontend Developer',
    interviewType: 'Technical Interview',
    status: 'scheduled',
    date: '2024-05-12',
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '10:00',
    startHourDecimal: 9,
    durationHours: 1,
    location: 'Google Meet',
    meetingLink: 'https://meet.google.com/abc-defg-hij',
    interviewers: [MOCK_INTERVIEWERS[0], MOCK_INTERVIEWERS[1], MOCK_INTERVIEWERS[2]],
    notes: 'Đánh giá kỹ năng chuyên sâu về Vue 3, TypeScript, State Management và văn hóa làm việc nhóm.',
    attachmentName: 'Interview_Plan.pdf',
    attachmentSize: '245 KB',
    colorTheme: 'purple',
  },
  {
    id: 'evt-2',
    candidateName: 'Michael Chen',
    candidateEmail: 'michael.chen@example.com',
    candidatePhone: '+84 912 345 678',
    candidateAvatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=120&h=120&fit=crop&crop=face',
    jobTitle: 'Backend Developer',
    interviewType: 'Technical Interview',
    status: 'in_progress',
    date: '2024-05-12',
    dayOfWeek: 1,
    startTime: '11:00',
    endTime: '12:00',
    startHourDecimal: 11,
    durationHours: 1,
    location: 'Google Meet',
    meetingLink: 'https://meet.google.com/mno-pqrs-tuv',
    interviewers: [MOCK_INTERVIEWERS[1], MOCK_INTERVIEWERS[2]],
    notes: 'Tập trung kiến trúc Node.js, PostgreSQL tối ưu index, microservices messaging.',
    attachmentName: 'Backend_Test_Assessment.pdf',
    attachmentSize: '310 KB',
    colorTheme: 'green',
  },
  {
    id: 'evt-3',
    candidateName: 'David Kim',
    candidateEmail: 'david.kim@example.com',
    candidatePhone: '+84 933 888 999',
    jobTitle: 'Full Stack Developer',
    interviewType: 'System Design',
    status: 'scheduled',
    date: '2024-05-12',
    dayOfWeek: 1,
    startTime: '13:00',
    endTime: '14:00',
    startHourDecimal: 13,
    durationHours: 1,
    location: 'Phòng họp Tầng 4 - Trụ sở chính',
    interviewers: [MOCK_INTERVIEWERS[0], MOCK_INTERVIEWERS[2]],
    notes: 'Thiết kế hệ thống chịu tải cao, caching Redis và cơ chế đồng bộ dữ liệu.',
    colorTheme: 'blue',
  },
  {
    id: 'evt-4',
    candidateName: 'James Wilson',
    candidateEmail: 'james.wilson@example.com',
    jobTitle: 'DevOps Engineer',
    interviewType: 'Technical Interview',
    status: 'scheduled',
    date: '2024-05-12',
    dayOfWeek: 1,
    startTime: '16:00',
    endTime: '17:00',
    startHourDecimal: 16,
    durationHours: 1,
    location: 'Google Meet',
    meetingLink: 'https://meet.google.com/jkl-mnop-qrs',
    interviewers: [MOCK_INTERVIEWERS[2]],
    notes: 'Kinh nghiệm CI/CD Docker, Kubernetes và giám sát hệ thống Grafana/Prometheus.',
    colorTheme: 'rose',
  },

  // Thứ 3 (Day 2)
  {
    id: 'evt-5',
    candidateName: 'Priya Patel',
    candidateEmail: 'priya.patel@example.com',
    jobTitle: 'Software Engineer',
    interviewType: 'Coding Interview',
    status: 'scheduled',
    date: '2024-05-13',
    dayOfWeek: 2,
    startTime: '10:00',
    endTime: '11:00',
    startHourDecimal: 10,
    durationHours: 1,
    location: 'Google Meet',
    meetingLink: 'https://meet.google.com/priya-interview',
    interviewers: [MOCK_INTERVIEWERS[1]],
    notes: 'Live coding thuật toán giải quyết bài toán Data Structure trong 45 phút.',
    colorTheme: 'amber',
  },
  {
    id: 'evt-6',
    candidateName: 'Alex Thompson',
    candidateEmail: 'alex.t@example.com',
    jobTitle: 'Backend Developer',
    interviewType: 'Technical Interview',
    status: 'scheduled',
    date: '2024-05-13',
    dayOfWeek: 2,
    startTime: '14:00',
    endTime: '15:30',
    startHourDecimal: 14,
    durationHours: 1.5,
    location: 'Google Meet',
    meetingLink: 'https://meet.google.com/alex-backend',
    interviewers: [MOCK_INTERVIEWERS[1], MOCK_INTERVIEWERS[2]],
    colorTheme: 'purple',
  },
  {
    id: 'evt-7',
    candidateName: 'Maria Garcia',
    candidateEmail: 'maria.g@example.com',
    jobTitle: 'QA Engineer',
    interviewType: 'Technical Interview',
    status: 'completed',
    date: '2024-05-13',
    dayOfWeek: 2,
    startTime: '17:00',
    endTime: '18:00',
    startHourDecimal: 17,
    durationHours: 1,
    location: 'Google Meet',
    interviewers: [MOCK_INTERVIEWERS[0]],
    colorTheme: 'green',
  },

  // Thứ 4 (Day 3)
  {
    id: 'evt-8',
    candidateName: 'Ryan Martinez',
    candidateEmail: 'ryan.m@example.com',
    jobTitle: 'Software Engineer',
    interviewType: 'Technical Interview',
    status: 'scheduled',
    date: '2024-05-14',
    dayOfWeek: 3,
    startTime: '09:30',
    endTime: '10:30',
    startHourDecimal: 9.5,
    durationHours: 1,
    location: 'Google Meet',
    interviewers: [MOCK_INTERVIEWERS[2]],
    colorTheme: 'blue',
  },
  {
    id: 'evt-9',
    candidateName: 'Daniel Lee',
    candidateEmail: 'daniel.lee@example.com',
    jobTitle: 'Full Stack Developer',
    interviewType: 'System Design',
    status: 'scheduled',
    date: '2024-05-14',
    dayOfWeek: 3,
    startTime: '12:00',
    endTime: '13:00',
    startHourDecimal: 12,
    durationHours: 1,
    location: 'Google Meet',
    interviewers: [MOCK_INTERVIEWERS[0], MOCK_INTERVIEWERS[1]],
    colorTheme: 'rose',
  },
  {
    id: 'evt-10',
    candidateName: 'Sophia Brown',
    candidateEmail: 'sophia.brown@example.com',
    jobTitle: 'Mobile Developer',
    interviewType: 'Technical Interview',
    status: 'rescheduled',
    date: '2024-05-14',
    dayOfWeek: 3,
    startTime: '15:00',
    endTime: '16:00',
    startHourDecimal: 15,
    durationHours: 1,
    location: 'Google Meet',
    interviewers: [MOCK_INTERVIEWERS[2]],
    colorTheme: 'amber',
  },

  // Thứ 5 (Day 4)
  {
    id: 'evt-11',
    candidateName: 'Jessica Davis',
    candidateEmail: 'jessica.davis@example.com',
    jobTitle: 'Product Designer',
    interviewType: 'HR Interview',
    status: 'scheduled',
    date: '2024-05-15',
    dayOfWeek: 4,
    startTime: '11:00',
    endTime: '12:00',
    startHourDecimal: 11,
    durationHours: 1,
    location: 'Google Meet',
    interviewers: [MOCK_INTERVIEWERS[3]],
    colorTheme: 'purple',
  },
  {
    id: 'evt-12',
    candidateName: 'Robert Taylor',
    candidateEmail: 'robert.taylor@example.com',
    jobTitle: 'UX Designer',
    interviewType: 'HR Interview',
    status: 'scheduled',
    date: '2024-05-15',
    dayOfWeek: 4,
    startTime: '14:00',
    endTime: '15:00',
    startHourDecimal: 14,
    durationHours: 1,
    location: 'Google Meet',
    interviewers: [MOCK_INTERVIEWERS[3]],
    colorTheme: 'blue',
  },
  {
    id: 'evt-13',
    candidateName: 'Emily White',
    candidateEmail: 'emily.white@example.com',
    jobTitle: 'Product Manager',
    interviewType: 'HR Interview',
    status: 'cancelled',
    date: '2024-05-15',
    dayOfWeek: 4,
    startTime: '16:00',
    endTime: '17:00',
    startHourDecimal: 16,
    durationHours: 1,
    location: 'Google Meet',
    interviewers: [MOCK_INTERVIEWERS[3]],
    colorTheme: 'purple',
  },

  // Thứ 6 (Day 5)
  {
    id: 'evt-14',
    candidateName: 'Ethan Anderson',
    candidateEmail: 'ethan.a@example.com',
    jobTitle: 'Product Owner',
    interviewType: 'Panel Interview',
    status: 'scheduled',
    date: '2024-05-16',
    dayOfWeek: 5,
    startTime: '10:00',
    endTime: '11:00',
    startHourDecimal: 10,
    durationHours: 1,
    location: 'Google Meet',
    interviewers: [MOCK_INTERVIEWERS[0], MOCK_INTERVIEWERS[4]],
    colorTheme: 'green',
  },
  {
    id: 'evt-15',
    candidateName: 'Olivia Martinez',
    candidateEmail: 'olivia.m@example.com',
    jobTitle: 'Business Analyst',
    interviewType: 'Panel Interview',
    status: 'scheduled',
    date: '2024-05-16',
    dayOfWeek: 5,
    startTime: '13:00',
    endTime: '14:30',
    startHourDecimal: 13,
    durationHours: 1.5,
    location: 'Google Meet',
    interviewers: [MOCK_INTERVIEWERS[3], MOCK_INTERVIEWERS[4]],
    colorTheme: 'purple',
  },
  {
    id: 'evt-16',
    candidateName: 'Liam Thomas',
    candidateEmail: 'liam.t@example.com',
    jobTitle: 'Project Manager',
    interviewType: 'Panel Interview',
    status: 'scheduled',
    date: '2024-05-16',
    dayOfWeek: 5,
    startTime: '17:00',
    endTime: '18:00',
    startHourDecimal: 17,
    durationHours: 1,
    location: 'Google Meet',
    interviewers: [MOCK_INTERVIEWERS[0], MOCK_INTERVIEWERS[4]],
    colorTheme: 'amber',
  },
];

// ---------------------------------------------------------------------------
// State Controls
// ---------------------------------------------------------------------------
const viewMode = ref<ViewMode>('week'); // Chỉ hỗ trợ 'day' | 'week'
const searchQuery = ref('');
const filterSidebarOpen = ref(false); // Dạng đóng mở như drawer detail để tiết kiệm diện tích
const selectedInterview = ref<InterviewEvent | null>(MOCK_INTERVIEWS[0]); // Mặc định mở chi tiết buổi đầu tiên
const showScheduleModal = ref(false);
const showCalendarIntegration = ref(false);

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

// Time & Days structure
const timeSlots = [
  '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM'
];

const weekDays = [
  { dayOfWeek: 1, nameVi: 'Thứ 2', nameEn: 'Mon', dateNum: 12, fullDate: '2024-05-12' },
  { dayOfWeek: 2, nameVi: 'Thứ 3', nameEn: 'Tue', dateNum: 13, fullDate: '2024-05-13' },
  { dayOfWeek: 3, nameVi: 'Thứ 4', nameEn: 'Wed', dateNum: 14, fullDate: '2024-05-14' },
  { dayOfWeek: 4, nameVi: 'Thứ 5', nameEn: 'Thu', dateNum: 15, fullDate: '2024-05-15' },
  { dayOfWeek: 5, nameVi: 'Thứ 6', nameEn: 'Fri', dateNum: 16, fullDate: '2024-05-16' },
];

const activeDayOfWeek = ref(1); // Ngày đang chọn khi ở mode Day

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
// Filter Computation
// ---------------------------------------------------------------------------
const filteredInterviews = computed(() => {
  return MOCK_INTERVIEWS.filter((evt) => {
    // Mode Day: Chỉ hiện các sự kiện của ngày đang chọn
    if (viewMode.value === 'day' && evt.dayOfWeek !== activeDayOfWeek.value) {
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

    return true;
  });
});

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

// Tính toán vị trí top và height của Event card trên lưới theo giờ (9 AM = 0px)
const calculateEventPosition = (startHourDecimal: number, durationHours: number) => {
  const HOUR_HEIGHT = 72; // Chiều cao 1 tiếng = 72px
  const top = (startHourDecimal - 9) * HOUR_HEIGHT;
  const height = durationHours * HOUR_HEIGHT - 6; // Trừ khoảng hở
  return {
    top: `${top + 4}px`,
    height: `${Math.max(48, height)}px`,
  };
};

const selectEvent = (evt: InterviewEvent): void => {
  selectedInterview.value = evt;
};
</script>

<template>
  <div class="font-poppins h-[calc(100vh-49px)] md:h-screen max-h-screen bg-[#fafbfc] text-[#1e293b] flex flex-col overflow-hidden">
    <!-- ==================== HEADER BAR ==================== -->
    <header class="border-b border-[#edf1f7] bg-white px-5 py-3.5 lg:px-8 shrink-0">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div class="flex items-center gap-3">
            <h1 class="text-xl font-bold text-gray-900 tracking-tight">Interview Scheduler</h1>
            <span class="rounded-full bg-primary-50 px-2.5 py-0.5 text-[11px] font-semibold text-primary-700 border border-primary-200">
              Mockup
            </span>
          </div>
          <p class="text-xs text-[#64748b] mt-0.5">
            Lên lịch và điều phối các buổi phỏng vấn thuận tiện với hỗ trợ từ AI.
          </p>
        </div>

        <!-- Search + Notification + Schedule Button -->
        <div class="flex flex-wrap items-center gap-2.5">
          <!-- Search box -->
          <div class="relative w-full sm:w-72">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search for candidates, jobs, or interviews..."
              class="h-9 w-full rounded-xl border border-gray-200 bg-gray-50/70 pl-8 pr-12 text-xs text-gray-800 placeholder-gray-400 outline-none transition focus:border-primary-500 focus:bg-white focus:ring-2 focus:ring-primary-100"
            />
            <kbd class="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-400">
              ⌘ K
            </kbd>
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

          <!-- Notification Bell with Badge -->
          <button
            type="button"
            class="relative grid h-9 w-9 place-items-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition cursor-pointer"
            title="Thông báo lịch hẹn"
          >
            <Bell class="h-4 w-4" />
            <span class="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow-xs">
              6
            </span>
          </button>

          <!-- + Schedule Interview Button -->
          <button
            type="button"
            class="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#4338ca] hover:bg-[#3730a3] px-3.5 text-xs font-semibold text-white shadow-sm transition cursor-pointer"
            @click="showScheduleModal = true"
          >
            <Plus class="h-4 w-4" />
            Schedule Interview
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
      <!-- Left side: Filters Button + Date navigation (Nút nằm bên trái) -->
      <div class="flex flex-wrap items-center gap-2 sm:gap-2.5">
        <!-- Toggle left filter panel button (Đặt ở góc trái) -->
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
          <span>Filters</span>
          <span
            v-if="activeFilterCount > 0"
            class="grid h-4 min-w-4 place-items-center rounded-full bg-primary-600 px-1 text-[10px] font-bold text-white leading-none"
          >
            {{ activeFilterCount }}
          </span>
        </button>

        <div class="h-4 w-px bg-gray-200 hidden sm:block"></div>

        <button
          type="button"
          class="h-8 rounded-lg border border-gray-200 bg-white px-3 font-semibold text-gray-700 hover:bg-gray-50 shadow-2xs transition cursor-pointer"
          @click="activeDayOfWeek = 1"
        >
          Today
        </button>

        <div class="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 shadow-2xs">
          <button
            type="button"
            class="grid h-7 w-7 place-items-center rounded text-gray-600 hover:bg-gray-100 transition cursor-pointer"
            title="Tuần trước"
          >
            <ChevronLeft class="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            class="grid h-7 w-7 place-items-center rounded text-gray-600 hover:bg-gray-100 transition cursor-pointer"
            title="Tuần tiếp theo"
          >
            <ChevronRight class="h-3.5 w-3.5" />
          </button>
        </div>

        <div class="flex items-center gap-2 px-1 font-semibold text-gray-800">
          <span v-if="viewMode === 'week'">May 12 – May 16, 2024</span>
          <span v-else>Monday, May 12, 2024</span>
          <CalendarIcon class="h-3.5 w-3.5 text-gray-400" />
        </div>

        <div class="relative ml-2 hidden sm:block">
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs text-gray-600 hover:bg-gray-50 transition cursor-pointer"
          >
            <span>(GMT+07:00) ICT</span>
            <ChevronDown class="h-3 w-3 text-gray-400" />
          </button>
        </div>
      </div>

      <!-- Right side: Mode Switch (Day / Week - Không cần Agenda) -->
      <div class="flex items-center gap-2">
        <div class="inline-flex rounded-lg bg-gray-100 p-1 font-semibold text-gray-600">
          <button
            type="button"
            class="rounded-md px-3 py-1 transition-all cursor-pointer"
            :class="viewMode === 'day' ? 'bg-white text-gray-900 shadow-xs' : 'hover:text-gray-900'"
            @click="viewMode = 'day'"
          >
            Day
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1 transition-all cursor-pointer"
            :class="viewMode === 'week' ? 'bg-white text-gray-900 shadow-xs' : 'hover:text-gray-900'"
            @click="viewMode = 'week'"
          >
            Week
          </button>
        </div>
      </div>
    </div>

    <!-- ==================== MAIN CONTENT BODY ==================== -->
    <div class="flex-1 min-h-0 flex overflow-hidden relative">
      <!-- Backdrop mờ nhẹ khi mở Filter (click ra ngoài để đóng, đè lên phần interview) -->
      <Transition name="fade-fast">
        <div
          v-if="filterSidebarOpen"
          class="absolute inset-0 bg-slate-900/10 z-20 backdrop-blur-[0.5px]"
          @click="filterSidebarOpen = false"
        />
      </Transition>

      <!-- 1. LEFT FILTER OVERLAY DRAWER (Đè lên phần interview, không đẩy grid) -->
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
                <h3 class="font-bold text-gray-900 text-sm">Filters</h3>
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
                  Clear all
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
          <label class="font-semibold text-gray-700">Interview Type</label>
          <div class="relative">
            <select
              v-model="selectedType"
              class="w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 py-2 pr-8 text-xs text-gray-800 outline-none focus:border-primary-500 transition cursor-pointer"
            >
              <option value="All Types">All Types</option>
              <option value="Technical Interview">Technical Interview</option>
              <option value="Coding Interview">Coding Interview</option>
              <option value="System Design">System Design</option>
              <option value="HR Interview">HR Interview</option>
              <option value="Panel Interview">Panel Interview</option>
            </select>
            <ChevronDown class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          </div>
        </div>

        <!-- Filter: Job -->
        <div class="space-y-1.5">
          <label class="font-semibold text-gray-700">Job</label>
          <div class="relative">
            <select
              v-model="selectedJob"
              class="w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 py-2 pr-8 text-xs text-gray-800 outline-none focus:border-primary-500 transition cursor-pointer"
            >
              <option value="All Jobs">All Jobs</option>
              <option value="Frontend Developer">Frontend Developer</option>
              <option value="Backend Developer">Backend Developer</option>
              <option value="Software Engineer">Software Engineer</option>
              <option value="Full Stack Developer">Full Stack Developer</option>
              <option value="Product Designer">Product Designer</option>
              <option value="Product Owner">Product Owner</option>
            </select>
            <ChevronDown class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          </div>
        </div>

        <!-- Filter: Interviewers -->
        <div class="space-y-1.5">
          <label class="font-semibold text-gray-700">Interviewers</label>
          <div class="relative">
            <select
              v-model="selectedInterviewer"
              class="w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 py-2 pr-8 text-xs text-gray-800 outline-none focus:border-primary-500 transition cursor-pointer"
            >
              <option value="All Interviewers">All Interviewers</option>
              <option v-for="int in MOCK_INTERVIEWERS" :key="int.id" :value="int.name">
                {{ int.name }}
              </option>
            </select>
            <ChevronDown class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          </div>
        </div>

        <!-- Filter: Location -->
        <div class="space-y-1.5">
          <label class="font-semibold text-gray-700">Location</label>
          <div class="relative">
            <select
              v-model="selectedLocation"
              class="w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 py-2 pr-8 text-xs text-gray-800 outline-none focus:border-primary-500 transition cursor-pointer"
            >
              <option value="All Locations">All Locations</option>
              <option value="Google Meet">Google Meet</option>
              <option value="Onsite Office">Onsite Office</option>
            </select>
            <ChevronDown class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          </div>
        </div>

        <!-- Filter: Status -->
        <div class="space-y-2 pt-2 border-t border-gray-100">
          <label class="font-semibold text-gray-700 block mb-1">Status</label>
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
          <label class="font-semibold text-gray-700 block">Availability</label>
          <label class="flex items-center gap-2.5 text-xs text-gray-700 cursor-pointer select-none">
            <input
              v-model="showOnlyAvailable"
              type="checkbox"
              class="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
            />
            <span>Show only available slots</span>
          </label>
        </div>

        <!-- AI Promo Card -->
        <div class="mt-auto rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-center">
          <div class="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-white text-primary-600 shadow-xs mb-2.5">
            <CalendarIcon class="h-5 w-5" />
          </div>
          <h4 class="text-xs font-bold text-gray-900 leading-snug">Automate your interview scheduling</h4>
          <p class="text-[11px] text-gray-500 mt-1 leading-relaxed">
            Let AI find the best time for your interviews without calendar conflicts.
          </p>
          <button
            type="button"
            class="mt-3 w-full rounded-lg bg-white border border-gray-200 py-1.5 text-xs font-semibold text-gray-800 shadow-2xs hover:bg-gray-50 transition cursor-pointer"
          >
            Learn More
          </button>
        </div>
      </div>
    </aside>
  </Transition>

      <!-- 2. CENTER SCHEDULE GRID -->
      <section class="flex-1 min-h-0 flex flex-col min-w-0 bg-white overflow-hidden">
        <!-- GRID TIME SLOTS & EVENT CARDS SCROLLABLE CONTAINER -->
        <div class="relative flex-1 min-h-0 overflow-y-auto overflow-x-auto scrollbar-thin">
          <!-- GRID HEADER ROW: Sticky top-0 để giữ cố định dòng đầu (thứ trong tuần ở mode week) khi cuộn timeline -->
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

            <!-- A. Khi ở MODE WEEK: Hàng đầu hiển thị các thứ & ngày trong tuần (Cố định khi cuộn timeline) -->
            <template v-if="viewMode === 'week'">
              <div
                v-for="d in weekDays"
                :key="d.dayOfWeek"
                class="h-14 border-r border-[#edf1f7] px-3 flex flex-col justify-center transition bg-[#fcfdfe]"
                :class="d.dayOfWeek === 1 ? 'bg-blue-50/50' : ''"
              >
                <div class="flex items-center gap-2">
                  <span class="text-xs font-bold text-gray-800">{{ d.nameVi }}</span>
                  <span
                    class="grid h-6 w-6 place-items-center rounded-full text-xs font-bold"
                    :class="d.dayOfWeek === 1 ? 'bg-[#4338ca] text-white shadow-xs' : 'text-gray-600 bg-gray-100'"
                  >
                    {{ d.dateNum }}
                  </span>
                </div>
                <span class="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">May 2024</span>
              </div>
            </template>

            <!-- B. Khi ở MODE DAY: Hàng đầu người phỏng vấn để trống (đúng theo yêu cầu prompt) -->
            <template v-else>
              <div class="h-14 border-r border-[#edf1f7] px-4 flex items-center justify-between bg-white">
                <!-- Để trống hàng đầu người phỏng vấn, chỉ hiển thị nhãn ngày sạch sẽ -->
                <div class="text-xs font-semibold text-gray-500">
                  Lịch trình ngày: <span class="font-bold text-gray-900">Thứ Hai, 12 Tháng 5, 2024</span>
                </div>
                <div class="flex items-center gap-1">
                  <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
                  <span class="text-[11px] text-gray-500">4 buổi phỏng vấn được xếp</span>
                </div>
              </div>
            </template>
          </div>

          <!-- TIMELINE GRID: Các khung giờ và event cards cuộn bên dưới hàng đầu sticky -->
          <div
            class="relative grid"
            :style="{
              gridTemplateColumns: viewMode === 'week' ? '64px repeat(5, minmax(130px, 1fr))' : '64px 1fr',
              minWidth: viewMode === 'week' ? '714px' : 'auto',
              minHeight: `${timeSlots.length * 72}px`,
            }"
          >
            <!-- 1. Cột hiển thị giờ bên trái (9 AM - 6 PM) -->
            <div class="border-r border-[#edf1f7] bg-white select-none">
              <div
                v-for="time in timeSlots"
                :key="time"
                class="h-[72px] border-b border-[#edf1f7] pr-2 pt-2 text-right text-[11px] font-semibold text-gray-400"
              >
                {{ time }}
              </div>
            </div>

            <!-- 2. Các cột ngày trong lịch -->
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
                  class="h-[72px] border-b border-[#f1f5f9]"
                ></div>

                <!-- Red Current Time Line (hiển thị ở Thứ 2 lúc 2:30 PM = 14.5) -->
                <div
                  v-if="d.dayOfWeek === 1"
                  class="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
                  style="top: calc((14.5 - 9) * 72px);"
                >
                  <span class="absolute -left-1.5 -top-2 rounded bg-rose-600 px-1 py-0.5 text-[9px] font-bold text-white shadow-xs">
                    2:30 PM
                  </span>
                  <div class="w-full border-t-2 border-rose-500"></div>
                </div>

                <!-- Event Cards của ngày này -->
                <div
                  v-for="evt in filteredInterviews.filter(e => e.dayOfWeek === d.dayOfWeek)"
                  :key="evt.id"
                  class="absolute left-1.5 right-1.5 z-10 rounded-xl p-2.5 border text-left cursor-pointer transition-all duration-200 hover:shadow-md hover:scale-[1.01]"
                  :class="[
                    THEME_STYLES[evt.colorTheme].bg,
                    THEME_STYLES[evt.colorTheme].border,
                    selectedInterview?.id === evt.id ? 'ring-2 ring-primary-500 shadow-sm' : ''
                  ]"
                  :style="calculateEventPosition(evt.startHourDecimal, evt.durationHours)"
                  @click="selectEvent(evt)"
                >
                  <!-- Time & Calendar Icon -->
                  <div class="flex items-center justify-between text-[10px] font-medium" :class="THEME_STYLES[evt.colorTheme].subText">
                    <span>{{ evt.startTime }} - {{ evt.endTime }}</span>
                    <CalendarIcon class="h-3 w-3 opacity-60" />
                  </div>

                  <!-- Candidate Name -->
                  <h4 class="text-xs font-bold truncate mt-1" :class="THEME_STYLES[evt.colorTheme].text">
                    {{ evt.candidateName }}
                  </h4>

                  <!-- Job Title -->
                  <p class="text-[10px] text-gray-500 truncate">
                    {{ evt.jobTitle }}
                  </p>

                  <!-- Bullet + Type -->
                  <p class="text-[10px] font-medium truncate mt-0.5" :class="THEME_STYLES[evt.colorTheme].subText">
                    • {{ evt.interviewType }}
                  </p>
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
                  class="h-[72px] border-b border-[#f1f5f9]"
                ></div>

                <!-- Red Current Time Line -->
                <div
                  class="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
                  style="top: calc((14.5 - 9) * 72px);"
                >
                  <span class="absolute -left-1.5 -top-2 rounded bg-rose-600 px-1 py-0.5 text-[9px] font-bold text-white shadow-xs">
                    2:30 PM
                  </span>
                  <div class="w-full border-t-2 border-rose-500"></div>
                </div>

                <!-- Event Cards trong ngày đang chọn -->
                <div
                  v-for="evt in filteredInterviews"
                  :key="evt.id"
                  class="absolute left-3 right-3 sm:left-6 sm:right-6 z-10 rounded-xl p-3 border text-left cursor-pointer transition-all duration-200 hover:shadow-md hover:scale-[1.01]"
                  :class="[
                    THEME_STYLES[evt.colorTheme].bg,
                    THEME_STYLES[evt.colorTheme].border,
                    selectedInterview?.id === evt.id ? 'ring-2 ring-primary-500 shadow-sm' : ''
                  ]"
                  :style="calculateEventPosition(evt.startHourDecimal, evt.durationHours)"
                  @click="selectEvent(evt)"
                >
                  <div class="flex items-center justify-between text-xs font-medium" :class="THEME_STYLES[evt.colorTheme].subText">
                    <span class="font-bold">{{ evt.startTime }} - {{ evt.endTime }} ({{ evt.durationHours }}h)</span>
                    <span class="inline-flex items-center gap-1 rounded bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                      {{ evt.location }}
                    </span>
                  </div>

                  <div class="mt-1 flex items-center justify-between">
                    <div>
                      <h4 class="text-sm font-bold" :class="THEME_STYLES[evt.colorTheme].text">
                        {{ evt.candidateName }}
                      </h4>
                      <p class="text-xs text-gray-600">
                        {{ evt.jobTitle }} • <span class="font-semibold">{{ evt.interviewType }}</span>
                      </p>
                    </div>

                    <!-- Interviewers avatar stack -->
                    <div class="flex -space-x-1.5 overflow-hidden">
                      <img
                        v-for="int in evt.interviewers"
                        :key="int.id"
                        :src="int.avatar"
                        :alt="int.name"
                        :title="int.name"
                        class="inline-block h-6 w-6 rounded-full ring-2 ring-white object-cover"
                      />
                    </div>
                  </div>
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
                <span class="font-bold text-gray-900 text-sm">24</span>
                <span class="text-gray-500 ml-1 text-[11px]">Interviews</span>
              </div>
            </div>

            <!-- Candidates count -->
            <div class="flex items-center gap-2">
              <div class="grid h-7 w-7 place-items-center rounded-lg bg-purple-50 text-purple-600">
                <Users class="h-3.5 w-3.5" />
              </div>
              <div>
                <span class="font-bold text-gray-900 text-sm">18</span>
                <span class="text-gray-500 ml-1 text-[11px]">Candidates</span>
              </div>
            </div>

            <!-- Total duration -->
            <div class="flex items-center gap-2">
              <div class="grid h-7 w-7 place-items-center rounded-lg bg-amber-50 text-amber-600">
                <Clock class="h-3.5 w-3.5" />
              </div>
              <div>
                <span class="font-bold text-gray-900 text-sm">5h 30m</span>
                <span class="text-gray-500 ml-1 text-[11px]">Total Duration</span>
              </div>
            </div>

            <!-- Panel Coverage -->
            <div class="flex items-center gap-2">
              <div class="grid h-7 w-7 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
                <Users class="h-3.5 w-3.5" />
              </div>
              <div>
                <span class="font-bold text-gray-900 text-sm">85%</span>
                <span class="text-gray-500 ml-1 text-[11px]">Panel Coverage</span>
              </div>
            </div>
          </div>

          <!-- AI Optimization status & View Report button -->
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-[11px] text-emerald-800">
              <CheckCircle2 class="h-3.5 w-3.5 text-emerald-600" />
              <span><strong>AI Optimization:</strong> 3 conflicts resolved</span>
            </div>

            <button
              type="button"
              class="rounded-xl border border-gray-200 bg-white px-3 py-1.5 font-semibold text-gray-700 shadow-2xs hover:bg-gray-50 transition cursor-pointer"
            >
              View Report
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
            <h3 class="font-bold text-gray-900 text-sm">Interview Details</h3>
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
            <span
              class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border"
              :class="[STATUS_META[selectedInterview.status].bg, STATUS_META[selectedInterview.status].color]"
            >
              <span class="h-1.5 w-1.5 rounded-full" :class="STATUS_META[selectedInterview.status].dot"></span>
              {{ STATUS_META[selectedInterview.status].label }}
            </span>

            <h2 class="text-base font-bold text-gray-900 mt-2">
              {{ selectedInterview.jobTitle }} Interview
            </h2>
          </div>

          <!-- Candidate Card with Quick Actions -->
          <div class="flex items-center justify-between rounded-2xl border border-gray-100 bg-gray-50/70 p-3">
            <div class="flex items-center gap-3">
              <img
                v-if="selectedInterview.candidateAvatar"
                :src="selectedInterview.candidateAvatar"
                :alt="selectedInterview.candidateName"
                class="h-10 w-10 rounded-full object-cover ring-2 ring-white shadow-2xs"
              />
              <div v-else class="grid h-10 w-10 place-items-center rounded-full bg-primary-100 font-bold text-primary-700">
                {{ selectedInterview.candidateName.charAt(0) }}
              </div>
              <div>
                <h4 class="font-bold text-gray-900 text-xs">{{ selectedInterview.candidateName }}</h4>
                <p class="text-[11px] text-gray-500">{{ selectedInterview.jobTitle }}</p>
              </div>
            </div>

            <!-- Contact action icons -->
            <div class="flex items-center gap-1 text-gray-400">
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
                <p class="font-semibold text-gray-900">May 12, 2024</p>
                <p class="text-[11px] text-gray-500">{{ selectedInterview.startTime }} – {{ selectedInterview.endTime }} ({{ selectedInterview.durationHours }}h)</p>
              </div>
            </div>

            <!-- Interview Type -->
            <div class="flex items-start gap-3">
              <Clock class="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
              <div>
                <p class="text-[11px] text-gray-400">Interview Type</p>
                <p class="font-semibold text-gray-900">{{ selectedInterview.interviewType }}</p>
              </div>
            </div>

            <!-- Location / Platform -->
            <div class="flex items-start gap-3">
              <Video class="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
              <div class="flex-1">
                <p class="text-[11px] text-gray-400">Location</p>
                <div class="flex items-center justify-between mt-0.5">
                  <p class="font-semibold text-gray-900">{{ selectedInterview.location }}</p>
                  <a
                    v-if="selectedInterview.meetingLink"
                    :href="selectedInterview.meetingLink"
                    target="_blank"
                    class="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 transition"
                  >
                    Vào phòng
                    <ExternalLink class="h-2.5 w-2.5" />
                  </a>
                </div>
              </div>
            </div>

            <!-- Interviewers -->
            <div class="flex items-start gap-3">
              <Users class="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
              <div>
                <p class="text-[11px] text-gray-400">Interviewers ({{ selectedInterview.interviewers.length }})</p>
                <div class="flex items-center gap-2 mt-1.5">
                  <div class="flex -space-x-1.5 overflow-hidden">
                    <img
                      v-for="int in selectedInterview.interviewers"
                      :key="int.id"
                      :src="int.avatar"
                      :alt="int.name"
                      class="inline-block h-6 w-6 rounded-full ring-2 ring-white object-cover"
                    />
                  </div>
                  <span class="text-[11px] text-gray-500 font-medium">
                    {{ selectedInterview.interviewers.map(i => i.name).slice(0, 2).join(', ') }}
                    <template v-if="selectedInterview.interviewers.length > 2">
                      +{{ selectedInterview.interviewers.length - 2 }}
                    </template>
                  </span>
                </div>
              </div>
            </div>

            <!-- Notes -->
            <div v-if="selectedInterview.notes" class="flex items-start gap-3">
              <FileText class="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
              <div>
                <p class="text-[11px] text-gray-400">Notes</p>
                <p class="text-[11.5px] text-gray-700 mt-0.5 leading-relaxed bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                  {{ selectedInterview.notes }}
                </p>
              </div>
            </div>

            <!-- Attachment -->
            <div v-if="selectedInterview.attachmentName" class="flex items-start gap-3">
              <Download class="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
              <div class="flex-1">
                <p class="text-[11px] text-gray-400">Attachments</p>
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

        <!-- Footer Actions: Reschedule & Edit -->
        <div class="pt-5 border-t border-gray-100 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            class="rounded-xl border border-gray-200 bg-white py-2 text-xs font-semibold text-gray-700 shadow-2xs hover:bg-gray-50 transition cursor-pointer"
            @click="showScheduleModal = true"
          >
            Reschedule
          </button>
          <button
            type="button"
            class="rounded-xl bg-[#4338ca] hover:bg-[#3730a3] py-2 text-xs font-semibold text-white shadow-sm transition cursor-pointer"
          >
            Edit
          </button>
        </div>
      </div>
    </aside>
  </Transition>
</div>

    <!-- Modal lên lịch phỏng vấn -->
    <ScheduleInterviewModal
      :open="showScheduleModal"
      application-id=""
      candidate-name=""
      candidate-email=""
      job-title=""
      @close="showScheduleModal = false"
    />
  </div>
</template>

<style scoped>
/*
 * Left Filter Overlay Transitions (Trượt đè lên phần interview, không đẩy layout)
 */
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

/*
 * Right Details Drawer Transitions
 */
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