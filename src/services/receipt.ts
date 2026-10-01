import type { PrivacyRequest, SystemReceipt } from '@/types/domain'

/** 回执的冲突结论前缀，用于按系统替换旧结论 */
export const receiptConflictPrefix = '跨系统回执'

/** 旧版本作废待确认的冲突前缀 */
export const staleReceiptConflictPrefix = '回执版本失效'

/** 系统尚未回传当前版本最终回执的冲突前缀 */
export const missingReceiptConflictPrefix = '系统回执缺失'

/** 当前版本、未作废的有效回执 */
export function effectiveReceipts(request: PrivacyRequest): SystemReceipt[] {
  return request.systemReceipts.filter(
    (receipt) => receipt.requestVersion === request.version && !receipt.superseded,
  )
}

/** 每个系统当前版本最新的一条有效回执（以系统处理时刻为准） */
export function latestReceiptBySystem(
  request: PrivacyRequest,
): Map<string, SystemReceipt> {
  const result = new Map<string, SystemReceipt>()
  for (const receipt of effectiveReceipts(request)) {
    const existing = result.get(receipt.systemId)
    if (!existing || receipt.systemProcessedAt > existing.systemProcessedAt) {
      result.set(receipt.systemId, receipt)
    }
  }
  return result
}

/** 还没有当前版本最终（成功）回执的涉及系统 */
export function systemsMissingFinalReceipt(request: PrivacyRequest): string[] {
  const latest = latestReceiptBySystem(request)
  return request.affectedSystemIds.filter((systemId) => {
    const receipt = latest.get(systemId)
    return !receipt || receipt.status !== 'success'
  })
}

/** 是否所有涉及系统都拿到了当前版本的成功最终回执 */
export function allSystemsFinalConfirmed(request: PrivacyRequest): boolean {
  return systemsMissingFinalReceipt(request).length === 0
}

/** 由当前版本回执推导出的冲突结论（失败/结果冲突） */
export function receiptConflicts(request: PrivacyRequest): string[] {
  const latest = latestReceiptBySystem(request)
  return [...latest.values()]
    .filter((receipt) => receipt.status !== 'success')
    .map((receipt) => {
      const kind = receipt.status === 'failure' ? '执行失败' : '结果冲突'
      return `${receiptConflictPrefix}（v${receipt.requestVersion}）：系统 ${receipt.systemId} ${kind}：${receipt.resultSummary}`
    })
}

/** 是否存在来自历史版本、尚未被新版本回执覆盖的系统 */
export function hasStaleReceipts(request: PrivacyRequest): boolean {
  const latest = latestReceiptBySystem(request)
  const staleSystems = new Set(
    request.systemReceipts
      .filter((receipt) => receipt.superseded || receipt.requestVersion < request.version)
      .map((receipt) => receipt.systemId),
  )
  return [...staleSystems].some((systemId) => !latest.has(systemId))
}
