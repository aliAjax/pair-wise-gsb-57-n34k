/* eslint-disable */
const assert = require('node:assert/strict')
const { createInitialState } = require('@/services/mockData')
const {
  closeRequest,
  ingestReceipt,
  reportSystemChange,
  saveRequest,
  taskAction,
} = require('@/services/requestService')

const state = createInitialState()
const operator = '测试员'
const get = (s, id) => s.requests.find((r) => r.id === id)
const ts = (offsetMin = 0) => new Date(Date.now() + offsetMin * 60000).toISOString()

// --- 场景 1：重复回执只留一条，不重复登记证据 ---
let s1 = ingestReceipt(
  state,
  'req-001',
  {
    systemId: 'sys-support',
    requestVersion: 1,
    processedAt: ts(),
    dedupKey: 'DUP-1',
    isFinal: true,
    outcome: 'success',
    resultDetail: '客服工单已打包',
    evidenceDigest: 'RC-SUPPORT-1',
  },
  operator,
)
const evidenceBefore = get(s1, 'req-001').evidence.length
s1 = ingestReceipt(
  s1,
  'req-001',
  {
    systemId: 'sys-support',
    requestVersion: 1,
    processedAt: ts(1),
    dedupKey: 'DUP-1',
    isFinal: true,
    outcome: 'success',
    resultDetail: '重复送达内容（应忽略）',
    evidenceDigest: 'RC-SUPPORT-DUP',
  },
  operator,
)
s1 = ingestReceipt(
  s1,
  'req-001',
  {
    systemId: 'sys-support',
    requestVersion: 1,
    processedAt: ts(2),
    dedupKey: 'DUP-1',
    isFinal: true,
    outcome: 'success',
    resultDetail: '第三次送达',
    evidenceDigest: 'RC-SUPPORT-DUP2',
  },
  operator,
)
const supportReceipts = get(s1, 'req-001').receipts.filter(
  (r) => r.systemId === 'sys-support' && r.requestVersion === 1 && r.dedupKey === 'DUP-1',
)
assert.equal(supportReceipts.length, 1, '重复回执必须只保留一条')
assert.equal(supportReceipts[0].duplicateCount, 2, '应累计 2 次重复送达')
assert.equal(
  get(s1, 'req-001').evidence.length,
  evidenceBefore,
  '重复回执不得重复登记证据',
)
console.log('✓ 场景1：重复回执幂等去重，证据不重复登记')

// --- 场景 2：失败回执回复核队列、任务证据保留、禁止关闭；成功后可关闭 ---
s1 = ingestReceipt(
  s1,
  'req-001',
  {
    systemId: 'sys-order',
    requestVersion: 1,
    processedAt: ts(3),
    dedupKey: 'ORD-FINAL-1',
    isFinal: true,
    outcome: 'success',
    resultDetail: '订单记录访问包已生成',
    evidenceDigest: 'RC-ORDER-1',
  },
  operator,
)
s1 = ingestReceipt(
  s1,
  'req-001',
  {
    systemId: 'sys-support',
    requestVersion: 1,
    processedAt: ts(4),
    dedupKey: 'SUPPORT-FAIL-1',
    isFinal: true,
    outcome: 'failure',
    resultDetail: '附件导出服务超时失败',
    evidenceDigest: '',
  },
  operator,
)
assert.equal(get(s1, 'req-001').status, 'review-required', '失败回执应使请求回到复核队列')
assert.ok(
  get(s1, 'req-001').conflicts.some(
    (c) => c.includes('系统回执失败') && c.includes('sys-support'),
  ),
  '失败应登记复核项',
)
assert.ok(
  get(s1, 'req-001').evidence.some((e) => e.digest === 'RC-SUPPORT-1'),
  '回复核队列后证据保留',
)
console.log('✓ 场景2a：失败回执回复核队列，任务与证据保留')

