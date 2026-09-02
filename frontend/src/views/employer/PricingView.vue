<script setup lang="ts">
/**
 * PricingView (placeholder — employer) — bảng giá các gói dịch vụ cho employer.
 * Backend: GET /api/v1/plans.
 */
import { Construction } from 'lucide-vue-next';
</script>

<template>
  <div class="min-h-screen bg-gray-50/50 p-5 md:p-8">
    <div class="max-w-5xl mx-auto">
      <header class="mb-6">
        <h1 class="text-xl font-semibold text-gray-900 tracking-tight">Nâng cấp gói dịch vụ</h1>
        <p class="text-sm text-gray-500 mt-1">Chọn gói phù hợp với quy mô tuyển dụng của bạn.</p>
      </header>
      <div class="bg-white border border-gray-200 rounded-xl p-10 text-center">
        <div class="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center mx-auto mb-3">
          <Construction class="w-6 h-6 text-primary-600" />
        </div>
        <h3 class="text-sm font-semibold text-gray-900">Tính năng đang phát triển</h3>
      </div>
    </div>
  </div>
</template>