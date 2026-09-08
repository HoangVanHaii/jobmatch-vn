<script setup lang="ts">  
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  DollarSign,
  Eye,
  FileText,
  Globe2,
  ImagePlus,
  Loader2,
  MapPin,
  MessageCircle,
  Send,
  Sparkles,
  Star,
  AlertCircle,
  Bookmark,
  BookmarkCheck,
  Share2,
  Check,
  X,
} from 'lucide-vue-next';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);
dayjs.locale('vi');
import { storeToRefs } from 'pinia';
import { jobApi } from '@services/job.api';
import { chatApi } from '@services/chat.api';
import { useToastStore } from '@stores/toast';
import { useSavedJobStore } from '@stores/savedJob';
import { useAuthStore } from '@stores/auth';
import { uploadApi, formatFileSize } from '@services/upload.api';
import { fileIconInfo } from '@utils/fileIcon';
import type { Socket } from 'socket.io-client';
import { getSocket } from '@services/socket';
import ApplyJob from '@components/job/ApplyJob.vue';
import type {
  ApplicationMatchReadyPayload,
  ApplicationMatchSkippedPayload,
} from '@/types/application';
import type { JobApplicationStatus, JobDetail, JobFeedback } from '@/types/job';

const route = useRoute();
const router = useRouter();
const toast = useToastStore();
const savedJobStore = useSavedJobStore();
const auth = useAuthStore();
const { savedIds, pendingIds } = storeToRefs(savedJobStore);

const job = ref<JobDetail | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const applyModalOpen = ref(false);

// ============================================================================
// Quick-chat (mini composer ở action card)
//
// Bên cạnh nút save → nút icon chat. Click → mở composer nhỏ (input +
// send) ngay dưới action row. Send → POST /messages/conversations (idempotent,
// tạo mới nếu chưa có) + POST /messages/conversations/:id/messages.
//
// Chỉ dùng cho candidate login + job có `postedBy`. Nếu thiếu → button hidden
// hoặc disabled để tránh lỗi.
// ============================================================================
const chatOpen = ref(false);
const chatDraft = ref('');
const chatSending = ref(false);

/** Mở/đóng composer — clear draft khi đóng để tránh gửi nhầm. */
const toggleChat = (): void => {
  chatOpen.value = !chatOpen.value;
  if (!chatOpen.value) {
    chatDraft.value = '';
  }
};

/**
 * Gửi tin nhắn: tạo/resolve conversation rồi push message vào room.
 *
 * Flow:
 *   1. Truncate + guard empty.
 *   2. chatApi.createOrGet({ peerUserId }) — BE idempotent (xem
 *      memory/conversations-unique-constraint-caveat). Migration 0034:
 *      2-user unique → chỉ cần peerUserId. Nếu A đã chat B → BE trả về
 *      conversation cũ (bất kể từ job nào).
 *   3. chatApi.sendMessage(conversationId, { content }) — REST fallback.
 *      (Socket sẽ realtime đẩy message đến peer qua /messages namespace.)
 *   4. Toast success + clear input + close composer.
 *
 * Lỗi 401/403 → http interceptor đã handle refresh token / redirect login.
 */
/**
 * Pending file/ảnh paste/upload trong mini composer — giữ id local + previewUrl
 * + tên gốc để hiển thị file card cho non-image.
 *
 * Khi user bấm send → upload song song qua `uploadChatAttachment` (route
 * theo MIME), attach vào message.
 */
interface MiniAttachment {
  id: string;
  previewUrl: string | null;
  file: File;
  kind: 'image' | 'file';
}
const chatAttachments = ref<MiniAttachment[]>([]);
const uploadingImage = ref(false);
const miniFileInputEl = ref<HTMLInputElement | null>(null);

/**
 * Paste handler — bắt MỌI file từ clipboard (image + application), ngăn
 * default để tránh paste blob vào textarea. Nếu clipboard chỉ có text
 * → để mặc định (paste text).
 */
const onMiniPaste = (e: ClipboardEvent): void => {
  const items = e.clipboardData?.items;
  if (!items) return;
  const files: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (files.length === 0) return;
  e.preventDefault();
  for (const file of files) {
    const id = `mini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const isImage = file.type.startsWith('image/');
    chatAttachments.value = [
      ...chatAttachments.value,
      {
        id,
        previewUrl: isImage ? URL.createObjectURL(file) : null,
        file,
        kind: isImage ? 'image' : 'file',
      },
    ];
  }
};

const removeMiniAttachment = (id: string): void => {
  const target = chatAttachments.value.find((a) => a.id === id);
  if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
  chatAttachments.value = chatAttachments.value.filter((a) => a.id !== id);
};

/**
 * Click icon upload file cho mini composer — desktop chủ yếu (mobile dùng
 * paste từ clipboard là đủ). Trigger input[type=file] ẩn.
 */
const onMiniPickFile = (): void => {
  miniFileInputEl.value?.click();
};
const onMiniFileInputChange = (e: Event): void => {
  const target = e.target as HTMLInputElement;
  const files = target.files;
  if (!files || files.length === 0) return;
  for (const file of Array.from(files)) {
    const id = `mini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const isImage = file.type.startsWith('image/');
    chatAttachments.value = [
      ...chatAttachments.value,
      {
        id,
        previewUrl: isImage ? URL.createObjectURL(file) : null,
        file,
        kind: isImage ? 'image' : 'file',
      },
    ];
  }
  target.value = '';
};

const sendChat = async (): Promise<void> => {
  const j = job.value;
  if (!j) return;
  const content = chatDraft.value.trim();
  const hasContent = content.length > 0;
  const hasAttachments = chatAttachments.value.length > 0;
  if ((!hasContent && !hasAttachments) || chatSending.value || uploadingImage.value) return;
  if (!j.postedBy) {
    toast.push({
      variant: 'error',
      title: 'Không gửi được tin nhắn',
      body: 'Job này chưa có thông tin nhà tuyển dụng.',
    });
    return;
  }

  chatSending.value = true;
  try {
    const convRes = await chatApi.createOrGet({
      peerUserId: j.postedBy,
    });
    const conversationId = convRes.data.data.id;

    let attachments: import('@/types/chat').ChatAttachmentDraft[] | undefined;
    if (hasAttachments) {
      uploadingImage.value = true;
      try {
        const uploaded = await Promise.all(
          chatAttachments.value.map(async (a) => {
            const result = await uploadApi.uploadChatAttachment(a.file);
            return {
              url: result.url,
              key: result.key,
              mime: result.mime,
              sizeBytes: result.size,
              name: result.name,
              kind: result.kind,
            };
          }),
        );
        attachments = uploaded;
      } finally {
        uploadingImage.value = false;
      }
    }

    await chatApi.sendMessage(conversationId, { content, attachments });

    toast.push({
      variant: 'success',
      title: 'Đã gửi tin nhắn',
      body: 'Nhà tuyển dụng sẽ nhận được thông báo.',
    });
    chatDraft.value = '';
    for (const a of chatAttachments.value) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
    chatAttachments.value = [];
    chatOpen.value = false;
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { code?: string } } } }).response?.data?.error?.code
        : undefined;
    const body =
      code === 'FORBIDDEN' || code === 'NOT_AUTHENTICATED'
        ? 'Vui lòng đăng nhập lại.'
        : 'Vui lòng thử lại sau ít phút.';
    toast.push({
      variant: 'error',
      title: 'Không gửi được tin nhắn',
      body,
    });
  } finally {
    chatSending.value = false;
  }
};

