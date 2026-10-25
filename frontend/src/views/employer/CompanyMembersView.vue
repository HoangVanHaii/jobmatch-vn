<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  AlertCircle,
  Building2,
  Crown,
  Loader2,
  LogOut,
  MailPlus,
  RefreshCw,
  Trash2,
  User as UserIcon,
  UserPlus,
  Users,
  X,
} from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { useCompanyStore } from '@stores/company';
import { useCompanyMemberStore } from '@stores/companyMember';
import { useAuthStore } from '@stores/auth';
import { useToastStore } from '@stores/toast';
import { useSocket } from '@composables/useSocket';
import ConfirmModal from '@components/common/ConfirmModal.vue';
import { formatDate } from '@/utils/format';
import type {
  CompanyMember,
  CompanyMemberRole,
  CompanyMemberStatus,
} from '@/types/companyMember';

/* ============================================================================
 * Stores
 * ==========================================================================*/
const route = useRoute();
const router = useRouter();
const companyStore = useCompanyStore();
const { current: company } = storeToRefs(companyStore);
const memberStore = useCompanyMemberStore();
const auth = useAuthStore();
const toast = useToastStore();

/* ============================================================================
 * State
 * ==========================================================================*/
type LoadState = 'loading' | 'no-company' | 'ready';
const loadState = ref<LoadState>('loading');
const companyId = ref<string | null>(null);
const loadError = ref<string | null>(null);
const inviteOpen = ref(false);
const transferTarget = ref<CompanyMember | null>(null);
/** Row sắp được xoá (mở ConfirmModal trước khi gọi API thật). */
const removeTarget = ref<CompanyMember | null>(null);
const removeSaving = ref(false);

/* ============================================================================
 * Lifecycle
 * ==========================================================================*/
/**
 * Hard ceiling cho tổng thời gian loadData. Nếu vượt quá (vd BE /companies/:id
 * treo do `withLiveJobs` chạy query chậm, hoặc network issue), force chuyển
 * sang ready state để UI không kẹt ở skeleton mãi — user thấy banner lỗi +
 * nút "Thử lại" thay vì spinner vô hạn.
 */
const LOAD_HARD_TIMEOUT_MS = 15_000;

/** Chống race: chỉ lần loadData() mới nhất được ghi state. */
let loadDataSeq = 0;
let loadTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

const loadData = async (): Promise<void> => {
  const seq = ++loadDataSeq;
  loadState.value = 'loading';
  loadError.value = null;
  // Chỉ reset members cache — KHÔNG reset company store vì trang
  // /employer/company (CompanyProfilePage) dùng chung state đó.
  memberStore.reset();

  // Safety timer: nếu API treo quá LOAD_HARD_TIMEOUT_MS, force ready để
  // UI hiện banner lỗi + "Thử lại" thay vì spinner vô hạn.
  if (loadTimeoutTimer) clearTimeout(loadTimeoutTimer);
  loadTimeoutTimer = setTimeout(() => {
    if (seq === loadDataSeq && loadState.value === 'loading') {
      loadError.value = 'Tải dữ liệu lâu hơn dự kiến — bạn có thể thử lại.';
      loadState.value = 'ready';
    }
  }, LOAD_HARD_TIMEOUT_MS);

  try {
    // Qua store (fetchCompany): phân biệt "chưa có công ty" (companyNotFound)
    // với lỗi tải thật (companyLoadError) — không gộp chung.
    const okCompany = await companyStore.fetchCompany();
    if (seq !== loadDataSeq) return;
    if (companyStore.companyNotFound) {
      companyId.value = null;
      loadState.value = 'no-company';
      return;
    }
    if (!okCompany || !company.value) {
      loadError.value = companyStore.companyLoadError ?? 'Không thể tải dữ liệu công ty.';
      loadState.value = 'ready';
      return;
    }
    companyId.value = company.value.id;
    await memberStore.fetchList(companyId.value);
    if (seq !== loadDataSeq) return;
    if (memberStore.error) loadError.value = memberStore.error;
    membersLoadedOnce = true;
    loadState.value = 'ready';
  } catch (e) {
    console.error('[CompanyMembersView.loadData] error:', e);
    if (seq === loadDataSeq) {
      loadError.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra.';
      loadState.value = 'ready';
    }
  } finally {
    if (seq === loadDataSeq && loadTimeoutTimer) {
      clearTimeout(loadTimeoutTimer);
      loadTimeoutTimer = null;
    }
  }
};

onMounted(() => {
  void loadData();
});

onBeforeUnmount(() => {
  if (loadTimeoutTimer) clearTimeout(loadTimeoutTimer);
  if (reloadTimer !== null) clearTimeout(reloadTimer);
});

/**
 * Realtime: refetch members list khi có bất kỳ thay đổi nào liên quan đến
 * membership của company hiện tại. Các kind được handle:
 *
 *   - `company_invite_accepted`        (user accept → status pending → active)
 *   - `company_invite_declined`       (user decline → status pending → declined)
 *   - `removed_from_company`         (owner xoá member active → user bị xoá)
 *   - `invite_cancelled`             (owner huỷ invite pending)
 *   - `company_member_left`           (member tự rời)
 *   - `company_owner_transferred`     (owner transfer — các member còn lại)
 *   - `company_owner_transferred_to_you`  (chính mình được promote — không
 *                                          cần thiết cho FE này nhưng cũng
 *                                          reload để role hiển thị đúng)
 *
 * Tất cả đều trigger refetch → list + role badges luôn consistent với DB.
 * Filter theo `payload.companyId === companyId.value` để không refetch
 * nhầm khi user đang ở CompanyView khác.
 *
 * Đặc biệt với `removed_from_company` / `invite_cancelled` / `company_member_left`:
 * nếu
 * current user là người bị ảnh hưởng (bị xoá hoặc tự rời), navigate họ
 * ra khỏi trang members → `/employer/company` để thấy empty state + modal
 * tạo công ty. Không navigate nếu user chỉ là người xem (affected ≠ current).
 */
let membersLoadedOnce = false;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Refetch members + kiểm tra current user còn active không.
 * Nếu không (bị xoá / tự rời) → refresh company context rồi đẩy về
 * /employer/company để thấy state 'no-company'.
 */
