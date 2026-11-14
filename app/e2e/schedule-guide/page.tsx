import AfCoreShell from '@/components/core-app/AfCoreShell'
import LeagueSchedule from '@/components/core-app/screens/LeagueSchedule'
import type { LeagueHomeData } from '@/lib/core-app/leagueHome'
import type { TimelinePhase } from '@/lib/core-app/seasonTimeline'
import type { LeagueScoreboard, ScoreboardTeam } from '@/lib/core-app/leagueScoreboard'

/**
 * DB-free render of a league's Schedule tab with the 2026-11-13 guide. Every team and manager here is
 * SAMPLE data. Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/schedule-guide                     head-to-head league, week 10, your game live
 *   /e2e/schedule-guide?league=guillotine   no head-to-head game: the phase and what is next
 *   /e2e/schedule-guide?league=preseason    before week 1
 *   /e2e/schedule-guide?week=12             a future week (the "not played yet" note)
 * The screen's language follows the af_lang cookie, like /core.
 */
const team = (name: string, points: number | null, isYou = false): ScoreboardTeam => ({
  rosterId: name,
  teamName: name,
  managerName: null,
  avatarUrl: null,
  points,
  projected: null,
  projectedFrom: 9,
  starterCount: 9,
  isYou,
})

function board(week: number, future: boolean): LeagueScoreboard {
  const s = (n: number) => (future ? null : n)
  const games = [
    [team('Sample Warriors', s(18.1)), team('Sample You', s(20.3), true)],
    [team('Sample Birds', s(0)), team('Sample Hawks', s(0))],
    [team('Sample Donkeys', s(33.6)), team('Sample Zebras', s(0))],
    [team('Sample Comeback', s(9.7)), team('Sample Checks', s(29.0))],
  ]
  return {
    seasonYear: 2026,
    week,
    games: games.map((teams, i) => ({ matchupId: i + 1, teams, winProbability: null, unplayed: future, margin: null })),
    allUnplayed: future,
    unpaired: [],
    projectionBasis: null,
    unpricedReason: null,
  }
}

const H2H: TimelinePhase[] = [
  { key: 'regular-early', label: 'Regular season', when: 'WK 1-11', state: 'now' },
  { key: 'trade-deadline', label: 'Trade deadline', when: 'WK 11', state: 'future', detail: 'Read from this league — no trades accepted after it' },
  { key: 'regular-late', label: 'Run-in', when: 'WK 12-14', state: 'future' },
  { key: 'playoffs', label: 'Playoffs', when: 'WK 15-16', state: 'future', detail: '6 teams' },
  { key: 'championship', label: 'Championship', when: 'WK 17', state: 'future' },
  { key: 'offseason-next', label: 'Offseason', when: null, state: 'future', detail: 'Rookie draft order, keepers and taxi decisions' },
]
const GUILLOTINE: TimelinePhase[] = [
  { key: 'regular', label: 'Survive', when: 'week 1 onward', state: 'now' },
  { key: 'trade-deadline', label: 'Trade deadline', when: 'WK 11', state: 'future', detail: 'Read from this league' },
  { key: 'last-standing', label: 'Last one with a head', when: null, state: 'future', detail: 'No bracket — the league runs until one team is left' },
]
const PRESEASON: TimelinePhase[] = [
  { key: 'draft', label: 'Draft', when: null, state: 'now', detail: 'Not started' },
  { key: 'regular-early', label: 'Regular season', when: 'WK 1-11', state: 'future' },
  { key: 'trade-deadline', label: 'Trade deadline', when: 'WK 11', state: 'future', detail: 'Read from this league — no trades accepted after it' },
  { key: 'playoffs', label: 'Playoffs', when: 'WK 15-17', state: 'future', detail: '6 teams' },
]

function data(kind: string, week: number): LeagueHomeData {
  const current = kind === 'preseason' ? null : 10
  const selected = kind === 'preseason' ? 1 : week
  const future = current == null || selected > current
  return {
    league: { id: 'L-sample', variant: null, name: kind === 'guillotine' ? 'Sample Chopping Block' : 'Sample Keeper League', platform: 'sleeper', format: 'redraft', sport: 'NFL', season: 2026, currentWeek: current },
    calendar: [{ key: 'keeper', label: 'Keeper deadline', at: '2027-08-20T23:00:00.000Z', when: '2027-08-20T23:00:00.000Z', detail: 'Published in this league’s settings.' }],
    timeline: { available: true, data: kind === 'guillotine' ? GUILLOTINE : kind === 'preseason' ? PRESEASON : H2H },
    matchup:
      kind === 'h2h'
        ? { available: true, data: { week: 10, season: 2026, you: { name: 'Sample You', points: 20.3 }, opponent: { name: 'Sample Warriors', points: 18.1 }, winProbability: null } }
        : { available: false, reason: 'no head-to-head game' },
    weekPicker: { weeks: Array.from({ length: 14 }, (_, i) => i + 1), selected, current, isFuture: future },
    scoreboard: { available: true, data: board(selected, future) },
  } as unknown as LeagueHomeData
}

export default async function ScheduleGuideHarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const kind = sp.league === 'guillotine' ? 'guillotine' : sp.league === 'preseason' ? 'preseason' : 'h2h'
  const week = typeof sp.week === 'string' && /^\d+$/.test(sp.week) ? Number(sp.week) : 10
  return (
    <AfCoreShell
      active="schedule"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="schedule-guide-harness">
        <LeagueSchedule data={data(kind, week)} />
      </div>
    </AfCoreShell>
  )
}
