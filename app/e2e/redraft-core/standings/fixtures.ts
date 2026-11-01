/**
 * Fixtures for the DB-free /core Standings · Season Outlook · Commissioner · Brackets harness
 * (/e2e/redraft-core/standings/<screen>, batch B6). Harness data only — app/e2e is 404 in production.
 *
 * ⚠ THE STANDINGS BOARD IS COMPUTED, NOT TYPED IN. Twelve scored weeks of a ten-team league go through
 * the real `advanceWeek` + `buildStandingsBoard`, so the playoff line, "Clinched" and "Eliminated" on the
 * captured frames are the model's own arithmetic on these results — the same proof the live screen uses.
 * The playoff odds, the outlook simulation and the commissioner figures are hand-written fixtures and are
 * labelled as such where a reader could mistake them for a measurement.
 *
 * ⚠ NO SERVER IMPORTS. Everything imported here is pure (`standingsModel`, `weeklyChecklist`) or a type.
 */
import {
  advanceWeek,
  buildStandingsBoard,
  type RemainingGame,
  type StandingsRules,
  type TeamMeta,
  type WeekRow,
  type WeekSnapshot,
} from '@/lib/core-app/standingsModel'
import type { LeagueStandingsResult, RankTrendPoint, RecentWeek, StandingRow } from '@/lib/core-app/leagueStandings'
import type { StandingsOdds } from '@/lib/core-app/standingsOdds'
import type { OutlookLeague, OutlookTeam, SwingMatchup } from '@/lib/core-app/seasonOutlook'
import type { OutlookFocus } from '@/lib/core-app/seasonOutlookFocus'
import type { CommissionerHubData } from '@/lib/core-app/commissionerHub'
import type { BracketChallengeData } from '@/lib/core-app/bracketChallenge'
import { SPORT_ORDER, SPORT_SHELLS, firstRoundPairs, seedsPerSide, toClientShell, type SportKey } from '@/lib/brackets/sportShell'
import { buildWeeklyChecklist, type ChecklistItem } from '@/lib/commissioner/weeklyChecklist'
import { decideCoreDepth } from '@/lib/core-app/coreDepthAccess'

export const HARNESS_LEAGUE_ID = 'e2e-redraft-core-standings'
export const HARNESS_LEAGUE_NAME = 'Sunday Night Redraft'
export const SEASON = 2026
const WEEKS = 14
const SCORED = 11
const YOU = '4'

const TEAM_NAMES = [
  'Ciege Squad',
  'Hardwood Heroes',
  'Blue Line Bandits',
  'Midnight Movers',
  'Stitch & Glory',
  'Goalpost Gang',
  'Bracket Busters',
  'Pitch Perfect',
  'Waiver Wire Kings',
  'Last Pick Legends',
]
const IDS = TEAM_NAMES.map((_, i) => String(i + 1))
/** Higher wins its game; the gaps are wide at both ends so the table settles a spot each way. */
const STRENGTH: Record<string, number> = { '1': 10, '2': 8.4, '3': 6.2, '4': 6, '5': 5.7, '6': 5.4, '7': 5.1, '8': 4.8, '9': 1.4, '10': 0.2 }

export const RULES: StandingsRules = {
  playoffTeams: 6,
  playoffTeamsSource: 'league',
  byes: 2,
  regularSeasonEnd: WEEKS,
  tiebreakers: ['points_for', 'head_to_head'],
  tiebreakerSource: 'league',
  coinSeed: `${HARNESS_LEAGUE_ID}:${SEASON}`,
  rankIsOfficial: false,
  platformLabel: 'AllFantasy',
}

/** Circle-method round robin for ten teams: nine distinct rounds, repeated. */
function pairings(week: number): Array<[string, string]> {
  const n = IDS.length
  const r = (week - 1) % (n - 1)
  const rest = IDS.slice(1)
  const rotated = [...rest.slice(r), ...rest.slice(0, r)]
  const ring = [IDS[0], ...rotated]
  const out: Array<[string, string]> = []
  for (let i = 0; i < n / 2; i += 1) out.push([ring[i], ring[n - 1 - i]])
  return out
}

function score(week: number, id: string): number {
  const wobble = ((week * 7 + Number(id) * 13) % 11) - 5
  return Math.round((96 + STRENGTH[id] * 3.4 + wobble * 2.6) * 10) / 10
}