const reloadMembersAndCheck = async (): Promise<void> => {
  if (!companyId.value) return;
  await memberStore.fetchList(companyId.value);
  const me = currentUserMember.value;
  if (!me || me.status !== 'active') {
    await companyStore.fetchCompany();
    if (route.name !== 'employer-company') {
      await router.push({ name: 'employer-company' });
    }
  }
};

/** Debounce: nhiều socket event dồn → chỉ 1 fetch sau 300ms. */
const onMembershipChange = (payloadCompanyId: string): void => {
  if (!companyId.value || payloadCompanyId !== companyId.value) return;
  if (reloadTimer !== null) return;
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    void reloadMembersAndCheck();
  }, 300);
};

useSocket('notification:new', (n: unknown) => {
  const notif = n as {
    type?: string;
    payload?: { kind?: string; companyId?: string };
  };
  const reloadKinds = new Set([
    'company_invite_accepted',
    'company_invite_declined',
    // User thực sự decline — row chuyển sang 'declined'.
    // Tách riêng với auto-cancelled (xem dưới) — khác về ngữ nghĩa.
    'company_invite_auto_cancelled',
    // User bị xoá khỏi company (case soft delete active row).
    'removed_from_company',
    // Invite pending bị owner huỷ (case soft delete pending row).
    'invite_cancelled',
    'company_member_left',
    'company_owner_transferred',
    'company_owner_transferred_to_you',
    'company_owner_transferred_from_you',
    // userA tạo company mới → các pending invite của userA ở company khác
    // bị auto-cancel → inviter (owner) nhận kind này và cần reload list.
    'invite_auto_cancelled_on_create_company',
  ]);
  // Sau refactor 0032: company-member lifecycle đi qua type='company' + kind.
  // Vẫn accept type='system' cho rows cũ chưa migrate; cùng một handler.
  if (
    (notif?.type === 'system' || notif?.type === 'company') &&
    notif.payload?.kind &&
    reloadKinds.has(notif.payload.kind) &&
    notif.payload?.companyId
  ) {
    onMembershipChange(notif.payload.companyId);
  }
});

/** Mất kết nối rồi nối lại → refetch một lần (bỏ qua lần connect đầu). */
useSocket('connect', () => {
  if (membersLoadedOnce && loadState.value === 'ready') {
    onMembershipChange(companyId.value ?? '');
  }
});

/* ============================================================================
 * Helpers — derive từ store + auth
 * ==========================================================================*/
/** Members của company hiện tại (cached ở store). */
const members = computed<CompanyMember[]>(() =>
  companyId.value ? memberStore.getMembers(companyId.value) : [],
);

/** Member row của current user (nếu có). */
const currentUserMember = computed<CompanyMember | null>(() => {
  const uid = auth.user?.id;
  if (!uid) return null;
  return members.value.find((m) => m.userId === uid) ?? null;
});

/** Current user là owner active? */
const isCurrentUserOwner = computed<boolean>(() => {
  const m = currentUserMember.value;
  return !!m && m.role === 'owner' && m.status === 'active';
});

/* ============================================================================
 * Modals
 * ==========================================================================*/
/* ---------- Invite modal ---------- */
const inviteEmail = ref('');
const inviteRole = ref<CompanyMemberRole>('member');
const inviteSaving = ref(false);
const inviteError = ref<string | null>(null);

/**
 * Validate email format — không quá strict (regex native HTML5 email type
 * đã check basic), chỉ bắt buộc có @ và . sau @. Match với Zod schema ở BE
 * (z.string().email()).
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inviteEmailEl = ref<HTMLInputElement | null>(null);
let inviteReturnFocusEl: HTMLElement | null = null;

const openInvite = (): void => {
  inviteEmail.value = '';
  inviteRole.value = 'member';
  inviteError.value = null;
  inviteReturnFocusEl = document.activeElement as HTMLElement | null;
  inviteOpen.value = true;
  void nextTick(() => inviteEmailEl.value?.focus());
};
const closeInvite = (): void => {
  if (inviteSaving.value) return;
  inviteOpen.value = false;
  inviteReturnFocusEl?.focus();
  inviteReturnFocusEl = null;
};

/** Khóa cuộn nền khi modal mở. */
watch(inviteOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : '';
});

const submitInvite = async (): Promise<void> => {
  if (inviteSaving.value) return; // guard double-submit
  inviteError.value = null;
  const email = inviteEmail.value.trim().toLowerCase();
  if (!email) {
    inviteError.value = 'Vui lòng nhập email.';
    return;
  }
  if (!EMAIL_REGEX.test(email)) {
    inviteError.value = 'Email không hợp lệ.';
    return;
  }
  if (!companyId.value) {
    inviteError.value = 'Không xác định được công ty.';
    return;
  }

  inviteSaving.value = true;
  try {
    const result = await memberStore.add(companyId.value, {
      email,
      role: inviteRole.value,
    });
    if (result) {
      toast.success(`Đã gửi lời mời tới ${email}.`);
      inviteOpen.value = false;
      // Reload full list để lấy user info (fullName/avatarUrl) của invite mới.
      // Store `add()` chỉ append raw CompanyMember row (không có JOIN user) →
      // UI sẽ hiển thị "User không xác định" nếu không refetch.
      await memberStore.fetchList(companyId.value);
    } else {
      inviteError.value = friendlyInviteError(memberStore.error) ?? 'Không thể gửi lời mời.';
    }
  } catch (e) {
    inviteError.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra.';
  } finally {
    inviteSaving.value = false;
  }
};

/**
 * Map mã lỗi backend → message thân thiện (ưu tiên Tiếng Việt, fallback message gốc).
 *
 * Sau khi http.ts unwrap BE error → HttpError có `.code` và `.message`. Hiện tại
 * BE messages đã là Tiếng Việt thân thiện, nên mapping chủ yếu là **fallback**
 * cho những code BE chưa customize message.
 *
 * Tương thích ngược: vẫn accept string message (substring match) phòng trường hợp
 * store chỉ lưu string (vd các store chưa update sang HttpError).
 */