// req-004 为单系统请求，用失败回执干净验证“任务完成但回执失败”的关闭门槛
let s4f = ingestReceipt(
  state,
  'req-004',
  {
    systemId: 'sys-marketing',
    requestVersion: 1,
    processedAt: ts(4),
    dedupKey: 'MKT-FAIL-1',
    isFinal: true,
    outcome: 'failure',
    resultDetail: '触达停止任务回执失败',
    evidenceDigest: '',
  },
  operator,
)
assert.equal(get(s4f, 'req-004').status, 'review-required')
s4f = ingestReceipt(
  s4f,
  'req-004',
  {
    systemId: 'sys-marketing',
    requestVersion: 1,
    processedAt: ts(5),
    dedupKey: 'MKT-OK-REDONE',
    isFinal: true,
    outcome: 'success',
    resultDetail: '重试成功',
    evidenceDigest: 'MKT-REDONE',
  },
  operator,
)
// 补齐合并/复核人工任务（系统任务已由回执完成）
for (const task of get(s4f, 'req-004').tasks.filter(
  (t) =>
    !t.id.endsWith('-close') &&
    t.status !== 'completed' &&
    !(t.systemId === 'sys-marketing'),
)) {
  s4f = taskAction(s4f, 'req-004', task.id, 'complete', '人工任务完成', operator)
}
s4f = closeRequest(s4f, 'req-004', '单系统确认完成', '提前关闭。', operator)
assert.equal(get(s4f, 'req-004').status, 'completed', '当前版本最终成功回执齐备后可关闭')
console.log('✓ 场景2b：失败重试成功、任务齐备后关闭通过')

s1 = ingestReceipt(
  s1,
  'req-001',
  {
    systemId: 'sys-support',
    requestVersion: 1,
    processedAt: ts(5),
    dedupKey: 'SUPPORT-OK-2',
    isFinal: true,
    outcome: 'success',
    resultDetail: '重试后附件导出成功',
    evidenceDigest: 'RC-SUPPORT-2',
  },
  operator,
)
assert.equal(
  get(s1, 'req-001').conflicts.filter((c) => c.includes('sys-support')).length,
  0,
  '新成功回执应清除该系统失败复核项',
)
console.log('✓ 场景2c：成功回执覆盖失败回执后复核项清除')

// --- 场景 3：关闭后重复回执不改状态；版本升级旧回执作废；旧版本迟到留痕不回滚 ---
let s4 = closeRequest(state, 'req-004', '同意撤回完成', '提前关闭：单系统已确认。', operator)
assert.equal(get(s4, 'req-004').status, 'completed')
s4 = ingestReceipt(
  s4,
  'req-004',
  {
    systemId: 'sys-marketing',
    requestVersion: 1,
    processedAt: ts(-10),
    dedupKey: 'MKT-WD-9014',
    isFinal: true,
    outcome: 'success',
    resultDetail: '迟到重复送达',
    evidenceDigest: 'X',
  },
  operator,
)
assert.equal(get(s4, 'req-004').status, 'completed', '重复回执不得改回已关闭请求')
s4 = saveRequest(
  s4,
  'req-004',
  { affectedSystemIds: ['sys-marketing', 'sys-crm'] },
  operator,
)
assert.equal(get(s4, 'req-004').version, 2, '涉及系统改动应升级版本')
assert.equal(get(s4, 'req-004').status, 'review-required', '版本升级后回复核队列')
assert.ok(
  get(s4, 'req-004').receipts.every((r) => r.status === 'superseded'),
  '旧版本回执应全部作废',
)
assert.ok(
  get(s4, 'req-004').tasks.some((t) => t.status === 'completed'),
  '版本升级后已完成任务保留',
)
s4 = ingestReceipt(
  s4,
  'req-004',
  {
    systemId: 'sys-marketing',
    requestVersion: 1,
    processedAt: ts(-30),
    dedupKey: 'MKT-STALE-V1',
    isFinal: true,
    outcome: 'success',
    resultDetail: '旧结论迟到',
    evidenceDigest: 'OLD',
  },
  operator,
)
assert.equal(get(s4, 'req-004').status, 'review-required', '旧版本迟到回执不得回滚结论')
assert.ok(
  get(s4, 'req-004').receipts.some(
    (r) => r.dedupKey === 'MKT-STALE-V1' && r.status === 'superseded',
  ),
  '旧版本迟到回执应留痕作废',
)
assert.throws(
  () =>
    ingestReceipt(
      s4,
      'req-004',
      {
        systemId: 'sys-marketing',
        requestVersion: 3,
        processedAt: ts(),
        dedupKey: 'FUTURE',
        isFinal: true,
        outcome: 'success',
        resultDetail: '未来版本',
        evidenceDigest: '',
      },
      operator,
    ),
  /高于请求当前版本/,
)
console.log('✓ 场景3：版本升级旧回执作废、旧版本迟到留痕不回滚、未来版本拒绝')

