import type {
  DataSystem,
  RequestStatus,
  RequestType,
  WorkflowStep,
} from '@/types/domain'

export const responseDays = {
  cn: 30,
  eu: 30,
  us: 45,
  sg: 30,
} as const

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function buildWorkflowSteps(params: {
  requestId: string
  type: RequestType
  systemIds: string[]
  requestedAt: string
  dueAt: string
  initialStatus: RequestStatus
  systems: DataSystem[]
}): WorkflowStep[] {
  const { requestId, type, systemIds, requestedAt, dueAt, initialStatus, systems } = params
  const steps: WorkflowStep[] = [
    {
      id: `${requestId}-identity`,
      order: 1,
      name: '身份核验与材料保护',
      role: '客服专员',
      status:
        initialStatus === 'registered' || initialStatus === 'identity-review'
          ? 'active'
          : 'completed',
      assignee: '当前客服',
      dueAt,
      completedAt:
        initialStatus === 'registered' || initialStatus === 'identity-review'
          ? undefined
          : requestedAt,
      exceptionReason: '',
    },
  ]

  const applicableSystems = systems.filter((system) => systemIds.includes(system.id))
  systemIds.forEach((systemId, index) => {
    const system = applicableSystems.find((item) => item.id === systemId)
    const isProcessing = ['processing', 'pending-close', 'completed', 'extended'].includes(
      initialStatus,
    )
    steps.push({
      id: `${requestId}-locate-${systemId}`,
      order: steps.length + 1,
      name: `定位 ${system?.name ?? systemId} 数据`,
      role: system?.owner ?? '数据管理员',
      systemId,
      status: isProcessing
        ? initialStatus === 'processing' && index === 0
          ? 'active'
          : ['pending-close', 'completed', 'extended'].includes(initialStatus)
            ? 'completed'
            : 'pending'
        : 'pending',
      assignee: system?.owner ?? '数据管理员',
      dueAt,
      completedAt: ['pending-close', 'completed', 'extended'].includes(initialStatus)
        ? requestedAt
        : undefined,
      exceptionReason: '',
    })
    steps.push({
      id: `${requestId}-execute-${systemId}`,
      order: steps.length + 1,
      name: `${type === 'deletion' ? '执行删除' : type === 'rectification' ? '执行更正' : '执行请求'}：${system?.name ?? systemId}`,
      role: system?.owner ?? '数据管理员',
      systemId,
      status: ['pending-close', 'completed', 'extended'].includes(initialStatus)
        ? 'completed'
        : 'pending',
      assignee: system?.owner ?? '数据管理员',
      dueAt,
      completedAt: ['pending-close', 'completed', 'extended'].includes(initialStatus)
        ? requestedAt
        : undefined,
      exceptionReason: '',
    })
  })

  steps.push(
    {
      id: `${requestId}-merge`,
      order: steps.length + 1,
      name: '合并跨系统处理结果',
      role: '隐私运营',
      status: ['pending-close', 'completed', 'extended'].includes(initialStatus)
        ? 'completed'
        : 'pending',
      assignee: '隐私运营',
      dueAt,
      completedAt: ['pending-close', 'completed', 'extended'].includes(initialStatus)
        ? requestedAt
        : undefined,
      exceptionReason: '',
    },
    {
      id: `${requestId}-review`,
      order: steps.length + 2,
      name: '复核例外、冲突与完整性',
      role: '隐私负责人',
      status: ['pending-close', 'completed', 'extended'].includes(initialStatus)
        ? 'completed'
        : 'pending',
      assignee: '隐私负责人',
      dueAt,
      completedAt: ['pending-close', 'completed', 'extended'].includes(initialStatus)
        ? requestedAt
        : undefined,
      exceptionReason: '',
    },
    {
      id: `${requestId}-close`,
      order: steps.length + 3,
      name: '确认关闭并生成处理包',
      role: '隐私负责人',
      status: initialStatus === 'completed' ? 'completed' : 'pending',
      assignee: '隐私负责人',
      dueAt,
      completedAt: initialStatus === 'completed' ? requestedAt : undefined,
      exceptionReason: '',
    },
  )

  return steps
}

export function templateName(region: keyof typeof responseDays, type: RequestType): string {
  const typeNames: Record<RequestType, string> = {
    access: '访问请求',
    rectification: '更正请求',
    deletion: '删除请求',
    'withdraw-consent': '撤回同意',
    restriction: '限制处理',
  }
  return `${region.toUpperCase()} · ${typeNames[type]} · ${responseDays[region]} 日流程`
}

export function deadlineState(dueAt: string, now = new Date()) {
  const diff = new Date(dueAt).getTime() - now.getTime()
  const days = Math.ceil(diff / 86_400_000)
  if (days < 0) return { label: `已逾期 ${Math.abs(days)} 天`, color: 'red.600', overdue: true }
  if (days <= 3) return { label: `剩余 ${days} 天`, color: 'orange.600', overdue: false }
  return { label: `剩余 ${days} 天`, color: 'green.600', overdue: false }
}