const friendlyInviteError = (raw: string | null): string => {
  if (!raw) return 'Đã có lỗi xảy ra.';
  const upper = raw.toUpperCase();
  if (upper.includes('USER_NOT_FOUND')) return 'Email chưa đăng ký tài khoản trên JobMatch.';
  if (upper.includes('MEMBER_EXISTS')) return 'Người dùng này đã thuộc công ty.';
  if (upper.includes('ALREADY_IN_COMPANY')) return 'Người dùng này đang thuộc một công ty khác.';
  if (upper.includes('USER_ACTIVE_ELSEWHERE')) {
    return 'Người dùng này đang là thành viên active của công ty khác. Họ cần rời trước khi có thể nhận lời mời mới.';
  }
  if (upper.includes('USER_NOT_EMPLOYER')) {
    return 'Email này thuộc tài khoản ứng viên. Chỉ tài khoản nhà tuyển dụng mới có thể tham gia công ty.';
  }
  if (upper.includes('USER_NOT_ACTIVE')) {
    return 'Tài khoản chưa kích hoạt hoặc đang bị tạm khoá — không thể tham gia công ty.';
  }
  if (upper.includes('ALREADY_PENDING')) return 'Đã có lời mời đang chờ user này phản hồi.';
  if (upper.includes('ALREADY_ACTIVE')) return 'Người dùng này đã là thành viên active của công ty.';
  if (upper.includes('CANNOT_INVITE_SELF')) return 'Bạn không thể tự mời chính mình.';
  if (upper.includes('CANNOT_REMOVE_OWNER')) return 'Không thể xoá owner duy nhất của công ty. Hãy chuyển quyền sở hữu trước.';
  if (upper.includes('VALIDATION')) return 'Thông tin không hợp lệ.';
  if (upper.includes('FORBIDDEN')) return 'Bạn không có quyền thực hiện thao tác này.';
  // Fallback: BE message đã là Tiếng Việt thân thiện → trả về luôn.
  return raw;
};

/* ============================================================================
 * Inline actions — hard delete + re-invite model
 *
 * Thay đổi từ soft delete sang hard delete:
 *   - "Xoá khỏi công ty" → DELETE row (xoá cứng)
 *   - "Huỷ lời mời" → DELETE row (xoá cứng invite)
 *   - "Mời lại" → mở InviteModal pre-filled với email user (tạo row mới)
 *
 * Permission: chỉ owner mới thấy buttons. Member thường → không có actions.
 *
 * Permission-aware render (max 2 buttons/row):
 *   - Owner row active: KHÔNG button (business rule: owner luôn active, không tự xoá,
 *     không thể transfer cho chính mình).
 *   - Member active (non-owner): [Transfer] + [Xoá khỏi công ty]
 *   - Member pending: [Huỷ lời mời] (xoá invite row, soft delete → status='removed')
 *   - Member non-active (declined/removed/left/auto_cancelled):
 *     [Mời lại] (chỉ khi có email — open InviteModal pre-filled)
 *
 * Nút "Xoá" hiện cho status='active' HOẶC 'pending' (BE chấp nhận cả 2,
 * atomic UPDATE WHERE status IN ('active','pending')). Các status khác đã
 * soft-delete rồi → dùng "Mời lại" (canReinviteMember).
 * ==========================================================================*/

/** Action item cho 1 button inline trên row */
interface RowActionItem {
  icon: typeof X;
  label: string;
  hoverClass: string;
  handler: () => void;
}

/**
 * Owner có thể xoá member này không?
 *
 * Điều kiện:
 *   - Caller phải là owner active
 *   - Không xoá owner row active (business rule + BE cũng chặn CANNOT_REMOVE_OWNER)
 *   - Status PHẢI là 'active' hoặc 'pending':
 *       - 'active' → "Xoá khỏi công ty" (xoá member đang hoạt động)
 *       - 'pending' → "Huỷ lời mời" (xoá invite chưa được accept)
 *     Các status khác (declined/removed/left/auto_cancelled) → đã soft-delete
 *     rồi, BE sẽ reject. Dùng button "Mời lại" (canReinviteMember) thay thế.
 *
 * Khớp với BE pre-check ở
 * backend/src/service/companyMember.service.ts (remove() chấp nhận cả
 * status='active' và 'pending' sau khi sửa).
 */
const canRemoveMember = (row: CompanyMember): boolean => {
  if (!isCurrentUserOwner.value) return false;
  if (row.role === 'owner' && row.status === 'active') return false;
  if (row.status !== 'active' && row.status !== 'pending') return false;
  return true;
};

/** Owner có thể mời lại user này không? — Cần email để pre-fill invite. */
const canReinviteMember = (row: CompanyMember): boolean => {
  if (!isCurrentUserOwner.value) return false;
  if (row.status === 'active') return false; // Đã active, không cần mời lại
  if (!row.user?.email) return false; // Cần email để pre-fill
  return true;
};

/** Có thể transfer ownership sang row này không? */
const canTransferOwnership = (row: CompanyMember): boolean => {
  if (!isCurrentUserOwner.value) return false;
  if (row.userId === auth.user?.id) return false;
  if (row.role === 'owner') return false;
  if (row.status !== 'active') return false;
  return true;
};

/**
 * User hiện tại có thể tự rời công ty từ row này không?
 *
 * Điều kiện:
 *   - Đúng là row của current user (row.userId === auth.user.id)
 *   - Không phải owner (BE sẽ reject — chỉ owner duy nhất mới chặn;
 *     nếu có nhiều owner thì BE vẫn cho leave. Nhưng UX thống nhất:
 *     chỉ member mới thấy nút "Rời công ty").
 *   - Status = 'active' (chỉ member active mới rời được — pending/declined
 *     thì không có gì để "rời"; chỉ cần decline invite thôi).
 */
const canLeaveCompany = (row: CompanyMember): boolean => {
  if (row.userId !== auth.user?.id) return false;
  if (row.role !== 'member') return false;
  if (row.status !== 'active') return false;
  return true;
};

