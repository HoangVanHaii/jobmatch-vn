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

/** Index ô rỗng đầu tiên từ trái, hoặc -1 nếu đã đầy. Dùng cho focus + paste. */
const findFirstEmpty = (): number => {
  for (let k = 0; k < 6; k++) {
    if (!digits.value[k]) return k;
  }
  return -1;
};

const onFocus = (i: number): void => {
  // Bắt buộc nhập trái → phải: focus vào ô rỗng trong khi ô trước còn rỗng
  // → nhảy về ô rỗng đầu tiên. Cho phép focus vào ô đã có data để user
  // sửa lại ký tự trước đó.
  if (i > 0 && !digits.value[i] && !digits.value[i - 1]) {
    const firstEmpty = findFirstEmpty();
    if (firstEmpty !== -1 && firstEmpty !== i) {
      focusBox(firstEmpty);
      return;
    }
  }
  // Select nội dung để user dễ ghi đè.
  nextTick(() => {
    const el = inputs.value[i];
    if (el) el.select();
  });
};

const onInput = (i: number, e: Event): void => {
  const target = e.target as HTMLInputElement;
  const val = target.value.replace(/\D/g, '');

  // Defense-in-depth: chặn input vào ô mà ô trước rỗng. focus handler đã chặn
  // focus rồi, nhưng giữ check ở đây phòng case keyboard/programmatic events
  // vẫn trigger input mà không qua focus.
  if (i > 0 && !digits.value[i - 1]) {
    target.value = digits.value[i] ?? '';
    focusBox(findFirstEmpty());
    return;
  }

  digits.value[i] = val ? val.slice(-1) : '';
  if (digits.value[i] && i < 5) focusBox(i + 1);
};

const onKeydown = (i: number, e: KeyboardEvent): void => {
  // OTP chỉ nhận chữ số. Chặn ký tự in được không phải số ngay tại keydown để
  // user thấy phản hồi ngay (ký tự không kịp hiện lên ô) — thay vì để onInput
  // filter im lặng và user tưởng app hỏng.
  //
  // Cho phép: digit (0-9), phím điều hướng/sửa (Backspace, Delete, Arrow*, Home,
  // End, Tab, Enter), và tổ hợp có modifier (Ctrl/Meta/Alt) để không chặn
  // copy/paste/select-all shortcuts.
  //
  // `e.isComposing === true` khi IME (vd telex) đang compose — bỏ qua filter để
  // không chặn user gõ số qua bộ gõ tiếng Việt.
  const isDigit = /^[0-9]$/.test(e.key);
  const isEditingKey =
    e.key === 'Backspace' ||
    e.key === 'Delete' ||
    e.key === 'Tab' ||
    e.key === 'Enter' ||
    e.key === 'ArrowLeft' ||
    e.key === 'ArrowRight' ||
    e.key === 'ArrowUp' ||
    e.key === 'ArrowDown' ||
    e.key === 'Home' ||
    e.key === 'End';
  const hasModifier = e.ctrlKey || e.metaKey || e.altKey;

  if (!e.isComposing && !isDigit && !isEditingKey && !hasModifier) {
    e.preventDefault();
    return;
  }

  // Navigation logic giữ nguyên.
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

  // Paste fill từ ô rỗng đầu tiên — giữ nguyên data đã có, không overwrite.
  // Số digit thừa (khi user paste nhiều hơn ô trống còn lại) bị bỏ qua.
  const startIdx = findFirstEmpty();
  if (startIdx === -1) return; // đã đầy → ignore paste

  for (let k = 0; k < clean.length && startIdx + k < 6; k++) {
    digits.value[startIdx + k] = clean[k]!;
  }

  // Focus vào ô rỗng kế tiếp (hoặc ô cuối nếu đã hết chỗ trống).
  let nextEmpty = -1;
  for (let k = startIdx + clean.length; k < 6; k++) {
    if (!digits.value[k]) { nextEmpty = k; break; }
  }
  focusBox(nextEmpty !== -1 ? nextEmpty : 5);
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
      :class="{ 'opacity-50': i - 1 > 0 && !digits[i - 2] }"
      @focus="onFocus(i - 1)"
      @input="onInput(i - 1, $event)"
      @keydown="onKeydown(i - 1, $event)"
    />
  </div>
</template>
