<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void;
  (e: 'search'): void;
}>();

const onInput = (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value);
const onSubmit = () => emit('search');
</script>
<template>
  <form @submit.prevent="onSubmit" class="flex gap-2 bg-white rounded-xl shadow-lg p-2">
    <input :value="modelValue" @input="onInput" type="search"
      placeholder="Tìm việc, công ty, kỹ năng..."
      class="flex-1 px-4 py-3 text-gray-900 outline-none" />
    <button type="submit" class="btn-primary">Tìm kiếm</button>
  </form>
</template>