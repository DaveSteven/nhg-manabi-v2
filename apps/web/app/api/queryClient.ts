import { QueryClient } from "@tanstack/react-query";

/**
 * Shared QueryClient defaults. Catalog data is cacheable; anything
 * session/answer related must always refetch (server is the source of
 * truth for sessions, drafts and results).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        staleTime: 0,
      },
    },
  });
}