function weekRows(week: number): WeekRow[] {
  const rows: WeekRow[] = []
  pairings(week).forEach(([a, b], m) => {
    let pa = score(week, a)
    let pb = score(week, b)
    // The stronger side wins its game unless the gap is small; keeps the table readable and deterministic.
    if (STRENGTH[a] - STRENGTH[b] > 1.2 && pa <= pb) [pa, pb] = [pb + 4.2, pa]
    if (STRENGTH[b] - STRENGTH[a] > 1.2 && pb <= pa) [pa, pb] = [pb, pa + 4.2]
    rows.push({ week, rosterId: a, matchupId: m + 1, pointsFor: pa, pointsAgainst: pb })
    rows.push({ week, rosterId: b, matchupId: m + 1, pointsFor: pb, pointsAgainst: pa })
  })
  return rows
}

function teamMeta(): TeamMeta[] {
  return IDS.map((id, i) => ({ rosterId: id, name: TEAM_NAMES[i], avatarUrl: null, isYou: id === YOU, division: null, reported: null }))
}

export function harnessStandings(): LeagueStandingsResult {
  const snapshots: WeekSnapshot[] = []
  const all: WeekRow[][] = []
  for (let w = 1; w <= SCORED; w += 1) {
    const rows = weekRows(w)
    all.push(rows)
    snapshots.push(advanceWeek(snapshots[w - 2] ?? null, SEASON, w, rows, IDS, `harness-${w}`))
  }
  const unplayed: RemainingGame[] = []
  for (let w = SCORED + 1; w <= WEEKS; w += 1) for (const [a, b] of pairings(w)) unplayed.push({ week: w, a, b })
  const board = buildStandingsBoard({ season: SEASON, snapshots, unplayed, teams: teamMeta(), rules: RULES })

  const pf = new Map(IDS.map((id) => [id, 0]))
  const trend: RankTrendPoint[] = []
  const recent: RecentWeek[] = []
  all.forEach((rows, i) => {
    for (const r of rows) pf.set(r.rosterId, (pf.get(r.rosterId) ?? 0) + r.pointsFor)
    const order = [...IDS].sort((a, b) => (pf.get(b) ?? 0) - (pf.get(a) ?? 0))
    trend.push({ week: i + 1, rank: order.indexOf(YOU) + 1, pointsFor: Math.round((pf.get(YOU) ?? 0) * 10) / 10 })
  })
  for (let w = SCORED; w > SCORED - 4; w -= 1) {
    const rows = all[w - 1]
    const mine = rows.find((r) => r.rosterId === YOU)!
    const before = all.slice(0, w - 1).map((rs) => rs.find((r) => r.rosterId === YOU)!.pointsFor)
    const avg = before.length ? before.reduce((s, v) => s + v, 0) / before.length : null
    const rank = [...rows].sort((a, b) => b.pointsFor - a.pointsFor).findIndex((r) => r.rosterId === YOU) + 1
    recent.push({ week: w, pointsFor: mine.pointsFor, delta: avg == null ? null : Math.round((mine.pointsFor - avg) * 10) / 10, rank })
  }
  const rows: StandingRow[] = board.teams.map((t) => ({
    rosterId: t.rosterId,
    name: t.name,
    avatarUrl: null,
    isYou: t.isYou,
    rank: t.pfRank,
    pointsFor: t.pointsFor,
    average: t.average,
    weeksPlayed: SCORED,
    wins: t.record.wins,
    losses: t.record.losses,
    ties: t.record.ties,
    movement: t.seedMove,
  }))
  const youPf = pf.get(YOU) ?? 0
  const pace = youPf / SCORED
  return {
    available: true,
    league: { id: HARNESS_LEAGUE_ID, name: HARNESS_LEAGUE_NAME, platform: 'allfantasy' },
    season: SEASON,
    week: SCORED + 1,
    seasonComplete: false,
    teams: rows,
    you: rows.find((r) => r.isYou) ?? null,
    trend,
    recent,
    projection: {
      available: true,
      data: {
        mid: youPf + pace * (WEEKS - SCORED),
        low: youPf + (pace - 12) * (WEEKS - SCORED),
        high: youPf + (pace + 12) * (WEEKS - SCORED),
        weeksRemaining: WEEKS - SCORED,
        basis: 'Your scoring pace so far, carried over the games left.',
      },
    },
    scoredWeeks: SCORED,
    history: [],
    board,
    live: null,
  }
}