// v2 两系统成功回执齐备 -> 可再次关闭
for (const [systemId, key, detail] of [
  ['sys-marketing', 'MKT-V2-OK', 'v2 重新撤回'],
  ['sys-crm', 'CRM-V2-OK', 'v2 客户库处理'],
]) {
  s4 = ingestReceipt(
    s4,
    'req-004',
    {
      systemId,
      requestVersion: 2,
      processedAt: ts(6),
      dedupKey: key,
      isFinal: true,
      outcome: 'success',
      resultDetail: detail,
      evidenceDigest: `${key}-DG`,
    },
    operator,
  )
}
s4 = closeRequest(s4, 'req-004', 'v2 全部系统确认', '范围变更经复核后提前关闭。', operator)
assert.equal(get(s4, 'req-004').status, 'completed')
console.log('✓ 场景4：新版本全部系统确认后可重新关闭')

// --- 场景 5：系统改动上报 ---
// 先补齐 req-001 人工任务，使其原本满足关闭条件（仅回执门槛会被系统改动打破）
let s5pre = s1
for (const task of get(s5pre, 'req-001').tasks.filter(
  (t) => !t.id.endsWith('-close') && t.status !== 'completed',
)) {
  s5pre = taskAction(s5pre, 'req-001', task.id, 'complete', '人工任务完成', operator)
}
const s5 = reportSystemChange(s5pre, 'sys-crm', '数据模型 v3 上线迁移', operator)
const r1 = get(s5, 'req-001')
assert.equal(r1.status, 'review-required', '已关闭请求也应回到复核队列')
assert.ok(
  r1.receipts
    .filter((receipt) => receipt.systemId === 'sys-crm')
    .every((receipt) => receipt.status === 'superseded'),
  '该系统旧回执应全部作废',
)
assert.ok(r1.evidence.length > 0, '证据必须保留')
assert.ok(
  r1.conflicts.some((c) => c.includes('系统回执待确认') && c.includes('sys-crm')),
  '应登记待确认复核项',
)
assert.throws(
  () => closeRequest(s5, 'req-001', '尝试关闭', '提前关闭。', operator),
  /(未解决冲突|最终成功回执)/,
  '系统改动后进入复核且缺少当前版本回执，禁止关闭',
)
console.log('✓ 场景5：系统改动批量作废旧回执，已关闭请求重开复核，任务证据保留')

// --- 场景 6：冲突回执回复核；非涉及系统回执拒绝；非最终回执不满足门槛 ---
let s6 = ingestReceipt(
  state,
  'req-004',
  {
    systemId: 'sys-marketing',
    requestVersion: 1,
    processedAt: ts(),
    dedupKey: 'MKT-PROC-1',
    isFinal: false,
    outcome: 'success',
    resultDetail: '仍在处理中',
    evidenceDigest: '',
  },
  operator,
)
assert.notEqual(get(s6, 'req-004').status, 'completed', '非最终回执不得导致完成')
s6 = ingestReceipt(
  s6,
  'req-004',
  {
    systemId: 'sys-marketing',
    requestVersion: 1,
    processedAt: ts(1),
    dedupKey: 'MKT-CONFLICT-1',
    isFinal: true,
    outcome: 'conflict',
    resultDetail: '同意记录与审计日志不一致',
    evidenceDigest: '',
  },
  operator,
)
assert.equal(get(s6, 'req-004').status, 'review-required')
assert.throws(
  () =>
    ingestReceipt(
      s6,
      'req-004',
      {
        systemId: 'sys-risk',
        requestVersion: 1,
        processedAt: ts(),
        dedupKey: 'X',
        isFinal: true,
        outcome: 'success',
        resultDetail: '不在范围内',
        evidenceDigest: '',
      },
      operator,
    ),
  /不在该请求的涉及系统范围/,
)
console.log('✓ 场景6：非最终回执不算确认、结果冲突回复核、非涉及系统回执拒绝')

console.log('\n全部跨系统回执规则验证通过 ✔')
