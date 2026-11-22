'use client'

import ZombieLeagueShell from '@/app/zombie/[leagueId]/ZombieLeagueShell'
import { ZombieLeagueHomeClient } from '@/app/zombie/[leagueId]/ZombieLeagueHomeClient'
import ZombieStandingsPage from '@/app/zombie/[leagueId]/standings/page'
import ZombieMatchupsPage from '@/app/zombie/[leagueId]/matchups/page'
import ZombieItemsPage from '@/app/zombie/[leagueId]/items/page'
import ZombieChatHubPage from '@/app/zombie/[leagueId]/chat/page'
import ZombieSettingsPage from '@/app/zombie/[leagueId]/settings/page'
import { ZombieRulesClient } from '@/app/zombie/[leagueId]/rules/ZombieRulesClient'
import { rules } from './fixtures'
import { ZombieToastContainer } from '@/app/zombie/components/ZombieNotificationToast'

import type { ZombieHarnessScreen as Screen } from './screens'

/**
 * Harness only (app/e2e is 404 in production). Mirrors app/zombie/[leagueId]/layout.tsx — the same wrapper,
 * shell and toast host — around the REAL page component. The pages read `useParams().leagueId`, which this
 * route provides as its own `[leagueId]` segment. Home is a server page that only resolves the session, so
 * its client is mounted directly with no user (which also keeps the first-visit intro video closed). Rules is
 * a server page too; its resolved props come from fixtures.ts and its HTML from the harness page.
 */
export default function ZombieHarnessClient({ leagueId, screen, rulesHtml = '' }: { leagueId: string; screen: Screen; rulesHtml?: string }) {
  return (
    <div className="af-draft-dark min-h-screen bg-[var(--zombie-bg)] text-[var(--zombie-text-mid)] antialiased">
      <ZombieLeagueShell leagueId={leagueId}>
        {screen === 'home' ? <ZombieLeagueHomeClient leagueId={leagueId} userId={null} /> : null}
        {screen === 'standings' ? <ZombieStandingsPage /> : null}
        {screen === 'matchups' ? <ZombieMatchupsPage /> : null}
        {screen === 'items' ? <ZombieItemsPage /> : null}
        {screen === 'chat' ? <ZombieChatHubPage /> : null}
        {screen === 'settings' ? <ZombieSettingsPage /> : null}
        {screen === 'rules' ? (
          <ZombieRulesClient
            leagueId={leagueId}
            sport={rules.sport}
            isPaid
            leagueName="Outbreak League"
            currentWeek={10}
            season={2026}
            rulesHtml={rulesHtml}
            rules={rules}
            experienceMode="enhanced"
            serumAwardHighScore
            serumAwardOnBashMaul
            infectionLossToWhisperer
            infectionLossToZombie
          />
        ) : null}
      </ZombieLeagueShell>
      <ZombieToastContainer />
    </div>
  )
}
