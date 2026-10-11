<script setup lang="ts">
/**
 * PricingView — page wrapper cho route /candidate/pricing (CandidateLayout,
 * auth candidate — xem router/index.ts). Toàn bộ implementation pricing
 * (UI + logic + scoped CSS) nằm ở @components/pricing/PricingComponent.vue
 * để tái sử dụng; view này render component với role="candidate".
 */
import PricingComponent from "@components/pricing/PricingComponent.vue";
</script>

<template>
  <PricingComponent role="candidate" />
</template>

