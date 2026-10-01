import type {
  IdentityCheck,
  PrivacyRequest,
  RequestStatus,
  RequestType,
  SystemReceipt,
  WorkspaceState,
} from '@/types/domain'
import { addDays, buildWorkflowSteps, responseDays } from './workflow'
import {
  AWAIT_CONFLICT_PREFIX,
  CONFLICT_CONFLICT_PREFIX,
  FAILURE_CONFLICT_PREFIX,
  acceptedFinalReceipt,
  allSystemsConfirmed,
  clearReceiptConflictsForSystem,
  clearVersionReceiptConflicts,
  completeSystemTasks,
  findDuplicateReceipt,
  isLiveReceipt,
  missingFinalSystems,
  recomputeStatus,
  supersedeLiveForSystem,
  supersedeReceipts,
} from './receipts'

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
  audit: { action: string; operator: string; detail: string },
): WorkspaceState {
  const draft = cloneState(state)
  const request = draft.requests.find((item) => item.id === requestId)
  if (!request) throw new Error('请求不存在')
  mutation(request, draft)
  appendAudit(draft, request, audit.action, audit.operator, audit.detail)
  draft.revision += 1
  return draft
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
    version: 1,
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
    receipts: [],
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
  const draft = cloneState(state)
  const request = draft.requests.find((item) => item.id === requestId)
  if (!request) throw new Error('请求不存在')

  const nextType = patch.type ?? request.type
  const nextSystemIds = patch.affectedSystemIds ?? request.affectedSystemIds
  const scopeChanged =
    nextType !== request.type ||
    nextSystemIds.length !== request.affectedSystemIds.length ||
    nextSystemIds.some((systemId, index) => systemId !== request.affectedSystemIds[index])

  let removedCount = 0
  if (scopeChanged) {
    const oldVersion = request.version
    request.version = oldVersion + 1
    removedCount = supersedeReceipts(
      request,
      `请求版本升级到 v${request.version}（类型或涉及系统改动），v${oldVersion} 回执作废待确认。`,
      oldVersion,
    )
    clearVersionReceiptConflicts(request)
    for (const systemId of nextSystemIds) {
      const system = draft.systems.find((item) => item.id === systemId)
      request.conflicts.push(
        `${AWAIT_CONFLICT_PREFIX}：${system?.name ?? systemId}（${systemId}）需在版本 v${request.version} 重新确认最终回执。`,
      )
    }
    // 涉及系统有改动：旧结论不能改回已复核/已关闭状态，回到复核队列；任务与证据保留
    request.status = 'review-required'
  }

  Object.assign(request, patch)
  if (scopeChanged) {
    // 受保护字段即使出现在 patch 中也不允许被覆盖
    request.status = 'review-required'
  }

  appendAudit(
    draft,
    request,
    '更新请求信息',
    operator,
    scopeChanged
      ? `请求类型或涉及系统改动，版本升级为 v${request.version}，${removedCount} 条旧版本回执已作废待确认；任务与证据保留。`
      : '更新申请人、地区、联系方式等基本信息。',
  )
  draft.revision += 1
  return draft
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
        recomputeStatus(request)
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
      }
      recomputeStatus(request)
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
      recomputeStatus(request)
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
  const draft = cloneState(state)
  const request = draft.requests.find((item) => item.id === requestId)
  if (!request) throw new Error('请求不存在')
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
  const missingSystemIds = missingFinalSystems(request)
  if (missingSystemIds.length) {
    const names = missingSystemIds
      .map((systemId) => draft.systems.find((system) => system.id === systemId)?.name ?? systemId)
      .join('、')
    throw new Error(
      `仍有系统缺少当前版本 v${request.version} 的最终成功回执：${names}，不能关闭请求`,
    )
  }
  if (!allSystemsConfirmed(request)) {
    throw new Error('并非全部涉及系统都已确认当前版本最终回执，不能关闭请求')
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
  appendAudit(
    draft,
    request,
    '完成并关闭请求',
    operator,
    `${closureReason ? `提前关闭理由：${closureReason}` : '截止时间后完成关闭。'} 关闭版本 v${request.version}，全部 ${request.affectedSystemIds.length} 个系统当前版本最终回执齐备。`,
  )
  draft.revision += 1
  return draft
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
    detail: `导出范围：${scope}，包含 ${count} 条请求，按各请求当前版本导出。`,
    createdAt: now(),
  })
  draft.revision += 1
  return draft
}

