'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import MockDraftSimulatorWrapper from '@/components/mock-draft/MockDraftSimulatorWrapper'

const E2E_LEAGUES = [
  { id: 'e2e-league-nfl', name: 'E2E NFL League', platform: 'AllFantasy', leagueSize: 12, sport: 'NFL' },
]

function E2EMockDraftRoomHarnessInner() {
  const searchParams = useSearchParams()
  const mode = searchParams.get('mode') ?? 'setup'

  const initialSessionDraft =
    mode === 'active'
      ? {
          id: 'mock-e2e-1',
          inviteLink: 'https://allfantasy.ai/mock-draft/join?invite=e2e',
          status: 'pre_draft' as const,
          canManage: true as const,
        }
      : null

  return (
    <div className="min-h-screen bg-[#040915] p-4 text-white">
      <h1 className="sr-only">E2E mock draft room</h1>
      <MockDraftSimulatorWrapper leagues={E2E_LEAGUES} initialSessionDraft={initialSessionDraft} />
    </div>
  )
}

export default function E2EMockDraftRoomHarnessClient() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#040915] p-4 text-white/75">Loading…</div>}>
      <E2EMockDraftRoomHarnessInner />
    </Suspense>
  )
}
