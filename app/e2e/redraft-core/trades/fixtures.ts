/**
 * Fixture data for the /core Trades + War Room harness (batch B4 of the redraft visual upgrade).
 * Harness only — app/e2e is notFound() in production. Every value here is a FIXTURE, typed against the
 * real loader shapes so a shape change breaks the typecheck rather than the screenshot.
 *
 * The API responses the Trade Center fetches client-side (rosters, the trades panel) are NOT here: the
 * capture script (scripts/redraft-core-trades-capture.mjs) answers them from
 * `trades-api-fixture.json` with `page.route`, so the browser never reaches a route handler — and so
 * never a database.
 */
import type { TradesData, TradeRecord } from '@/lib/core-app/trades'
import type { TradeDeadlineCountdown } from '@/lib/trade-deadline/tradeDeadlineCountdown'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { ScoutData, ScoutedManager } from '@/lib/core-app/scout'
import type { ConnectedFranchiseWarRoomSide } from '@/components/core-app/screens/ConnectedFranchiseWarRoom'

export const HARNESS_LEAGUE_ID = 'e2e-redraft-core-trades'

/** The deadline states the bar can show, each from the server verdict the real page passes. */
export const DEADLINE_FIXTURES: Record<string, TradeDeadlineCountdown | null> = {
  open: { state: 'weeks', deadlineWeek: 12, currentWeek: 9, weeksLeft: 3 },
  final: { state: 'weeks', deadlineWeek: 12, currentWeek: 12, weeksLeft: 0 },
  passed: { state: 'closed', by: 'week', deadlineWeek: 12, closesAtIso: null },
  none: { state: 'none' },
  scheduled: { state: 'scheduled', deadlineWeek: 12, closesAtIso: null },
  unknown: null,
}

function grade(letter: 'A' | 'B' | 'C' | 'D' | 'F', partnerLetter: 'A' | 'B' | 'C' | 'D' | 'F', getValue: number, giveValue: number, label: string): TradeGradeView {
  return {
    graded: true,
    letter,
    partnerLetter,
    percentDiff: Math.round(((getValue - giveValue) / Math.max(1, giveValue)) * 100),
    label,
    sideAdvantage: getValue >= giveValue ? 'give' : 'get',
    action: 'accept',
    recommendation: getValue >= giveValue ? 'Take it — you come out ahead on league value.' : 'Ask for more before you say yes.',
    giveValue,
    getValue,
    giveMarket: giveValue,
    getMarket: getValue,
    basis: 'Redraft · 12 teams · Half PPR',
    scoringApplied: true,
    needApplied: false,
    needGap: null,
    lines: [],
    moves: [],
  } as unknown as TradeGradeView
}

const completed: TradeRecord[] = [
  {
    transactionId: `${HARNESS_LEAGUE_ID}:t-101`,
    season: 2026,
    week: 7,
    rosterIds: ['1', '4'],
    yourSide: 'in',
    playersIn: 1,
    playersOut: 2,
    picks: 0,
    partnerTeamName: 'Gridiron Ghosts',
    at: new Date('2026-10-20T15:00:00Z'),
    players: [
      { manager: 'You', isYou: true, received: [{ sleeperId: '4034', name: 'Christian McCaffrey', position: 'RB', team: 'SF' }] },
      {
        manager: 'Gridiron Ghosts',
        isYou: false,
        received: [
          { sleeperId: '6794', name: 'Justin Jefferson', position: 'WR', team: 'MIN' },
          { sleeperId: '5859', name: 'A.J. Brown', position: 'WR', team: 'PHI' },
        ],
      },
    ],
    leagueGrade: grade('B', 'C', 6820, 6110, 'Good deal'),
  } as unknown as TradeRecord,
  {
    transactionId: `${HARNESS_LEAGUE_ID}:t-088`,
    season: 2026,
    week: 4,
    rosterIds: ['1', '7'],
    yourSide: 'out',
    playersIn: 1,
    playersOut: 1,
    picks: 0,
    partnerTeamName: 'Hardwood Heroes',
    at: new Date('2026-09-29T15:00:00Z'),
    players: [
      { manager: 'You', isYou: true, received: [{ sleeperId: '8138', name: 'Breece Hall', position: 'RB', team: 'NYJ' }] },
      { manager: 'Hardwood Heroes', isYou: false, received: [{ sleeperId: '7564', name: "Ja'Marr Chase", position: 'WR', team: 'CIN' }] },
    ],
    leagueGrade: { graded: false, reason: 'One asset in this trade could not be priced on this league’s chart.', basis: null } as unknown as TradeGradeView,
  } as unknown as TradeRecord,
]

