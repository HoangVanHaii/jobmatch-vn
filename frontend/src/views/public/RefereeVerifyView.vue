<script setup lang="ts">
/**
 * RefereeVerifyView — trang PUBLIC cho người tham chiếu (referee).
 *
 * Referee là người ngoài hệ thống (không có tài khoản) — token 64 hex
 * trong URL `/verify/reference/:token` là proof-of-access duy nhất.
 * Link đến từ email n8n `reference_verify` gửi ra.
 *
 * States:
 *   - loading: đang GET info theo token
 *   - error: token sai (404) — render thông báo link không hợp lệ
 *   - form: token hợp lệ + status pending/sent + chưa hết hạn
 *   - done: submit thành công — cảm ơn referee
 */
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { CheckCircle2, Building2, Briefcase, LinkIcon, ShieldCheck, XCircle } from 'lucide-vue-next';
import { referenceApi, type PublicReferenceInfo } from '@/services/reference.api';
import { extractErrorMessage } from '@/services/http';

const route = useRoute();
const token = String(route.params.token ?? '');

type ViewState = 'loading' | 'error' | 'form' | 'done';

const view = ref<ViewState>('loading');
const info = ref<PublicReferenceInfo | null>(null);
const errorMsg = ref('');
const notes = ref('');
const submitting = ref(false);

const load = async (): Promise<void> => {
  view.value = 'loading';
  try {
    const { data } = await referenceApi.getByToken(token);
    info.value = data.data;
    view.value = 'form';
  } catch (e) {
    errorMsg.value = extractErrorMessage(e, 'Link xác minh không hợp lệ');
    view.value = 'error';
  }
};

const submit = async (confirmed: boolean): Promise<void> => {
  submitting.value = true;
  try {
    await referenceApi.submit(token, { confirmed, notes: notes.value || undefined });
    view.value = 'done';
  } catch (e) {
    errorMsg.value = extractErrorMessage(e, 'Gửi phản hồi thất bại');
    view.value = 'error';
  } finally {
    submitting.value = false;
  }
};

onMounted(load);
</script>

<template>
  <div class="min-h-screen bg-gray-50 font-poppins flex items-center justify-center p-4">
    <!-- Loading -->
    <div v-if="view === 'loading'" class="text-gray-500 text-sm">Đang tải thông tin xác minh…</div>

    <!-- Error -->
    <div v-else-if="view === 'error'" class="max-w-md w-full bg-white rounded-md shadow-sm border border-gray-200 p-8 text-center">
      <XCircle class="w-12 h-12 mx-auto text-red-400" />
      <h1 class="mt-4 text-lg font-semibold text-gray-900">Không thể xác minh</h1>
      <p class="mt-2 text-sm text-gray-600">{{ errorMsg }}</p>
      <p class="mt-4 text-xs text-gray-400">
        Nếu bạn nghĩ đây là nhầm lẫn, vui lòng liên hệ nhà tuyển dụng để nhận link mới.
      </p>
    </div>

    <!-- Done -->
    <div v-else-if="view === 'done'" class="max-w-md w-full bg-white rounded-md shadow-sm border border-gray-200 p-8 text-center">
      <CheckCircle2 class="w-12 h-12 mx-auto text-emerald-500" />
      <h1 class="mt-4 text-lg font-semibold text-gray-900">Cảm ơn bạn đã phản hồi!</h1>
      <p class="mt-2 text-sm text-gray-600">
        Phản hồi của bạn đã được ghi nhận và gửi tới nhà tuyển dụng.
      </p>
    </div>

    <!-- Form -->
    <div v-else-if="info" class="max-w-md w-full bg-white rounded-md shadow-sm border border-gray-200 p-6">
      <div class="flex items-center gap-2 text-primary-700">
        <ShieldCheck class="w-5 h-5" />
        <span class="text-sm font-semibold uppercase tracking-wide">Xác minh người tham chiếu</span>
      </div>

      <h1 class="mt-3 text-xl font-bold text-gray-900">Xin chào {{ info.refereeName }},</h1>
      <p class="mt-2 text-sm text-gray-600 leading-relaxed">
        Bạn được <span class="font-semibold text-gray-900">{{ info.candidateName }}</span>
        liệt kê là người tham chiếu trong hồ sơ ứng tuyển vị trí
        <span class="font-semibold text-gray-900">{{ info.jobTitle }}</span>.
        Vui lòng xác nhận bạn có thực sự từng làm việc với ứng viên này hay không.
      </p>

      <dl class="mt-5 space-y-2 text-sm bg-gray-50 rounded-md p-4 border border-gray-100">
        <div v-if="info.relationship" class="flex items-start gap-2">
          <Briefcase class="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
          <div><dt class="inline font-medium text-gray-700">Mối quan hệ: </dt><dd class="inline text-gray-600">{{ info.relationship }}</dd></div>
        </div>
        <div v-if="info.company" class="flex items-start gap-2">
          <div><dt class="inline font-medium text-gray-700">Công ty: </dt><dd class="inline text-gray-600">{{ info.company }}</dd></div>
        </div>
      </dl>

      <label class="block mt-5 text-sm font-medium text-gray-700" for="referee-notes">
        Ghi chú thêm (không bắt buộc)
      </label>
      <textarea
        id="referee-notes"
        v-model="notes"
        rows="3"
        maxlength="2000"
        placeholder="Ví dụ: Tôi từng làm chung với bạn ấy tại ABC Corp từ 2021–2023…"
        class="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
      ></textarea>

      <div class="mt-5 flex items-center justify-start gap-4">
        <button
          type="button"
          :disabled="submitting"
          class="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md bg-[#5b4eea] text-white text-sm font-semibold hover:bg-primary-700 transition disabled:opacity-50"
          @click="submit(true)"
        >
          <CheckCircle2 class="w-4 h-4" />
          Xác nhận
        </button>
        <button
          type="button"
          :disabled="submitting"
          class="inline-flex items-center gap-1 text-sm font-medium text-gray-500 underline underline-offset-2 hover:text-gray-700 transition disabled:opacity-50"
          @click="submit(false)"
        >
          Tôi không biết người này
        </button>
      </div>

      <p class="mt-4 flex items-center gap-1 text-xs text-gray-400">
        <LinkIcon class="w-3 h-3" />
        Link này là riêng tư và có thời hạn — vui lòng không chia sẻ.
      </p>
    </div>
  </div>
</template>
