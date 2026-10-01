import type { PrivacyRequest, SystemReceipt, WorkflowStep } from '@/types/domain'

// 与系统改动作废相关的复核项前缀；新版本成功回执到达后按前缀清除
export const RECEIPT_CONFLICT_PREFIX = '系统回执'
export const FAILURE_CONFLICT_PREFIX = `${RECEIPT_CONFLICT_PREFIX}失败`
export const CONFLICT_CONFLICT_PREFIX = `${RECEIPT_CONFLICT_PREFIX}冲突`
export const AWAIT_CONFLICT_PREFIX = `${RECEIPT_CONFLICT_PREFIX}待确认`

export function isLiveReceipt(receipt: SystemReceipt): boolean {
  return receipt.status !== 'superseded'
}

export function receiptsForSystem(
  request: PrivacyRequest,
  systemId: string,
): SystemReceipt[] {
  return request.receipts.filter(
    (receipt) => receipt.systemId === systemId && receipt.requestVersion === request.version,
  )
}

/** 该系统当前版本最终成功回执（关闭门槛依据，只认当前版本） */
export function acceptedFinalReceipt(
  request: PrivacyRequest,
  systemId: string,
): SystemReceipt | undefined {
  return request.receipts.find(
    (receipt) =>
      receipt.systemId === systemId &&
      receipt.requestVersion === request.version &&
      isLiveReceipt(receipt) &&
      receipt.isFinal &&
      receipt.outcome === 'success' &&
      receipt.status === 'accepted',
  )
}

/** 是否仍有当前版本失败/冲突回执未被新成功回执覆盖 */
export function hasOutstandingFailureReceipts(request: PrivacyRequest): boolean {
  return request.receipts.some(
    (receipt) =>
      receipt.requestVersion === request.version &&
      isLiveReceipt(receipt) &&
      receipt.isFinal &&
      receipt.outcome !== 'success',
  )
}

export function missingFinalSystems(request: PrivacyRequest): string[] {
  return request.affectedSystemIds.filter((systemId) => !acceptedFinalReceipt(request, systemId))
}

/** 关闭门槛：每个涉及系统都必须持有当前版本最终成功回执 */
export function allSystemsConfirmed(request: PrivacyRequest): boolean {
  return (
    request.affectedSystemIds.length > 0 && missingFinalSystems(request).length === 0
  )
}

/** 幂等键：同一系统、同一请求版本、同一系统幂等键只保留一条 */
export function receiptDedupMatch(
  receipt: SystemReceipt,
  params: { systemId: string; requestVersion: number; dedupKey: string },
): boolean {
  return (
    receipt.systemId === params.systemId &&
    receipt.requestVersion === params.requestVersion &&
    receipt.dedupKey === params.dedupKey
  )
}

export function findDuplicateReceipt(
  request: PrivacyRequest,
  params: { systemId: string; requestVersion: number; dedupKey: string },
): SystemReceipt | undefined {
  return request.receipts.find((receipt) => receiptDedupMatch(receipt, params))
}

/** 作废一个请求下给定版本（默认全部旧版本）的回执，保留记录可审计 */
export function supersedeReceipts(
  request: PrivacyRequest,
  reason: string,
  version?: number,
): number {
  let count = 0
  for (const receipt of request.receipts) {
    const versionMatch = version === undefined || receipt.requestVersion === version
    if (versionMatch && isLiveReceipt(receipt)) {
      receipt.status = 'superseded'
      receipt.voidReason = reason
      count += 1
    }
  }
  return count
}

/** 同一系统当前版本已有有效回执时，先将其作废（成功回执被后续结果覆盖） */
export function supersedeLiveForSystem(
  request: PrivacyRequest,
  systemId: string,
  reason: string,
): number {
  let count = 0
  for (const receipt of request.receipts) {
    if (
      receipt.systemId === systemId &&
      receipt.requestVersion === request.version &&
      isLiveReceipt(receipt)
    ) {
      receipt.status = 'superseded'
      receipt.voidReason = reason
      count += 1
    }
  }
  return count
}

/** 清除某系统由回执失败/冲突/待确认产生的复核项（新成功回执到达时） */
export function clearReceiptConflictsForSystem(
  request: PrivacyRequest,
  systemId: string,
): string[] {
  const removed: string[] = []
  request.conflicts = request.conflicts.filter((conflict) => {
    const belongs =
      conflict.startsWith(FAILURE_CONFLICT_PREFIX) ||
      conflict.startsWith(CONFLICT_CONFLICT_PREFIX) ||
      conflict.startsWith(AWAIT_CONFLICT_PREFIX)
    if (belongs && conflict.includes(systemId)) {
      removed.push(conflict)
      return false
    }
    return true
  })
  return removed
}

/** 版本升级后，清除上一版的“待确认/失败/冲突”复核项，再由调用方按当前系统重建 */
export function clearVersionReceiptConflicts(request: PrivacyRequest) {
  request.conflicts = request.conflicts.filter(
    (conflict) =>
      !conflict.startsWith(FAILURE_CONFLICT_PREFIX) &&
      !conflict.startsWith(CONFLICT_CONFLICT_PREFIX) &&
      !conflict.startsWith(AWAIT_CONFLICT_PREFIX),
  )
}

/** 收到最终成功回执时，完成该系统对应的定位/执行任务（人工完成的任务原样保留） */
export function completeSystemTasks(
  request: PrivacyRequest,
  systemId: string,
  completedAt: string,
): WorkflowStep[] {
  const completed: WorkflowStep[] = []
  for (const task of request.tasks) {
    const isSystemTask =
      task.systemId === systemId &&
      (task.id.includes('-locate-') || task.id.includes('-execute-'))
    if (isSystemTask && task.status !== 'completed') {
      task.status = 'completed'
      task.completedAt = completedAt
      task.exceptionReason = ''
      completed.push(task)
    }
  }
  return completed
}

/**
 * 依据当前版本回执和任务重算请求状态。
 * 冲突、身份不足优先进入复核队列；全部系统当前版本最终成功回执齐备后才允许待关闭。
 * 不改动 rejected 等与回执无关的状态。
 */
export function recomputeStatus(request: PrivacyRequest): void {
  if (request.status === 'rejected') return
  if (request.conflicts.length) {
    request.status = 'review-required'
    return
  }
  if (request.identity.status === 'insufficient') {
    request.status = 'review-required'
    return
  }
  const executableTasks = request.tasks.filter((task) => !task.id.endsWith('-close'))
  const tasksDone = executableTasks.every((task) => task.status === 'completed')
  if (allSystemsConfirmed(request) && tasksDone) {
    request.status = 'pending-close'
    return
  }
  if (request.status === 'completed') {
    // 已关闭请求在缺少全部成功回执时（例如系统改动重开）回到复核，而不是静默完成
    request.status = allSystemsConfirmed(request) ? 'completed' : 'review-required'
    return
  }
  if (request.identity.status === 'verified' && request.status !== 'extended') {
    request.status = 'processing'
  }
}
