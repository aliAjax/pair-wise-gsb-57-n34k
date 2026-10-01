import type { WorkspaceState } from '@/types/domain'
import { workspaceStateSchema } from './schemas'

const STORAGE_KEY = 'privacy-rights-workbench-v1'

export function loadWorkspace(): WorkspaceState | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = workspaceStateSchema.safeParse(
      migrateWorkspace(JSON.parse(raw) as Partial<WorkspaceState>),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** 旧版本工作区补齐请求版本与跨系统回执字段，保留既有本地演示进度 */
function migrateWorkspace(raw: Partial<WorkspaceState>): WorkspaceState {
  return {
    ...(raw as WorkspaceState),
    requests: (raw.requests ?? []).map((request) => ({
      ...request,
      version: request.version ?? 1,
      receipts: request.receipts ?? [],
    })),
  }
}

export function saveWorkspace(state: WorkspaceState): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function clearWorkspace(): void {
  if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY)
}