/** Lấy danh sách action cho 1 row (max 2 button). */
const getRowActions = (row: CompanyMember): RowActionItem[] => {
  const items: RowActionItem[] = [];

  // 1. Transfer ownership — chỉ owner mới thấy + chỉ active non-owner (không phải self)
  if (isCurrentUserOwner.value && canTransferOwnership(row)) {
    items.push({
      icon: Crown,
      label: 'Chuyển quyền sở hữu',
      hoverClass: 'hover:text-primary-600 hover:bg-primary-50',
      handler: () => openTransfer(row),
    });
  }

  // 2. Hard delete — chỉ hiện khi status='active' (khớp BE pre-check).
  //    - status='pending' → button "Huỷ lời mời" (xoá invite row).
  //    - status khác (declined/removed/left/auto_cancelled) → KHÔNG hiện,
  //      vì đã soft-delete rồi — BE sẽ reject 409 NOT_ACTIVE. Dùng button
  //      "Mời lại" (canReinviteMember) thay thế.
  if (canRemoveMember(row)) {
    if (row.status === 'pending') {
      items.push({
        icon: X,
        label: 'Huỷ lời mời',
        hoverClass: 'hover:text-red-600 hover:bg-red-50',
        handler: () => removeMember(row),
      });
    } else {
      // canRemoveMember giờ chỉ true khi status='active' → luôn là "Xoá khỏi công ty"
      items.push({
        icon: Trash2,
        label: 'Xoá khỏi công ty',
        hoverClass: 'hover:text-red-600 hover:bg-red-50',
        handler: () => removeMember(row),
      });
    }
  }

  // 3. Re-invite — chỉ non-active có email (canReinviteMember đã check
  //    row.status !== 'active' + có email).
  //    Đặt SAU để không hiển thị cùng lúc với "Xoá" (ưu tiên Xoá cho active).
  if (canReinviteMember(row) && row.status !== 'active' && row.status !== 'pending') {
    items.push({
      icon: MailPlus,
      label: 'Mời lại',
      hoverClass: 'hover:text-primary-600 hover:bg-primary-50',
      handler: () => reinviteMember(row),
    });
  }

  // 4. Leave company — chỉ hiện cho CHÍNH current user khi họ là member active.
  //    (Owner thì BE đã enforce; member bình thường mới thấy nút này.)
  if (canLeaveCompany(row)) {
    items.push({
      icon: LogOut,
      label: 'Rời công ty',
      hoverClass: 'hover:text-red-600 hover:bg-red-50',
      handler: () => openLeave(),
    });
  }

  return items;
};

/**
 * Handler: xoá member khỏi công ty (gọi store.remove → DELETE /members/:userId).
 *
 * Hỗ trợ cả 2 case:
 *   - status='active'  → "Xoá khỏi công ty" (xoá member đang active)
 *   - status='pending' → "Huỷ lời mời" (cancel invite chưa accept)
 *
 * BE đã được cập nhật để chấp nhận cả 'active' và 'pending' (atomic UPDATE
 * WHERE status IN ('active','pending')), set ended_at = now().
 */
/**
 * Handler bước 1: mở ConfirmModal để user xác nhận trước khi xoá.
 * Thực sự xoá được thực hiện bởi `confirmRemoveMember()` sau khi user confirm.
 */
const removeMember = (row: CompanyMember): void => {
  removeTarget.value = row;
};

