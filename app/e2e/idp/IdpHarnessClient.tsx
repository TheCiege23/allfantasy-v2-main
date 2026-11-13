'use client'

import { Suspense } from 'react'
import { SessionProvider } from 'next-auth/react'
import { CapRoomClient } from '@/app/idp/cap/[leagueId]/CapRoomClient'
import { ContractCenterClient } from '@/app/idp/contracts/[leagueId]/ContractCenterClient'
import IdpCapLayout from '@/app/idp/cap/layout'
import { HARNESS_USER_ID } from './fixtures'

/**
 * Harness only (app/e2e is 404 in production). Both screens wait for a signed-in user (`useSession`), and on
 * /e2e routes the app's SessionProvider is handed a null session, so this nests one with a harness user —
 * no /api/auth call is made. Mirrors app/idp/<screen>/[leagueId]/page.tsx: the client inside Suspense.
 */
export default function IdpHarnessClient({ leagueId, screen }: { leagueId: string; screen: 'cap' | 'contracts' }) {
  return (
    <SessionProvider
      session={{ user: { id: HARNESS_USER_ID, name: 'Harness', email: null, image: null }, expires: '2099-01-01T00:00:00.000Z' } as never}
      refetchInterval={0}
      refetchOnWindowFocus={false}
    >
      {/* Both routes' layouts are the same always-dark wrapper (app/idp/cap|contracts/layout.tsx). */}
      <IdpCapLayout>
        <Suspense fallback={<div className="min-h-screen bg-[#040915] p-6 text-white/50">Loading…</div>}>
          {screen === 'cap' ? <CapRoomClient leagueId={leagueId} /> : <ContractCenterClient leagueId={leagueId} />}
        </Suspense>
      </IdpCapLayout>
    </SessionProvider>
  )
}
