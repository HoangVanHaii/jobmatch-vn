/**
 * useAuth composable — wrapper cho auth store
 */
import { useAuthStore } from '@stores/auth';
import { storeToRefs } from 'pinia';

export const useAuth = () => {
  const store = useAuthStore();
  const { user, isAuthenticated, isLoading } = storeToRefs(store);
  return { user, isAuthenticated, isLoading, ...store };
};