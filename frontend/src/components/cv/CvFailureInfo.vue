<script setup lang="ts">
/**
 * CvFailureInfo — banner nội dung giải thích lý do CV bị failed.
 *
 * Phải đồng bộ với backend/src/interface/cv.ts CvFailureReason.
 *
 * Props:
 *   - reason: loại lỗi từ BE
 *   - variant: 'card' (compact trong CV card) | 'banner' (full trong preview modal)
 */
import { computed } from 'vue';
import { AlertCircle, AlertTriangle, FileWarning, Ban, CreditCard } from 'lucide-vue-next';
import type { CvFailureReason } from '@/types/cv';

interface Props {
    reason: CvFailureReason;
    variant?: 'card' | 'banner';
}

const props = withDefaults(defineProps<Props>(), {
    variant: 'card',
});

/* ============================================================================
 * Map reason → label + icon + CTA
 * ==========================================================================*/
interface FailureContent {
    title: string;
    description: string;
    icon: typeof AlertCircle;
    cta: { label: string; to: string } | null;
}

const content = computed<FailureContent>(() => {
    switch (props.reason) {
        case 'quota_exceeded':
            return {
                title: 'Đã hết lượt AI',
                description: 'Bạn đã dùng hết lượt phân tích CV trong gói hiện tại.',
                icon: CreditCard,
                cta: { label: 'Nâng cấp gói', to: '/candidate/pricing' },
            };
        case 'invalid_file':
            return {
                title: 'File không hợp lệ',
                description: 'PDF/DOCX bị lỗi hoặc định dạng không được hỗ trợ. Vui lòng upload lại.',
                icon: FileWarning,
                cta: { label: 'Upload lại', to: '/candidate/resumes/new?mode=upload' },
            };
        case 'parse_error':
            return {
                title: 'Lỗi xử lý',
                description: 'Hệ thống gặp sự cố khi phân tích CV. Vui lòng thử lại sau.',
                icon: AlertTriangle,
                cta: null,
            };
        case 'not_a_cv':
            return {
                title: 'Không nhận diện được CV',
                description: 'Nội dung file không phải CV. Vui lòng kiểm tra lại.',
                icon: Ban,
                cta: { label: 'Upload lại', to: '/candidate/resumes/new?mode=upload' },
            };
        default:
            return {
                title: 'Có lỗi xảy ra',
                description: 'Hệ thống không thể xử lý CV này.',
                icon: AlertCircle,
                cta: null,
            };
    }
});
</script>

<template>
    <!-- ============ Compact card (chỉ icon + title 1 dòng) ============ -->
    <div
        v-if="variant === 'card'"
        class="flex items-center gap-1.5 text-[11px] text-red-600"
        :title="content.description"
    >
        <component :is="content.icon" class="w-3 h-3 shrink-0" />
        <span class="truncate">{{ content.title }}</span>
    </div>

    <!-- ============ Banner đầy đủ (preview modal) ============ -->
    <div
        v-else
        class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3"
    >
        <div class="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <component :is="content.icon" class="w-4 h-4 text-red-600" />
        </div>
        <div class="flex-1 min-w-0">
            <h3 class="text-sm font-semibold text-red-900">{{ content.title }}</h3>
            <p class="text-xs text-red-700 mt-0.5">{{ content.description }}</p>
            <router-link
                v-if="content.cta"
                :to="content.cta.to"
                class="inline-flex items-center gap-1 mt-2 px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-md hover:bg-red-700 transition"
            >
                {{ content.cta.label }}
            </router-link>
        </div>
    </div>
</template>