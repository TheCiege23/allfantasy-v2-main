'use client'

import { useState } from 'react'
import { SessionProvider } from 'next-auth/react'
import { SurvivorGuillotineLeague } from '@/components/survivor-guillotine/SurvivorGuillotineLeague'
import { SG_LEAGUE_ID, installSgHarnessFetch, type SgHarnessMood } from './fixtures'

/** Harness only (app/e2e is 404 in production). The real island, as app/survivor-guillotine/[leagueId] renders it. */
export default function SgLeagueHarnessClient({ mood }: { mood: SgHarnessMood }) {
  // Synchronously, during the first render, so it is in place before the island's first fetch.
  useState(() => installSgHarnessFetch(mood))
  return (
    <SessionProvider session={{ user: { id: 'e2e-sg-viewer', name: 'Ciege' }, expires: '2099-01-01T00:00:00.000Z' } as never}>
      <SurvivorGuillotineLeague leagueId={SG_LEAGUE_ID} />
    </SessionProvider>
  )
}
