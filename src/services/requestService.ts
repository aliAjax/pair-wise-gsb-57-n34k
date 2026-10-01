import type {
  IdentityCheck,
  PrivacyRequest,
  ReceiptStatus,
  RequestStatus,
  RequestType,
  SystemReceipt,
  WorkspaceState,
} from '@/types/domain'
import { addDays, buildWorkflowSteps, responseDays } from './workflow'
import {
  allSystemsFinalConfirmed,
  effectiveReceipts,
  latestReceiptBySystem,
  missingReceiptConflictPrefix,
  receiptConflictPrefix,
  receiptConflicts,
  staleReceiptConflictPrefix,
  systemsMissingFinalReceipt,
} from './receipt'

const cloneState = (state: WorkspaceState): WorkspaceState => structuredClone(state)
const now = () => new Date().toISOString()
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

function digest(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `PD-${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
}

function appendAudit(
  state: WorkspaceState,
  request: PrivacyRequest,
  action: string,
  operator: string,
  detail: string,
) {
  const entry = {
    id: id('audit'),
    requestId: request.id,
    action,
    operator,
    detail,
    createdAt: now(),
  }
  state.audit.unshift(entry)
  request.audit.unshift({
    id: entry.id,
    action,
    operator,
    detail,
    createdAt: entry.createdAt,
  })
}

function mutateRequest(
  state: WorkspaceState,
  requestId: string,
  mutation: (request: PrivacyRequest, draft: WorkspaceState) => void,
  audit: { action: string; operator: string; detail: string | ((request: PrivacyRequest) => string) },
): WorkspaceState {
  const draft = cloneState(state)
  const request = draft.requests.find((item) => item.id === requestId)
  if (!request) throw new Error('请求不存在')
  mutation(request, draft)
  const detail = typeof audit.detail === 'function' ? audit.detail(request) : audit.detail
  appendAudit(draft, request, audit.action, audit.operator, detail)
  draft.revision += 1
  return draft
}

const machineConflictPrefixes = [
  receiptConflictPrefix,
  staleReceiptConflictPrefix,
  missingReceiptConflictPrefix,
]

/**
 * 依据当前版本回执重建机器管理的冲突结论：
 * - 回执失败/结果冲突 → 逐系统生成冲突
 * - 旧版本回执已作废且该系统尚无当前版本回执 → 待确认冲突
 * 人工登记的冲突保持不变。
 */
function reconcileReceiptConflicts(request: PrivacyRequest) {
  const manual = request.conflicts.filter(
    (conflict) => !machineConflictPrefixes.some((prefix) => conflict.startsWith(prefix)),
  )
  const generated = [...receiptConflicts(request)]

  const latest = latestReceiptBySystem(request)
  const staleAffected = request.affectedSystemIds.filter((systemId) => {
    if (latest.has(systemId)) return false
    return request.systemReceipts.some(
      (receipt) =>
        receipt.systemId === systemId &&
        (receipt.superseded || receipt.requestVersion < request.version),
    )
  })
  if (staleAffected.length) {
    generated.push(
      `${staleReceiptConflictPrefix}（v${request.version}）：${staleAffected.join('、')} 仅回传过旧版本回执，旧回执已作废，等待系统按当前版本重新确认。`,
    )
  }

  const executableDone = request.tasks
    .filter((task) => !task.id.endsWith('-close'))
    .every((task) => task.status === 'completed')
  const missing = systemsMissingFinalReceipt(request)
  if (executableDone && missing.length) {
    generated.push(
      `${missingReceiptConflictPrefix}（v${request.version}）：${missing.join('、')} 尚未回传当前版本的成功最终回执，全部系统确认前不能关闭。`,
    )
  }

  request.conflicts = [...manual, ...generated]
}

/** 按身份、任务完成度与当前版本最终回执重算请求状态 */
function reconcileStatus(request: PrivacyRequest) {
  if (['completed', 'rejected'].includes(request.status)) return
  if (request.identity.status !== 'verified') {
    if (request.conflicts.length) request.status = 'review-required'
    return
  }
  const executableTasks = request.tasks.filter((task) => !task.id.endsWith('-close'))
  const allTasksDone =
    executableTasks.length > 0 && executableTasks.every((task) => task.status === 'completed')
  if (request.conflicts.length) {
    request.status = 'review-required'
  } else if (allTasksDone && allSystemsFinalConfirmed(request)) {
    request.status = 'pending-close'
  } else if (['review-required', 'pending-close', 'extended'].includes(request.status)) {
    request.status = 'processing'
  }
}

function reconcileRequest(request: PrivacyRequest) {
  reconcileReceiptConflicts(request)
  reconcileStatus(request)
}

export interface CreateRequestInput {
  requesterName: string
  requesterContact: string
  region: keyof typeof responseDays
  type: RequestType
  affectedSystemIds: string[]
  identityMaterialType: IdentityCheck['materialType']
  identityReference: string
  note: string
}

export function createRequest(
  state: WorkspaceState,
  input: CreateRequestInput,
  operator: string,
): WorkspaceState {
  const draft = cloneState(state)
  const requestedAt = now()
  const dueAt = addDays(new Date(requestedAt), responseDays[input.region]).toISOString()
  const duplicate = draft.requests.find(
    (request) =>
      request.requesterContact === input.requesterContact &&
      request.type === input.type &&
      !['completed', 'rejected'].includes(request.status),
  )
  const identityInsufficient =
    input.identityMaterialType === 'none' || input.identityReference.trim().length < 6
  const status: RequestStatus = identityInsufficient || duplicate ? 'review-required' : 'identity-review'
  const nextNumber =
    Math.max(
      0,
      ...draft.requests.map((request) => Number(request.code.split('-').at(-1)) || 0),
    ) + 1
  const requestId = id('request')
  const request: PrivacyRequest = {
    id: requestId,
    code: `DSR-2026-${String(nextNumber).padStart(3, '0')}`,
    requesterName: input.requesterName.trim(),
    requesterContact: input.requesterContact.trim(),
    region: input.region,
    type: input.type,
    status,
    identity: {
      status: identityInsufficient ? 'insufficient' : 'pending',
      materialType: input.identityMaterialType,
      maskedReference: input.identityReference.trim(),
      protectedDigest: digest(input.identityReference),
      note: input.note.trim(),
    },
    requestedAt,
    dueAt,
    extendedDays: 0,
    duplicateOf: duplicate?.code,
    affectedSystemIds: [...input.affectedSystemIds],
    version: 1,
    systemReceipts: [],
    tasks: buildWorkflowSteps({
      requestId,
      type: input.type,
      systemIds: input.affectedSystemIds,
      requestedAt,
      dueAt,
      initialStatus: 'identity-review',
      systems: draft.systems,
    }),
    evidence: [],
    conflicts: [],
    resultSummary: '',
    closureReason: '',
    audit: [],
  }
  if (identityInsufficient) {
    request.conflicts.push('身份材料不足：需要补充可核验的身份或授权关系证明。')
    const identityTask = request.tasks.find((task) => task.id.endsWith('-identity'))
    if (identityTask) {
      identityTask.status = 'blocked'
      identityTask.exceptionReason = '身份材料不足，等待复核。'
    }
  }
  if (duplicate) {
    request.conflicts.push(`疑似重复请求：与 ${duplicate.code} 的请求人和请求类型相同。`)
  }
  draft.requests.unshift(request)
  appendAudit(
    draft,
    request,
    '登记隐私请求',
    operator,
    `按 ${responseDays[input.region]} 日模板登记，涉及 ${input.affectedSystemIds.length} 个系统。`,
  )
  draft.revision += 1
  return draft
}

export function saveRequest(
  state: WorkspaceState,
  requestId: string,
  patch: Partial<PrivacyRequest>,
  operator: string,
): WorkspaceState {
  return mutateRequest(
    state,
    requestId,
    (request, draft) => {
      const nextSystemIds = patch.affectedSystemIds
      let systemsChanged = false
      if (nextSystemIds) {
        const before = new Set(request.affectedSystemIds)
        const after = new Set(nextSystemIds)
        systemsChanged =
          before.size !== after.size || [...after].some((systemId) => !before.has(systemId))

        if (systemsChanged && ['completed', 'rejected'].includes(request.status)) {
          throw new Error('已完成或已拒绝的请求不能调整涉及系统')
        }
      }

      Object.assign(request, patch)

      if (systemsChanged) {
        const oldVersion = request.version
        request.version = oldVersion + 1

        // 系统范围变化后，历史回执一律作废，晚到的旧版本回执不得再改动结论
        request.systemReceipts.forEach((receipt) => {
          receipt.superseded = true
        })

        // 保留身份/合并/复核/关闭任务与保留系统任务的执行进度，新增系统任务补入执行区
        const sharedTasks = request.tasks.filter((task) => !task.systemId)
        const keptSystemTasks = request.tasks.filter(
          (task) => task.systemId && nextSystemIds?.includes(task.systemId),
        )
        const addedSystemIds = nextSystemIds!.filter(
          (systemId) => !keptSystemTasks.some((task) => task.systemId === systemId),
        )
        const fresh = buildWorkflowSteps({
          requestId,
          type: request.type,
          systemIds: addedSystemIds,
          requestedAt: request.requestedAt,
          dueAt: request.dueAt,
          initialStatus: 'identity-review',
          systems: draft.systems,
        }).filter((step) => step.systemId)

        const systemTasks = [...keptSystemTasks, ...fresh]
        const identityTask = sharedTasks.find((task) => task.id.endsWith('-identity'))
        const restShared = sharedTasks.filter((task) => !task.id.endsWith('-identity'))
        request.tasks = [identityTask!, ...systemTasks, ...restShared].filter(Boolean)
        request.tasks.forEach((task, index) => {
          task.order = index + 1
        })

        reconcileRequest(request)
      }
    },
    {
      action: '更新请求信息',
      operator,
      detail: (request) =>
        request.version > 1
          ? `涉及系统已调整，请求升级到版本 v${request.version}；旧版本回执全部作废，等待各系统按新版本回传。`
          : '更新申请人、地区、请求类型或涉及系统。',
    },
  )
}

export function verifyIdentity(
  state: WorkspaceState,
  requestId: string,
  status: 'verified' | 'insufficient',
  note: string,
  operator: string,
): WorkspaceState {
  return mutateRequest(
    state,
    requestId,
    (request) => {
      request.identity.status = status
      request.identity.note = note
      request.identity.reviewedAt = now()
      const identityTask = request.tasks.find((task) => task.id.endsWith('-identity'))
      if (status === 'verified') {
        if (identityTask) {
          identityTask.status = 'completed'
          identityTask.completedAt = now()
          identityTask.exceptionReason = ''
        }
        request.conflicts = request.conflicts.filter(
          (conflict) => !conflict.startsWith('身份材料不足'),
        )
        const nextTask = request.tasks.find((task) => task.status === 'pending')
        if (nextTask) nextTask.status = 'active'
        reconcileRequest(request)
      } else {
        if (identityTask) {
          identityTask.status = 'blocked'
          identityTask.exceptionReason = note
        }
        request.status = 'review-required'
        if (!request.conflicts.some((conflict) => conflict.startsWith('身份材料不足'))) {
          request.conflicts.push(`身份材料不足：${note}`)
        }
      }
    },
    {
      action: status === 'verified' ? '身份核验通过' : '身份材料退回',
      operator,
      detail: note,
    },
  )
}

export function assignTask(
  state: WorkspaceState,
  requestId: string,
  taskId: string,
  assignee: string,
  operator: string,
): WorkspaceState {
  return mutateRequest(
    state,
    requestId,
    (request) => {
      const task = request.tasks.find((item) => item.id === taskId)
      if (!task) throw new Error('任务不存在')
      task.assignee = assignee
    },
    { action: '分派履约任务', operator, detail: `任务 ${taskId} 分派给 ${assignee}。` },
  )
}

export function taskAction(
  state: WorkspaceState,
  requestId: string,
  taskId: string,
  action: 'start' | 'complete' | 'block',
  note: string,
  operator: string,
): WorkspaceState {
  return mutateRequest(
    state,
    requestId,
    (request) => {
      if (request.identity.status !== 'verified') {
        throw new Error('身份未核验通过，不能推进履约任务')
      }
      const task = request.tasks.find((item) => item.id === taskId)
      if (!task) throw new Error('任务不存在')
      if (action === 'start') {
        task.status = 'active'
        task.exceptionReason = ''
      } else if (action === 'complete') {
        task.status = 'completed'
        task.completedAt = now()
        task.exceptionReason = ''
        const nextTask = request.tasks.find((item) => item.status === 'pending')
        if (nextTask) nextTask.status = 'active'
      } else {
        task.status = 'blocked'
        task.exceptionReason = note
        request.conflicts.push(`任务阻塞：${task.name}，${note}`)
        request.status = 'review-required'
      }
      if (action !== 'block') {
        reconcileRequest(request)
      }
    },
    {
      action:
        action === 'start' ? '开始履约任务' : action === 'complete' ? '完成履约任务' : '阻断履约任务',
      operator,
      detail: note || `${taskId} 状态更新为 ${action}。`,
    },
  )
}

export function addEvidence(
  state: WorkspaceState,
  requestId: string,
  taskId: string,
  name: string,
  evidenceType: 'execution-log' | 'screenshot' | 'signed-record' | 'system-response',
  operator: string,
): WorkspaceState {
  return mutateRequest(
    state,
    requestId,
    (request) => {
      const task = request.tasks.find((item) => item.id === taskId)
      if (!task) throw new Error('任务不存在')
      request.evidence.push({
        id: id('evidence'),
        stepId: taskId,
        name,
        evidenceType,
        digest: digest(`${name}-${now()}`),
        uploadedBy: operator,
        uploadedAt: now(),
        protected: true,
      })
    },
    {
      action: '上传执行证据',
      operator,
      detail: `${name} 已按受保护附件登记，保存摘要而非明文材料。`,
    },
  )
}

export interface IngestReceiptInput {
  systemId: string
  requestVersion: number
  status: ReceiptStatus
  resultSummary: string
  systemProcessedAt: string
}

/**
 * 接入跨系统回执：
 * - 每份回执必须带请求版本与系统处理时刻；
 * - 相同 系统+版本+处理时刻 的重复送达只保留一条，只累加重复次数、不加证据、不改结论；
 * - 旧版本回执标记作废待确认，不能把已复核的结论改回去；
 * - 失败或结果冲突驱动请求回到复核队列，任务与证据保留。
 */
export function ingestReceipt(
  state: WorkspaceState,
  requestId: string,
  input: IngestReceiptInput,
  operator: string,
): WorkspaceState {
  const draft = cloneState(state)
  const request = draft.requests.find((item) => item.id === requestId)
  if (!request) throw new Error('请求不存在')
  if (['completed', 'rejected'].includes(request.status)) {
    throw new Error('请求已结束，不能再接入回执')
  }
  if (!request.affectedSystemIds.includes(input.systemId)) {
    throw new Error('回执系统不在当前请求的涉及系统范围内')
  }
  const processedAtMs = Date.parse(input.systemProcessedAt)
  if (Number.isNaN(processedAtMs)) {
    throw new Error('系统处理时刻格式无效')
  }
  if (processedAtMs > Date.now()) {
    throw new Error('系统处理时刻不能晚于当前时间')
  }
  const systemProcessedAt = new Date(processedAtMs).toISOString()
  const systemName =
    draft.systems.find((system) => system.id === input.systemId)?.name ?? input.systemId

  // 同一系统同一版本同一处理时刻：重复送达，只留一条
  const duplicate = request.systemReceipts.find(
    (receipt) =>
      receipt.systemId === input.systemId &&
      receipt.requestVersion === input.requestVersion &&
      receipt.systemProcessedAt === systemProcessedAt,
  )
  if (duplicate) {
    duplicate.duplicateDeliveries += 1
    appendAudit(
      draft,
      request,
      '重复回执已去重',
      operator,
      `${systemName} v${input.requestVersion} ${systemProcessedAt} 的回执重复送达，保留唯一记录（累计第 ${duplicate.duplicateDeliveries + 1} 次送达），不重复登记证据。`,
    )
    draft.revision += 1
    return draft
  }

  const receivedAt = now()
  const receipt: SystemReceipt = {
    id: id('receipt'),
    systemId: input.systemId,
    requestVersion: input.requestVersion,
    status: input.status,
    resultSummary: input.resultSummary.trim(),
    systemProcessedAt,
    receivedAt,
    superseded: input.requestVersion < request.version,
    duplicateDeliveries: 0,
  }

  if (input.requestVersion < request.version) {
    // 旧版本回执晚到：只登记作废，不回改已复核结论，不加证据
    request.systemReceipts.push(receipt)
    reconcileRequest(request)
    appendAudit(
      draft,
      request,
      '旧版本回执作废',
      operator,
      `${systemName} 回传的 v${input.requestVersion} 回执晚于当前 v${request.version}，已标记作废待确认，未覆盖现有结论与证据。`,
    )
    draft.revision += 1
    return draft
  }

  if (input.requestVersion > request.version) {
    throw new Error(
      `回执版本 v${input.requestVersion} 高于请求当前版本 v${request.version}，请核对后重新接入`,
    )
  }

  request.systemReceipts.push(receipt)

  // 当前版本回执：同一系统同版本只以系统处理时刻最新的一条为准，旧回执保留记录但标记被取代
  const sameSystemReceipts = request.systemReceipts.filter(
    (receiptItem) =>
      receiptItem.systemId === input.systemId &&
      receiptItem.requestVersion === request.version &&
      receiptItem.id !== receipt.id,
  )
  const previous = sameSystemReceipts.find(
    (receiptItem) => receiptItem.evidenceId && !receiptItem.superseded,
  )
  sameSystemReceipts.forEach((receiptItem) => {
    receiptItem.superseded = true
  })

  // 每个系统只保留一条回执证据；同系统再来新回执时原地替换，不新增证据
  const kindLabel =
    input.status === 'success' ? '处理成功' : input.status === 'failure' ? '执行失败' : '结果冲突'
  if (previous?.evidenceId) {
    const evidence = request.evidence.find((item) => item.id === previous.evidenceId)
    if (evidence) {
      evidence.name = `${systemName}回执（v${request.version}·${kindLabel}）`
      evidence.digest = digest(`${input.systemId}-${request.version}-${systemProcessedAt}`)
      evidence.uploadedBy = operator
      evidence.uploadedAt = receivedAt
    }
    receipt.evidenceId = previous.evidenceId
    previous.evidenceId = undefined
  } else {
    const evidenceId = id('evidence')
    receipt.evidenceId = evidenceId
    request.evidence.push({
      id: evidenceId,
      stepId: `${request.id}-execute-${input.systemId}`,
      name: `${systemName}回执（v${request.version}·${kindLabel}）`,
      evidenceType: 'system-response',
      digest: digest(`${input.systemId}-${request.version}-${systemProcessedAt}`),
      uploadedBy: operator,
      uploadedAt: receivedAt,
      protected: true,
    })
  }

  reconcileRequest(request)

  const action =
    input.status === 'success'
      ? '接入系统成功回执'
      : input.status === 'failure'
        ? '系统回执失败，回到复核'
        : '系统结果冲突，回到复核'
  appendAudit(
    draft,
    request,
    action,
    operator,
    `${systemName} 已回传 v${request.version} 回执（系统处理时刻 ${systemProcessedAt}）：${input.resultSummary}。`,
  )
  draft.revision += 1
  return draft
}

export function addConflict(
  state: WorkspaceState,
  requestId: string,
  conflict: string,
  operator: string,
): WorkspaceState {
  return mutateRequest(
    state,
    requestId,
    (request) => {
      request.conflicts.push(conflict)
      request.status = 'review-required'
    },
    { action: '标记冲突或例外', operator, detail: conflict },
  )
}

export function resolveConflict(
  state: WorkspaceState,
  requestId: string,
  conflictIndex: number,
  resolution: string,
  operator: string,
): WorkspaceState {
  return mutateRequest(
    state,
    requestId,
    (request) => {
      const conflict = request.conflicts[conflictIndex]
      if (!conflict) throw new Error('冲突项不存在')
      request.conflicts.splice(conflictIndex, 1)
      reconcileRequest(request)
    },
    { action: '复核处理冲突', operator, detail: resolution },
  )
}

export function extendRequest(
  state: WorkspaceState,
  requestId: string,
  days: number,
  reason: string,
  operator: string,
): WorkspaceState {
  return mutateRequest(
    state,
    requestId,
    (request) => {
      const base = new Date(request.dueAt) > new Date() ? new Date(request.dueAt) : new Date()
      request.dueAt = addDays(base, days).toISOString()
      request.extendedDays += days
      request.status = 'extended'
    },
    { action: '延期请求处理', operator, detail: `延期 ${days} 天：${reason}` },
  )
}

export function closeRequest(
  state: WorkspaceState,
  requestId: string,
  resultSummary: string,
  closureReason: string,
  operator: string,
): WorkspaceState {
  return mutateRequest(
    state,
    requestId,
    (request) => {
      if (request.identity.status !== 'verified') {
        throw new Error('身份核验尚未通过，不能关闭请求')
      }
      const requiredTasks = request.tasks.filter((task) => !task.id.endsWith('-close'))
      if (requiredTasks.some((task) => task.status !== 'completed')) {
        throw new Error('仍有未完成任务，不能关闭请求')
      }
      if (request.conflicts.length) {
        throw new Error('仍有未解决冲突，不能关闭请求')
      }
      const missingSystems = systemsMissingFinalReceipt(request)
      if (missingSystems.length) {
        throw new Error(
          `仍有系统未回传 v${request.version} 的成功最终回执（${missingSystems.join('、')}），全部系统确认前不能关闭`,
        )
      }
      if (new Date(request.dueAt) > new Date() && !closureReason.trim()) {
        throw new Error('截止时间前关闭必须填写提前关闭理由')
      }
      request.resultSummary = resultSummary
      request.closureReason = closureReason
      request.status = 'completed'
      const closeTask = request.tasks.find((task) => task.id.endsWith('-close'))
      if (closeTask) {
        closeTask.status = 'completed'
        closeTask.completedAt = now()
      }
    },
    {
      action: '完成并关闭请求',
      operator,
      detail: closureReason ? `提前关闭理由：${closureReason}` : '截止时间后完成关闭。',
    },
  )
}

export function addComment(
  state: WorkspaceState,
  requestId: string,
  content: string,
  operator: string,
): WorkspaceState {
  const draft = cloneState(state)
  const request = draft.requests.find((item) => item.id === requestId)
  if (!request) throw new Error('请求不存在')
  draft.comments.unshift({
    id: id('comment'),
    requestId,
    author: operator,
    content,
    createdAt: now(),
  })
  appendAudit(draft, request, '提交处理意见', operator, content)
  draft.revision += 1
  return draft
}

export function recordExport(
  state: WorkspaceState,
  scope: string,
  count: number,
  operator: string,
): WorkspaceState {
  const draft = cloneState(state)
  draft.audit.unshift({
    id: id('audit'),
    action: '导出处理包',
    operator,
    detail: `导出范围：${scope}，包含 ${count} 条请求。`,
    createdAt: now(),
  })
  draft.revision += 1
  return draft
}
