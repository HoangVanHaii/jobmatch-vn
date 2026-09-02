<script setup lang="ts">
/**
 * App.vue — root layout.
 *
 * Components global (luôn mount khi user login):
 *   - <RouterView />          : page chính
 *   - <NotificationBell />    : chuông + dropdown notification (đăng ký socket
 *                               `notification:new` để real-time update badge).
 *   - <ToastHost />           : global toast queue (peer chat realtime khi user
 *                               ở ngoài /chat).
 *
 * Global socket listeners:
 *   - `chat:new`  ← đăng ký TẠI ĐÂY (không phải ChatView) để hoạt động đúng
 *     khi user ở trang khác (chatbot, profile, ...). Hành vi:
 *       1. Luôn `chatStore.handleChatNew(payload)` — cập nhật sidebar +
 *          unread badge cho cache local. Idempotent.
 *       2. Nếu user KHÔNG ở `/chat*` → đẩy toast (peer name + preview +
 *          click → navigate tới /chat/:id).
 *       3. Nếu user ĐANG ở `/chat*` → sidebar update là đủ (họ đã thấy
 *          conv reorder + badge); tránh toast redundant.
 *
 *   Lưu ý: ChatView KHÔNG đăng ký `chat:new` nữa để khỏi duplicate
 *   (handleChatNew được gọi 2 lần — không sai nhưng tốn công vô ích).
 *
 *   - `notification:new` ← NotificationBell tự lo.
 */
