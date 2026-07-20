/**
 * useDebounce composable
 */
import { ref, watch, type Ref } from 'vue';

export const useDebounce = <T>(source: Ref<T>, delay = 300): Ref<T> => {
  const debounced = ref(source.value) as Ref<T>;
  let timer: ReturnType<typeof setTimeout> | null = null;
  watch(source, (val) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { debounced.value = val; }, delay);
  });
  return debounced;
};