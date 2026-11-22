/**
 * A synthetic demo league for Chimmy answer-quality tests. Every name is invented.
 *
 * Built to reproduce the 2026-11-15 tester report: the standings leader (Gridiron Gremlins, 5-1)
 * is only 4th in points for, while the top scorer (Turbo Tacos, 3-3) has the toughest schedule.
 * Standings are DERIVED from the weekly scores and schedule below, so they cannot disagree.
 */
import type { DemoLeagueView, DemoStandingRow } from '@/lib/demo-league/types'

export const TEAMS = [
  { slot: 1, teamName: 'Gridiron Gremlins', managerName: 'Alex Rivers' },
  { slot: 2, teamName: 'Waiver Wizards', managerName: 'Sam Holt' },
  { slot: 3, teamName: 'Turbo Tacos', managerName: 'Jordan Vale' },
  { slot: 4, teamName: 'Blitz Brigade', managerName: 'Casey Moore' },
  { slot: 5, teamName: 'Fumble Factory', managerName: 'Riley Shaw' },
  { slot: 6, teamName: 'Hail Mary Hornets', managerName: 'Morgan Price' },
] as const

/** [week, home, away] */
const SCHEDULE: Array<[number, number, number]> = [
  [1, 1, 2], [1, 3, 4], [1, 5, 6],
  [2, 1, 3], [2, 2, 5], [2, 4, 6],
  [3, 1, 4], [3, 2, 6], [3, 3, 5],
  [4, 1, 5], [4, 2, 4], [4, 3, 6],
  [5, 1, 6], [5, 2, 3], [5, 4, 5],
  [6, 1, 2], [6, 3, 4], [6, 5, 6],
]

/** Points by week, slot 1..6. */
const SCORES: Record<number, number[]> = {
  1: [118, 110, 135, 140, 95, 101],
  2: [121, 99, 117, 104, 112, 108],
  3: [109, 102, 142, 103, 128, 97],
  4: [112, 125, 138, 120, 100, 105],
  5: [104, 130, 131, 133, 111, 98],
  6: [115, 119, 128, 141, 107, 103],
}

const ROSTERS: Record<number, { starters: Array<[string, string, string]>; bench: Array<[string, string, string]> }> = {
  1: { starters: [['Josh Allen', 'QB', 'BUF'], ['Bijan Robinson', 'RB', 'ATL'], ['Puka Nacua', 'WR', 'LAR'], ['Sam LaPorta', 'TE', 'DET']], bench: [['Jaylen Warren', 'RB', 'PIT']] },
  2: { starters: [['Jalen Hurts', 'QB', 'PHI'], ['Breece Hall', 'RB', 'NYJ'], ['Garrett Wilson', 'WR', 'NYJ'], ['Mark Andrews', 'TE', 'BAL']], bench: [['Rashee Rice', 'WR', 'KC']] },
  3: { starters: [['Lamar Jackson', 'QB', 'BAL'], ['Jahmyr Gibbs', 'RB', 'DET'], ["Ja'Marr Chase", 'WR', 'CIN'], ['Trey McBride', 'TE', 'ARI']], bench: [['Tank Dell', 'WR', 'HOU']] },
  4: { starters: [['Joe Burrow', 'QB', 'CIN'], ['Saquon Barkley', 'RB', 'PHI'], ['CeeDee Lamb', 'WR', 'DAL'], ['George Kittle', 'TE', 'SF']], bench: [['Zack Moss', 'RB', 'CIN']] },
  5: { starters: [['Kyler Murray', 'QB', 'ARI'], ['Kyren Williams', 'RB', 'LAR'], ['DK Metcalf', 'WR', 'PIT'], ['Evan Engram', 'TE', 'DEN']], bench: [['Gus Edwards', 'RB', 'LAC']] },
  6: { starters: [['Geno Smith', 'QB', 'LV'], ['Rhamondre Stevenson', 'RB', 'NE'], ['Chris Olave', 'WR', 'NO'], ['Dalton Kincaid', 'TE', 'BUF']], bench: [['Jerome Ford', 'RB', 'CLE']] },
}