let socket: Socket | null = null;

const jobSlug = computed<string>(() => String(route.params.slug ?? ''));
const saved = computed(() => (job.value ? savedIds.value.has(job.value.id) : false));
const saving = computed(() => (job.value ? pendingIds.value.has(job.value.id) : false));

/* ============================================================================
 * Fetch detail
 * ==========================================================================*/

const fetchDetail = async () => {
  if (!jobSlug.value) return;
  loading.value = true;
  error.value = null;
  try {
    const { data } = await jobApi.bySlug(jobSlug.value);
    job.value = data.data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Không tải được chi tiết job';
    job.value = null;
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  void fetchDetail();
  void savedJobStore.fetchIds();
  void fetchMyFeedback();
  void fetchMyApplicationStatus();

  // Connect socket + listen realtime match events.
  // Chỉ cần khi user đã login (auth token mới có ý nghĩa ở BE socketAuth).
  if (auth.isAuthenticated) {
    socket = getSocket();
    if (!socket.connected) socket.connect();
    socket.on('application:match-ready', onMatchReady);
    socket.on('application:match-skipped', onMatchSkipped);
  }
});

// Cleanup listeners khi rời route — tránh patch tràn sang component khác
// hoặc memory leak (handler closures giữ ref đến applicationList/job).
onUnmounted(() => {
  if (socket) {
    socket.off('application:match-ready', onMatchReady);
    socket.off('application:match-skipped', onMatchSkipped);
    // KHÔNG disconnect ở đây — AppliedJobsView có thể đang mounted đồng thời
    // và share cùng socket instance. Để socket.io tự idle.
  }
});
// Re-fetch khi navigate giữa 2 detail (route param đổi).
watch(jobSlug, async () => {
  await fetchDetail();
  await fetchMyFeedback();
  await fetchMyApplicationStatus();
});

/* ============================================================================
 * Formatters (giữ chung với JobCard)
 * ==========================================================================*/

const jobLevelLabel = computed((): string => {
  const m: Record<string, string> = {
    intern: 'Intern',
    fresher: 'Fresher',
    junior: 'Junior',
    mid: 'Mid-level',
    senior: 'Senior',
    lead: 'Lead',
    manager: 'Manager',
  };
  return job.value?.jobLevel ? m[job.value.jobLevel] ?? job.value.jobLevel : '';
});

const jobTypeLabel = computed((): string => {
  const m: Record<string, string> = {
    'full-time': 'Toàn thời gian',
    'part-time': 'Bán thời gian',
    contract: 'Hợp đồng',
    internship: 'Thực tập',
    freelance: 'Freelance',
  };
  return job.value?.jobType ? m[job.value.jobType] ?? job.value.jobType : '';
});

const salaryLabel = computed((): string => {
  const j = job.value;
  if (!j) return '';
  if (!j.salaryVisible) return 'Thoả thuận';
  const { salaryMin, salaryMax } = j;
  if (!salaryMin && !salaryMax) return 'Thoả thuận';
  const toM = (s: string): string => `${(Number(s) / 1_000_000).toFixed(0)} triệu`;
  if (salaryMin && salaryMax) return `${toM(salaryMin)} – ${toM(salaryMax)}`;
  if (salaryMin) return `Từ ${toM(salaryMin)}`;
  return `Đến ${toM(salaryMax!)}`;
});

const companyInitial = computed((): string => {
  const name = job.value?.companyName;
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase();
});

const locationLine = computed((): string => {
  const loc = job.value?.location;
  if (!loc) return '';
  const parts = [loc.district, loc.city].filter(Boolean);
  return parts.join(', ');
});

const experienceLabel = computed((): string => {
  const j = job.value;
  if (!j) return '';
  const { experienceYearsMin, experienceYearsMax } = j;
  if (experienceYearsMin == null && experienceYearsMax == null) return '';
  if (experienceYearsMin != null && experienceYearsMax != null) {
    return `${experienceYearsMin}–${experienceYearsMax} năm`;
  }
  if (experienceYearsMin != null) return `Từ ${experienceYearsMin} năm`;
  return `Đến ${experienceYearsMax} năm`;
});

const publishedLabel = computed((): string => {
  if (!job.value?.publishedAt) return '';
  return dayjs(job.value.publishedAt).format('DD/MM/YYYY');
});

const deadlineLabel = computed((): string => {
  if (!job.value?.deadline) return '';
  return dayjs(job.value.deadline).format('DD/MM/YYYY');
});

const compactNumber = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
};

/** Map `applications.status` → label tiếng Việt cho dòng "CV đã ứng tuyển". */
const formatAppliedStatus = (status: JobApplicationStatus['status']): string => {
  const m: Record<JobApplicationStatus['status'], string> = {
    pending: 'Đã nộp',
    viewed: 'Đã xem',
    screening: 'Đang xét duyệt',
    interview: 'Mời phỏng vấn',
    offered: 'Đã nhận offer',
    hired: 'Trúng tuyển',
    rejected: 'Bị từ chối',
    withdrawn: 'Đã rút',
  };
  return m[status] ?? status;
};

/* ============================================================================
 * Handlers
 * ==========================================================================*/

const goBack = (): void => {
  // Quay lại trang list job trong candidate layout.
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push('/candidate/viec-lam');
  }
};

const onApply = (): void => {
  if (!job.value) return;
  applyModalOpen.value = true;
};

const onApplied = (_applicationId: string): void => {
  // Sau khi apply thành công → re-fetch để update appliesCount +1 và status.
  void fetchDetail();
  void fetchMyApplicationStatus();
};