/** Fixture odds, consistent with the computed board: a settled team reads as settled, the rest fall off with seed. */
export function harnessOdds(standings: LeagueStandingsResult): StandingsOdds | null {
  if (!standings.available) return null
  const { board } = standings
  const byRoster: StandingsOdds['byRoster'] = {}
  board.teams.forEach((t, i) => {
    const settled = t.clinched ? 100 : t.zone === 'eliminated' ? 0 : null
    const pct = settled ?? Math.max(1.5, Math.min(98, 94 - i * 13.5))
    byRoster[t.rosterId] = { playoffPct: pct, byePct: i < 2 ? 70 - i * 20 : 4, modelled: true, sosRank: ((i * 3) % board.teams.length) + 1, sosOpponentMu: 108 + i }
  })
  const me = board.teams.find((t) => t.isYou)!
  return {
    byRoster,
    sosRanked: board.teams.length,
    leagueMu: 112,
    iterations: 10_000,
    you: { rosterId: me.rosterId, playoffPct: byRoster[me.rosterId].playoffPct, whatDecidesIt: 'Win one of your last two and you are in nine times in ten.' },
    stakes: null,
    basis: '10,000 simulated seasons (harness fixture).',
    href: `/core/season-outlook?league=${HARNESS_LEAGUE_ID}`,
  }
}

/* ── Season Outlook ───────────────────────────────────────────────────────────────────────────── */

function outlookTeam(id: string, seed: number, over: Partial<OutlookTeam> = {}): OutlookTeam {
  const playoff = Math.max(1, Math.min(99, 96 - seed * 9.5))
  return {
    rosterId: id,
    name: TEAM_NAMES[Number(id) - 1],
    isYou: id === YOU,
    wins: Math.max(1, 11 - seed),
    losses: Math.min(11, seed + 1),
    pointsFor: 1420 - seed * 36,
    seed,
    playoffPct: playoff,
    byePct: Math.max(0, 62 - seed * 14),
    titlePct: Math.max(0.5, 28 - seed * 3.2),
    missPct: 100 - playoff,
    range: { playoff: { lo: Math.max(0, playoff - 7), hi: Math.min(100, playoff + 6) }, bye: { lo: 2, hi: 18 }, title: { lo: 4, hi: 14 } },
    status: null,
    modelled: true,
    weeksFitted: 36,
    weeklyMean: 118 - seed,
    expectedWins: 11 - seed * 0.8,
    schedule: { pastOpponentMu: 114, remainingOpponentMu: 110, pastRank: 3, remainingRank: 6, leagueMu: 112, pastGames: 12, remainingGames: 2 },
    ...over,
  }
}

