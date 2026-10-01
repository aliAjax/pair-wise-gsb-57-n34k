'use client'

import { useEffect, useState, type ReactNode } from 'react'
import NextLink from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Avatar,
  Box,
  Flex,
  HStack,
  Heading,
  Spinner,
  Tag,
  Text,
  VStack,
} from '@chakra-ui/react'
import {
  Activity,
  ClipboardList,
  Database,
  FileClock,
  LayoutDashboard,
  ShieldCheck,
} from 'lucide-react'
import { useWorkspaceQuery } from '@/lib/hooks'

const navItems = [
  { href: '/', label: '运行总览', icon: LayoutDashboard },
  { href: '/requests', label: '请求工作台', icon: ClipboardList },
  { href: '/review', label: '复核队列', icon: ShieldCheck },
  { href: '/systems', label: '系统清单', icon: Database },
  { href: '/audit', label: '审计与导出', icon: FileClock },
]

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { isFetching } = useWorkspaceQuery()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const activePath =
    navItems
      .map((item) => item.href)
      .filter((href) => href !== '/' && pathname.startsWith(href))
      .sort((left, right) => right.length - left.length)[0] ?? '/'

  return (
    <Flex minH="100vh">
      <Box position="fixed" insetY={0} left={0} width="236px" bg="#17324d" color="white">
        <Flex h="82px" px="20px" align="center" gap="12px" borderBottom="1px solid #2b4962">
          <Flex
            w="38px"
            h="38px"
            align="center"
            justify="center"
            bg="#56bfc0"
            color="#17324d"
            fontWeight="800"
            borderRadius="6px"
          >
            隐
          </Flex>
          <Box>
            <Text fontWeight="700">隐私权利履约</Text>
            <Text mt="1" color="whiteAlpha.600" fontSize="xs">
              多系统请求工作台
            </Text>
          </Box>
        </Flex>

        <VStack align="stretch" spacing="1" p="10px">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = activePath === item.href
            return (
              <NextLink href={item.href} key={item.href}>
                <HStack
                  h="46px"
                  px="14px"
                  spacing="12px"
                  color={active ? 'white' : 'whiteAlpha.700'}
                  bg={active ? '#285c70' : 'transparent'}
                  borderLeft={active ? '3px solid #56bfc0' : '3px solid transparent'}
                  borderRadius="5px"
                  _hover={{ bg: '#234763', color: 'white' }}
                >
                  <Icon size={17} strokeWidth={1.8} />
                  <Text fontSize="sm">{item.label}</Text>
                </HStack>
              </NextLink>
            )
          })}
        </VStack>

        <Box position="absolute" right="16px" bottom="20px" left="16px" pt="14px" borderTop="1px solid #2b4962">
          <Text color="whiteAlpha.500" fontSize="xs">
            当前工作模式
          </Text>
          <Text mt="1" fontWeight="600" fontSize="sm">
            本地模拟 · 受保护材料
          </Text>
          <Text mt="1" color="whiteAlpha.500" fontSize="xs">
            localStorage 持久化
          </Text>
        </Box>
      </Box>

      <Box ml="236px" flex="1" minW={0}>
        <Flex h="82px" px="28px" align="center" justify="space-between" bg="white" borderBottom="1px solid #d9e1e8">
          <Box>
            <Text color="gray.500" fontSize="xs">
              用户隐私权利请求履约工作台
            </Text>
            <Heading mt="1" size="md">
              请求履约控制台
            </Heading>
          </Box>
          <HStack spacing="12px">
            <Tag colorScheme={mounted && isFetching ? 'orange' : 'green'}>
              {!mounted ? '本地工作区' : isFetching ? '正在同步服务' : '数据已持久化'}
            </Tag>
            <Activity size={18} color="#237b78" />
            <Avatar size="sm" name="隐私运营" bg="brand.500" />
            <Text fontSize="sm">隐私运营</Text>
          </HStack>
        </Flex>
        <Box className="workbench-content">
          {isFetching && !children ? <Spinner /> : children}
        </Box>
      </Box>
    </Flex>
  )
}
