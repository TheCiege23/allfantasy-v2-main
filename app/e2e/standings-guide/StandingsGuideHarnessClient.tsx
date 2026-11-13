'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { Standings } from '@/components/core-app/screens/Standings'
import type { LeagueStandingsResult } from '@/lib/core-app/leagueStandings'
import type { StandingsOdds } from '@/lib/core-app/standingsOdds'
import { DEFAULT_STANDINGS_VIEW } from '@/lib/core-app/standingsView'
import { advanceWeek, buildStandingsBoard, type StandingsRules, type TeamMeta, type WeekRow, type WeekSnapshot } from '@/lib/core-app/standingsModel'

/**
 * Harness only (app/e2e is 404 in production). SAMPLE data throughout — six invented clubs, four
 * scored weeks, built through the real board model so every section draws from a real StandingsBoard.
 */
const RULES: StandingsRules = {
  playoffTeams: 3,
  playoffTeamsSource: 'league',
  byes: 0,
  regularSeasonEnd: 8,
  tiebreakers: ['points_for', 'head_to_head'],
  tiebreakerSource: 'platform',
  rankIsOfficial: false,
  platformLabel: 'Sleeper',
}
const IDS = ['1', '2', '3', '4', '5', '6']
const row = (week: number, m: number, id: string, pf: number, pa: number): WeekRow => ({ week, rosterId: id, matchupId: m, pointsFor: pf, pointsAgainst: pa })

function snapshots(weeks: number): WeekSnapshot[] {
  const out: WeekSnapshot[] = []
  for (let w = 1; w <= weeks; w += 1) {
    const rows = [
      row(w, 1, '1', 150, 120 + w), row(w, 1, '2', 120 + w, 150),
      row(w, 2, '3', w % 2 ? 132 : 104, w % 2 ? 101 : 118), row(w, 2, '4', w % 2 ? 101 : 118, w % 2 ? 132 : 104),
      row(w, 3, '5', 112 + w, 125), row(w, 3, '6', 125, 112 + w),
    ]
    out.push(advanceWeek(out[w - 2] ?? null, 2026, w, rows, IDS, `s${w}`))
  }
  return out
}
const NAMES = ['Sample Leaders', 'Sample Chasers', 'Sample Team (you)', 'Sample Rivals', 'Sample Bubble', 'Sample Longshots']
const teams = (): TeamMeta[] => IDS.map((id, i) => ({ rosterId: id, name: NAMES[i]!, avatarUrl: null, isYou: id === '3', division: null, reported: null }))

const ODDS: StandingsOdds = {
  byRoster: {
    '1': { playoffPct: 97.4, byePct: 0, modelled: true, sosRank: 4, sosOpponentMu: 104 },
    '2': { playoffPct: 21.3, byePct: 0, modelled: true, sosRank: 3, sosOpponentMu: 105 },
    '3': { playoffPct: 72.1, byePct: 0, modelled: true, sosRank: 1, sosOpponentMu: 120 },
    '4': { playoffPct: 47.1, byePct: 0, modelled: true, sosRank: 2, sosOpponentMu: 118 },
    '5': { playoffPct: 40.4, byePct: 0, modelled: true, sosRank: 5, sosOpponentMu: 110 },
    '6': { playoffPct: 21.7, byePct: 0, modelled: true, sosRank: 6, sosOpponentMu: 101 },
  },
  sosRanked: 6,
  leagueMu: 121,
  iterations: 10_000,
  you: { rosterId: '3', playoffPct: 72.1, whatDecidesIt: 'Get to 6 wins — 3 of your last 4 — and you are in nine times in ten.' },
  stakes: {
    week: 5,
    opponentName: 'Sample Bubble',
    ifWin: 87.2,
    ifLose: 61.4,
    clinchOnWin: false,
    helpIfLose: ['Sample Rivals'],
    rooting: [{ a: { id: '1', name: 'Sample Leaders' }, b: { id: '4', name: 'Sample Rivals' }, ifA: 75.0, ifB: 68.0, rootFor: '1' }],
  },
  basis: '10,000 simulations per league.',
  href: '#',
}

function data(): LeagueStandingsResult {
  return {
    available: true,
    league: { id: 'L1', name: 'Sample Redraft League', platform: 'sleeper' },
    season: 2026,
    week: 5,
    seasonComplete: false,
    teams: [],
    you: null,
    trend: [{ week: 1, rank: 3 }, { week: 2, rank: 2 }, { week: 3, rank: 3 }, { week: 4, rank: 3 }],
    recent: [{ week: 4, pointsFor: 104, delta: -14.5, rank: 4 }, { week: 3, pointsFor: 132, delta: 13.5, rank: 2 }],
    projection: { available: true, data: { mid: 1010, low: 960, high: 1060, weeksRemaining: 4, basis: 'Projects your 118.0 per week across the 4 games left.' } },
    scoredWeeks: 4,
    history: [],
    board: buildStandingsBoard({
      season: 2026,
      snapshots: snapshots(4),
      unplayed: [
        { week: 5, a: '3', b: '5' }, { week: 5, a: '1', b: '4' }, { week: 5, a: '2', b: '6' },
        { week: 6, a: '3', b: '1' }, { week: 6, a: '2', b: '4' }, { week: 6, a: '5', b: '6' },
      ],
      teams: teams(),
      rules: RULES,
    }),
  } as unknown as LeagueStandingsResult
}

export default function StandingsGuideHarnessClient() {
  return (
    <AfCoreShell
      active="standings"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="standings-guide-harness">
        <Standings data={data()} odds={ODDS} view={DEFAULT_STANDINGS_VIEW} />
      </div>
    </AfCoreShell>
  )
}
