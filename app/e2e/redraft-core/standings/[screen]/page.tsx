import { notFound } from 'next/navigation'
import { Standings } from '@/components/core-app/screens/Standings'
import { SeasonOutlookLeague } from '@/components/core-app/screens/SeasonOutlookLeague'
import { CommissionerHub } from '@/components/core-app/screens/CommissionerHub'
import { BracketChallenge } from '@/components/core-app/screens/BracketChallenge'
import { coreShellRedraftSport } from '@/lib/core-app/coreShellRedraftIdentity'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { SportKey } from '@/lib/brackets/sportShell'
import RedraftCoreStandingsHarnessShell from '../RedraftCoreStandingsHarnessShell'
import {
  HARNESS_LEAGUE_ID,
  HARNESS_LEAGUE_NAME,
  harnessBracket,
  harnessChecklist,
  harnessCommissioner,
  harnessOdds,
  harnessOutlook,
  harnessStandings,
} from '../fixtures'

/**
 * DB-free render of the /core Standings, Season Outlook, Commissioner and Brackets screens inside the real
 * AfCoreShell with a native redraft league open (batch B6), for visual review
 * (scripts/redraft-core-standings-capture.mjs). Production is refused by app/e2e/layout.tsx and here.
 *
 *   /e2e/redraft-core/standings/standings?sport=NBA
 *   /e2e/redraft-core/standings/commissioner?sport=MLB&health=none   ← health score unavailable
 *   /e2e/redraft-core/standings/season-outlook?sport=NHL&identity=off ← no stamp (the default look)
 *   /e2e/redraft-core/standings/standings?sport=NFL&leagueType=dynasty ← a non-redraft league: no stamp
 *
 * The stamp goes through the real decision (lib/core-app/coreShellRedraftIdentity.ts).
 *
 * ⚠ THE COMMISSIONER SCREEN'S STREAMED REPORTS STILL CALL PRISMA (`loadAuditTimeline`, the charts). They
 * catch their own failures, so start the dev server with DATABASE_URL pointed at an unreachable sentinel
 * (the capture script's header says how) and they render their "unavailable" states. Never point it at
 * a real database for a capture.
 */
const SCREENS = ['standings', 'season-outlook', 'commissioner', 'bracket'] as const
type Screen = (typeof SCREENS)[number]

const BRACKET_SPORT: Record<string, SportKey> = { NFL: 'nfl', NBA: 'nba', NHL: 'nhl', MLB: 'mlb', NCAAF: 'ncaa', NCAAB: 'ncaa', SOCCER: 'world-cup' }

export default async function RedraftCoreStandingsHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ screen: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { screen: raw } = await params
  if (!(SCREENS as readonly string[]).includes(raw)) notFound()
  const screen = raw as Screen
  const sp = await searchParams
  const sport = normalizeToSupportedSport(sp.sport ?? 'NFL')
  const redraftSport =
    sp.identity === 'off' ? null : coreShellRedraftSport({ platform: 'allfantasy', sport, leagueType: sp.leagueType ?? 'redraft' })

  let body: React.ReactNode
  let checklist: ReturnType<typeof harnessChecklist> | null = null
  if (screen === 'standings') {
    const data = harnessStandings()
    body = <Standings data={data} odds={sp.odds === 'none' ? null : harnessOdds(data)} />
  } else if (screen === 'season-outlook') {
    const { league, swing, basis } = harnessOutlook()
    body = <SeasonOutlookLeague league={league} swing={swing} basis={basis} />
  } else if (screen === 'commissioner') {
    checklist = harnessChecklist(new Date())
    body = <CommissionerHub data={harnessCommissioner(sp.health !== 'none')} />
  } else {
    body = <BracketChallenge data={harnessBracket(BRACKET_SPORT[sport] ?? 'nfl')} />
  }

  return (
    <RedraftCoreStandingsHarnessShell
      active={screen === 'bracket' ? 'tools' : screen}
      sport={sport}
      redraftSport={redraftSport}
      leagueId={HARNESS_LEAGUE_ID}
      leagueName={HARNESS_LEAGUE_NAME}
      checklist={checklist}
    >
      {body}
    </RedraftCoreStandingsHarnessShell>
  )
}
