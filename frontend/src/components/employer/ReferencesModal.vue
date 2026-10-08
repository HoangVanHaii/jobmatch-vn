<script setup lang="ts">
/**
 * ReferencesModal — HR xem + gửi email xác minh người tham chiếu của 1 application.
 *
 * Mở từ ApplicationsView detail modal (nút "Người tham chiếu").
 *
 * Layout:
 *   - Section "Từ CV": referees LLM extract từ cvs.parsed_data.references —
 *     mỗi row có nút "Gửi email" (disable nếu chưa có email hoặc đã có
 *     yêu cầu pending/sent/verified cho email đó).
 *   - Section "Đã gửi": verifications kèm trạng thái + phản hồi của referee.
 *   - Form thêm tay: khi CV không có references (CV cũ) HR nhập name + email.
 *
 * ESC: listener capture-phase + stopPropagation để không đóng detail modal
 * bên dưới cùng lúc (parent handler là bubble-phase).
 */
import { computed, ref, watch, onBeforeUnmount, onMounted } from 'vue';
import { Loader2, Mail, Plus, ShieldCheck, UserRound, X } from 'lucide-vue-next';
import {
  referenceApi,
  type CvReferenceSource,
  type ReferenceVerificationRow,
} from '@/services/reference.api';
import { extractErrorMessage } from '@/services/http';
import { useToastStore } from '@stores/toast';
import { getSocket } from '@services/socket';
import dayjs from 'dayjs';

const props = defineProps<{ applicationId: string; open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const toast = useToastStore();

const loading = ref(false);
const source = ref<CvReferenceSource[]>([]);
const verifications = ref<ReferenceVerificationRow[]>([]);

// Form thêm tay
const showAddForm = ref(false);
const addName = ref('');
const addEmail = ref('');
const addRelationship = ref('');
const addCompany = ref('');

const sendingEmail = ref<string | null>(null); // key đang gửi: "cv:<idx>" | "manual"

const close = (): void => emit('close');

const statusMeta: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Chờ gửi lại', cls: 'bg-gray-100 text-gray-600' },
  sent: { label: 'Đã gửi — chờ phản hồi', cls: 'bg-amber-100 text-amber-700' },
  verified: { label: 'Đã xác minh', cls: 'bg-emerald-100 text-emerald-700' },
  failed: { label: 'Bị từ chối', cls: 'bg-red-100 text-red-700' },
};

const statusOf = (email: string): ReferenceVerificationRow | null =>
  verifications.value.find((v) => v.refereeEmail === email.toLowerCase()) ?? null;

/** Referee từ CV đã có yêu cầu đang chờ/hoàn tất → không cho gửi nữa. */
const isHandled = (email?: string): boolean => {
  if (!email) return false;
  const row = statusOf(email);
  return row !== null && row.status !== 'failed';
};

const load = async (): Promise<void> => {
  loading.value = true;
  try {
    const { data } = await referenceApi.listForApplication(props.applicationId);
    source.value = data.data.source;
    verifications.value = data.data.verifications;
  } catch (e) {
    toast.push({
      variant: 'error',
      title: 'Không tải được danh sách người tham chiếu',
      body: extractErrorMessage(e, 'Vui lòng thử lại sau.'),
    });
  } finally {
    loading.value = false;
  }
};

const send = async (payload: {
  refereeName: string;
  refereeEmail: string;
  relationship?: string;
  company?: string;
}): Promise<void> => {
  sendingEmail.value = payload.refereeEmail;
  try {
    await referenceApi.send(props.applicationId, payload);
    toast.push({
      variant: 'success',
      title: 'Đã gửi email xác minh',
      body: `Email đang được gửi tới ${payload.refereeEmail} qua n8n.`,
    });
    await load();
    showAddForm.value = false;
    addName.value = '';
    addEmail.value = '';
    addRelationship.value = '';
    addCompany.value = '';
  } catch (e) {
    toast.push({
      variant: 'error',
      title: 'Gửi email thất bại',
      body: extractErrorMessage(e, 'Vui lòng thử lại sau.'),
    });
  } finally {
    sendingEmail.value = null;
  }
};

