'use client'

import ZombieLeagueShell from '@/app/zombie/[leagueId]/ZombieLeagueShell'
import { ZombieLeagueHomeClient } from '@/app/zombie/[leagueId]/ZombieLeagueHomeClient'
import ZombieStandingsPage from '@/app/zombie/[leagueId]/standings/page'
import ZombieMatchupsPage from '@/app/zombie/[leagueId]/matchups/page'
import ZombieItemsPage from '@/app/zombie/[leagueId]/items/page'
import { ZombieToastContainer } from '@/app/zombie/components/ZombieNotificationToast'

import type { ZombieHarnessScreen as Screen } from './screens'

/**
 * Harness only (app/e2e is 404 in production). Mirrors app/zombie/[leagueId]/layout.tsx — the same wrapper,
 * shell and toast host — around the REAL page component. The pages read `useParams().leagueId`, which this
 * route provides as its own `[leagueId]` segment. Home is a server page that only resolves the session, so
 * its client is mounted directly with no user (which also keeps the first-visit intro video closed).
 */
export default function ZombieHarnessClient({ leagueId, screen }: { leagueId: string; screen: Screen }) {
  return (
    <div className="af-draft-dark min-h-screen bg-[var(--zombie-bg)] text-[var(--zombie-text-mid)] antialiased">
      <ZombieLeagueShell leagueId={leagueId}>
        {screen === 'home' ? <ZombieLeagueHomeClient leagueId={leagueId} userId={null} /> : null}
        {screen === 'standings' ? <ZombieStandingsPage /> : null}
        {screen === 'matchups' ? <ZombieMatchupsPage /> : null}
        {screen === 'items' ? <ZombieItemsPage /> : null}
      </ZombieLeagueShell>
      <ZombieToastContainer />
    </div>
  )
}