export function harnessOutlook(): { league: OutlookLeague; swing: SwingMatchup; basis: string } {
  const teams = IDS.map((id, i) => outlookTeam(id, i + 1))
  teams[0] = { ...teams[0], status: 'clinched', playoffPct: 100, missPct: 0 }
  teams[9] = { ...teams[9], status: 'eliminated', playoffPct: 0, missPct: 100 }
  const you = { ...teams[3], playoffPct: 71.6, byePct: 9.4, titlePct: 11.8, missPct: 28.4, range: { playoff: { lo: 64, hi: 78 }, bye: { lo: 6, hi: 13 }, title: { lo: 9, hi: 15 } } }
  teams[3] = you
  const focus: OutlookFocus = {
    scenario: {
      leagueId: HARNESS_LEAGUE_ID,
      basisWeek: { season: String(SEASON), week: SCORED + 1 },
      refusal: null,
      slots: ['QB', 'RB', 'WR'],
      teams: [
        { rosterId: YOU, name: TEAM_NAMES[Number(YOU) - 1], isYou: true, players: [] },
        { rosterId: '5', name: TEAM_NAMES[4], isYou: false, players: [] },
      ],
      freeAgents: [],
      sim: {
        teams: IDS.map((id, i) => ({ rosterId: id, wins: Math.max(1, 10 - i), losses: Math.min(11, i + 2), pointsFor: 1420 - i * 36, profile: { mu: 118 - i, sigma: 18, n: 36 } })),
        remaining: [
          { week: 13, a: YOU, b: '5' },
          { week: 13, a: '6', b: '7' },
          { week: 14, a: YOU, b: '6' },
          { week: 14, a: '5', b: '7' },
        ],
        playoffTeams: 6,
        byeTeams: 2,
      },
      seed: 7,
      weeks: [13, 14],
      youRosterId: YOU,
    },
    drivers: [
      { key: 'swing', label: `Week 13 vs ${TEAM_NAMES[4]}`, detail: 'Win and you are at 93%.', impact: 21.4, spread: true },
      { key: 'schedule', label: 'Remaining schedule', detail: '6th hardest of 10.', impact: -3.1, spread: false },
      { key: 'strength', label: 'Your scoring', detail: 'Fourth-best in the league.', impact: 4.8, spread: false },
    ],
    moves: [
      { key: 'lineup-13', kind: 'lineup', title: 'Set your best lineup for week 13', detail: 'Two starters are on a bye.', week: 13, pointsPerWeek: 6.2, playoffDelta: 3.8, titleDelta: 0.9, href: `/core/my-team?league=${HARNESS_LEAGUE_ID}` },
    ],
    durability: null,
    branchIterations: 2000,
    notes: [],
  }
  const league: OutlookLeague = {
    leagueId: HARNESS_LEAGUE_ID,
    leagueName: HARNESS_LEAGUE_NAME,
    platform: 'allfantasy',
    season: SEASON,
    weeksRemaining: WEEKS - SCORED,
    playoffTeams: 6,
    byeTeams: 2,
    you,
    teams,
    whatDecidesIt: 'Win one of your last two and you are in nine times in ten.',
    href: `/core?league=${HARNESS_LEAGUE_ID}`,
    milestones: {
      totalGames: WEEKS,
      winsForLikely: 8,
      winsForSafe: 9,
      cutWinsMedian: 8,
      cutWinsLow: 7,
      cutWinsHigh: 9,
      cutPointsMedian: 1540,
      cutPointsLow: 1490,
      cutPointsHigh: 1600,
      projectedWins: 8,
      projectedPoints: 1560,
      oddsByWins: [null, null, null, null, null, null, 0, 12, 71, 98, 100, null, null, null, null],
      currentWins: you.wins,
      maxWins: you.wins + 2,
    },
    assumptions: {
      iterations: 10000,
      rangeBatches: 10,
      rangeRunsPerBatch: 500,
      seasonsFitted: [2025, 2026],
      weeksFitted: { min: 34, median: 36, max: 36 },
      teams: 10,
      modelledTeams: 10,
      remainingGames: 10,
      regularSeasonEndWeek: WEEKS,
      playoffTeams: { value: 6, source: 'league' },
      byes: { value: 2, source: 'league' },
      tiebreak: 'Wins, then points for.',
      computedAt: '2026-10-31T12:00:00Z',
      reused: false,
      missing: [],
    },
    focus,
  }
  const swing: SwingMatchup = {
    leagueId: HARNESS_LEAGUE_ID,
    leagueName: HARNESS_LEAGUE_NAME,
    week: 13,
    opponentName: TEAM_NAMES[4],
    ifWin: 93.1,
    ifLose: 41.7,
    swing: 51.4,
    clinchOnWin: false,
    helpIfLose: [TEAM_NAMES[6]],
  }
  return { league, swing, basis: '10,000 simulated seasons (harness fixture).' }
}

/* ── Commissioner ─────────────────────────────────────────────────────────────────────────────── */

export function harnessChecklist(now: Date): { applies: true; week: number; items: ChecklistItem[] } {
  const week = SCORED + 1
  const items = buildWeeklyChecklist(
    {
      leagueId: HARNESS_LEAGUE_ID,
      week,
      totalWeeks: WEEKS + 3,
      playoffStartWeek: WEEKS + 1,
      lastWeekMatchups: Array.from({ length: 5 }, () => ({ status: 'final' })),
      pendingClaims: [{ submittedAt: new Date(now.getTime() - 3_600_000) }],
      processedClaimsLast7Days: 6,
      lineups: TEAM_NAMES.map((teamName, i) => ({ teamName, required: 9, filled: i === 8 ? 7 : 9, unavailable: i === 6 ? ['Questionable starter'] : [] })),
      tradesAwaitingReview: 1,
      tradeDeadlineWeek: 11,
      dues: null,
    },
    now,
  )
  return { applies: true, week, items }
}

