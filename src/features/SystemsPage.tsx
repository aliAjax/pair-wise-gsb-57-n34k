'use client'

import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  HStack,
  Input,
  SimpleGrid,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
} from '@chakra-ui/react'
import { PageHeader } from '@/components/PageHeader'
import { useWorkspaceQuery } from '@/lib/hooks'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { requestTypeLabels, systemStatusLabels } from '@/lib/schemas'

export function SystemsPage() {
  const { data, isLoading } = useWorkspaceQuery()
  const store = useWorkspaceStore()

  if (isLoading || !data) return <Box className="panel">正在加载系统清单...</Box>

  const systems = data.systems.filter((system) =>
    `${system.name}${system.owner}${system.dataDomain}`
      .toLowerCase()
      .includes(store.systemSearch.toLowerCase()),
  )
  const activeRequests = data.requests.filter(
    (request) => !['completed', 'rejected'].includes(request.status),
  )

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
                </Tr>
              ))}
            </Tbody>
          </Table>
        </TableContainer>
      </Box>

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
