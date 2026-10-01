'use client'

import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@/server/root'

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/api/trpc',
    }),
  ],
})
