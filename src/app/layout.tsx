import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { AppShell } from '@/components/AppShell'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: '用户隐私权利请求履约工作台',
  description: '访问、更正、删除、撤回同意和限制处理请求的本地履约工作台',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  )
}