import { RouterView, useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@stores/auth';
import { useChatStore } from '@stores/chat';
import { useEmployerJobStore } from '@stores/employerJob';
import { useToastStore } from '@stores/toast';
import { useSocket } from '@composables/useSocket';
import NotificationBell from '@components/notify/NotificationBell.vue';
import ToastHost from '@components/common/ToastHost.vue';
import type { ChatNewPayload } from '@/types/chat';

const auth = useAuthStore();
const chat = useChatStore();
const employerJobStore = useEmployerJobStore();
const toast = useToastStore();
const route = useRoute();
const router = useRouter();

/**
 * Global `chat:new` listener — đăng ký ở App.vue nên luôn sống cùng app.
 * useSocket auto-cleanup khi App unmount (chỉ xảy ra khi logout/refresh).
 */
useSocket('chat:new', (payload: ChatNewPayload) => {
  // 1. Update sidebar cache (unread + sort) — chạy ở mọi trang.
  chat.handleChatNew(payload);

  // 2. Toast CHỈ khi user KHÔNG ở /chat namespace — tránh spam trên trang
  //    chat (sidebar update đã là indicator đủ rõ).
  const onChatPage = route.path.startsWith('/chat');
  if (onChatPage) return;

  // Look up peer info từ chat store — nếu conversation chưa có trong cache
  // (vd user vừa mới nhận tin từ người lạ, hoặc sidebar chưa fetch) → fallback
  // title generic.
  const peer = chat.conversations.find((c) => c.id === payload.conversationId)?.peer;

  // Tự navigate về /chat theo role (giống ChatView.onSelect).
  const chatRouteName = auth.user?.role === 'candidate' ? 'chat' : 'e-chat';
  const goToChat = (): void => {
    void router.push({ name: chatRouteName, params: { id: payload.conversationId } });
  };

  toast.push({
    // Dedupe key — cùng conversationId + messageId chỉ hiện 1 toast.
    id: `${payload.conversationId}:${payload.lastMessage.id}`,
    variant: 'chat',
    title: peer?.fullName ?? 'Tin nhắn mới',
    body: payload.lastMessage.content,
    avatarUrl: peer?.avatarUrl ?? null,
    onClick: goToChat,
    action: { label: 'Mở', onClick: goToChat },
  });
});

/**
 * `job_scan_complete` — realtime push từ jobModeration.worker.ts khi AI scan xong
 * (verdict từ LLM trả về, hoặc bị skip do hết quota).
 *
 * Backend emit tới room `user:${postedBy}` (xem notificationGateway.emitToUser) —
 * candidate không bao giờ nhận event này (chỉ chủ job). Vẫn gate theo role để
 * chắc chắn không lộ toast lạ.
 *
 * Hành vi:
 *  - LUÔN hiện toast (user có thể đang ở /candidate, /pricing, ...).
 *  - Nếu user đang ở trang `/employer/jobs` → refetch list store để status
 *    badge trên các job tự đổi từ "AI đang quét" → "Đang hiển thị" / "Bị gắn cờ".
 *  - JobDetailView có listener LOCAL riêng (xem views/employer/JobDetailView.vue)
 *    chỉ update khi đang ở đúng trang detail đó — listener global này CHỈ lo
 *    toast + listing, không can thiệp state detail view (tránh double-fetch).
 *
 * Payload (xem backend/src/jobs/jobModeration.worker.ts:45 và 110):
 *   { jobId, verdict, score, flaggedCount, reason? }
 *   verdict: 'approved' | 'flagged' | 'skipped'
 *   reason (chỉ khi verdict='skipped'): 'quota_exceeded' | undefined
 */
useSocket(
  'job_scan_complete',
  (payload: {
    jobId: string;
    verdict: 'approved' | 'flagged' | 'skipped' | string;
    score?: number;
    flaggedCount?: number;
    reason?: 'quota_exceeded' | string;
  }): void => {
    // Gate an toàn — chỉ employer mới là chủ job.
    if (auth.user?.role !== 'employer') return;

    // Lấy title từ employer store nếu cache có — tránh phải gọi GET /jobs/:id.
    const cached = employerJobStore.items.find((j) => j.id === payload.jobId);
    const jobTitle = cached?.title ?? 'Job của bạn';

    // Dedupe id — cùng jobId + verdict chỉ hiện 1 toast (worker có thể retry,
    // scan_complete có thể emit lại nếu user đăng nhập 2 tab).
    const dedupeId = `job-scan:${payload.jobId}:${payload.verdict}:${payload.score ?? 0}`;

    // Build message theo verdict.
    let variant: 'success' | 'error' | 'info' = 'info';
    let title = 'AI scan hoàn tất';
    let body = '';
    if (payload.verdict === 'approved') {
      variant = 'success';
      body = `Job "${jobTitle}" đã được AI duyệt và hiển thị cho ứng viên.`;
    } else if (payload.verdict === 'flagged') {
      variant = 'error';
      body = `Job "${jobTitle}" bị AI gắn cờ (${payload.flaggedCount ?? 0} vấn đề). Sửa nội dung rồi gửi lại.`;
    } else if (payload.verdict === 'skipped') {
      // Quota hết → worker skip moderation, job tự live. Không phải lỗi.
      variant = 'info';
      title = 'Job đã được đăng';
      body = payload.reason === 'quota_exceeded'
        ? `Hết lượt AI scan — job "${jobTitle}" tự động live.`
        : `Job "${jobTitle}" đã được đăng.`;
    } else {
      // verdict unknown (defensive — backend thêm enum mới chưa kịp update FE).
      body = `Job "${jobTitle}" vừa được AI xử lý (verdict: ${String(payload.verdict)}).`;
    }

    const goToDetail = (): void => {
      void router.push(`/employer/jobs/${payload.jobId}`);
    };

    toast.push({
      id: dedupeId,
      variant,
      title,
      body,
      onClick: goToDetail,
      action: { label: 'Mở', onClick: goToDetail },
      // Toast scan thành công / lỗi → để 7s thay vì 5s để user đọc verdict.
      dismissAfterMs: 7000,
    });

    // Nếu user đang ở trang listing → refetch để status badge cập nhật
    // (vd "AI đang quét" → "Đang hiển thị" / "Bị gắn cờ"). Không xung đột
    // với listener local của JobDetailView vì user chỉ ở 1 trang tại 1 thời điểm.
    if (route.path === '/employer/jobs') {
      void employerJobStore.fetchList();
    }
  },
);
</script>

<template>
  <RouterView />
  <NotificationBell />
  <ToastHost />
</template>