/** Handler bước 2: gọi API xoá sau khi user đã confirm. */
const confirmRemoveMember = async (): Promise<void> => {
  const row = removeTarget.value;
  if (!row || !companyId.value || removeSaving.value) {
    if (!removeSaving.value) removeTarget.value = null;
    return;
  }
  removeSaving.value = true;
  try {
    const ok = await memberStore.remove(companyId.value, row.userId);
    if (ok) {
      const name = row.user?.fullName ?? row.user?.email ?? 'thành viên';
      if (row.status === 'pending') {
        toast.success(`Đã huỷ lời mời tới ${name}.`);
      } else {
        toast.success(`Đã xoá ${name} khỏi công ty.`);
      }
      // Reload list ngay để owner thấy row biến mất (BE chỉ notify user bị xoá,
      // không notify owner — nên owner phải tự refetch qua action này).
      // (User bị xoá nhận socket notification → listener trong useSocket
      // sẽ navigate họ ra /employer/company.)
      await memberStore.fetchList(companyId.value);
      removeTarget.value = null;
    } else {
      toast.error(memberStore.error ?? 'Không thể xoá thành viên.');
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Đã có lỗi xảy ra.');
  } finally {
    removeSaving.value = false;
  }
};

/** Đóng modal khi user cancel (click backdrop / ESC / nút Hủy). */
const cancelRemove = (): void => {
  removeTarget.value = null;
};

/** Handler: mở InviteModal pre-fill với email user để mời lại. */
const reinviteMember = (row: CompanyMember): void => {
  if (!row.user?.email) {
    toast.error('User chưa có email — không thể mời lại.');
    return;
  }
  // Reset các field khác, pre-fill email, mở modal
  inviteEmail.value = row.user.email;
  inviteRole.value = 'member';
  inviteError.value = null;
  inviteOpen.value = true;
};

/* ---------- Transfer ownership ----------
 *
 * Modal đơn giản: chỉ cần confirm/cancel qua ConfirmModal. Không yêu cầu user
 * nhập User ID — họ đã chọn đúng row qua action button rồi.
 *
 * BE: atomic swap role (demote caller → member, promote target → owner).
 * Service đã enforce self-check ở caller = active owner của company.
 */
const transferSaving = ref(false);

/** Message cho ConfirmModal — chứa tên + email owner mới để user xác nhận đúng người. */
const transferMessage = computed<string>(() => {
  const t = transferTarget.value;
  if (!t) return '';
  const newOwnerName = t.user?.fullName ?? `User ID ${t.userId.slice(0, 8)}…`;
  const newOwnerEmail = t.user?.email ?? t.userId;
  return `Bạn có chắc chắn muốn chuyển quyền sở hữu cho ${newOwnerName} (${newOwnerEmail}) không? Sau khi chuyển, bạn sẽ trở thành member và không thể hoàn tác.`;
});

/**
 * Message cho ConfirmModal xoá member — phân biệt 2 case:
 *   - status='pending' → "Huỷ lời mời tới {name}"
 *   - status='active'  → "Xoá {name} khỏi công ty"
 * Fallback tên khi user chưa cập nhật profile: dùng email → userId (8 ký tự đầu).
 */
const removeConfirmMessage = computed<string>(() => {
  const t = removeTarget.value;
  if (!t) return '';
  const name = t.user?.fullName ?? t.user?.email ?? `User ID ${t.userId.slice(0, 8)}…`;
  if (t.status === 'pending') {
    return `Bạn có chắc chắn muốn huỷ lời mời đã gửi tới ${name}? Hành động này không thể hoàn tác — nếu muốn mời lại, bạn phải tạo invite mới.`;
  }
  return `Bạn có chắc chắn muốn xoá ${name} khỏi công ty? Họ sẽ mất quyền truy cập vào các tính năng dành cho thành viên. Hành động này không thể hoàn tác.`;
});

const openTransfer = (row: CompanyMember): void => {
  transferTarget.value = row;
};

/** Đóng modal (khi user click backdrop hoặc ESC). */
const onTransferModalClose = (open: boolean): void => {
  if (!open && !transferSaving.value) {
    transferTarget.value = null;
  }
};

const submitTransfer = async (): Promise<void> => {
  if (!transferTarget.value || !companyId.value || transferSaving.value) return;
  transferSaving.value = true;
  try {
    const result = await memberStore.transferOwner(companyId.value, {
      newOwnerUserId: transferTarget.value.userId,
    });
    if (result) {
      toast.success('Đã chuyển quyền sở hữu công ty.');
      transferTarget.value = null;
      // Reload full list để refresh cache + đảm bảo consistency sau swap.
      // (Owner mới có thể truy cập member view ngay sau khi transfer.)
      await memberStore.fetchList(companyId.value);
    } else {
      toast.error(memberStore.error ?? 'Không thể chuyển quyền sở hữu.');
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Đã có lỗi xảy ra.');
  } finally {
    transferSaving.value = false;
  }
};

/* ---------- Leave company (self) ----------
 *
 * Member tự rời công ty — soft delete, status active → left, ended_at = now.
 * BE controller check self-only + service chặn last-owner (CANNOT_LEAVE_AS_LAST_OWNER).
 *
 * Sau khi thành công:
 *   - Filter row khỏi cache (store đã syncMember trả về row với status='left')
 *   - Reload company context → chuyển state 'no-company'
 *   - Navigate về /employer/company để user thấy empty state + modal tạo company
 */
const leaveOpen = ref(false);
const leaveSaving = ref(false);
const leaveError = ref<string | null>(null);

const openLeave = (): void => {
  if (!companyId.value || !auth.user) return;
  leaveError.value = null;
  leaveOpen.value = true;
};

const submitLeave = async (): Promise<void> => {
  if (!companyId.value || !auth.user || leaveSaving.value) return;
  leaveSaving.value = true;
  leaveError.value = null;
  try {
    const result = await memberStore.leaveCompany(companyId.value, auth.user.id);
    if (result) {
      toast.success('Đã rời công ty.');
      leaveOpen.value = false;
      // Reload company context → state 'no-company' sẽ tự động.
      await companyStore.fetchById(companyId.value);
      // Navigate về /employer/company để thấy empty state + modal tạo company.
      // (Không navigate nếu đang ở đúng route đó.)
      if (route.name !== 'employer-company') {
        await router.push({ name: 'employer-company' });
      }
    } else {
      leaveError.value = memberStore.error ?? 'Không thể rời công ty.';
    }
  } catch (e) {
    leaveError.value = e instanceof Error ? e.message : 'Đã có lỗi xảy ra.';
  } finally {
    leaveSaving.value = false;
  }
};

/* ============================================================================
 * Display helpers
 * ==========================================================================*/
const truncateId = (id: string, head = 8, tail = 4): string => {
  if (id.length <= head + tail + 3) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
};


const STATUS_LABELS: Record<CompanyMemberStatus, string> = {
  pending: 'Đã mời',
  active: 'Đang hoạt động',
  declined: 'Đã từ chối',
  removed: 'Đã bị xoá',
  left: 'Đã rời công ty',
  auto_cancelled: 'Bị huỷ tự động',
};

const ROLE_LABELS: Record<CompanyMemberRole, string> = {
  owner: 'Chủ sở hữu',
  member: 'Thành viên',
};

const STATUS_BADGE: Record<CompanyMemberStatus, { cls: string }> = {
  pending: { cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  active: { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  declined: { cls: 'bg-gray-100 text-gray-600 ring-gray-200' },
  removed: { cls: 'bg-red-50 text-red-700 ring-red-200' },
  left: { cls: 'bg-gray-100 text-gray-600 ring-gray-200' },
  auto_cancelled: { cls: 'bg-gray-100 text-gray-500 ring-gray-200' },
};

</script>

<template>
  <div class="font-poppins min-h-screen bg-gray-50/50 p-5 md:p-8">
    <div class="max-w-6xl mx-auto space-y-6">
      <!-- =================== Header =================== -->
      <header class="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 class="text-xl font-semibold text-gray-900 tracking-tight">Thành viên công ty</h1>
          <p class="text-sm text-gray-500 mt-1">
            Quản lý thành viên và quyền truy cập của công ty.
          </p>
        </div>

        <!-- Skeleton placeholder for button on loading -->
        <div v-if="loadState === 'loading'" class="animate-pulse bg-gray-200 rounded h-9 w-40" />
        <button
          v-else-if="loadState === 'ready' && isCurrentUserOwner"
          type="button"
          class="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
          @click="openInvite"
        >
          <UserPlus class="w-4 h-4" />
          Mời thành viên
        </button>
      </header>

      <!-- =================== Loading state (skeleton) =================== -->
      <template v-if="loadState === 'loading'">
        <!-- Company summary skeleton -->
        <div class="bg-white rounded-xl border border-gray-200 p-5">
          <div class="flex items-center gap-4">
            <div class="animate-pulse bg-gray-200 rounded w-12 h-12 rounded-lg shrink-0" />
            <div class="flex-1 space-y-2">
              <div class="animate-pulse bg-gray-200 rounded h-4 w-44" />
              <div class="animate-pulse bg-gray-200 rounded h-3 w-32" />
            </div>
          </div>
        </div>

        <!-- Table skeleton -->
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div class="hidden md:grid grid-cols-12 px-4 py-3 border-b border-gray-100 bg-gray-50/50">
            <div class="animate-pulse bg-gray-200 rounded col-span-4 h-3 w-24" />
            <div class="animate-pulse bg-gray-200 rounded col-span-2 h-3 w-16" />
            <div class="animate-pulse bg-gray-200 rounded col-span-2 h-3 w-20" />
            <div class="animate-pulse bg-gray-200 rounded col-span-2 h-3 w-24" />
            <div class="animate-pulse bg-gray-200 rounded col-span-2 h-3 w-16 ml-auto" />
          </div>
          <div v-for="i in 4" :key="i" class="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-0 px-4 py-4 border-b border-gray-100 last:border-b-0">
            <div class="animate-pulse bg-gray-200 rounded md:col-span-4 h-4 w-40" />
            <div class="animate-pulse bg-gray-200 rounded md:col-span-2 h-4 w-16 mt-1 md:mt-0" />
            <div class="animate-pulse bg-gray-200 rounded md:col-span-2 h-4 w-20 mt-1 md:mt-0" />
            <div class="animate-pulse bg-gray-200 rounded md:col-span-2 h-4 w-24 mt-1 md:mt-0" />
            <div class="animate-pulse bg-gray-200 rounded md:col-span-2 h-4 w-12 mt-1 md:mt-0 md:ml-auto" />
          </div>
        </div>
      </template>

      <!-- =================== No company =================== -->
      <!-- Việc tạo công ty + nhận lời mời đã nằm ở /employer/company (CompanyProfilePage). -->
      <template v-else-if="loadState === 'no-company'">
        <div class="bg-white rounded-xl border border-gray-200">
          <div class="flex flex-col items-center justify-center py-16 text-center px-6">
            <div class="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mb-4">
              <Building2 class="w-7 h-7 text-blue-600" />
            </div>
            <h2 class="text-base font-semibold text-gray-900">Bạn chưa thuộc công ty nào</h2>
            <p class="text-sm text-gray-500 mt-2 max-w-md">
              Bạn cần thuộc một công ty để mời và quản lý thành viên.
            </p>
            <RouterLink
              :to="{ name: 'employer-company' }"
              class="mt-5 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
            >
              <Building2 class="w-4 h-4" />
              Đến hồ sơ công ty
            </RouterLink>
          </div>
        </div>
      </template>

      <!-- =================== Ready =================== -->
      <template v-else>
        <!-- ============ Error banner ============ -->
        <div
          v-if="loadError"
          class="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 flex items-center gap-2"
        >
          <AlertCircle class="w-4 h-4 text-red-500 shrink-0" />
          <p class="text-sm text-red-700 flex-1" role="alert">{{ loadError }}</p>
          <button
            type="button"
            class="text-xs font-medium text-red-700 hover:text-red-900 underline shrink-0 inline-flex items-center gap-1"
            @click="loadData"
          >
            <RefreshCw class="w-3 h-3" /> Thử lại
          </button>
        </div>

        <!-- ============ Company summary ============ -->
        <section v-if="company" class="bg-white rounded-xl border border-gray-200 p-5">
          <div class="flex items-center gap-4">
            <div
              class="w-12 h-12 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden shrink-0"
            >
              <img
                v-if="company.logoUrl"
                :src="company.logoUrl"
                :alt="`${company.name} logo`"
                class="w-full h-full object-cover"
              />
              <Building2 v-else class="w-6 h-6 text-gray-400" />
            </div>
            <div class="flex-1 min-w-0">
              <h2 class="text-base font-semibold text-gray-900 truncate">
                {{ company.name }}
              </h2>
              <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                <span class="inline-flex items-center gap-1">
                  <Users class="w-3.5 h-3.5" />
                  <strong class="text-gray-700">{{ members.length }}</strong>
                  thành viên
                </span>
                <span v-if="currentUserMember?.role === 'owner' && currentUserMember.status === 'active'" class="inline-flex items-center gap-1">
                  <span class="text-gray-300">·</span>
                  <Crown class="w-3 h-3 text-amber-500" />
                  Bạn là chủ sở hữu
                </span>
                <span v-else-if="currentUserMember && currentUserMember.status === 'active'" class="inline-flex items-center gap-1">
                  <span class="text-gray-300">·</span>
                  <UserIcon class="w-3 h-3" />
                  Bạn là thành viên
                </span>
              </div>
            </div>
          </div>
        </section>

        <!-- ============ Error banner (fetch list) ============ -->
        <div
          v-if="memberStore.error && !loadError"
          class="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 flex items-center gap-2"
        >
          <AlertCircle class="w-4 h-4 text-red-500 shrink-0" />
          <p class="text-sm text-red-700 flex-1" role="alert">{{ memberStore.error }}</p>
          <button
            v-if="companyId"
            type="button"
            class="text-xs font-medium text-red-700 hover:text-red-900 underline shrink-0 inline-flex items-center gap-1"
            @click="memberStore.fetchList(companyId)"
          >
            <RefreshCw class="w-3 h-3" /> Thử lại
          </button>
        </div>

        <!-- ============ Loading list (after company loaded) ============ -->
        <div
          v-if="memberStore.loading && members.length === 0"
          class="bg-white rounded-xl border border-gray-200 flex items-center justify-center py-12"
          aria-busy="true"
        >
          <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
        </div>

        <!-- ============ Empty ============ -->
        <div
          v-else-if="members.length === 0 && !memberStore.loading"
          class="bg-white rounded-xl border border-gray-200"
        >
          <div class="flex flex-col items-center justify-center py-14 text-center px-6">
            <div class="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center mb-3">
              <Users class="w-6 h-6 text-primary-600" />
            </div>
            <h3 class="text-sm font-semibold text-gray-900">Chưa có thành viên</h3>
            <p class="text-xs text-gray-500 mt-1 max-w-sm">
              Mời đồng đội tham gia để cùng quản lý công ty.
            </p>
            <button
              v-if="isCurrentUserOwner"
              type="button"
              class="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 transition"
              @click="openInvite"
            >
              <UserPlus class="w-3.5 h-3.5" /> Mời thành viên
            </button>
          </div>
        </div>

        <!-- ============ Members table ============ -->
        <div
          v-else
          class="bg-white rounded-xl border border-gray-200 overflow-hidden"
        >
          <!-- Desktop table -->
          <div class="hidden md:block overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50/50 border-b border-gray-100">
                <tr class="text-left text-[11px] uppercase tracking-wider font-semibold text-gray-500">
                  <th scope="col" class="px-4 py-3 font-semibold">Thành viên</th>
                  <th scope="col" class="px-4 py-3 font-semibold">Vai trò</th>
                  <th scope="col" class="px-4 py-3 font-semibold">Trạng thái</th>
                  <th scope="col" class="px-4 py-3 font-semibold">Ngày mời</th>
                  <th scope="col" class="px-4 py-3 font-semibold text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                <tr
                  v-for="row in members"
                  :key="row.userId"
                  class="hover:bg-gray-50/50 transition"
                >
                  <!-- Thành viên -->
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-3 min-w-0">
                      <!-- Avatar (BE trả user.avatarUrl hoặc fallback initials) -->
                      <div
                        class="w-9 h-9 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-sm font-semibold shrink-0 overflow-hidden"
                      >
                        <img
                          v-if="row.user?.avatarUrl"
                          :src="row.user.avatarUrl"
                          :alt="row.user.fullName || row.user.email"
                          class="w-full h-full object-cover"
                        />
                        <span v-else-if="row.user?.fullName" class="text-gray-700">
                          {{ row.user.fullName.charAt(0).toUpperCase() }}
                        </span>
                        <UserIcon v-else class="w-4 h-4" />
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5">
                          <p class="text-sm font-medium text-gray-900 truncate">
                            <span v-if="row.user?.fullName">{{ row.user.fullName }}</span>
                            <span v-else-if="row.user?.email" class="text-gray-500 italic text-xs">Chưa cập nhật tên</span>
                            <span v-else class="text-gray-400 italic text-xs">User không xác định</span>
                          </p>
                        </div>
                        <p
                          v-if="row.user?.email"
                          class="text-[11px] text-gray-500 mt-0.5 truncate"
                        >
                          {{ row.user.email }}
                        </p>
                        <p v-else class="text-[11px] text-gray-400 mt-0.5 truncate font-mono">
                          ID: {{ truncateId(row.userId) }}
                        </p>
                      </div>
                    </div>
                  </td>

                  <!-- Vai trò -->
                  <td class="px-4 py-3">
                    <span
                      v-if="row.role === 'owner' && row.status === 'active'"
                      class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200"
                    >
                      <Crown class="w-3 h-3" />
                      {{ ROLE_LABELS.owner }}
                    </span>
                    <span
                      v-else
                      class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200"
                    >
                      <UserIcon class="w-3 h-3" />
                      {{ ROLE_LABELS.member }}
                    </span>
                  </td>

                  <!-- Trạng thái -->
                  <td class="px-4 py-3">
                    <span
                      class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ring-1 ring-inset"
                      :class="STATUS_BADGE[row.status].cls"
                    >
                      <span class="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                      {{ STATUS_LABELS[row.status] }}
                    </span>
                  </td>

                  <!-- Ngày tham gia (= invitedAt, vì insert row = lúc mời) -->
                  <td class="px-4 py-3 text-xs text-gray-600">
                    {{ formatDate(row.invitedAt) }}
                  </td>

                  <!-- Thao tác — render tối đa 2 button inline (Transfer + Remove/Re-invite) -->
                  <td class="px-4 py-3 text-right">
                    <div class="inline-flex items-center justify-end gap-1 shrink-0">
                      <button
                        v-for="item in getRowActions(row)"
                        :key="item.label"
                        type="button"
                        class="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-400 transition focus:outline-none focus:ring-2 focus:ring-gray-300"
                        :class="item.hoverClass"
                        :title="item.label"
                        :aria-label="`${item.label} ${row.user?.fullName || row.user?.email || row.userId}`"
                        @click="item.handler"
                      >
                        <component :is="item.icon" class="w-4 h-4" />
                      </button>
                      <span
                        v-if="getRowActions(row).length === 0"
                        class="text-xs text-gray-400 italic px-2"
                      >
                        —
                      </span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Mobile cards -->
          <div class="md:hidden divide-y divide-gray-100">
            <div
              v-for="row in members"
              :key="row.userId"
              class="p-4 space-y-2.5"
            >
              <div class="flex items-start gap-3">
                <div
                  class="w-10 h-10 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-sm font-semibold shrink-0 overflow-hidden"
                >
                  <img
                    v-if="row.user?.avatarUrl"
                    :src="row.user.avatarUrl"
                    :alt="row.user.fullName || row.user.email"
                    class="w-full h-full object-cover"
                  />
                  <span v-else-if="row.user?.fullName" class="text-gray-700">
                    {{ row.user.fullName.charAt(0).toUpperCase() }}
                  </span>
                  <UserIcon v-else class="w-4 h-4" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5">
                    <p class="text-sm font-medium text-gray-900 truncate">
                      <span v-if="row.user?.fullName">{{ row.user.fullName }}</span>
                      <span v-else-if="row.user?.email" class="text-gray-500 italic text-xs">Chưa cập nhật tên</span>
                      <span v-else class="text-gray-400 italic text-xs">User không xác định</span>
                    </p>
                  </div>
                  <p
                    v-if="row.user?.email"
                    class="text-[11px] text-gray-500 mt-0.5 truncate"
                  >
                    {{ row.user.email }}
                  </p>
                  <p v-else class="text-[11px] text-gray-400 mt-0.5 truncate font-mono">
                    ID: {{ truncateId(row.userId) }}
                  </p>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <!-- Hard delete + re-invite model — render tối đa 2 button -->
                  <button
                    v-for="item in getRowActions(row)"
                    :key="item.label"
                    type="button"
                    class="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-400 transition focus:outline-none focus:ring-2 focus:ring-gray-300"
                    :class="item.hoverClass"
                    :title="item.label"
                    :aria-label="`${item.label} ${row.user?.fullName || row.user?.email || row.userId}`"
                    @click="item.handler"
                  >
                    <component :is="item.icon" class="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-2 pl-[52px]">
                <span
                  v-if="row.role === 'owner' && row.status === 'active'"
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200"
                >
                  <Crown class="w-3 h-3" />
                  {{ ROLE_LABELS.owner }}
                </span>
                <span
                  v-else
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200"
                >
                  <UserIcon class="w-3 h-3" />
                  {{ ROLE_LABELS.member }}
                </span>
                <span
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ring-1 ring-inset"
                  :class="STATUS_BADGE[row.status].cls"
                >
                  <span class="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                  {{ STATUS_LABELS[row.status] }}
                </span>
                <span class="text-[11px] text-gray-500">
                  · {{ formatDate(row.invitedAt) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- =================== Invite modal =================== -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="inviteOpen"
          class="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-modal-title"
          @mousedown.self="closeInvite"
          @keydown.escape="closeInvite"
        >
          <div class="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />
          <div
            class="relative z-10 w-full max-w-md rounded-xl bg-white p-5 shadow-2xl ring-1 ring-gray-200"
            @mousedown.stop
          >
            <button
              v-if="!inviteSaving"
              type="button"
              class="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              title="Đóng"
              aria-label="Đóng"
              @click="closeInvite"
            >
              <X class="h-4 w-4" />
            </button>

            <div class="flex gap-4">
              <div class="shrink-0">
                <div class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary-50">
                  <UserPlus class="h-5 w-5 text-primary-600" />
                </div>
              </div>
              <div class="min-w-0 flex-1">
                <h2 id="invite-modal-title" class="text-base font-semibold text-gray-900">
                  Mời thành viên
                </h2>
                <p class="mt-1 text-sm text-gray-500">
                  Thêm một thành viên vào công ty bằng email.
                </p>
              </div>
            </div>

            <div class="mt-4 space-y-3">
              <div>
                <label for="invite-email" class="block text-xs font-medium text-gray-700 mb-1.5">
                  Email <span class="text-red-500">*</span>
                </label>
                <input
                  id="invite-email"
                  ref="inviteEmailEl"
                  v-model="inviteEmail"
                  type="email"
                  placeholder="email@example.com"
                  autocomplete="off"
                  spellcheck="false"
                  class="w-full px-3 py-2 text-sm rounded-lg border bg-white focus:outline-none focus:ring-1 transition"
                  :class="inviteError ? 'border-red-300 focus:border-red-500 focus:ring-red-200' : 'border-gray-200 focus:border-blue-600 focus:ring-blue-600/20'"
                  :disabled="inviteSaving"
                  :aria-invalid="inviteError ? 'true' : undefined"
                  :aria-describedby="inviteError ? 'invite-email-err' : 'invite-email-hint'"
                  @keyup.enter="submitInvite"
                />
                <p id="invite-email-hint" class="text-[11px] text-gray-500 mt-1">
                  Email của user đã đăng ký tài khoản trên JobMatch. Hệ thống sẽ gửi thông báo mời.
                </p>
              </div>

              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1.5">Vai trò</label>
                <select
                  v-model="inviteRole"
                  disabled
                  class="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed"
                >
                  <option value="member">Thành viên</option>
                </select>
                <p class="text-[11px] text-gray-500 mt-1">Khóa — chỉ owner mới được thêm.</p>
              </div>

              <div
                v-if="inviteError"
                class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 flex items-start gap-2"
              >
                <AlertCircle class="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                <p id="invite-email-err" class="text-xs text-red-700" role="alert">{{ inviteError }}</p>
              </div>
            </div>

            <div class="mt-5 flex justify-end gap-2">
              <button
                type="button"
                class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="inviteSaving"
                @click="closeInvite"
              >
                Hủy
              </button>
              <button
                type="button"
                class="inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40 disabled:opacity-60 disabled:cursor-not-allowed"
                :disabled="inviteSaving"
                @click="submitInvite"
              >
                <Loader2 v-if="inviteSaving" class="mr-1.5 w-3.5 h-3.5 animate-spin" />
                {{ inviteSaving ? 'Đang gửi...' : 'Gửi lời mời' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- =================== Transfer ownership modal =================== -->
    <!--
      Đơn giản hóa: chỉ cần confirm/cancel qua ConfirmModal. Không yêu cầu user
      nhập User ID — user đã chọn đúng target qua action button trên row rồi.
    -->
    <ConfirmModal
      :open="transferTarget !== null"
      title="Chuyển quyền sở hữu?"
      :message="transferMessage"
      confirm-text="Chuyển quyền sở hữu"
      variant="danger"
      :loading="transferSaving"
      @update:open="onTransferModalClose"
      @confirm="submitTransfer"
    />

    <!-- =================== Remove member confirm modal =================== -->
    <!--
      Confirm trước khi xoá (cả 2 case):
        - status='pending' → huỷ lời mời đã gửi
        - status='active'  → xoá member khỏi công ty
      User có thể cancel qua backdrop click, ESC, hoặc nút "Huỷ".
    -->
    <ConfirmModal
      :open="removeTarget !== null"
      :title="removeTarget?.status === 'pending' ? 'Huỷ lời mời?' : 'Xoá thành viên?'"
      :message="removeConfirmMessage"
      :confirm-text="removeTarget?.status === 'pending' ? 'Huỷ lời mời' : 'Xoá'"
      cancel-text="Huỷ"
      variant="danger"
      @update:open="cancelRemove"
      @confirm="confirmRemoveMember"
    />

    <!-- =================== Leave company modal =================== -->
    <ConfirmModal
      :open="leaveOpen"
      title="Rời công ty?"
      :message="leaveError ? leaveError : `Sau khi rời, bạn sẽ mất quyền truy cập vào các tính năng dành cho thành viên của công ty này. Nếu muốn quay lại, bạn cần được owner mời lại.`"
      confirm-text="Rời công ty"
      variant="danger"
      :loading="leaveSaving"
      @update:open="leaveOpen = $event"
      @confirm="submitLeave"
    />

  </div>
</template>

<style scoped>
/* =================== Modal fade-in/out =================== */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}
.modal-enter-active > div:last-child,
.modal-leave-active > div:last-child {
  transition: transform 0.18s ease, opacity 0.18s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from > div:last-child,
.modal-leave-to > div:last-child {
  transform: scale(0.96);
  opacity: 0;
}
</style>
