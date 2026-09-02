<script setup lang="ts">
/**
 * BillingHistoryView (placeholder — employer) — lịch sử thanh toán + subscription hiện tại.
 * Backend: GET /api/v1/payments + /api/v1/subscriptions.
 */
import { Construction } from 'lucide-vue-next';
</script>

<template>
  <div class="min-h-screen bg-gray-50/50 p-5 md:p-8">
    <div class="max-w-5xl mx-auto">
      <header class="mb-6">
        <h1 class="text-xl font-semibold text-gray-900 tracking-tight">Lịch sử thanh toán</h1>
        <p class="text-sm text-gray-500 mt-1">Gói hiện tại, hoá đơn và các lần gia hạn.</p>
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