export function tradesFixture(deadline: string): TradesData {
  const countdown = deadline in DEADLINE_FIXTURES ? DEADLINE_FIXTURES[deadline] : DEADLINE_FIXTURES.open
  return {
    league: { id: HARNESS_LEAGUE_ID, name: 'Sunday Night Redraft', platform: 'sleeper', sourceLink: null },
    gradingContext: { available: true, data: { leagueName: 'Sunday Night Redraft', format: 'Redraft · Half PPR', teamCount: 12 } },
    history: { available: true, data: completed },
    inbox: { available: true, data: [] },
    sent: { available: true, data: [] },
    grades: { available: true, data: [] },
    canonicalHistory: true,
    deadline:
      deadline === 'none'
        ? { available: true, data: { week: null, regularSeasonLength: 14, none: true } }
        : deadline === 'unknown'
          ? { available: false, reason: 'this league’s trade deadline is not ingested' }
          : { available: true, data: { week: 12, regularSeasonLength: 14, none: false } },
    deadlineCountdown: countdown,
    pickTradeDeadline: null,
    agentIdeas: {
      available: true,
      data: [
        {
          id: 'idea-1',
          partnerName: 'Gridiron Ghosts',
          give: [{ name: 'Tee Higgins', position: 'WR' }],
          get: [{ name: 'Jonathan Taylor', position: 'RB' }],
          letter: 'B',
          partnerLetter: 'C',
          percentDiff: 4,
          viewerFitPct: 9,
          partnerFitPct: 6,
          basis: 'Redraft · Half PPR',
          runDate: '2026-10-30',
        },
      ],
    },
  }
}

/* ── War Room ───────────────────────────────────────────────────────────────────────────────────── */

function manager(id: string, team: string, owner: string, seed: number, w: number, l: number, pf: number, form: Array<'W' | 'L' | 'T'>, zone: 'bye' | 'playoff' | 'bubble' | 'out', extra: Partial<ScoutedManager> = {}): ScoutedManager {
  return {
    managerId: id,
    teamName: team,
    ownerName: owner,
    avatarUrl: null,
    isYou: false,
    isNextOpponent: false,
    standing: { seed, record: { wins: w, losses: l, ties: 0 }, pointsFor: pf, pointsAgainst: pf - 40, form, zone, gamesBack: seed === 1 ? null : seed - 1, powerRank: seed },
    eliminated: null,
    picks: null,
    ...extra,
  }
}

export function scoutFixture(sport: string): ScoutData {
  const you = manager('m1', 'Ciege Squad', 'ciege', 3, 6, 2, 912.4, ['W', 'W', 'L', 'W', 'W'], 'playoff', { isYou: true })
  const opp = manager('m2', 'Gridiron Ghosts', 'ghosts', 1, 7, 1, 968.0, ['W', 'W', 'W', 'L', 'W'], 'bye', { isNextOpponent: true })
  return {
    league: { id: HARNESS_LEAGUE_ID, name: 'Sunday Night Redraft', sport },
    you: { managerId: 'm1', teamName: 'Ciege Squad', standing: you.standing },
    week: { seasonYear: 2026, week: 9 },
    opponent: { managerId: 'm2', teamName: 'Gridiron Ghosts', headToHead: { wins: 1, losses: 2, ties: 0 } },
    managers: {
      available: true,
      data: [
        opp,
        manager('m3', 'Hardwood Heroes', 'heroes', 2, 6, 2, 930.1, ['L', 'W', 'W', 'W', 'L'], 'bye'),
        you,
        manager('m4', 'Blue Line Bandits', 'bandits', 4, 5, 3, 880.6, ['W', 'L', 'W', 'L', 'W'], 'playoff'),
        manager('m5', 'Stitch City', 'stitch', 7, 4, 4, 842.2, ['L', 'L', 'W', 'W', 'L'], 'bubble'),
        manager('m6', 'Pitch Perfect', 'pitch', 11, 2, 6, 760.9, ['L', 'L', 'L', 'W', 'L'], 'out'),
      ],
    },
    basis: { available: true, data: { season: 2026, throughWeek: 8, seasonComplete: false, orderBasis: 'Ordered by seed.' } },
    format: { kind: 'redraft', elimination: false, bestBall: false, dynasty: false, picks: null },
  } as ScoutData
}

export function franchiseSidesFixture(sport: string): ConnectedFranchiseWarRoomSide[] {
  const base = (memberId: string, leagueId: string | null, name: string, platform: string, players: number | null, current: boolean): ConnectedFranchiseWarRoomSide => ({
    memberId,
    role: current ? 'primary' : 'member',
    leagueId,
    memberLeagueId: `${platform}-${memberId}`,
    name,
    platform,
    sport,
    season: 2026,
    teamLabel: 'Ciege Squad',
    teamCandidates: [],
    avatarUrl: null,
    playerCount: players,
    unavailableReason: players == null ? 'This league’s roster has not been read yet.' : null,
    players: [
      { id: `${memberId}-1`, name: 'Player One', position: 'RB', team: 'SF' },
      { id: `${memberId}-2`, name: 'Player Two', position: 'WR', team: 'MIN' },
      { id: `${memberId}-3`, name: 'Player Three', position: 'QB', team: 'BUF' },
    ],
    draft: { phase: 'complete', headline: 'Draft complete', detail: 'Picked 3rd of 12', href: null },
    activity: { available: true, trades: 2, waivers: 9, rosterMoves: 4, newest: '2026-10-29T15:00:00Z', capped: false, since: '2026-09-04T15:00:00Z' },
    sync: { lastSyncedAt: '2026-10-31T13:05:00Z', stale: !current, refreshHref: current ? null : '/core/connect-leagues', detail: current ? 'Synced from the league itself.' : 'Last import is a day old.' },
  })
  return [base('fm1', HARNESS_LEAGUE_ID, 'Sunday Night Redraft', 'sleeper', 16, true), base('fm2', 'e2e-redraft-core-trades-2', 'Office Redraft', 'espn', 15, false)]
}
