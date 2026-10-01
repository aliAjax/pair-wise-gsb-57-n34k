'use client'

import { useState, type ReactNode } from 'react'
import { ChakraProvider, extendTheme } from '@chakra-ui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const theme = extendTheme({
  config: {
    initialColorMode: 'light',
    useSystemColorMode: false,
  },
  colors: {
    brand: {
      50: '#e8f5f4',
      100: '#c8e8e6',
      200: '#98d3cf',
      300: '#68bdb8',
      400: '#3fa49f',
      500: '#237b78',
      600: '#1b625f',
      700: '#164e4c',
    },
  },
  styles: {
    global: {
      body: {
        bg: 'gray.100',
        color: 'gray.800',
      },
    },
  },
  fonts: {
    heading: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
    body: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  },
})

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <ChakraProvider theme={theme}>{children}</ChakraProvider>
    </QueryClientProvider>
  )
}
