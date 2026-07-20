/**
 * usePagination composable — cursor-based
 */
import { ref } from 'vue';

export interface PageState {
  page: number;
  limit: number;
  total?: number;
}

export const usePagination = (defaultLimit = 20) => {
  const page = ref(1);
  const limit = ref(defaultLimit);
  const total = ref(0);
  const nextCursor = ref<string | null>(null);

  const reset = (): void => {
    page.value = 1;
    nextCursor.value = null;
  };

  return { page, limit, total, nextCursor, reset };
};