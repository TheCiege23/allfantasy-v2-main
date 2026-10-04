'use client'

import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import { bindClientSyncAccount } from '@/lib/core-app/clientSyncJob'

const AccountContext = createContext<string | null>(null)
export const useClientSyncAccount = () => useContext(AccountContext)

export function ClientSyncAccountProvider({ children }: { children: ReactNode }) {
  const { data, status } = useSession()
  const accountId = status === 'authenticated' ? (data?.user as { id?: string } | undefined)?.id ?? null : null
  useEffect(() => { bindClientSyncAccount(accountId) }, [accountId])
  return <AccountContext.Provider value={accountId}>{children}</AccountContext.Provider>
}
