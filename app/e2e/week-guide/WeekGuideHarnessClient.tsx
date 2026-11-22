'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import WeekBoard from '@/components/core-app/boards/WeekBoard'
import { WeekGuide, WeekToolsDisclosure } from '@/components/core-app/week/WeekGuide'
import type { EliminationWeek, WeekBoard as WeekBoardData, WeekMatchup } from '@/lib/core-app/weekBoard'
import type { WeeklyCalendar } from '@/lib/core-app/weeklyCalendar'
import type { LineupFact } from '@/lib/core-app/weekGuide'

/**
 * Harness only (app/e2e is 404 in production). SAMPLE data throughout — leagues, opponents, scores and
 * kickoffs are invented to exercise every section, not read from anywhere.
 */
function game(id: string, name: string, over: Partial<WeekMatchup>): WeekMatchup {
  return {
    leagueId: id,
    leagueName: name,
    platform: 'sleeper',
    leagueImageUrl: null,
    season: 2026,
    week: 10,
    opponent: { rosterId: `o-${id}`, name: `Sample Rival ${id.toUpperCase()}`, avatarUrl: null },
    elimination: false,
    projection: null,
    form: null,
    yourSampleWeeks: 8,
    live: null,
    href: '#',
    ...over,
  }
}
const proj = (you: number, them: number, wp: number) => ({ you, them, margin: you - them, winProbability: wp })

function elim(id: string, name: string, over: Partial<EliminationWeek>): EliminationWeek {
  return {
    leagueId: id,
    platformLeagueId: id,
    yourRosterId: 'me',
    leagueName: name,
    platform: 'sleeper',
    leagueImageUrl: null,
    season: 2026,
    week: 10,
    yourScore: null,
    cutLine: null,
    rank: null,
    fieldSize: 0,
    margin: null,
    onTheBlock: false,
    labelled: true,
    href: '#',
    ...over,
  }
}

const BOARD: WeekBoardData = {
  season: 2026,
  week: 10,
  coinFlips: [
    game('a', 'Sample Zombie League', { projection: proj(65.2, 62.4, 0.47), live: { you: 31, them: 38.1, margin: -7.1, final: false } }),
    game('b', 'Sample Pro H2H League', { projection: proj(118.4, 110.3, 0.58) }),
    game('c', 'Sample Dynasty C', { projection: proj(132, 134.5, 0.46) }),
  ],
  leaning: [
    game('d', 'Sample Dynasty D', { projection: proj(165.3, 117.6, 0.86) }),
    game('e', 'Sample Keeper E', { projection: proj(122.6, 140.5, 0.24), live: { you: 71, them: 66.6, margin: 4.4, final: false } }),
    game('f', 'Sample Pirate F', { projection: proj(124.8, 30.1, 0.97) }),
    game('g', 'Sample Redraft G', { projection: proj(170.7, 123.1, 0.81), live: { you: 40, them: 67.2, margin: -27.2, final: false } }),
  ],
  unprojected: [game('h', 'Sample New League H', {})],
  eliminationWeeks: [
    elim('s1', 'Sample Guillotine 1', { fieldSize: 9, yourScore: 6.4, cutLine: 6.4, margin: 0, onTheBlock: true }),
    elim('s2', 'Sample Guillotine 2', { fieldSize: 9, yourScore: 17.5, cutLine: 6.4, margin: 11.1 }),
    elim('s3', 'Sample Chopped League', {}),
  ],
  model: { basis: 'Historical scoring estimate from each roster’s own completed weeks in its own league’s scoring.', sampleSize: 47259 },
  withoutSchedule: 22,
  firstKickoffAt: '2026-11-15T14:30:00.000Z',
  leagueBoard: null,
}

const ev = (id: string, leagueId: string, leagueName: string, at: string, kind: WeeklyCalendar['events'][number]['kind'] = 'game') => ({
  id,
  leagueId,
  leagueName,
  kind,
  title: '',
  at,
  source: 'stored-lineup' as const,
  href: '#',
})

const CALENDAR: WeeklyCalendar = {
  generatedAt: '2026-11-13T12:00:00.000Z',
  through: '2026-11-20T12:00:00.000Z',
  events: [
    ...['Sample Guillotine 1', 'Sample Keeper E', 'Sample Zombie League', 'Sample Dynasty D', 'Sample Pirate F', 'Sample Redraft G', 'Sample Chopped League'].map(
      (n, i) => ev(`g9-${i}`, `k${i}`, n, '2026-11-15T14:30:00.000Z'),
    ),
    ev('g1-1', 'p1', 'Sample Pro H2H League', '2026-11-15T18:00:00.000Z'),
    ev('g1-2', 'p2', 'Sample Dynasty C', '2026-11-15T18:00:00.000Z'),
    ev('g4-1', 'p3', 'Sample Guillotine 2', '2026-11-15T21:05:00.000Z'),
    ev('w1', 'p4', 'Sample AF League', '2026-11-18T08:00:00.000Z', 'waivers'),
    ev('t1', 'p5', 'Sample Dynasty D', '2026-11-19T17:00:00.000Z', 'trade'),
  ],
  gaps: [],
}

/* SAMPLE lineup facts — one per action state: swap, fill, clean, and (no row) unknown. */
const fact = (leagueId: string, over: Partial<LineupFact>): LineupFact => ({
  leagueId,
  empty: 0,
  out: 0,
  bye: 0,
  questionable: 0,
  lockAt: '2026-11-15T18:00:00.000Z',
  locked: false,
  automatic: false,
  href: '#lineup',
  ...over,
})
const LINEUPS: LineupFact[] = [
  fact('a', { out: 1, bye: 1 }),
  fact('b', { empty: 1 }),
  fact('d', { questionable: 1 }),
  fact('e', {}),
]

const QUIET: WeekBoardData = { ...BOARD, coinFlips: [], eliminationWeeks: [], firstKickoffAt: null, withoutSchedule: 0 }

export default function WeekGuideHarnessClient({ quiet }: { quiet: boolean }) {
  const board = quiet ? QUIET : BOARD
  return (
    <AfCoreShell
      active="week"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="week-guide-harness">
        <WeekGuide board={board} calendar={quiet ? null : CALENDAR} totalLeagues={82} allHref="#" isCommissioner={!quiet} lineups={quiet ? [] : LINEUPS} />
        <WeekBoard board={board} outlook={null} rivalriesHref="#" allHref="#" totalLeagues={82} embedded />
        <WeekToolsDisclosure>
          <p style={{ padding: 18, opacity: 0.7 }}>SAMPLE — the compact Weekly Blueprint renders here on the real page.</p>
        </WeekToolsDisclosure>
      </div>
    </AfCoreShell>
  )
}
