'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { RequestStatus, RequestType } from '@/types/domain'

interface WorkspaceUiState {
  requestSearch: string
  requestType: RequestType | ''
  requestStatus: RequestStatus | ''
  selectedRequestId: string
  systemSearch: string
  auditSearch: string
  setRequestSearch: (value: string) => void
  setRequestType: (value: RequestType | '') => void
  setRequestStatus: (value: RequestStatus | '') => void
  setSelectedRequestId: (value: string) => void
  setSystemSearch: (value: string) => void
  setAuditSearch: (value: string) => void
  resetUi: () => void
}

const initialUi = {
  requestSearch: '',
  requestType: '' as const,
  requestStatus: '' as const,
  selectedRequestId: '',
  systemSearch: '',
  auditSearch: '',
}

export const useWorkspaceStore = create<WorkspaceUiState>()(
  persist(
    (set) => ({
      ...initialUi,
      setRequestSearch: (requestSearch) => set({ requestSearch }),
      setRequestType: (requestType) => set({ requestType }),
      setRequestStatus: (requestStatus) => set({ requestStatus }),
      setSelectedRequestId: (selectedRequestId) => set({ selectedRequestId }),
      setSystemSearch: (systemSearch) => set({ systemSearch }),
      setAuditSearch: (auditSearch) => set({ auditSearch }),
      resetUi: () => set(initialUi),
    }),
    {
      name: 'privacy-rights-ui-v1',
      partialize: (state) => ({
        requestSearch: state.requestSearch,
        requestType: state.requestType,
        requestStatus: state.requestStatus,
        selectedRequestId: state.selectedRequestId,
        systemSearch: state.systemSearch,
        auditSearch: state.auditSearch,
      }),
    },
  ),
)
