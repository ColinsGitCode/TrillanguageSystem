import { QueryClient } from '@tanstack/react-query';

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        retry: 1
      },
      mutations: {
        retry: false
      }
    }
  });
}
