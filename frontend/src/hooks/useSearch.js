import { useMutation } from '@tanstack/react-query';
import { search } from '../api/search';

export function useSearch() {
  return useMutation({ mutationFn: search });
}