const onSave = async (): Promise<void> => {
  if (!job.value) return;
  const wasSaved = saved.value;
  const ok = await savedJobStore.toggle(job.value.id);
  if (ok) {
    toast.push({
      variant: 'success',
      title: wasSaved ? 'Đã bỏ lưu' : 'Đã lưu job',
      body: job.value.title,
    });
  } else {
    toast.push({
      variant: 'error',
      title: wasSaved ? 'Bỏ lưu thất bại' : 'Lưu job thất bại',
      body: 'Vui lòng thử lại',
    });
  }
};

const onShare = async (): Promise<void> => {
  try {
    const url = window.location.href;
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
      toast.push({ variant: 'success', title: 'Đã sao chép liên kết' });
    } else {
      toast.push({ variant: 'info', title: url });
    }
  } catch {
    toast.push({ variant: 'error', title: 'Không sao chép được liên kết' });
  }
};

/* ============================================================================
 * Copy section content
 *
 * - Dùng cho 2 section "Mô tả công việc" và "Yêu cầu ứng viên": nút copy icon
 *   ở góc phải. Khi click → copy text vào clipboard, hiển thị toast + tick 1s.
 * - Lưu `copiedKey` ref để track section nào vừa copy (đổi icon Copy → Check).
 * ==========================================================================*/

type CopyKey = 'description' | 'requirements';

const copiedKey = ref<CopyKey | null>(null);

const copySection = async (key: CopyKey, text: string | null | undefined): Promise<void> => {
  if (!text) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback cho môi trường không có Clipboard API (http, safari cũ, …)
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    copiedKey.value = key;
    toast.push({ variant: 'success', title: 'Đã sao chép nội dung' });
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null;
    }, 1500);
  } catch {
    toast.push({ variant: 'error', title: 'Không sao chép được nội dung' });
  }
};

/* ============================================================================
 * Feedback — candidate đánh giá job (rating + comment) sau khi đã apply.
 *
 * Flow:
 *   - Khi load job detail, list `job.feedbacks` + `job.feedbackStats` đã có sẵn
 *     trong response (BE nhúng luôn để FE khỏi gọi thêm).
 *   - Gọi `/feedbacks/me` nếu user đã login để biết họ đã rate chưa → fill form.
 *   - Submit POST /feedbacks → BE upsert (candidate 1 feedback / job).
 *     Lỗi 403 NOT_APPLIED hiển thị toast nhắc user apply trước.
 * ==========================================================================*/

const myFeedback = ref<JobFeedback | null>(null);
const feedbackRating = ref<number>(0);
const feedbackComment = ref<string>('');
const submittingFeedback = ref(false);

/** Form có đang ở trạng thái edit feedback cũ không. */
const isEditingFeedback = computed(() => myFeedback.value != null);

/**
 * Có được phép gửi đánh giá không — phải có ít nhất 1 application cho job này.
 * Backend rule: chỉ candidate đã apply mới rate được. Nếu chưa apply → disable
 * button + tooltip + notice giải thích.
 */
const canRateFeedback = computed(
  () => isCandidateLoggedIn.value && applicationList.value.length > 0,
);

/** Cache user đã login + role candidate để quyết định hiển thị form. */
const isCandidateLoggedIn = computed(() =>
  auth.isAuthenticated && auth.user?.role === 'candidate',
);

// ============================================================================
// Application status (candidate-self)
//
// BE endpoint `GET /jobs/by-slug/:slug/application-status` trả về MẢNG các
// application của candidate cho job này (1 entry/CV đã apply, migration 0033).
// FE dùng để:
//   - Render danh sách "CV đã ứng tuyển + điểm AI match" bên dưới Apply button.
//   - Click vào entry → mở đơn trong trang /candidate/applications.
//   - Apply button LUÔN hiển thị "Ứng tuyển ngay" — modal chọn CV sẽ chặn CV
//     đã apply (DB unique chặn duplicate).
// ============================================================================

const applicationList = ref<JobApplicationStatus[]>([]);
const loadingApplicationStatus = ref(false);

/** Set CV id đã ứng tuyển job này — truyền cho ApplyJob để disable radio. */
const appliedCvIds = computed(() =>
  applicationList.value.map((a) => a.cvId).filter((id): id is string => Boolean(id)),
);

const fetchMyApplicationStatus = async (): Promise<void> => {
  if (!isCandidateLoggedIn.value || !jobSlug.value) {
    applicationList.value = [];
    return;
  }
  loadingApplicationStatus.value = true;
  try {
    const { data } = await jobApi.myApplicationStatus(jobSlug.value);
    applicationList.value = data.data;
  } catch {
    // 401/403 (chưa login) hoặc 404 (slug mất) → coi như chưa apply.
    applicationList.value = [];
  } finally {
    loadingApplicationStatus.value = false;
  }
};

/** Click vào 1 dòng CV đã ứng tuyển → mở trang đơn ứng tuyển, focus đúng đơn. */
const goToMyApplication = (applicationId: string): void => {
  void router.push({ name: 'candidate-applications', query: { application: applicationId } });
};

// ============================================================================
// Realtime: patch `applicationList[i].aiMatchScore` khi worker AI chấm xong,
// thay vì để spinner "Chấm..." xoay vô hạn. Pattern mirror AppliedJobsView.
//
// Flow:
//   1. Candidate apply → backend enqueue worker.
//   2. Worker chấm xong (success / quota_exceeded / failed) → backend emit
//      `application:match-ready` hoặc `:match-skipped` cho socket user.
//   3. Handler patch row trong `applicationList` đang hiển thị → badge chuyển
//      từ spinner → điểm (hoặc badge terminal nếu quota/fail).
//
// Không cần refetch — patch trực tiếp vào reactive array.
// ============================================================================

/**
 * Worker success / failed / quota_exceeded — patch `aiMatchReason` và
 * (nếu có) `aiMatchScore` cho application tương ứng.
 *
 * Lọc theo `jobId` (payload có sẵn) để không patch nhầm khi user đang mở
 * job khác, application list khác render cùng lúc.
 */
const onMatchReady = (payload: ApplicationMatchReadyPayload): void => {
  if (!job.value) return;
  if (payload.jobId && payload.jobId !== job.value.id) return;
  const row = applicationList.value.find(
    (a) => a.applicationId === payload.applicationId,
  );
  if (!row) return;

  // Patch reason (success | quota_exceeded | failed) → UI chuyển spinner
  // thành điểm hoặc badge "Lỗi".
  if (payload.reason) {
    row.aiMatchReason = payload.reason;
  }
  // Patch điểm chỉ khi worker trả về (success). Quota/fail → matchPercent
  // null → KHÔNG touch score (giữ null → render badge terminal).
  if (payload.matchPercent != null) {
    row.aiMatchScore = payload.matchPercent;
  }
};

