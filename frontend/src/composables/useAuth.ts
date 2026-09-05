/**
 * useAuth composable — wrapper cho auth store
 */
import { useAuthStore } from '@stores/auth';
import { storeToRefs } from 'pinia';

export const useAuth = () => {
  const store = useAuthStore();
  // storeToRefs tách state ra refs (giữ reactivity).
  // Trả về refs trước + store sau → actions (login/logout/...) không ghi đè refs.
  return { ...storeToRefs(store), ...store };
};