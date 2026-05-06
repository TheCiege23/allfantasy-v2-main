'use client'

import { useSearchParams } from 'next/navigation'
import { DraftRoomPageClient } from '@/components/app/draft-room/DraftRoomPageClient'

export default function DraftRoomHarnessClient() {
  const searchParams = useSearchParams()
  const leagueId = searchParams.get('leagueId') ?? 'e2e-draft-league'
  const sport = searchParams.get('sport') ?? 'NFL'
  const isCommissioner = searchParams.get('commissioner') !== '0'

  return (
    <div className="min-h-screen bg-[#040915]" data-testid="e2e-draft-room-harness">
      <DraftRoomPageClient
        leagueId={leagueId}
        leagueName="E2E Draft Room"
        sport={sport}
        isCommissioner={isCommissioner}
        isDynasty={false}
      />
    </div>
  )
}