const sendFromCv = (r: CvReferenceSource): void => {
  if (!r.email) return;
  void send({
    refereeName: r.name,
    refereeEmail: r.email,
    relationship: r.relationship,
    company: r.company,
  });
};

const submitManual = (): void => {
  if (!addName.value.trim() || !addEmail.value.trim()) return;
  void send({
    refereeName: addName.value.trim(),
    refereeEmail: addEmail.value.trim(),
    relationship: addRelationship.value.trim() || undefined,
    company: addCompany.value.trim() || undefined,
  });
};

const hasData = computed(() => source.value.length > 0 || verifications.value.length > 0);

// ESC — capture phase để chặn handler của detail modal bên dưới.
const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape' && props.open) {
    e.stopPropagation();
    close();
  }
};

watch(
  () => props.open,
  (open) => {
    if (open) {
      void load();
      document.addEventListener('keydown', onKeydown, true);
    } else {
      document.removeEventListener('keydown', onKeydown, true);
    }
  },
);

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown, true));

// ---------------------------------------------------------------------------
// Realtime: referee submit → backend emit 'reference:verified' cho employer.
// Modal đang mở → refresh list ngay (badge + notes cập nhật tức thời).
// Bell notification ('notification:new') đã có ApplicationsView xử lý sẵn.
// ---------------------------------------------------------------------------
const onReferenceVerified = (payload: {
  applicationId?: string;
  status?: string;
  refereeName?: string;
}): void => {
  if (!props.open || payload?.applicationId !== props.applicationId) return;
  void load();
  toast.push({
    variant: payload.status === 'verified' ? 'success' : 'warning',
    title: payload.status === 'verified'
      ? `${payload.refereeName ?? 'Người tham chiếu'} đã xác nhận`
      : `${payload.refereeName ?? 'Người tham chiếu'} đã từ chối`,
  });
};

onMounted(() => {
  getSocket().on('reference:verified', onReferenceVerified);
});

