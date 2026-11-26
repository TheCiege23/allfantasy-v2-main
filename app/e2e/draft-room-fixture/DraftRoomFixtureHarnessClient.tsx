'use client'

import { DraftBoard } from '@/components/draft/DraftBoard'
import type { DraftSessionSnapshot } from '@/lib/live-draft-engine/types'
import { FIXTURE_LEAGUE_ID } from './fixtures'

/** Mirrors /drafts/[draftId]'s wrapper for a redraft snake room, with the fixture snapshot. */
export default function DraftRoomFixtureHarnessClient({
  initialSnapshot,
  poolCount,
}: {
  initialSnapshot: DraftSessionSnapshot
  poolCount: number
}) {
  return (
    <div
      className="min-h-screen bg-[radial-gradient(ellipse_100%_60%_at_50%_0%,rgba(34,211,238,0.08),transparent_50%)]"
      data-testid="e2e-draft-room-fixture"
    >
      <DraftBoard
        kind="live"
        draftId={FIXTURE_LEAGUE_ID}
        leagueId={FIXTURE_LEAGUE_ID}
        leagueName="Sample Snake League"
        sport="NFL"
        isDynasty={false}
        isCommissioner={false}
        presentationVariant="redraft_snake"
        initialSnapshot={initialSnapshot}
        initialPoolReadiness={{ ready: true, entryCount: poolCount, source: 'db-cache', syncedAt: initialSnapshot.updatedAt }}
      />
    </div>
  )
}
