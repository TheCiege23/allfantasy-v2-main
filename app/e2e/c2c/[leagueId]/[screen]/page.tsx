import { C2CPageFrame } from '@/app/c2c/components/C2CPageFrame'
import { notFound } from 'next/navigation'
import C2CLeagueLayout from '@/app/c2c/[leagueId]/layout'
import { C2CRosterClient } from '@/app/c2c/[leagueId]/roster/C2CRosterClient'
import { C2CMatchupClient } from '@/app/c2c/[leagueId]/matchup/C2CMatchupClient'
import { C2CPicksClient } from '@/app/c2c/[leagueId]/picks/C2CPicksClient'
import { HARNESS_USER_ID } from '../../fixtures'

const SCREENS = ['roster', 'campus', 'canton', 'matchup', 'picks'] as const
type Screen = (typeof SCREENS)[number]
const TITLE: Record<Screen, string> = {
  roster: 'C2C franchise', campus: '🎓 Campus', canton: '🏙 Canton', matchup: 'C2C matchup', picks: 'C2C picks',
}

/**
 * DB-free render of the Campus to Canton league screens — the REAL league layout and client for each screen,
 * inside the same page frame its server page draws (app/c2c/[leagueId]/<screen>/page.tsx), minus the
 * session check. The capture script answers `/api/c2c`, `/api/c2c/roster`, `/api/c2c/picks`,
 * `/api/redraft/season` and `/api/redraft/matchup` from app/e2e/c2c/fixtures.ts; every other /api/ call
 * gets a 503.
 * Production is refused by app/e2e/layout.tsx; the check below is the redundant second guard.
 *
 *   /e2e/c2c/e2e-c2c/roster
 *   /e2e/c2c/e2e-c2c/matchup     ← week 10, campus won, canton trailing
 */
export default async function C2CHarnessPage({ params }: { params: Promise<{ leagueId: string; screen: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { leagueId, screen: raw } = await params
  if (!(SCREENS as readonly string[]).includes(raw)) notFound()
  const screen = raw as Screen
  return (
    <C2CLeagueLayout>
      <C2CPageFrame leagueId={leagueId} title={TITLE[screen]} tone={screen === 'campus' || screen === 'canton' ? screen : 'neutral'}>
        {screen === 'roster' || screen === 'campus' || screen === 'canton' ? (
          <C2CRosterClient
            leagueId={leagueId}
            userId={HARNESS_USER_ID}
            hasAfSub
            initialViewMode={screen === 'roster' ? 'full' : screen}
          />
        ) : null}
        {screen === 'matchup' ? <C2CMatchupClient leagueId={leagueId} userId={HARNESS_USER_ID} /> : null}
        {screen === 'picks' ? <C2CPicksClient leagueId={leagueId} rosterId="ro-me" /> : null}
      </C2CPageFrame>
    </C2CLeagueLayout>
  )
}