export interface IngestReceiptInput {
  systemId: string
  requestVersion: number
  processedAt: string
  dedupKey: string
  isFinal: boolean
  outcome: 'success' | 'failure' | 'conflict'
  resultDetail: string
  evidenceDigest: string
}

/**
 * 接入一份跨系统回执。
 * - 每份回执必须带请求版本与系统处理时刻；
 * - 重复回执（同系统+同版本+同幂等键）只保留一条，仅累加送达次数，不重复登记证据、不改动结论；
 * - 旧版本迟到回执只留痕作废，不能把已复核请求改回旧结论；
 * - 失败或结果冲突 -> 请求回到复核队列，任务与证据保留；
 * - 当前版本最终成功回执 -> 完成该系统任务，全部系统齐备后才进入待关闭。
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
  const system = draft.systems.find((item) => item.id === input.systemId)
  const systemName = system?.name ?? input.systemId
  if (!request.affectedSystemIds.includes(input.systemId)) {
    throw new Error(`${systemName} 不在该请求的涉及系统范围内，回执被拒绝`)
  }
  if (!Number.isFinite(new Date(input.processedAt).getTime())) {
    throw new Error('系统处理时刻格式无效')
  }
  if (input.requestVersion > request.version) {
    throw new Error(
      `回执版本 v${input.requestVersion} 高于请求当前版本 v${request.version}，回执被拒绝`,
    )
  }

  // 旧版本迟到回执：留痕但不改当前结论
  if (input.requestVersion < request.version) {
    const stale: SystemReceipt = {
      id: id('receipt'),
      systemId: input.systemId,
      requestVersion: input.requestVersion,
      processedAt: input.processedAt,
      receivedAt: now(),
      dedupKey: input.dedupKey,
      isFinal: input.isFinal,
      outcome: input.outcome,
      resultDetail: input.resultDetail,
      evidenceDigest: input.evidenceDigest,
      status: 'superseded',
      voidReason: `迟到的旧版本回执：请求当前为 v${request.version}，该回执不作采纳。`,
      duplicateCount: 0,
    }
    request.receipts.unshift(stale)
    appendAudit(
      draft,
      request,
      '忽略旧版本回执',
      operator,
      `${systemName} 的 v${input.requestVersion} 回执晚到（系统处理时刻 ${input.processedAt}），请求当前版本 v${request.version}，旧结论不回滚，已留痕。`,
    )
    draft.revision += 1
    return draft
  }

  // 重复送达：幂等，只更新计数与最后送达时间
  const duplicate = findDuplicateReceipt(request, {
    systemId: input.systemId,
    requestVersion: input.requestVersion,
    dedupKey: input.dedupKey,
  })
  if (duplicate) {
    duplicate.duplicateCount += 1
    duplicate.lastDeliveredAt = now()
    appendAudit(
      draft,
      request,
      '重复回执已去重',
      operator,
      `${systemName} 回执 ${input.dedupKey}（v${input.requestVersion}）重复送达，仅保留首条，累计送达 ${duplicate.duplicateCount + 1} 次，未重复登记证据。`,
    )
    draft.revision += 1
    return draft
  }

  // 同一系统当前版本新回执：先作废旧有效回执
  const supersededCount = supersedeLiveForSystem(
    request,
    input.systemId,
    `被同系统 v${request.version} 更新回执 ${input.dedupKey} 覆盖。`,
  )

  const receivedAt = now()
  const receipt: SystemReceipt = {
    id: id('receipt'),
    systemId: input.systemId,
    requestVersion: input.requestVersion,
    processedAt: input.processedAt,
    receivedAt,
    dedupKey: input.dedupKey,
    isFinal: input.isFinal,
    outcome: input.outcome,
    resultDetail: input.resultDetail,
    evidenceDigest: input.evidenceDigest,
    status: input.isFinal
      ? input.outcome === 'success'
        ? 'accepted'
        : input.outcome === 'failure'
          ? 'failed'
          : 'conflict'
      : 'processing',
    duplicateCount: 0,
  }
  request.receipts.unshift(receipt)

  let evidenceName = ''
  if (input.isFinal && input.outcome === 'success') {
    // 成功最终回执覆盖此前失败/冲突复核项
    clearReceiptConflictsForSystem(request, input.systemId)
    completeSystemTasks(request, input.systemId, receivedAt)
    if (input.evidenceDigest) {
      evidenceName = `${systemName}当前版本处理回执`
      request.evidence.push({
        id: id('evidence'),
        stepId: `${request.id}-execute-${input.systemId}`,
        name: evidenceName,
        evidenceType: 'system-response',
        digest: input.evidenceDigest,
        uploadedBy: operator,
        uploadedAt: receivedAt,
        protected: true,
      })
    }
  } else if (input.isFinal) {
    const prefix = input.outcome === 'failure' ? FAILURE_CONFLICT_PREFIX : CONFLICT_CONFLICT_PREFIX
    const label = input.outcome === 'failure' ? '处理失败' : '结果冲突'
    const message = `${prefix}：${systemName}（${input.systemId}）v${input.requestVersion} 回执${label}，${input.resultDetail}`
    if (!request.conflicts.some((conflict) => conflict === message)) {
      request.conflicts.push(message)
    }
  }

  recomputeStatus(request)

  const outcomeText =
    input.outcome === 'success' ? '成功' : input.outcome === 'failure' ? '失败' : '结果冲突'
  appendAudit(
    draft,
    request,
    input.isFinal ? '接收系统最终回执' : '接收系统处理中回执',
    operator,
    `${systemName} v${input.requestVersion} 回执（幂等键 ${input.dedupKey}，系统处理时刻 ${input.processedAt}）：${outcomeText}，${input.resultDetail}${supersededCount ? `；覆盖 ${supersededCount} 条同版本旧回执` : ''}${evidenceName ? '；回执证据已受保护登记' : ''}。`,
  )
  draft.revision += 1
  return draft
}

/**
 * 上报数据系统发生改动（配置变更、数据迁移、补录等）。
 * 该系统相关进行中/已关闭请求的现有回执全部作废待确认，请求回到复核队列，
 * 已完成任务与证据保留；系统需按请求当前版本重新回最终回执。
 */
