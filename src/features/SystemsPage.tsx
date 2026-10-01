'use client'

import { useState } from 'react'
import {
  Badge,
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  SimpleGrid,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Textarea,
  Th,
  Thead,
  Tr,
  VStack,
  useDisclosure,
  useToast,
} from '@chakra-ui/react'
import { RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { useReportSystemChangeMutation, useWorkspaceQuery } from '@/lib/hooks'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { requestTypeLabels, systemStatusLabels } from '@/lib/schemas'

export function SystemsPage() {
  const { data, isLoading } = useWorkspaceQuery()
  const store = useWorkspaceStore()
  const reportChange = useReportSystemChangeMutation()
  const toast = useToast()
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [selectedSystemId, setSelectedSystemId] = useState('')
  const [reason, setReason] = useState('')

  if (isLoading || !data) return <Box className="panel">正在加载系统清单...</Box>

  const systems = data.systems.filter((system) =>
    `${system.name}${system.owner}${system.dataDomain}`
      .toLowerCase()
      .includes(store.systemSearch.toLowerCase()),
  )
  const activeRequests = data.requests.filter(
    (request) => !['completed', 'rejected'].includes(request.status),
  )

  function openChangeReport(systemId: string) {
    setSelectedSystemId(systemId)
    setReason('')
    onOpen()
  }

  async function submitChangeReport() {
    if (reason.trim().length < 4) {
      toast({ title: '请填写系统改动说明（至少 4 个字）', status: 'warning' })
      return
    }
    try {
      await reportChange.mutateAsync({
        systemId: selectedSystemId,
        reason: reason.trim(),
        operator: '系统管理员',
      })
      toast({
        title: '系统改动已上报',
        description: '关联请求的旧回执已作废待确认，已回到复核队列（任务与证据保留）。',
        status: 'success',
      })
      onClose()
    } catch (error) {
      toast({
        title: '上报失败',
        description: error instanceof Error ? error.message : '请重试',
        status: 'error',
      })
    }
  }

  return (
    <Box>
      <PageHeader
        title="系统清单与处理映射"
        description="维护隐私数据所在系统、责任团队、传输方式、处理时限和可支持的请求类型。"
      />

      <SimpleGrid columns={4} spacing="4" mb="5">
        <Box className="metric">
          <Text color="gray.600" fontSize="sm">
            系统总数
          </Text>
          <Heading mt="2" size="md">
            {data.systems.length}
          </Heading>
        </Box>
        <Box className="metric info">
          <Text color="gray.600" fontSize="sm">
            在用系统
          </Text>
          <Heading mt="2" size="md">
            {data.systems.filter((system) => system.status === 'active').length}
          </Heading>
        </Box>
        <Box className="metric warning">
          <Text color="gray.600" fontSize="sm">
            维护中
          </Text>
          <Heading mt="2" size="md">
            {data.systems.filter((system) => system.status === 'maintenance').length}
          </Heading>
        </Box>
        <Box className="metric danger">
          <Text color="gray.600" fontSize="sm">
            受影响请求
          </Text>
          <Heading mt="2" size="md">
            {activeRequests.length}
          </Heading>
        </Box>
      </SimpleGrid>

      <Box className="toolbar">
        <Input
          width="320px"
          value={store.systemSearch}
          onChange={(event) => store.setSystemSearch(event.target.value)}
          placeholder="搜索系统、责任团队或数据域"
        />
        <Box className="grow" />
        <Text color="gray.600" fontSize="sm">
          共 {systems.length} 个系统
        </Text>
      </Box>

      <Box className="panel">
        <TableContainer>
          <Table size="sm">
            <Thead>
              <Tr>
                <Th>系统名称</Th>
                <Th>责任团队</Th>
                <Th>数据域</Th>
                <Th>传输方式</Th>
                <Th>处理时限</Th>
                <Th>支持请求类型</Th>
                <Th>状态</Th>
                <Th>回执版本控制</Th>
              </Tr>
            </Thead>
            <Tbody>
              {systems.map((system) => (
                <Tr key={system.id}>
                  <Td fontWeight="600">{system.name}</Td>
                  <Td>{system.owner}</Td>
                  <Td maxW="300px">{system.dataDomain}</Td>
                  <Td>{system.transferMethod}</Td>
                  <Td>{system.slaDays} 天</Td>
                  <Td>
                    <HStack wrap="wrap" spacing="1">
                      {system.requestTypes.map((type) => (
                        <Badge key={type} colorScheme="blue">
                          {requestTypeLabels[type]}
                        </Badge>
                      ))}
                    </HStack>
                  </Td>
                  <Td>
                    <Badge colorScheme={system.status === 'active' ? 'green' : 'orange'}>
                      {systemStatusLabels[system.status]}
                    </Badge>
                  </Td>
                  <Td>
                    <Button
                      size="xs"
                      variant="outline"
                      colorScheme="orange"
                      leftIcon={<RefreshCw size={13} />}
                      onClick={() => openChangeReport(system.id)}
                    >
                      上报系统改动
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </TableContainer>
      </Box>

      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            上报系统改动 ·{' '}
            {data.systems.find((system) => system.id === selectedSystemId)?.name ?? ''}
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack align="stretch" spacing="4">
              <Box bg="orange.50" border="1px solid" borderColor="orange.200" borderRadius="5px" p="3">
                <Text fontSize="sm" color="orange.800">
                  系统发生配置变更、数据迁移或补录后，关联请求中该系统的旧回执将全部作废待确认；请求（含已关闭请求）回到复核队列，已完成任务与证据保留，必须重新收到当前版本最终回执后才能再次关闭。
                </Text>
              </Box>
              <FormControl isRequired>
                <FormLabel>改动说明</FormLabel>
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="例如：数据模型 v3 上线、历史数据迁移重刷、删除接口切换到新通道"
                />
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr="3" onClick={onClose}>
              取消
            </Button>
            <Button
              colorScheme="orange"
              isLoading={reportChange.isPending}
              onClick={submitChangeReport}
            >
              确认并作废旧回执
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Box className="panel">
        <Flex className="panel-title">
          <Heading size="sm">系统处理负载</Heading>
          <Button size="xs" variant="ghost">
            按 SLA 排序
          </Button>
        </Flex>
        <SimpleGrid columns={3} spacing="4">
          {data.systems.map((system) => {
            const requestCount = activeRequests.filter((request) =>
              request.affectedSystemIds.includes(system.id),
            ).length
            return (
              <Box key={system.id} p="4" bg="gray.50" borderRadius="5px">
                <Flex justify="space-between">
                  <Text fontWeight="600">{system.name}</Text>
                  <Badge colorScheme={requestCount > 1 ? 'orange' : 'green'}>
                    {requestCount} 个未完成请求
                  </Badge>
                </Flex>
                <VStack align="stretch" mt="3" spacing="1">
                  <Text color="gray.600" fontSize="sm">
                    责任人：{system.owner}
                  </Text>
                  <Text color="gray.600" fontSize="sm">
                    结果传输：{system.transferMethod}
                  </Text>
                  <Text color="gray.600" fontSize="sm">
                    SLA：{system.slaDays} 天
                  </Text>
                </VStack>
              </Box>
            )
          })}
        </SimpleGrid>
      </Box>
    </Box>
  )
}
