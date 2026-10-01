import type { WorkspaceState } from '@/types/domain'
import { workspaceStateSchema } from './schemas'

const STORAGE_KEY = 'privacy-rights-workbench-v1'

export function loadWorkspace(): WorkspaceState | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = workspaceStateSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function saveWorkspace(state: WorkspaceState): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function clearWorkspace(): void {
  if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY)
}
