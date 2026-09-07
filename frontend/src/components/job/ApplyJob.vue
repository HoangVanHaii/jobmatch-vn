<script setup lang="ts">
/**
 * ApplyJob — modal ứng tuyển job cho candidate.
 *
 * Mount ở candidate JobDetailView (`<ApplyJob :job="job" v-model:open="open" />`).
 *
 * Flow:
 *   1. User mở modal → fetch CV list (chỉ status='ready', source=upload|direct).
 *   2. User chọn CV (optional) + viết coverLetter (optional).
 *   3. Submit → POST /applications → 201 Created.
 *   4. Close modal + toast success + push notification sẽ tới employer realtime.
 *   5. AI matching chạy async qua worker — candidate nhận socket
 *      `application:match-ready` để hiển thị điểm sau (xem AppliedJobsView).
 *
 * Edge cases đã handle:
 *   - 409 ALREADY_APPLIED → toast warning "đã apply job này".
 *   - 400 JOB_NOT_APPLYABLE / JOB_EXPIRED → toast error.
 *   - 404 CV_NOT_FOUND / 403 CV_FORBIDDEN → CV có thể bị xoá giữa chừng → refresh list.
 *   - Submit success → emit 'applied' để parent có thể update UI (vd disable button).
 */
import { ref, watch, computed } from 'vue';
import { Loader2, FileText, X, Sparkles, AlertCircle } from 'lucide-vue-next';
import { applicationApi } from '@services/application.api';
import { cvApi } from '@services/cv.api';
import { aiApi } from '@services/ai.api';
import { useToastStore } from '@stores/toast';
import type { Cv } from '@/types/cv';

const props = defineProps<{
  job: { id: string; title: string };
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  applied: [applicationId: string];
}>();

const toast = useToastStore();

// -----------------------------------------------------------------------
// Form state
// -----------------------------------------------------------------------
const cvId = ref<string>(''); // rỗng = apply không kèm CV
const coverLetter = ref('');
const submitting = ref(false);
const generating = ref(false);

// CV list
const cvList = ref<Cv[]>([]);
const loadingCvs = ref(false);

const selectedCv = computed(() => cvList.value.find((c) => c.id === cvId.value) ?? null);
const canSubmit = computed(() => !submitting.value);

// -----------------------------------------------------------------------
// Fetch CV khi mở modal
// -----------------------------------------------------------------------
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    // Reset form khi đóng
    if (!isOpen) {
      cvId.value = '';
      coverLetter.value = '';
    }
    await fetchCvs();
  },
);

const fetchCvs = async (): Promise<void> => {
  loadingCvs.value = true;
  try {
    // Lấy tất cả CV ready, sắp xếp primary lên đầu.
    const { data } = await cvApi.list({ limit: 50 });
    cvList.value = (data.data.items ?? [])
      .filter((c: Cv) => c.status === 'ready' || c.status === 'pending')
      .sort((a: Cv, b: Cv) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
    // Auto-select primary CV nếu có.
    const primary = cvList.value.find((c) => c.isPrimary);
    if (primary && !cvId.value) {
      cvId.value = primary.id;
    }
  } catch (err) {
    toast.push({
      variant: 'error',
      title: 'Không tải được danh sách CV',
      body: 'Vui lòng thử lại sau.',
    });
  } finally {
    loadingCvs.value = false;
  }
};

// -----------------------------------------------------------------------
// AI generate cover letter
// -----------------------------------------------------------------------
const generateCover = async (): Promise<void> => {
  generating.value = true;
  try {
    // BE sẽ tự resolve CV của candidate từ session.
    // Truyền job title làm context để LLM viết liên quan.
    const { data } = await aiApi.generateCoverLetter(
      { jobTitle: props.job.title, jobId: props.job.id } as Record<string, unknown>,
      '',
    );
    coverLetter.value = String(data.data?.content ?? '');
  } catch (err) {
    toast.push({
      variant: 'error',
      title: 'AI không tạo được cover letter',
      body: 'Bạn có thể viết tay nhé.',
    });
  } finally {
    generating.value = false;
  }
};

// -----------------------------------------------------------------------
// Submit
// -----------------------------------------------------------------------
const submit = async (): Promise<void> => {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    const { data } = await applicationApi.create({
      jobId: props.job.id,
      cvId: cvId.value || undefined,
      coverLetter: coverLetter.value.trim() || undefined,
    });
    toast.push({
      variant: 'success',
      title: 'Ứng tuyển thành công',
      body: `Đã nộp hồ sơ cho "${props.job.title}".`,
    });
    emit('applied', data.data.id);
    emit('update:open', false);
  } catch (err) {
    // Error đã được http interceptor format sẵn → response.data.error.code
    const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code;
    const messageMap: Record<string, string> = {
      ALREADY_APPLIED: 'Bạn đã ứng tuyển job này rồi.',
      JOB_NOT_FOUND: 'Job không còn tồn tại.',
      JOB_NOT_APPLYABLE: 'Job hiện không nhận hồ sơ.',
      JOB_EXPIRED: 'Job đã hết hạn nộp hồ sơ.',
      CV_NOT_FOUND: 'CV đã bị xoá. Vui lòng chọn CV khác.',
      CV_FORBIDDEN: 'CV không thuộc về bạn. Vui lòng chọn CV khác.',
    };
    toast.push({
      variant: code === 'ALREADY_APPLIED' ? 'warning' : 'error',
      title: 'Ứng tuyển thất bại',
      body: messageMap[code ?? ''] ?? 'Vui lòng thử lại sau ít phút.',
    });
    // Nếu CV lỗi → refresh list để user chọn lại.
    if (code === 'CV_NOT_FOUND' || code === 'CV_FORBIDDEN') {
      void fetchCvs();
    }
  } finally {
    submitting.value = false;
  }
};