export function reportSystemChange(
  state: WorkspaceState,
  systemId: string,
  reason: string,
  operator: string,
): WorkspaceState {
  const draft = cloneState(state)
  const system = draft.systems.find((item) => item.id === systemId)
  if (!system) throw new Error('系统不存在')
  const affected = draft.requests.filter((request) =>
    request.affectedSystemIds.includes(systemId),
  )
  if (!affected.length) throw new Error('该系统当前没有关联的隐私请求')

  for (const request of affected) {
    const voided = supersedeReceipts(
      request,
      `系统 ${system.name} 发生改动（${reason}），旧回执作废，需按当前版本重新确认。`,
    )
    // 移除该系统旧的待确认/失败/冲突复核项，避免叠加过期信息
    request.conflicts = request.conflicts.filter(
      (conflict) =>
        !(
          (conflict.startsWith(AWAIT_CONFLICT_PREFIX) ||
            conflict.startsWith(FAILURE_CONFLICT_PREFIX) ||
            conflict.startsWith(CONFLICT_CONFLICT_PREFIX)) &&
          conflict.includes(systemId)
        ),
    )
    request.conflicts.push(
      `${AWAIT_CONFLICT_PREFIX}：${system.name}（${systemId}）发生改动，v${request.version} 的 ${voided} 条旧回执已作废，等待系统重新回传当前版本最终回执。`,
    )
    // 已关闭请求也回到复核队列；任务和证据保留，不允许旧结论继续成立
    request.status = 'review-required'
    appendAudit(
      draft,
      request,
      '系统改动作废回执',
      operator,
      `${system.name} 发生改动：${reason}。${voided} 条回执作废待确认，请求回到复核队列，已完成任务与证据保留。`,
    )
  }

  draft.audit.unshift({
    id: id('audit'),
    action: '上报数据系统改动',
    operator,
    detail: `${system.name}（${systemId}）：${reason}；影响 ${affected.length} 个请求，旧回执全部作废待确认。`,
    createdAt: now(),
  })
  draft.revision += 1
  return draft
}