/** Worker skip do hết quota — chỉ patch reason, score để null. */
const onMatchSkipped = (payload: ApplicationMatchSkippedPayload): void => {
  if (!job.value) return;
  if (payload.jobId && payload.jobId !== job.value.id) return;
  const row = applicationList.value.find(
    (a) => a.applicationId === payload.applicationId,
  );
  if (!row) return;
  row.aiMatchReason = payload.reason;
};

const fetchMyFeedback = async (): Promise<void> => {
  if (!isCandidateLoggedIn.value || !job.value) {
    myFeedback.value = null;
    return;
  }
  try {
    const { data } = await jobApi.myFeedback(job.value.id);
    myFeedback.value = data.data;
    if (myFeedback.value) {
      feedbackRating.value = myFeedback.value.rating;
      feedbackComment.value = myFeedback.value.comment ?? '';
    } else {
      feedbackRating.value = 0;
      feedbackComment.value = '';
    }
  } catch {
    // 401/403 chỉ là candidate chưa đăng nhập — bỏ qua, không toast.
    myFeedback.value = null;
  }
};

const submitFeedback = async (): Promise<void> => {
  if (!job.value || !isCandidateLoggedIn.value) {
    toast.push({
      variant: 'info',
      title: 'Đăng nhập để đánh giá',
      body: 'Bạn cần đăng nhập với tài khoản ứng viên.',
    });
    void router.push({ name: 'login' });
    return;
  }
  if (feedbackRating.value < 1) {
    toast.push({ variant: 'error', title: 'Vui lòng chọn số sao' });
    return;
  }
  submittingFeedback.value = true;
  try {
    const { data } = await jobApi.createFeedback(job.value.id, {
      rating: feedbackRating.value,
      comment: feedbackComment.value.trim() || null,
    });
    myFeedback.value = data.data;
    // Refetch detail để update feedbacks[] + feedbackStats.
    await fetchDetail();
    toast.push({
      variant: 'success',
      title: isEditingFeedback.value ? 'Đã cập nhật đánh giá' : 'Cảm ơn bạn đã đánh giá',
    });
  } catch (err: unknown) {
    // BE trả 403 NOT_APPLIED nếu candidate chưa apply.
    const status =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { status?: number; data?: { code?: string } } }).response?.status
        : undefined;
    const code =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { code?: string } } }).response?.data?.code
        : undefined;

    if (status === 403 && code === 'NOT_APPLIED') {
      toast.push({
        variant: 'info',
        title: 'Bạn cần ứng tuyển trước',
        body: 'Hãy nộp hồ sơ cho job này rồi quay lại đánh giá nhé.',
      });
    } else {
      toast.push({
        variant: 'error',
        title: 'Không gửi được đánh giá',
        body: 'Vui lòng thử lại sau.',
      });
    }
  } finally {
    submittingFeedback.value = false;
  }
};

const cancelEditFeedback = (): void => {
  feedbackRating.value = myFeedback.value?.rating ?? 0;
  feedbackComment.value = myFeedback.value?.comment ?? '';
};
</script>