onBeforeUnmount(() => {
  getSocket().off('reference:verified', onReferenceVerified);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="open"
        class="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
        @click.self="close"
      >
        <!-- font-poppins: Teleport render dưới <body> (font global là Inter)
             nên phải set font tường minh, không kế thừa được từ view cha. -->
        <div class="bg-white rounded-md font-poppins shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div class="flex items-center gap-2">
              <ShieldCheck class="w-5 h-5 text-primary-600" />
              <h2 class="text-base font-semibold text-gray-900">Người tham chiếu</h2>
            </div>
            <button type="button" class="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition" @click="close">
              <X class="w-4 h-4" />
            </button>
          </div>

          <!-- Body -->
          <div class="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            <!-- Loading -->
            <div v-if="loading" class="flex items-center justify-center py-10 text-gray-400">
              <Loader2 class="w-5 h-5 animate-spin" />
            </div>

            <template v-else>
              <!-- Từ CV -->
              <section v-if="source.length">
                <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500">Từ CV</h3>
                <ul class="mt-2 divide-y divide-gray-100 border border-gray-100 rounded-xl">
                  <li v-for="(r, i) in source" :key="`cv-${i}`" class="flex items-center gap-3 px-3.5 py-2.5">
                    <UserRound class="w-4 h-4 text-gray-400 shrink-0" />
                    <div class="min-w-0 flex-1">
                      <p class="text-sm font-medium text-gray-900 truncate">{{ r.name }}</p>
                      <p class="text-xs text-gray-500 truncate">
                        {{ r.email || 'Không có email' }}
                        <span v-if="r.relationship"> · {{ r.relationship }}</span>
                        <span v-if="r.company"> · {{ r.company }}</span>
                      </p>
                    </div>
                    <span
                      v-if="r.email && statusOf(r.email)"
                      class="px-2 py-0.5 text-[11px] font-medium rounded-full"
                      :class="statusMeta[statusOf(r.email)!.status]?.cls ?? 'bg-gray-100 text-gray-600'"
                    >
                      {{ statusMeta[statusOf(r.email)!.status]?.label ?? statusOf(r.email)!.status }}
                    </span>
                    <button
                      v-if="r.email"
                      type="button"
                      :disabled="isHandled(r.email) || sendingEmail !== null"
                      class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md bg-[#5b4eea] text-white hover:bg-primary-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                      @click="sendFromCv(r)"
                    >
                      <Loader2 v-if="sendingEmail === r.email" class="w-3 h-3 animate-spin" />
                      <Mail v-else class="w-3 h-3" />
                      {{ isHandled(r.email) ? 'Đã gửi' : 'Gửi email' }}
                    </button>
                  </li>
                </ul>
              </section>

              <!-- Đã gửi -->
              <section v-if="verifications.length">
                <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500">Yêu cầu đã gửi</h3>
                <ul class="mt-2 divide-y divide-gray-100 border border-gray-100 rounded-xl">
                  <li v-for="v in verifications" :key="v.id" class="px-3.5 py-3">
                    <div class="flex items-center gap-2">
                      <p class="text-sm font-medium text-gray-900 flex-1 truncate">{{ v.refereeName }} · {{ v.refereeEmail }}</p>
                      <span class="px-2 py-0.5 text-[11px] font-medium rounded-full" :class="statusMeta[v.status]?.cls ?? 'bg-gray-100 text-gray-600'">
                        {{ statusMeta[v.status]?.label ?? v.status }}
                      </span>
                    </div>
                    <p class="mt-1 text-xs text-gray-400">
                      Gửi {{ v.sentAt ? dayjs(v.sentAt).format('DD/MM/YYYY HH:mm') : '—' }}
                      <span v-if="v.verifiedAt"> · Phản hồi {{ dayjs(v.verifiedAt).format('DD/MM/YYYY HH:mm') }}</span>
                    </p>
                    <p v-if="v.response?.notes" class="mt-1.5 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                      “{{ v.response.notes }}”
                    </p>
                  </li>
                </ul>
              </section>

              <!-- Empty -->
              <div v-if="!hasData" class="text-center py-8 text-sm text-gray-500">
                CV này không có thông tin người tham chiếu. Bạn có thể thêm tay bên dưới.
              </div>

              <!-- Form thêm tay -->
              <section>
                <button
                  v-if="!showAddForm"
                  type="button"
                  class="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:text-primary-800"
                  @click="showAddForm = true"
                >
                  <Plus class="w-3.5 h-3.5" />
                  Thêm người tham chiếu
                </button>
                <form v-else class="border border-gray-200 rounded-xl p-4 space-y-3" @submit.prevent="submitManual">
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      v-model="addName"
                      required
                      placeholder="Họ tên *"
                      class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <input
                      v-model="addEmail"
                      required
                      type="email"
                      placeholder="Email *"
                      class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <input
                      v-model="addRelationship"
                      placeholder="Mối quan hệ (VD: Cựu quản lý)"
                      class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <input
                      v-model="addCompany"
                      placeholder="Công ty"
                      class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div class="flex gap-2 justify-end">
                    <button type="button" class="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-md transition" @click="showAddForm = false">
                      Hủy
                    </button>
                    <button
                      type="submit"
                      :disabled="sendingEmail !== null"
                      class="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-primary-600 text-white hover:bg-primary-700 transition disabled:opacity-50"
                    >
                      <Loader2 v-if="sendingEmail !== null" class="w-3 h-3 animate-spin" />
                      <Mail v-else class="w-3 h-3" />
                      Gửi email xác minh
                    </button>
                  </div>
                </form>
              </section>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