export function harnessCommissioner(scoreAvailable: boolean): CommissionerHubData {
  return {
    allowed: true,
    formatCards: [],
    formatTemplate: null as unknown as CommissionerHubData['formatTemplate'],
    network: null,
    history: { tradeAvailable: true, draftAvailable: true, trades: [], drafts: [], tradeNote: 'Trades made in this league, newest first.', draftNote: 'Drafts held in this league.' },
    grant: { leagueId: HARNESS_LEAGUE_ID, platform: 'allfantasy', platformLeagueId: null, season: SEASON } as unknown as CommissionerHubData['grant'],
    league: { id: HARNESS_LEAGUE_ID, name: HARNESS_LEAGUE_NAME, platform: 'allfantasy', sport: 'NFL', season: SEASON, native: true },
    role: 'commissioner',
    viewerIsOwner: true,
    viewerCanBroadcast: false,
    tiles: [
      { key: 'health', label: 'League health', tone: 'good', state: scoreAvailable ? { available: true, data: { value: '84', sub: 'Healthy · 88% confidence' } } : { available: false, reason: 'not enough weeks scored yet' } },
      { key: 'needs-you', label: 'Needs you', tone: 'warn', state: { available: true, data: { value: '2', sub: 'task cards below' } } },
      { key: 'deadline', label: 'Next deadline', tone: 'neutral', state: { available: true, data: { value: 'Wk 15', sub: 'playoffs start' } } },
      { key: 'managers', label: 'Active managers', tone: 'good', state: { available: true, data: { value: '9 of 10', sub: 'moves in the last 14 days' } } },
    ],
    tasks: {
      cards: [
        { id: 't1', severity: 'warn', source: 'health', title: '1 lineup has an empty starting slot', detail: 'Waiver Wire Kings has 2 empty slots for week 13.', due: null, action: { label: 'Message the manager', href: '#ch-members', external: false } },
        { id: 't2', severity: 'info', source: 'review', title: 'A trade is waiting on your review', detail: 'Accepted 3 hours ago.', due: null, action: { label: 'Review the trade', href: '#ch-history', external: false } },
      ],
      overflow: [],
    },
    tasksEmptyReason: null,
    health: {
      score: scoreAvailable
        ? { available: true, data: { score: 84, status: 'healthy', summary: 'Healthy — active managers, full lineups, a settled schedule.', confidencePct: 88 } }
        : { available: false, reason: 'Not enough of the season is scored to grade this league yet.' },
      flags: [
        { key: 'abandoned', label: 'Abandoned teams', measured: true, severity: 'good', count: 0, headline: 'Every team is active', detail: 'Moves from every manager in the last 14 days.', names: [], action: null },
        { key: 'lineups', label: 'Lineups', measured: true, severity: 'warn', count: 1, headline: '1 team has an empty slot', detail: 'Starting lineups for week 13.', names: ['Waiver Wire Kings'], action: null },
        { key: 'schedule', label: 'Schedule', measured: true, severity: 'good', count: 0, headline: 'The schedule is complete', detail: 'Every week has its matchups.', names: [], action: null },
        { key: 'dues', label: 'Dues', measured: false, reason: 'This league does not track dues.', action: null },
      ],
    },
    members: {
      available: true,
      data: {
        rows: TEAM_NAMES.map((name, i) => ({ name, status: i === 8 ? 'inactive' : 'active', detail: i === 8 ? 'no moves in 16 days' : `${(i % 4) + 1} moves`, lastActionAt: null })),
        total: 10,
        active: 9,
        inactive: 1,
        basis: 'moves',
      },
    } as unknown as CommissionerHubData['members'],
    calendar: { events: [], gaps: [], ics: null } as unknown as CommissionerHubData['calendar'],
    areas: [],
    workflows: [],
    communities: [],
    recipes: { values: {}, saved: false, updatedAt: null, sendEnabled: false, catalog: [], chimmySpeaksUp: true } as unknown as CommissionerHubData['recipes'],
    charts: { scoring: null, balance: null, engagement: null },
    settings: [],
    access: [],
    unread: false,
    disputes: { available: false, reason: 'Not scanned in the harness.' },
    publicStandings: { enabled: false, url: `/standings/${HARNESS_LEAGUE_ID}` },
    waivers: { available: false, reason: 'No waiver run in the harness.' } as unknown as CommissionerHubData['waivers'],
    art: { label: 'Redraft', video: null, poster: '/af-robot-king.png' },
    chatHref: `/league/${HARNESS_LEAGUE_ID}?view=league_chat`,
    unclaimedTeams: 0,
    quietManagers: ['Waiver Wire Kings'],
    depth: decideCoreDepth('commissioner_depth', { live: true, startsAt: new Date('2026-01-01T00:00:00Z'), hasPlan: true }),
  } as CommissionerHubData
}

/* ── Brackets ─────────────────────────────────────────────────────────────────────────────────── */

/** The Bracket Challenge for a sport, built as `getBracketChallenge` builds it — minus the team read. */
export function harnessBracket(sport: SportKey): BracketChallengeData {
  const shell = SPORT_SHELLS[sport]
  const per = seedsPerSide(shell)
  const pairs = firstRoundPairs(shell)
  const side = (label: string) => ({
    label,
    slots: Array.from({ length: per }, (_, i) => ({ seed: i + 1, team: null, bye: shell.byeSeeds.includes(i + 1) })),
    pairs,
  })
  return {
    shell: toClientShell(shell),
    sports: SPORT_ORDER.map((key) => ({ key, label: SPORT_SHELLS[key].label, available: SPORT_SHELLS[key].available })),
    sides: [side(shell.sides[0]), side(shell.sides[1])],
    pool: [],
    seedsPending: true,
  }
}
