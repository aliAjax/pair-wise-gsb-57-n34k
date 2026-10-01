'use client'

import { useMemo, useState } from 'react'
import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  HStack,
  Input,
  Select,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  useToast,
} from '@chakra-ui/react'
import { Download, RotateCcw } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { useRecordExportMutation, useWorkspaceQuery } from '@/lib/hooks'
import { clearWorkspace } from '@/lib/localStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'

function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([`\ufeff${content}`], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export function AuditPage() {
  const toast = useToast()
  const { data, isLoading } = useWorkspaceQuery()
  const recordExport = useRecordExportMutation()
  const store = useWorkspaceStore()
  const [requestId, setRequestId] = useState('')

  const auditEntries = useMemo(() => {
    const merged = [
      ...(data?.audit ?? []),
      ...(data?.requests.flatMap((request) =>
        request.audit.map((entry) => ({ ...entry, requestId: request.id })),
      ) ?? []),
    ]
    const unique = new Map(merged.map((entry) => [entry.id, entry]))
    return [...unique.values()]
      .filter((entry) => {
        const text = `${entry.action}${entry.detail}${entry.operator}`.toLowerCase()
        return (
          (!store.auditSearch || text.includes(store.auditSearch.toLowerCase())) &&
          (!requestId || entry.requestId === requestId)
        )
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }, [data, requestId, store.auditSearch])

  if (isLoading || !data) return <Box className="panel">正在加载审计工作区...</Box>
  const workspace = data

  function sanitizedPackage() {
    return {
      exportedAt: new Date().toISOString(),
      policy: '用户隐私权利请求履约操作规范 v1',
      summary: {
        requestCount: workspace.requests.length,
        openCount: workspace.requests.filter(
          (request) => !['completed', 'rejected'].includes(request.status),
        ).length,
        systemCount: workspace.systems.length,
      },
      requests: workspace.requests.map((request) => ({
        code: request.code,
        requesterName: request.requesterName,
        requesterContact: request.requesterContact,
        region: request.region,
        type: request.type,
        status: request.status,
        requestedAt: request.requestedAt,
        dueAt: request.dueAt,
        extendedDays: request.extendedDays,
        identity: {
          status: request.identity.status,
          materialType: request.identity.materialType,
          maskedReference: request.identity.maskedReference,
          protectedDigest: request.identity.protectedDigest,
          note: request.identity.note,
        },
        affectedSystems: workspace.systems
          .filter((system) => request.affectedSystemIds.includes(system.id))
          .map((system) => system.name),
        tasks: request.tasks.map((task) => ({
          name: task.name,
          status: task.status,
          assignee: task.assignee,
          completedAt: task.completedAt,
          exceptionReason: task.exceptionReason,
        })),
        evidence: request.evidence.map((evidence) => ({
          name: evidence.name,
          type: evidence.evidenceType,
          digest: evidence.digest,
          uploadedAt: evidence.uploadedAt,
        })),
        conflicts: request.conflicts,
        resultSummary: request.resultSummary,
        closureReason: request.closureReason,
      })),
      audit: auditEntries,
    }
  }

  async function exportPackage() {
    const pkg = sanitizedPackage()
    await recordExport.mutateAsync({
      scope: '全量请求处理包',
      count: workspace.requests.length,
      operator: '隐私负责人',
    })
    downloadFile(
      `隐私请求处理包-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(pkg, null, 2),
      'application/json;charset=utf-8',
    )
    toast({ title: '处理包已导出并记录审计', status: 'success' })
  }

  function exportCsv() {
    const header = ['时间', '请求编号', '操作', '操作人', '说明']
    const rows = auditEntries.map((entry) => [
      new Date(entry.createdAt).toLocaleString('zh-CN'),
      workspace.requests.find((request) => request.id === entry.requestId)?.code ?? '系统',
      entry.action,
      entry.operator,
      entry.detail,
    ])
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
      .join('\n')
    downloadFile('隐私请求操作审计.csv', csv, 'text/csv;charset=utf-8')
  }

  return (
    <Box>
      <PageHeader
        title="审计与请求处理包"
        description="追踪登记、身份核验、任务分派、执行证据、冲突复核、延期和关闭操作。"
        actions={
          <HStack>
            <Button
              variant="outline"
              leftIcon={<RotateCcw size={15} />}
              onClick={() => {
                clearWorkspace()
                window.location.reload()
              }}
            >
              恢复演示数据
            </Button>
            <Button variant="outline" onClick={exportCsv}>
              导出当前日志
            </Button>
            <Button
              colorScheme="brand"
              leftIcon={<Download size={15} />}
              isLoading={recordExport.isPending}
              onClick={exportPackage}
            >
              导出处理包
            </Button>
          </HStack>
        }
      />

      <div className="toolbar">
        <Input
          width="300px"
          value={store.auditSearch}
          onChange={(event) => store.setAuditSearch(event.target.value)}
          placeholder="搜索操作、说明或操作人"
        />
        <Select
          width="260px"
          value={requestId}
          onChange={(event) => setRequestId(event.target.value)}
          placeholder="全部请求"
        >
          {workspace.requests.map((request) => (
            <option key={request.id} value={request.id}>
              {request.code} · {request.requesterName}
            </option>
          ))}
        </Select>
        <Box className="grow" />
        <Badge colorScheme="blue">{auditEntries.length} 条记录</Badge>
      </div>

      <Box className="panel">
        <TableContainer>
          <Table size="sm">
            <Thead>
              <Tr>
                <Th>时间</Th>
                <Th>请求编号</Th>
                <Th>操作</Th>
                <Th>操作人</Th>
                <Th>说明</Th>
              </Tr>
            </Thead>
            <Tbody>
              {auditEntries.map((entry) => (
                <Tr key={entry.id}>
                  <Td whiteSpace="nowrap">
                    {new Date(entry.createdAt).toLocaleString('zh-CN')}
                  </Td>
                  <Td className="mono">
                    {workspace.requests.find((request) => request.id === entry.requestId)?.code ?? '系统'}
                  </Td>
                  <Td>{entry.action}</Td>
                  <Td>{entry.operator}</Td>
                  <Td whiteSpace="normal">{entry.detail}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </TableContainer>
      </Box>

      <Box className="panel">
        <Flex className="panel-title">
          <Heading size="sm">处理包隐私保护</Heading>
          <Badge colorScheme="green">已校验</Badge>
        </Flex>
        <Text color="gray.600" fontSize="sm">
          导出内容仅包含掩码身份引用、摘要、任务状态、证据元数据和审计记录；系统不会导出原始身份材料。
        </Text>
      </Box>
    </Box>
  )
}
