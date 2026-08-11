<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue';

// OTP 6 chữ số — v-model emit chuỗi 6 ký tự; expose reset() cho parent
const model = defineModel<string>({ default: '' });

const digits = ref<string[]>(['', '', '', '', '', '']);
const inputs = ref<HTMLInputElement[]>([]);

const setInputRef = (el: Element | null, i: number): void => {
  if (el) inputs.value[i] = el as HTMLInputElement;
};

const focusBox = (i: number): void => {
  nextTick(() => {
    const el = inputs.value[i];
    if (el) {
      el.focus();
      el.select();
    }
  });
};

const onInput = (i: number, e: Event): void => {
  const target = e.target as HTMLInputElement;
  const val = target.value.replace(/\D/g, '');
  digits.value[i] = val ? val.slice(-1) : '';
  if (digits.value[i] && i < 5) focusBox(i + 1);
};

const onKeydown = (i: number, e: KeyboardEvent): void => {
  if (e.key === 'Backspace' && !digits.value[i] && i > 0) {
    e.preventDefault();
    focusBox(i - 1);
  } else if (e.key === 'ArrowLeft' && i > 0) {
    focusBox(i - 1);
  } else if (e.key === 'ArrowRight' && i < 5) {
    focusBox(i + 1);
  }
};

const handlePaste = (text: string): void => {
  const clean = text.replace(/\D/g, '').slice(0, 6);
  if (!clean) return;
  for (let k = 0; k < 6; k++) digits.value[k] = clean[k] ?? '';
  focusBox(Math.min(clean.length, 5));
};

const onPaste = (e: ClipboardEvent): void => {
  e.preventDefault();
  handlePaste(e.clipboardData?.getData('text') ?? '');
};

// digits -> model (child ghi, parent chỉ đọc; tránh vòng lặp)
watch(digits, (d) => { model.value = d.join(''); }, { deep: true });

const reset = (): void => {
  digits.value = ['', '', '', '', '', ''];
  focusBox(0);
};

defineExpose({ reset });

onMounted(() => focusBox(0));
</script>

<template>
  <div class="flex justify-between gap-2" @paste="onPaste">
    <input
      v-for="i in 6"
      :key="i"
      :ref="(el) => setInputRef(el as Element | null, i - 1)"
      :value="digits[i - 1]"
      type="text"
      inputmode="numeric"
      :autocomplete="i === 1 ? 'one-time-code' : 'off'"
      maxlength="1"
      :aria-label="`Chữ số ${i} trong 6`"
      class="w-11 sm:w-12 h-14 text-center text-2xl font-bold border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition"
      @input="onInput(i - 1, $event)"
      @keydown="onKeydown(i - 1, $event)"
    />
  </div>
</template>
