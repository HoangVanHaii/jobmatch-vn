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
 *   - 409 ALREADY_APPLIED → toast warning "đã apply job này bằng CV này rồi".
 *   - 400 JOB_NOT_APPLYABLE / JOB_EXPIRED → toast error.
 *   - 400 CV_ID_REQUIRED → user chưa chọn CV (Zod guard ở backend).
 *   - 404 CV_NOT_FOUND / 403 CV_FORBIDDEN → CV có thể bị xoá giữa chừng → refresh list.
 *   - Submit success → emit 'applied' để parent có thể update UI (vd disable button).
 *
 * Migration 0033: cvId BẮT BUỘC. Ràng buộc "1 CV - 1 job" → 1 candidate có thể
 * apply cùng job bằng nhiều CV. Modal chỉ cho phép chọn CV (radio), không có
 * option "nộp không kèm CV" như trước. Submit disabled khi chưa pick CV.
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
  /**
   * Danh sách CV id đã ứng tuyển job này (từ `applicationList` của parent).
   * Mỗi CV chỉ apply được 1 lần/job → backend chặn duplicate qua unique
   * (cv_id, job_id). Modal disable radio tương ứng + hiển thị hint "Đã nộp".
   */
  appliedCvIds?: string[];
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  applied: [applicationId: string];
}>();

const toast = useToastStore();

// -----------------------------------------------------------------------
// Form state
// -----------------------------------------------------------------------
const cvId = ref<string>(''); // rỗng = chưa chọn (submit bị disabled)
const coverLetter = ref('');
const submitting = ref(false);
const generating = ref(false);
/**
 * Ngôn ngữ cover letter AI sinh ra. 'vi' = mặc định cho hầu hết nhà tuyển dụng
 * Việt Nam; 'en' cho công ty nước ngoài / job description tiếng Anh. User có thể
 * đổi bằng pill toggle ngay cạnh nút "AI sinh thư xin việc". Đổi ngôn ngữ KHÔNG
 * tự re-gen (user phải bấm AI lại) để tránh overwrite text họ đang sửa.
 */
const letterLanguage = ref<'vi' | 'en'>('vi');

// CV list
const cvList = ref<Cv[]>([]);
const loadingCvs = ref(false);

const selectedCv = computed(() => cvList.value.find((c) => c.id === cvId.value) ?? null);
const canSubmit = computed(() => !submitting.value && cvId.value !== '');

/** CV đã ứng tuyển job này (set lookup O(1)). */
const appliedCvSet = computed(() => new Set(props.appliedCvIds ?? []));

/** CV khả dụng = CV ready chưa từng apply job này. */
const availableCvs = computed(() =>
  cvList.value.filter((c) => !appliedCvSet.value.has(c.id)),
);

/**
 * Nếu CV đang chọn bị đánh dấu đã apply (vd apply thành công xong user mở lại
 * modal) → clear selection để tránh submit trùng.
 */