const close = (): void => {
  if (submitting.value) return; // không cho đóng giữa chừng
  emit('update:open', false);
};
</script>

<template>
  <!-- Backdrop -->
  <div
    v-if="open"
    class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
    @click.self="close"
  >
    <!-- Modal panel -->
    <div class="bg-white rounded-md shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between p-5 border-b border-gray-200">
        <div class="min-w-0">
          <h3 class="text-base font-semibold text-gray-900 truncate">Ứng tuyển công việc</h3>
          <p class="text-xs text-gray-500 mt-0.5 truncate">{{ job.title }}</p>
        </div>
        <button
          type="button"
          class="text-gray-400 hover:text-gray-600 transition"
          :disabled="submitting"
          @click="close"
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <!-- Body -->
      <div class="p-5 space-y-4 overflow-y-auto flex-1">
        <!-- CV picker -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1.5">
            CV của bạn <span class="text-gray-400 font-normal">(không bắt buộc)</span>
          </label>

          <div v-if="loadingCvs" class="flex items-center justify-center py-6 text-sm text-gray-500">
            <Loader2 class="w-4 h-4 mr-2 animate-spin" /> Đang tải CV...
          </div>

          <div v-else-if="cvList.length === 0" class="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
            <AlertCircle class="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              Bạn chưa có CV nào. Có thể <a href="/candidate/my-resumes" class="font-semibold underline">tạo CV ngay</a> hoặc nộp hồ sơ không kèm CV.
            </div>
          </div>

          <div v-else class="space-y-2">
            <label
              v-for="cv in cvList"
              :key="cv.id"
              class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition"
              :class="cvId === cv.id ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'"
            >
              <input
                type="radio"
                :value="cv.id"
                v-model="cvId"
                class="mt-1 shrink-0"
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <FileText class="w-4 h-4 text-gray-500 shrink-0" />
                  <span class="text-sm font-medium text-gray-900 truncate">{{ cv.title ?? '(Chưa đặt tên)' }}</span>
                  <span
                    v-if="cv.isPrimary"
                    class="inline-flex items-center rounded-full bg-primary-100 text-primary-700 px-1.5 py-0.5 text-[10px] font-semibold"
                  >
                    Primary
                  </span>
                  <span
                    v-if="cv.status === 'pending'"
                    class="inline-flex items-center rounded-full bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] font-semibold"
                  >
                    Đang xử lý
                  </span>
                </div>
                <p class="text-xs text-gray-500 mt-0.5 truncate">
                  {{ cv.source === 'upload' ? 'Upload' : 'Tạo trực tiếp' }} · cập nhật {{ new Date(cv.updatedAt).toLocaleDateString('vi-VN') }}
                </p>
              </div>
            </label>

            <button
              v-if="cvId"
              type="button"
              class="text-xs text-gray-500 hover:text-gray-700 underline"
              @click="cvId = ''"
            >
              Bỏ chọn CV (nộp không kèm CV)
            </button>
          </div>
        </div>

        <!-- Cover letter -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1.5">
            Thư xin việc <span class="text-gray-400 font-normal">(không bắt buộc, tối đa 5000 ký tự)</span>
          </label>
          <button
            type="button"
            class="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-primary-700 hover:text-primary-800 disabled:opacity-50"
            :disabled="generating"
            @click="generateCover"
          >
            <Loader2 v-if="generating" class="w-3.5 h-3.5 animate-spin" />
            <Sparkles v-else class="w-3.5 h-3.5" />
            {{ generating ? 'AI đang viết...' : '✨ AI sinh thư xin việc' }}
          </button>
          <textarea
            v-model="coverLetter"
            :maxlength="5000"
            :disabled="generating"
            class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none resize-none disabled:opacity-50"
            rows="5"
            placeholder="Viết ngắn gọn về điểm mạnh của bạn cho vị trí này..."
          />
          <p class="mt-1 text-xs text-gray-400 text-right">{{ coverLetter.length }} / 5000</p>
        </div>

        <!-- AI match note -->
        <div class="flex items-start gap-2 p-3 rounded-lg bg-primary-50 border border-primary-100 text-xs text-primary-900">
          <Sparkles class="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            Sau khi nộp hồ sơ, hệ thống sẽ tự động chấm điểm AI match với job này (nếu bạn có CV). Bạn sẽ nhận thông báo khi có kết quả.
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-end gap-2 p-4 border-t border-gray-200 bg-gray-50">
        <button
          type="button"
          class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
          :disabled="submitting"
          @click="close"
        >
          Huỷ
        </button>
        <button
          type="button"
          class="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!canSubmit"
          @click="submit"
        >
          <Loader2 v-if="submitting" class="w-4 h-4 animate-spin" />
          {{ submitting ? 'Đang nộp...' : 'Nộp hồ sơ' }}
        </button>
      </div>
    </div>
  </div>
</template>