function deriveStandings(): DemoStandingRow[] {
  const agg = new Map<number, Omit<DemoStandingRow, 'rank'>>()
  for (const t of TEAMS) agg.set(t.slot, { slot: t.slot, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 })
  for (const [week, a, b] of SCHEDULE) {
    const pa = SCORES[week]![a - 1]!
    const pb = SCORES[week]![b - 1]!
    const ra = agg.get(a)!
    const rb = agg.get(b)!
    ra.pointsFor += pa; ra.pointsAgainst += pb
    rb.pointsFor += pb; rb.pointsAgainst += pa
    if (pa > pb) { ra.wins += 1; rb.losses += 1 } else if (pb > pa) { rb.wins += 1; ra.losses += 1 } else { ra.ties += 1; rb.ties += 1 }
  }
  return [...agg.values()]
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.pointsFor - a.pointsFor)
    .map((r, i) => ({ ...r, rank: i + 1 }))
}

export function demoChimmyFixtureView(): DemoLeagueView {
  const player = ([name, position, team]: [string, string, string]) => ({ name, position, team, headshotUrl: null })
  return {
    demo: true,
    label: 'Demo league — live sample data',
    leagueName: 'AllFantasy Demo League',
    settings: {
      sport: 'NFL', season: 2026, scoringLabel: 'PPR', leagueType: 'redraft', isDynasty: false, teamCount: 6,
      rosterPositions: ['QB', 'RB', 'WR', 'TE'], playoffTeams: 4, playoffStartWeek: 14, tradeDeadlineWeek: 11, waiverType: 'FAAB',
    },
    currentWeek: 7,
    lastSyncedAt: '2026-11-15T12:00:00.000Z',
    teams: TEAMS.map((t) => ({ ...t, initials: t.teamName.split(' ').map((w) => w[0]).join(''), color: '#336699' })),
    standings: deriveStandings(),
    matchups: [],
    weeklyScores: Object.keys(SCORES).map(Number).sort((a, b) => a - b).map((week) => ({
      week,
      scores: SCORES[week]!.map((points, i) => ({ slot: i + 1, points })),
    })),
    rosters: TEAMS.map((t) => ({ slot: t.slot, starters: ROSTERS[t.slot]!.starters.map(player), bench: ROSTERS[t.slot]!.bench.map(player) })),
    trades: [{ key: 't1', date: '2026-10-20', sides: [
      { slot: 1, received: [{ kind: 'player', name: 'Puka Nacua', position: 'WR', team: 'LAR' }] },
      { slot: 5, received: [{ kind: 'player', name: 'DK Metcalf', position: 'WR', team: 'PIT' }, { kind: 'pick', name: '2027 Round 2', position: null, team: null }] },
    ] }],
    health: null,
    alerts: [],
  }
}

/**
 * The evaluative questions a tester actually asks. Each one must get the call AND the reasoning
 * in the first reply.
 */
export const EVALUATIVE_QUESTIONS = [
  "Who's the best team in the league and why?",
  'Who is the best team right now?',
  'Which team is the most overrated?',
  'Which team is underrated?',
  'Who won the most recent trade?',
  'Who is the favorite to win the title?',
  'Which team is in the most trouble?',
  'Is Gridiron Gremlins actually good or just lucky?',
] as const

/**
 * Does a FIRST reply carry its reasoning? A bare name fails. A reasoned answer quotes at least
 * two numbers that are really in the league data and is long enough to be more than a verdict.
 * Used by the deterministic tests (as a positive control) and by the live eval.
 */
export function firstReplyHasReasoning(answer: string, view: DemoLeagueView): { ok: boolean; why: string } {
  const words = answer.trim().split(/\s+/).filter(Boolean)
  if (words.length < 25) return { ok: false, why: `only ${words.length} words` }
  const known = new Set<string>()
  for (const s of view.standings) {
    known.add(`${s.wins}-${s.losses}`)
    known.add(String(s.pointsFor))
    known.add(String(s.pointsAgainst))
  }
  for (const w of view.weeklyScores) for (const sc of w.scores) known.add(String(sc.points))
  const quoted = [...known].filter((k) => new RegExp(`(^|[^0-9.])${k.replace('.', '\\.')}([^0-9]|$)`).test(answer))
  if (quoted.length < 2) return { ok: false, why: `quotes ${quoted.length} league number(s)` }
  return { ok: true, why: `quotes ${quoted.join(', ')}` }
}
