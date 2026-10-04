'use client'

import type { ReactNode } from 'react'
import type { Session } from 'next-auth'
import { usePathname } from 'next/navigation'
import { SessionProvider } from 'next-auth/react'
import { ClientSyncAccountProvider } from './ClientSyncAccountProvider'

export default function SessionAppProvider({
  children,
  session,
}: {
  children: ReactNode
  session?: Session | null
}) {
  const pathname = usePathname() ?? ""

  // E2E harness routes should not require auth/session fetches.
  if (pathname?.startsWith('/e2e')) {
    return (
      <SessionProvider
        session={session ?? null}
        refetchInterval={0}
        refetchOnWindowFocus={false}
      >
        {children}
      </SessionProvider>
    )
  }
  return <SessionProvider session={session}><ClientSyncAccountProvider>{children}</ClientSyncAccountProvider></SessionProvider>
}