watch(
  [cvId, appliedCvSet],
  ([id, set]) => {
    if (id && set.has(id)) cvId.value = '';
  },
  { immediate: true },
);

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
  if (!cvId.value) {
    toast.push({
      variant: 'info',
      title: 'Chọn CV trước',
      body: 'Vui lòng chọn CV để AI viết thư xin việc phù hợp.',
    });
    return;
  }
  generating.value = true;
  try {
    const { data } = await aiApi.generateCoverLetter({
      jobId: props.job.id,
      cvId: cvId.value,
      language: letterLanguage.value,
    });
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
      cvId: cvId.value,
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
            CV của bạn <span class="text-red-500 font-normal">*</span>
          </label>

          <div v-if="loadingCvs" class="flex items-center justify-center py-6 text-sm text-gray-500">
            <Loader2 class="w-4 h-4 mr-2 animate-spin" /> Đang tải CV...
          </div>

          <div v-else-if="cvList.length === 0" class="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
            <AlertCircle class="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              Bạn chưa có CV nào. Vui lòng <a href="/candidate/my-resumes" class="font-semibold underline">tạo CV trước</a> rồi quay lại ứng tuyển.
            </div>
          </div>

          <div v-else-if="availableCvs.length === 0" class="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
            <AlertCircle class="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              Bạn đã ứng tuyển job này bằng tất cả {{ cvList.length }} CV. Mỗi CV chỉ dùng được 1 lần cho 1 job.
            </div>
          </div>

          <div v-else class="space-y-2">
            <label
              v-for="cv in availableCvs"
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

            <!--
              CV đã apply job này — hiển thị mờ để user biết tồn tại, disabled
              để không chọn lại (DB unique chặn duplicate).
            -->
            <template v-if="cvList.some((c) => appliedCvSet.has(c.id))">
              <p class="text-[11px] text-gray-400 uppercase tracking-wide pt-2">
                Đã ứng tuyển bằng CV này
              </p>
              <div
                v-for="cv in cvList.filter((c) => appliedCvSet.has(c.id))"
                :key="`applied-${cv.id}`"
                class="flex items-center gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed"
              >
                <FileText class="w-4 h-4 text-gray-400 shrink-0" />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium text-gray-500 truncate">
                      {{ cv.title ?? '(Chưa đặt tên)' }}
                    </span>
                    <span class="inline-flex items-center rounded-full bg-gray-200 text-gray-600 px-1.5 py-0.5 text-[10px] font-semibold">
                      Đã nộp
                    </span>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Cover letter -->
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="text-sm font-medium text-gray-700">
              Thư xin việc <span class="text-gray-400 font-normal">(không bắt buộc, tối đa 5000 ký tự)</span>
            </label>
            <!--
              Language toggle: pill group VI / EN. Đổi sẽ KHÔNG tự re-gen
              (user phải bấm nút AI) để tránh overwrite text đang sửa. State
              persist trong session modal — không lưu localStorage vì user
              chọn theo job cụ thể.
            -->
            <div class="inline-flex rounded-md border border-gray-200 overflow-hidden" role="group" aria-label="Ngôn ngữ thư xin việc">
              <button
                type="button"
                class="px-2.5 py-1 text-[11px] font-semibold transition"
                :class="letterLanguage === 'vi' ? 'bg-primary-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'"
                :aria-pressed="letterLanguage === 'vi'"
                @click="letterLanguage = 'vi'"
              >
                VI
              </button>
              <button
                type="button"
                class="px-2.5 py-1 text-[11px] font-semibold transition border-l border-gray-200"
                :class="letterLanguage === 'en' ? 'bg-primary-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'"
                :aria-pressed="letterLanguage === 'en'"
                @click="letterLanguage = 'en'"
              >
                EN
              </button>
            </div>
          </div>
          <div class="mb-1.5 flex items-center gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 text-xs font-medium text-primary-700 hover:text-primary-800 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="generating || !cvId"
              :title="!cvId ? 'Chọn CV trước để AI cá nhân hoá thư xin việc' : `Sẽ viết bằng ${letterLanguage === 'vi' ? 'tiếng Việt' : 'tiếng Anh'}`"
              @click="generateCover"
            >
              <Loader2 v-if="generating" class="w-3.5 h-3.5 animate-spin" />
              <Sparkles v-else class="w-3.5 h-3.5" />
              {{ generating ? 'AI đang viết...' : '✨ AI sinh thư xin việc' }}
            </button>
            <span class="text-[11px] text-gray-400">
              Sẽ viết bằng <span class="font-semibold">{{ letterLanguage === 'vi' ? 'tiếng Việt' : 'tiếng Anh' }}</span>
            </span>
          </div>
          <textarea
            v-model="coverLetter"
            :maxlength="5000"
            :disabled="generating"
            class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none resize-none disabled:opacity-50"
            rows="5"
            :placeholder="letterLanguage === 'vi' ? 'Viết ngắn gọn về điểm mạnh của bạn cho vị trí này...' : 'Briefly describe why you are a strong fit for this role...'"
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
