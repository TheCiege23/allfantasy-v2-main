import { notFound } from 'next/navigation'
import AfCoreShell from '@/components/core-app/AfCoreShell'
import { YourWeekLeague } from '@/components/core-app/screens/YourWeekLeague'
import { WeeklyBlueprint } from '@/components/core-app/WeeklyBlueprint'
import { WeekToolsDisclosure } from '@/components/core-app/week/WeekGuide'
import type { LeagueWeekBoard } from '@/lib/core-app/weekBoard'
import type { WeekLineups } from '@/lib/core-app/weekLineups'
import type { WeeklyBlueprint as Blueprint } from '@/lib/core-app/weeklyBlueprint'
import type { WeeklyPlayoffPath } from '@/lib/core-app/weeklyPlayoffPath'

/**
 * DB-free render of one league's Your week (2026-11-14): the matchup first, the Blueprint folded under it
 * in "Week tools". Every team and manager here is SAMPLE data. Production is refused here and by
 * app/e2e/layout.tsx.
 *
 *   /e2e/your-week-guide              week 10, in progress: "you trail … 0.0 to 13.0"
 *   /e2e/your-week-guide?state=pre    before kickoff: "you vs …"
 *   /e2e/your-week-guide?state=final  final: "you beat …"
 */
const LEAGUE = 'L-sample'

function board(state: string): LeagueWeekBoard {
  const live =
    state === 'pre' ? null : state === 'final' ? { you: 141.2, them: 120.5, margin: 20.7, final: true } : { you: 0, them: 13, margin: -13, final: false }
  return {
    format: 'head-to-head',
    sport: 'NFL',
    leagueId: LEAGUE,
    leagueName: 'Sample Dynasty',
    platform: 'sleeper',
    season: 2026,
    week: 10,
    yours: {
      leagueId: LEAGUE,
      leagueName: 'Sample Dynasty',
      platform: 'sleeper',
      leagueImageUrl: null,
      season: 2026,
      week: 10,
      href: `/core/matchup?league=${LEAGUE}`,
      opponent: { rosterId: 'r2', name: 'Sample Dolphins', avatarUrl: null },
      elimination: false,
      projection: { you: 201.4, them: 222.8, margin: -21.4, winProbability: 0.31 },
      form: null,
      yourSampleWeeks: 9,
      live,
    },
    sidelines: [
      { a: { rosterId: 'r3', name: 'Sample Texans', avatarUrl: null, projected: 221.9 }, b: { rosterId: 'r4', name: 'Sample Pats', avatarUrl: null, projected: 217.0 }, aWinProbability: 0.55 },
      { a: { rosterId: 'r5', name: 'Sample Raiders', avatarUrl: null, projected: 220.6 }, b: { rosterId: 'r6', name: 'Sample Petes', avatarUrl: null, projected: 209.9 }, aWinProbability: 0.62 },
    ],
    rivalry: { wins: 2, losses: 5, ties: 0, meetings: 7, averageMargin: -24 },
    records: { r1: { wins: 2, losses: 7 }, r2: { wins: 5, losses: 4 }, r3: { wins: 5, losses: 4 }, r4: { wins: 5, losses: 4 }, r5: { wins: 4, losses: 5 }, r6: { wins: 6, losses: 3 } },
    yourRosterId: 'r1',
    yourTeamName: 'Sample You',
    yourAvatarUrl: null,
    extraMatchup: null,
  } as unknown as LeagueWeekBoard
}

const lineups = {
  byLeague: {
    [LEAGUE]: {
      leagueId: LEAGUE, yourTeam: 'Sample You', yourAvatarUrl: null, yourScore: 0,
      yourProjection: { projected: 186.8, afProjected: 186.8, afEngine: 184.7, afEngineFrom: 9, pricedFrom: 9, starterCount: 9 },
      opponentTeam: 'Sample Dolphins', opponentAvatarUrl: null, opponentScore: 13,
      opponentProjection: { projected: 231.8, afProjected: 231.8, afEngine: 233.3, afEngineFrom: 9, pricedFrom: 9, starterCount: 9 },
      unpaired: false, standing: null, scored: true, freshAt: null, source: 'live_cache', season: 2026, week: 10,
    },
  },
  projectionWeek: { season: '2026', week: 10 },
} as unknown as WeekLineups

const blueprint = {
  name: 'Sample', teamName: 'Sample You', leagueCount: 1, sports: ['NFL'], focusLeagueId: LEAGUE,
  actions: [
    { id: `${LEAGUE}:monitor`, leagueId: LEAGUE, leagueName: 'Sample Dynasty', kind: 'monitor', count: 1, href: `/core/my-team?league=${LEAGUE}`, gameAt: '2026-11-15T14:30:00Z', evidence: { empty: 0, out: 0, bye: 0, questionable: 1, players: ['Sample Receiver'] }, period: 10 },
    { id: `${LEAGUE}:playoff`, leagueId: LEAGUE, leagueName: 'Sample Dynasty', kind: 'playoff', count: 1, href: `/core/season-outlook?league=${LEAGUE}`, period: 11, playoffScenarios: { ifWin: 0.7, ifLose: 0 } },
  ],
  actionCount: 2, attentionLeagueIds: [LEAGUE], lineupReadFailed: false, coverage: [],
  sportPlans: [{ leagueId: LEAGUE, leagueName: 'Sample Dynasty', sport: 'NFL' }],
} as unknown as Blueprint

const path = {
  leagueId: LEAGUE, season: 2026, period: 10,
  points: [{ period: 10, probability: 0.3, sampledAt: '2026-11-14' }],
  historyUnavailable: false,
  swing: { week: 11, ifWin: 0.7, ifLose: 0 },
  league: {
    leagueId: LEAGUE, season: 2026, period: 10,
    you: { modelled: true, playoffPct: 0.3, status: null },
    whatDecidesIt: 'A long-shot forecast; a nonzero probability is not mathematical elimination.',
    assumptions: { iterations: 10000, computedAt: '2026-11-14T12:00:00Z', missing: [] },
  },
} as unknown as WeeklyPlayoffPath

export default async function YourWeekGuideHarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  return (
    <AfCoreShell
      active="week"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="your-week-guide-harness">
        <YourWeekLeague board={board(sp.state ?? 'live')} allWeeksHref="/core/week" lineups={lineups} />
        <WeekToolsDisclosure>
          <WeeklyBlueprint data={blueprint} path={path} />
        </WeekToolsDisclosure>
      </div>
    </AfCoreShell>
  )
}
