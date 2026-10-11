<script setup lang="ts">
/**
 * PricingView — page wrapper cho route /employer/pricing (EmployerLayout,
 * auth employer — xem router/index.ts). Toàn bộ implementation pricing
 * (UI + logic + scoped CSS) nằm ở @components/pricing/PricingComponent.vue
 * để tái sử dụng; view này render component với role="employer".
 */
import PricingComponent from "@components/pricing/PricingComponent.vue";
</script>

<template>
  <PricingComponent role="employer" />
</template>

