'use client'

import { Suspense, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { DraftBoard } from '@/components/draft/DraftBoard'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

function E2EDraftRoomHarnessInner() {
  const searchParams = useSearchParams()
  const leagueId = searchParams.get('leagueId') ?? 'e2e-default-league'
  const sport = normalizeToSupportedSport(searchParams.get('sport'))
  const isCommissioner = searchParams.get('commissioner') !== '0'
  const e2eRoom = searchParams.get('e2eRoom') === '1'

  const [entered, setEntered] = useState(e2eRoom)

  const draftId = useMemo(() => {
    const safe = leagueId.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 72)
    return `e2e-${safe || 'league'}`
  }, [leagueId])

  return (
    <div className="min-h-screen bg-[#040915] p-4" data-testid="e2e-draft-room-harness">
      {!entered ? (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
          <p className="text-sm text-white/70">E2E draft room harness</p>
          <button
            type="button"
            data-testid="draft-enter-room-button"
            className="rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100"
            onClick={() => setEntered(true)}
          >
            Enter draft room
          </button>
        </div>
      ) : (
        <DraftBoard
          kind="live"
          draftId={draftId}
          leagueId={leagueId}
          leagueName={`E2E ${leagueId}`}
          sport={sport}
          isDynasty={false}
          isCommissioner={isCommissioner}
          presentationVariant="redraft_snake"
        />
      )}
    </div>
  )
}

export default function E2EDraftRoomHarnessClient() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#040915] p-4" data-testid="e2e-draft-room-harness">
          <p className="text-center text-white/75">Loading draft room…</p>
        </div>
      }
    >
      <E2EDraftRoomHarnessInner />
    </Suspense>
  )
}