<template>
  <div class="min-h-screen bg-gray-50/50 p-5 md:p-8">
    <div class="max-w-6xl mx-auto">
      <!-- ============ Back button ============ -->
      <button
        type="button"
        class="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition"
        @click="goBack"
      >
        <ArrowLeft class="w-4 h-4" /> Quay lại danh sách
      </button>

      <!-- ============ Loading ============ -->
      <div
        v-if="loading && !job"
        class="bg-white rounded-xl border border-gray-200 flex items-center justify-center py-20"
      >
        <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
      </div>

      <!-- ============ Error / Not found ============ -->
      <div
        v-else-if="error || !job"
        class="bg-white rounded-xl border border-gray-200 px-6 py-16 text-center"
      >
        <div class="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
          <AlertCircle class="w-6 h-6 text-red-500" />
        </div>
        <h3 class="text-sm font-semibold text-gray-900">Không tải được chi tiết job</h3>
        <p class="text-xs text-gray-500 mt-1">{{ error ?? 'Job không tồn tại hoặc đã bị đóng.' }}</p>
        <button
          type="button"
          class="mt-4 px-3 py-1.5 text-xs rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition"
          @click="goBack"
        >
          Quay lại
        </button>
      </div>

      <!-- ============ Main content ============ -->
      <template v-else>
        <!-- Header card -->
        <header class="bg-white rounded-xl border border-gray-200 p-6 mb-4">
          <div class="flex items-start gap-4">
            <div
              class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-primary-50 to-primary-100 text-xl font-semibold text-primary-700"
            >
              <img
                v-if="job.companyLogoUrl"
                :src="job.companyLogoUrl"
                :alt="job.companyName ?? ''"
                class="h-full w-full object-cover"
              />
              <span v-else>{{ companyInitial }}</span>
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-start gap-2 flex-wrap">
                <h1 class="text-[21px] md:text-[24px] font-bold text-[#12131A] tracking-tight leading-tight">
                  {{ job.title }}
                </h1>
                <Star
                  v-if="job.featured"
                  class="w-5 h-5 shrink-0 mt-1 fill-yellow-400 text-yellow-400"
                  aria-label="Job nổi bật"
                />
                <!--
                  Save icon ở góc phải tiêu đề — pattern Indeed/LinkedIn/TopCV
                  (icon nho nhỏ ngay cạnh title thay vì nút to chiếm slot chính
                  ở action card). Khi đã lưu → BookmarkCheck + tone primary;
                  pending → Loader2 spin. Đẩy sang `ml-auto` để dồn về mép phải
                  dòng title (group flex-wrap vẫn đứng cùng Star featured).
                -->
                <button
                  type="button"
                  :aria-label="saved ? 'Bỏ lưu job' : 'Lưu job'"
                  :title="saved ? 'Bỏ lưu job' : 'Lưu job'"
                  class="ml-auto shrink-0 mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full border transition disabled:opacity-50 disabled:cursor-not-allowed"
                  :class="saved
                    ? 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100'
                    : 'border-gray-300 bg-white text-gray-500 hover:text-gray-700 hover:bg-gray-50'"
                  :disabled="saving"
                  @click="onSave"
                >
                  <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
                  <BookmarkCheck v-else-if="saved" class="w-4 h-4" />
                  <Bookmark v-else class="w-4 h-4" />
                </button>
              </div>

              <div class="mt-1.5 flex items-center gap-x-4 gap-y-1 flex-wrap text-sm text-gray-600">
                <span v-if="job.companyName" class="inline-flex items-center gap-1">
                  <Building2 class="w-3.5 h-3.5 text-gray-400" />
                  {{ job.companyName }}
                </span>
                <span v-if="locationLine" class="inline-flex items-center gap-1">
                  <MapPin class="w-3.5 h-3.5 text-gray-400" />
                  {{ locationLine }}
                </span>
                <span v-if="job.industry" class="inline-flex items-center gap-1">
                  <Globe2 class="w-3.5 h-3.5 text-gray-400" />
                  {{ job.industry }}
                </span>
              </div>

              <!-- Tag row -->
              <div class="mt-3 flex flex-wrap gap-1.5">
                <span
                  v-if="job.jobLevel"
                  class="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700"
                >
                  <Briefcase class="h-3 w-3" />
                  {{ jobLevelLabel }}
                </span>
                <span
                  v-if="job.jobType"
                  class="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700"
                >
                  <Clock class="h-3 w-3" />
                  {{ jobTypeLabel }}
                </span>
                <span
                  class="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700"
                >
                  <DollarSign class="h-3 w-3" />
                  {{ salaryLabel }}
                </span>
                <span
                  v-if="job.remoteOk"
                  class="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700"
                >
                  Remote OK
                </span>
              </div>

              <hr class="mt-3 border-gray-200" />

              <!-- Meta row -->
              <div class="mt-3 flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-gray-500">
                <span v-if="publishedLabel" class="inline-flex items-center gap-1">
                  <Calendar class="w-3 h-3" />
                  Đăng <b class="font-semibold text-gray-700">{{ publishedLabel }}</b>
                </span>
                <span v-if="deadlineLabel" class="inline-flex items-center gap-1">
                  <Clock class="w-3 h-3" />
                  Hạn nộp <b class="font-semibold text-gray-700">{{ deadlineLabel }}</b>
                </span>
                <span v-if="experienceLabel" class="inline-flex items-center gap-1">
                  <Briefcase class="w-3 h-3" />
                  Kinh nghiệm: <b class="font-semibold text-gray-700">{{ experienceLabel }}</b>
                </span>
                <span class="inline-flex items-center gap-1">
                  <Eye class="w-3 h-3" />
                  <b class="font-semibold text-gray-700">{{ compactNumber(job.viewsCount) }}</b> lượt xem
                </span>
                <span class="inline-flex items-center gap-1">
                  <FileText class="w-3 h-3" />
                  <b class="font-semibold text-gray-700">{{ compactNumber(job.appliesCount) }}</b> ứng viên
                </span>
              </div>
            </div>
          </div>
        </header>

        <!-- 2-col main -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <!-- ============ Left col ============ -->
          <div class="lg:col-span-8 space-y-4">
            <!-- Mô tả -->
            <section class="bg-white rounded-xl border border-gray-200 p-6">
              <header class="flex items-start justify-between gap-3 mb-3">
                <h2
                  class="text-[15px] font-extrabold text-[#12131A] tracking-tight inline-flex items-center gap-2"
                >
                  <FileText class="w-4 h-4 text-[#3B33C7]" />
                  Mô tả công việc
                </h2>
                <button
                  type="button"
                  aria-label="Sao chép mô tả công việc"
                  title="Sao chép nội dung"
                  class="shrink-0 p-1.5 rounded-md text-gray-400 hover:text-[#3B33C7] hover:bg-[#EEEDFB] transition"
                  @click="copySection('description', job.description)"
                >
                  <Check v-if="copiedKey === 'description'" class="w-4 h-4 text-emerald-500" />
                  <Copy v-else class="w-4 h-4" />
                </button>
              </header>
              <p class="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                {{ job.description }}
              </p>
            </section>

            <!-- Yêu cầu -->
            <section
              v-if="job.requirements"
              class="bg-white rounded-xl border border-gray-200 p-6"
            >
              <header class="flex items-start justify-between gap-3 mb-3">
                <h2
                  class="text-[15px] font-extrabold text-[#12131A] tracking-tight inline-flex items-center gap-2"
                >
                  <CheckCircle2 class="w-4 h-4 text-[#3B33C7]" />
                  Yêu cầu ứng viên
                </h2>
                <button
                  type="button"
                  aria-label="Sao chép yêu cầu ứng viên"
                  title="Sao chép nội dung"
                  class="shrink-0 p-1.5 rounded-md text-gray-400 hover:text-[#3B33C7] hover:bg-[#EEEDFB] transition"
                  @click="copySection('requirements', job.requirements)"
                >
                  <Check v-if="copiedKey === 'requirements'" class="w-4 h-4 text-emerald-500" />
                  <Copy v-else class="w-4 h-4" />
                </button>
              </header>
              <p class="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                {{ job.requirements }}
              </p>
            </section>

            <!-- Quyền lợi -->
            <section
              v-if="job.benefits"
              class="bg-white rounded-xl border border-gray-200 p-6"
            >
              <h2
                class="text-[15px] font-extrabold text-[#12131A] mb-3 tracking-tight inline-flex items-center gap-2"
              >
                <DollarSign class="w-4 h-4 text-[#3B33C7]" />
                Quyền lợi
              </h2>
              <p class="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                {{ job.benefits }}
              </p>
            </section>

            <!-- Skills -->
            <section
              v-if="job.requiredSkills?.length || job.niceToHaveSkills?.length"
              class="bg-white rounded-xl border border-gray-200 p-6"
            >
              <h2
                class="text-[15px] font-extrabold text-[#12131A] mb-3 tracking-tight inline-flex items-center gap-2"
              >
                <Briefcase class="w-4 h-4 text-[#3B33C7]" />
                Kỹ năng
              </h2>

              <div v-if="job.requiredSkills?.length" class="mb-3">
                <p class="text-[11px] font-medium uppercase tracking-wide text-gray-500 mb-1.5">
                  Yêu cầu
                </p>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="skill in job.requiredSkills"
                    :key="skill"
                    class="inline-flex items-center rounded-md bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700"
                  >
                    {{ skill }}
                  </span>
                </div>
              </div>

              <div v-if="job.niceToHaveSkills?.length">
                <p class="text-[11px] font-medium uppercase tracking-wide text-gray-500 mb-1.5">
                  Ưu tiên
                </p>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="skill in job.niceToHaveSkills"
                    :key="skill"
                    class="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                  >
                    {{ skill }}
                  </span>
                </div>
              </div>
            </section>

            <!-- Feedback (rating + comment) — styled per mockup.html (amber gradient card) -->
            <section
              class="rounded-2xl border border-[#FBE7B0] p-[22px] bg-[linear-gradient(135deg,#FFFBEB_0%,#FFFFFF_55%)] shadow-[0_1px_2px_rgba(17,18,26,0.04),0_1px_1px_rgba(17,18,26,0.03)]"
            >
              <header class="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <h2
                  class="text-[15px] font-extrabold text-[#92400E] inline-flex items-center gap-2 tracking-tight"
                >
                  <Star class="w-4 h-4 fill-[#F59E0B] text-[#F59E0B]" />
                  Đánh giá từ ứng viên
                </h2>
                <div
                  v-if="job.feedbackStats.count > 0"
                  class="inline-flex items-center gap-1.5 text-xs"
                >
                  <span class="inline-flex items-center gap-0.5 text-[#F59E0B] font-bold">
                    <Star class="w-3.5 h-3.5 fill-[#F59E0B] text-[#F59E0B]" />
                    {{ job.feedbackStats.average }}
                  </span>
                  <span class="text-[#9599A6]">({{ job.feedbackStats.count }} lượt)</span>
                </div>
              </header>

              <!--
                Form đánh giá — chỉ hiện cho candidate đã login. BE sẽ trả 403
                NOT_APPLIED nếu chưa apply → toast hướng dẫn apply trước.
              -->
              <div
                v-if="isCandidateLoggedIn"
                class="border border-[#E6E8F0] rounded-xl p-4 bg-[#FCFCFD] mb-4"
              >
                <!--
                  Notice khi chưa apply CV nào — disable form + giải thích.
                  Backend rule: chỉ candidate đã apply mới rate được.
                -->
                <div
                  v-if="!canRateFeedback"
                  class="mb-3 flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900"
                >
                  <AlertCircle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    Bạn cần <strong>ứng tuyển job này bằng ít nhất 1 CV</strong> trước khi đánh giá.
                  </span>
                </div>
                <p class="text-[11px] font-bold tracking-wider text-[#9599A6] mb-2.5">
                  {{ isEditingFeedback ? 'SỬA ĐÁNH GIÁ CỦA BẠN' : 'CHIA SẺ TRẢI NGHIỆM CỦA BẠN' }}
                </p>
                <!-- Star picker -->
                <div
                  class="flex items-center gap-1.5 mb-3 transition"
                  :class="!canRateFeedback ? 'opacity-50 pointer-events-none' : ''"
                >
                  <button
                    v-for="n in 5"
                    :key="n"
                    type="button"
                    class="p-0 transition hover:scale-110"
                    :aria-label="`${n} sao`"
                    :disabled="!canRateFeedback"
                    @click="feedbackRating = n"
                  >
                    <Star
                      class="w-6 h-6 transition"
                      :class="n <= feedbackRating
                        ? 'fill-[#F59E0B] text-[#F59E0B]'
                        : 'text-[#CBD0DC]'"
                      :stroke-width="1.5"
                    />
                  </button>
                  <span
                    v-if="feedbackRating > 0"
                    class="ml-2 text-xs font-semibold text-[#5B5F6E]"
                  >
                    {{ feedbackRating }}/5
                  </span>
                </div>

                <textarea
                  v-model="feedbackComment"
                  rows="3"
                  maxlength="2000"
                  :disabled="!canRateFeedback"
                  placeholder="Cảm nhận của bạn về quy trình tuyển dụng, môi trường làm việc, JD, v.v."
                  class="w-full text-[13px] font-sans text-[#12131A] placeholder-[#9599A6] border border-[#E6E8F0] rounded-[10px] px-3.5 py-2.5 focus:outline-none focus:border-[#3B33C7] resize-y min-h-[64px] disabled:bg-gray-50 disabled:cursor-not-allowed"
                />

                <div class="mt-2.5 flex items-center justify-between gap-2.5 flex-wrap">
                  <p class="text-[11px] text-[#9599A6]">
                    Bạn chỉ có thể gửi 1 đánh giá cho job này — có thể chỉnh sửa sau.
                  </p>
                  <div class="flex items-center gap-2 shrink-0">
                    <button
                      v-if="isEditingFeedback"
                      type="button"
                      class="px-3 py-1.5 text-[12.5px] font-semibold rounded-lg border border-[#E6E8F0] bg-white text-[#5B5F6E] hover:bg-[#F1F2F6] transition"
                      :disabled="submittingFeedback"
                      @click="cancelEditFeedback"
                    >
                      Huỷ
                    </button>
                    <button
                      type="button"
                      class="inline-flex items-center gap-1.5 px-[18px] py-2 text-[12.5px] font-bold rounded-lg bg-[#3B33C7] hover:bg-[#2A2494] text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                      :disabled="submittingFeedback || feedbackRating < 1 || !canRateFeedback"
                      :title="!canRateFeedback
                        ? 'Bạn cần ứng tuyển job này (bằng ít nhất 1 CV) trước khi đánh giá'
                        : (isEditingFeedback ? 'Cập nhật đánh giá' : 'Gửi đánh giá')"
                      @click="submitFeedback"
                    >
                      <Loader2 v-if="submittingFeedback" class="w-3.5 h-3.5 animate-spin" />
                      {{ submittingFeedback
                        ? 'Đang gửi...'
                        : (isEditingFeedback ? 'Cập nhật' : 'Gửi đánh giá') }}
                    </button>
                  </div>
                </div>
              </div>

              <!-- Empty state -->
              <div
                v-if="job.feedbacks.length === 0"
                class="flex flex-col items-center text-center py-5 text-[#9599A6]"
              >
                <Star class="w-[30px] h-[30px] mb-2.5 text-[#E4C876]" :stroke-width="1.6" />
                <div class="text-[13px] font-bold text-[#5B5F6E] mb-0.5">
                  Hãy là người đầu tiên đánh giá
                </div>
                <div class="text-[12px]">
                  Chia sẻ trải nghiệm để giúp ứng viên khác cân nhắc.
                </div>
              </div>

              <!-- List feedback -->
              <div v-else class="space-y-3">
                <article
                  v-for="fb in job.feedbacks"
                  :key="fb.id"
                  class="rounded-lg border p-4 transition"
                  :class="fb.isMine
                    ? 'border-[#3B33C7]/40 bg-[#EEEDFB]/40'
                    : 'border-[#E6E8F0] bg-white'"
                >
                  <header class="flex items-start justify-between gap-3 mb-2">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <p class="text-sm font-semibold text-[#12131A] truncate">
                          {{ fb.candidateName ?? 'Ứng viên ẩn danh' }}
                        </p>
                        <span
                          v-if="fb.isMine"
                          class="text-[10px] font-bold text-[#3B33C7] bg-[#EEEDFB] rounded-full px-2 py-0.5"
                        >
                          Đánh giá của bạn
                        </span>
                      </div>
                      <p class="text-[11px] text-[#9599A6] mt-0.5">
                        {{ dayjs(fb.createdAt).format('DD/MM/YYYY') }}
                      </p>
                    </div>
                    <!-- Star display (read-only) -->
                    <div class="inline-flex items-center gap-0.5 shrink-0">
                      <Star
                        v-for="n in 5"
                        :key="n"
                        class="w-3.5 h-3.5"
                        :class="n <= fb.rating
                          ? 'fill-[#F59E0B] text-[#F59E0B]'
                          : 'text-[#CBD0DC]'"
                      />
                    </div>
                  </header>
                  <p
                    v-if="fb.comment"
                    class="text-sm text-[#5B5F6E] whitespace-pre-line leading-[1.7]"
                  >
                    {{ fb.comment }}
                  </p>
                  <p v-else class="text-xs italic text-[#9599A6]">
                    (Không có nhận xét)
                  </p>
                </article>
              </div>
            </section>
          </div>

          <!-- ============ Right col (sticky) ============ -->
          <aside class="lg:col-span-4 space-y-4">
            <div class="lg:sticky lg:top-4 space-y-4">
              <!-- Action card — Apply + Save + Share trên 1 hàng -->
              <div class="bg-white rounded-xl border border-gray-200 p-5">
                <div class="flex items-stretch gap-2">
                  <button
                    type="button"
                    class="flex-1 px-3 py-2.5 text-sm font-semibold rounded-lg transition inline-flex items-center justify-center gap-2 bg-gray-900 text-white hover:bg-gray-800"
                    @click="onApply"
                  >
                    <Send class="w-4 h-4" />
                    Ứng tuyển ngay
                  </button>
                  <!--
                    Quick-chat button — chỉ hiện cho candidate login + job có
                    postedBy. Click → toggle `chatOpen` → hiện composer nhỏ
                    bên dưới để nhắn nhanh cho nhà tuyển dụng.
                    Save icon đã được đưa lên title row ở header (pattern
                    Indeed/LinkedIn); không render ở đây nữa để action row
                    gọn lại — chỉ Apply (chính) + Chat + Share.
                  -->
                  <button
                    v-if="isCandidateLoggedIn && job.postedBy"
                    type="button"
                    :aria-label="chatOpen ? 'Đóng chat nhà tuyển dụng' : 'Mở chat nhà tuyển dụng'"
                    :title="chatOpen ? 'Đóng chat' : 'Nhắn nhanh cho nhà tuyển dụng'"
                    class="shrink-0 w-10 h-auto rounded-lg border transition inline-flex items-center justify-center"
                    :class="chatOpen
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-300 bg-white text-gray-500 hover:text-gray-700 hover:bg-gray-50'"
                    @click="toggleChat"
                  >
                    <MessageCircle class="w-4 h-4" />
                  </button>
                  <div
                    role="button"
                    tabindex="0"
                    aria-label="Chia sẻ job này"
                    title="Chia sẻ job này"
                    class="shrink-0 w-10 h-auto rounded-lg border border-gray-300 bg-white text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition inline-flex items-center justify-center cursor-pointer select-none"
                    @click="onShare"
                    @keydown.enter.prevent="onShare"
                    @keydown.space.prevent="onShare"
                  >
                    <Share2 class="w-4 h-4" />
                  </div>
                </div>

                <!--
                  Mini chat composer — hiện dưới action row khi user click
                  chat icon. Không phải full chat panel (chỉ 1 ô input + gửi);
                  user mở /messages để xem full history.

                  Phase 1 attachments: thumbnail preview + nút upload ảnh
                  (ImagePlus) bên cạnh textarea. Paste từ clipboard cũng
                  được (handler gắn trên textarea).
                -->
                <div
                  v-if="chatOpen"
                  class="mt-3 pt-3 border-t border-gray-100"
                >
                  <!-- Preview cho file/ảnh pending upload: ảnh → thumbnail, file → card -->
                  <div v-if="chatAttachments.length > 0" class="flex flex-wrap gap-1.5 mb-2">
                    <div
                      v-for="att in chatAttachments"
                      :key="att.id"
                      class="relative rounded-md overflow-hidden border border-gray-200 group"
                      :class="att.kind === 'image' ? 'h-12 w-12' : 'h-12 min-w-[160px] max-w-[200px] px-2 py-1 bg-gray-50'"
                    >
                      <template v-if="att.kind === 'image' && att.previewUrl">
                        <img
                          :src="att.previewUrl"
                          :alt="att.file.name"
                          class="h-full w-full object-cover"
                        />
                      </template>
                      <template v-else>
                        <div class="flex items-center gap-1.5 h-full min-w-0">
                          <component
                            :is="fileIconInfo(att.file.type, att.file.name).icon"
                            class="w-3.5 h-3.5 shrink-0"
                            :class="fileIconInfo(att.file.type, att.file.name).color"
                          />
                          <span class="text-[10px] font-medium text-gray-800 truncate flex-1 min-w-0">
                            {{ att.file.name }}
                          </span>
                          <span class="text-[9px] text-gray-500 shrink-0">
                            {{ formatFileSize(att.file.size) }}
                          </span>
                        </div>
                      </template>
                      <button
                        type="button"
                        aria-label="Xoá file"
                        title="Xoá"
                        class="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                        @click="removeMiniAttachment(att.id)"
                      >
                        <X class="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>
                  <div class="flex items-start gap-1.5">
                    <button
                      type="button"
                      :disabled="chatSending || uploadingImage"
                      aria-label="Đính kèm file"
                      title="Đính kèm file (ảnh/PDF/DOCX/...) hoặc paste từ clipboard"
                      class="shrink-0 w-9 h-9 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transition"
                      @click="onMiniPickFile"
                    >
                      <ImagePlus class="w-3.5 h-3.5" />
                    </button>
                    <input
                      ref="miniFileInputEl"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv,application/zip"
                      multiple
                      class="hidden"
                      @change="onMiniFileInputChange"
                    />
                    <textarea
                      v-model="chatDraft"
                      :disabled="chatSending || uploadingImage"
                      :maxlength="500"
                      rows="2"
                      placeholder="Nhắn nhanh cho nhà tuyển dụng... (có thể paste ảnh)"
                      class="flex-1 text-xs border border-gray-300 rounded-lg px-2.5 py-2 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none resize-none disabled:opacity-50 disabled:bg-gray-50"
                      @keydown.enter.exact.prevent="sendChat"
                      @paste="onMiniPaste"
                    />
                    <button
                      type="button"
                      aria-label="Gửi tin nhắn"
                      title="Gửi (Enter)"
                      class="shrink-0 inline-flex items-center justify-center gap-1 px-2.5 py-2 text-xs font-semibold rounded-lg bg-primary-600 hover:bg-primary-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                      :disabled="chatSending || uploadingImage || (!chatDraft.trim() && chatAttachments.length === 0)"
                      @click="sendChat"
                    >
                      <Loader2 v-if="chatSending || uploadingImage" class="w-3.5 h-3.5 animate-spin" />
                      <Send v-else class="w-3.5 h-3.5" />
                      Gửi
                    </button>
                  </div>
                  <p class="mt-1 text-[10px] text-gray-400 text-right">
                    {{ chatDraft.length }}/500 · Enter để gửi
                  </p>
                </div>

                <!--
                  Danh sách CV đã ứng tuyển (1 entry/CV). Mỗi dòng click để mở
                  chi tiết đơn trong /candidate/applications. Hiển thị điểm AI
                  match nếu đã chấm; "Đang chấm" nếu worker chưa xong; "Chưa
                  chấm được" nếu worker fail.
                -->
                <div
                  v-if="isCandidateLoggedIn && applicationList.length > 0"
                  class="mt-4 pt-4 border-t border-gray-100"
                >
                  <p class="text-xs font-semibold text-gray-700 inline-flex items-center gap-1.5 mb-2">
                    <FileText class="w-3.5 h-3.5" />
                    CV đã ứng tuyển ({{ applicationList.length }})
                  </p>
                  <ul class="space-y-1.5">
                    <li
                      v-for="app in applicationList"
                      :key="app.applicationId"
                    >
                      <button
                        type="button"
                        class="w-full flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-2.5 py-2 hover:border-[#E9DDFD] hover:bg-[#F4EEFE] transition text-left"
                        :title="`Xem chi tiết đơn ${app.applicationId}`"
                        @click="goToMyApplication(app.applicationId)"
                      >
                        <span class="min-w-0 flex-1">
                          <span class="block text-xs font-medium text-gray-900 truncate">
                            {{ app.cvTitle ?? '(CV đã xoá)' }}
                          </span>
                          <span class="block text-[10px] text-gray-500 mt-0.5">
                            {{ formatAppliedStatus(app.status) }} · {{ dayjs(app.appliedAt).fromNow() }}
                          </span>
                        </span>
                        <span class="shrink-0 inline-flex items-center gap-1">
                          <template v-if="app.aiMatchScore != null">
                            <Sparkles class="w-3 h-3 text-[#6D28D9]" />
                            <b class="text-sm font-extrabold text-[#6D28D9]">
                              {{ app.aiMatchScore }}
                            </b>
                            <span class="text-[10px] font-semibold text-[#6D28D9]/70">/100</span>
                          </template>
                          <template v-else-if="app.aiMatchReason == null && !['hired', 'rejected', 'withdrawn'].includes(app.status)">
                            <Loader2 class="w-3 h-3 animate-spin text-gray-400" />
                            <span class="text-[10px] text-gray-500">Chấm...</span>
                          </template>
                          <template v-else-if="app.aiMatchReason === 'quota_exceeded' || app.aiMatchReason === 'failed'">
                            <AlertCircle class="w-3 h-3 text-amber-500" />
                            <span class="text-[10px] text-amber-600">Lỗi</span>
                          </template>
                        </span>
                      </button>
                    </li>
                  </ul>
                </div>
              </div>

              <!-- Company card -->
              <div class="bg-white rounded-xl border border-gray-200 p-5">
                <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                  Thông tin công ty
                </h3>
                <div class="flex items-center gap-3">
                  <div
                    class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-primary-50 to-primary-100 text-sm font-semibold text-primary-700"
                  >
                    <img
                      v-if="job.companyLogoUrl"
                      :src="job.companyLogoUrl"
                      :alt="job.companyName ?? ''"
                      class="h-full w-full object-cover"
                    />
                    <span v-else>{{ companyInitial }}</span>
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold text-gray-900 truncate">
                      {{ job.companyName ?? 'Công ty ẩn danh' }}
                    </p>
                    <p v-if="job.industry" class="text-xs text-gray-500 truncate">
                      {{ job.industry }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Job overview stats -->
              <div class="bg-white rounded-xl border border-gray-200 p-5 space-y-2.5">
                <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Tổng quan
                </h3>
                <div class="flex items-center justify-between text-xs">
                  <span class="text-gray-500 inline-flex items-center gap-1.5">
                    <Eye class="w-3.5 h-3.5" /> Lượt xem
                  </span>
                  <span class="font-medium text-gray-900">{{ compactNumber(job.viewsCount) }}</span>
                </div>
                <div class="flex items-center justify-between text-xs">
                  <span class="text-gray-500 inline-flex items-center gap-1.5">
                    <FileText class="w-3.5 h-3.5" /> Ứng viên
                  </span>
                  <span class="font-medium text-gray-900">{{ compactNumber(job.appliesCount) }}</span>
                </div>
                <div v-if="publishedLabel" class="flex items-center justify-between text-xs">
                  <span class="text-gray-500 inline-flex items-center gap-1.5">
                    <Calendar class="w-3.5 h-3.5" /> Ngày đăng
                  </span>
                  <span class="font-medium text-gray-900">{{ publishedLabel }}</span>
                </div>
                <div v-if="deadlineLabel" class="flex items-center justify-between text-xs">
                  <span class="text-gray-500 inline-flex items-center gap-1.5">
                    <Clock class="w-3.5 h-3.5" /> Hạn nộp
                  </span>
                  <span class="font-medium text-gray-900">{{ deadlineLabel }}</span>
                </div>
                <div class="flex items-center justify-between text-xs">
                  <span class="text-gray-500 inline-flex items-center gap-1.5">
                    <Star class="w-3.5 h-3.5" /> Đánh giá
                  </span>
                  <span class="inline-flex items-center gap-1 font-medium text-gray-900">
                    <template v-if="job.feedbackStats.count > 0">
                      <Star class="w-3 h-3 fill-amber-400 text-amber-400" />
                      {{ job.feedbackStats.average }}
                      <span class="text-gray-500 font-normal">({{ job.feedbackStats.count }})</span>
                    </template>
                    <template v-else>Chưa có</template>
                  </span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </template>
    </div>

    <!-- Apply modal -->
    <ApplyJob
      v-if="job"
      :job="job"
      :applied-cv-ids="appliedCvIds"
      v-model:open="applyModalOpen"
      @applied="onApplied"
    />
  </div>
</template>