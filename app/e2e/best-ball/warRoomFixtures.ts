/**
 * Best Ball War Room fixtures for the DB-free harness (app/e2e/best-ball, the `war_room` screen). They answer
 * every read `BestBallWarRoomPanel` (app/league/[leagueId]/tabs/best-ball/BestBallWarRoomPanel.tsx) makes through
 * lib/best-ball-war-room/client.ts. Nothing here touches a database, a provider or the network. Harness-only.
 *
 * ONE HAND-WRITTEN INPUT, EVERYTHING ELSE COMPUTED THE WAY THE SERVER COMPUTES IT. The only literal is the
 * `BestBallWarRoomContext` — the object `buildBestBallWarRoomContext` (the one file that does DB I/O) would
 * return. Every result body is then produced by the SAME pure engine the route calls, on that context, and
 * wrapped in the same keys:
 *   - GET  /api/leagues/:id/best-ball-war-room   → handler.ts: `{ context, construction, depth, constructionLocked }`
 *   - POST /api/leagues/:id/best-ball-war-room/x → [action]/route.ts: `{ upside }`, `{ draftPlan }`, `{ stacks }`, …
 * So a body cannot say something the engine would not, and an engine change shows up here instead of drifting.
 * Each is also typed with `satisfies` against the app's exported types. The harness matches on pathname only
 * (app/e2e/harnessApi.ts has no method field), which is enough: each POST action has its own path.
 *
 * The league, matching ./fixtures.ts: "Underdog Summer Best Ball", NFL, 12 teams, 18-man rosters, 2026, week 10,
 * half PPR, underdog mode (cumulative), QB/RB/RB/WR/WR/WR/TE/FLEX. The viewer is a member (not commissioner) and
 * owns "Spike Week Society" (`e2e-bb-r01`). The league name is not part of the War Room's state — the panel never
 * shows it.
 *
 * Cases the panel draws differently, all from that one roster: WR heavy (10), TE thin (1) and fragile, QB fragile
 * (2), three non-healthy players (injury concentration flag), three on CIN (over-concentration flag), a QB + WR
 * stack on CIN and on WAS plus two non-QB stacks, a Week 12 bye cluster, a post-draft plan targeting TE.
 *
 * WAIVERS AND TRADES ARE OFF, as in every draft-only best-ball league. The panel disables those three buttons;
 * their routes are still here and answer with the engines' honest disabled state (`enabled: false`, the
 * "disabled … draft-only" flag, and for trade-analyze the grade withheld with its reason), never results.
 * `ask` (the Chimmy question box) is NOT answered: its real answer is model text, which a fixture would have to
 * invent; it gets the harness 503.
 */
import type { HarnessApiRoute } from '../harnessApi'
import type { BestBallPlayerFact, BestBallTeamSummary, BestBallWarRoomContext } from '@/lib/best-ball-war-room/types'
import { evaluateUserRosterConstruction, type BestBallConstructionResult } from '@/lib/best-ball-war-room/bestBallRosterConstructionEngine'
import { evaluateDepth, type BestBallDepthResult } from '@/lib/best-ball-war-room/bestBallDepthEngine'
import { evaluateUpside, type BestBallUpsideResult } from '@/lib/best-ball-war-room/bestBallUpsideEngine'
import { buildBestBallDraftPlan, type BestBallDraftPlanResult } from '@/lib/best-ball-war-room/bestBallDraftPlanEngine'
import { evaluateStacks, type BestBallStackResult } from '@/lib/best-ball-war-room/bestBallStackCorrelationEngine'
import { evaluateRisk, type BestBallRiskResult } from '@/lib/best-ball-war-room/bestBallRiskEngine'
import { buildBestBallWaiverRecommendations, type BestBallWaiverResult } from '@/lib/best-ball-war-room/bestBallWaiverEngine'
import {
  bestBallTradeFacts,
  findBestBallTradeTargets,
  type BestBallTradeAnalysis,
  type BestBallTradeFinderResult,
} from '@/lib/best-ball-war-room/bestBallTradeEngine'
import { warRoomTradeAnalysisForClient, type WarRoomTradeAnalysisView } from '@/lib/decision-os/trade/warRoomTradeView'
import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'

const LEAGUE_ID = 'e2e-bestball'
const BASE = `/api/leagues/${LEAGUE_ID}/best-ball-war-room`
const TEAM_COUNT = 12

/** Same names and ids as ./fixtures.ts, so the tab and the War Room describe one league. */
const TEAMS = [
  'Spike Week Society', 'Zero RB Zealots', 'Stack Attack', 'Late Round QBs', 'Bye Week Bandits', 'Correlation Station',
  'The Ceiling Fans', 'Hero RB Heroes', 'Tight End Truthers', 'Fade the Chalk', 'Pocket Aces', 'Week 17 Dreams',
]
const rosterId = (i: number) => `e2e-bb-r${String(i + 1).padStart(2, '0')}`
const USER_ROSTER_ID = rosterId(0)

/**
 * One drafted player as `toPlayerFact` (bestBallWarRoomContext.ts) builds him: `adpRound = max(1, ceil(adp / teams))`,
 * avg/max/started from weeks 1–9 of real weekly scores, `hasNoValueSignal` false because every one has ADP.
 */
function player(
  id: string, playerName: string, position: string, team: string, byeWeek: number,
  adp: number, avgPoints: number, maxPoints: number, startedWeeks: number, weekProjection: number,
  injuryStatus: string | null = null,
): BestBallPlayerFact {
  return {
    playerId: `bb-${id}`,
    playerName,
    position,
    team,
    byeWeek,
    injuryStatus,
    adp,
    adpRound: Math.max(1, Math.ceil(adp / TEAM_COUNT)),
    avgPoints,
    maxPoints,
    startedWeeks,
    weekProjection,
    hasNoValueSignal: false,
  }
}

/** "Spike Week Society": QB 2, RB 5, WR 10, TE 1 = 18 (the recommended NFL best-ball size). */
const USER_PLAYERS: BestBallPlayerFact[] = [
  player('burrow', 'Joe Burrow', 'QB', 'CIN', 12, 71.2, 18.4, 29.6, 3, 19.1),
  player('daniels', 'Jayden Daniels', 'QB', 'WAS', 7, 52.7, 21.2, 34.9, 6, 21.8),
  player('gibbs', 'Jahmyr Gibbs', 'RB', 'DET', 8, 23.4, 17.6, 38.2, 8, 17.9),
  player('achane', "De'Von Achane", 'RB', 'MIA', 6, 44.1, 14.9, 32.5, 6, 14.2),
  player('cook', 'James Cook', 'RB', 'BUF', 9, 77.5, 13.1, 26.8, 5, 13.4),
  player('hubbard', 'Chuba Hubbard', 'RB', 'CAR', 11, 133.6, 9.4, 18.7, 2, 8.1, 'Questionable'),
  player('spears', 'Tyjae Spears', 'RB', 'TEN', 10, 168.2, 5.2, 11.3, 0, 5.6),
  player('chase', "Ja'Marr Chase", 'WR', 'CIN', 12, 2.1, 18.9, 41.6, 8, 18.7),
  player('higgins', 'Tee Higgins', 'WR', 'CIN', 12, 101.4, 12.7, 27.9, 5, 12.3),
  player('stbrown', 'Amon-Ra St. Brown', 'WR', 'DET', 8, 26.8, 16.3, 30.1, 8, 15.8),
  player('mclaurin', 'Terry McLaurin', 'WR', 'WAS', 7, 112.8, 11.8, 24.4, 4, 11.6),
  player('gwilson', 'Garrett Wilson', 'WR', 'NYJ', 12, 90.3, 12.2, 22.6, 4, 12.9),
  player('london', 'Drake London', 'WR', 'ATL', 5, 82.6, 13.5, 29.3, 4, 0, 'Out'),
  player('jsn', 'Jaxon Smith-Njigba', 'WR', 'SEA', 8, 58.3, 13.9, 33.7, 5, 13.5),
  player('addison', 'Jordan Addison', 'WR', 'MIN', 6, 124.0, 9.6, 21.4, 2, 10.2),
  player('odunze', 'Rome Odunze', 'WR', 'CHI', 14, 141.9, 8.7, 19.8, 1, 9.4),
  player('coleman', 'Keon Coleman', 'WR', 'BUF', 9, 189.5, 6.1, 17.2, 0, 6.8),
  player('mcbride', 'Trey McBride', 'TE', 'ARI', 11, 63.9, 11.4, 22.8, 7, 11.9, 'Questionable'),
]

/** Standings after week 9; cumulative points decide the seed in underdog mode. */
const STANDINGS: Array<[wins: number, losses: number, pointsFor: number]> = [
  [6, 3, 1342.6], [5, 4, 1318.9], [7, 2, 1366.2], [4, 5, 1251.4], [3, 6, 1207.8], [6, 3, 1329.5],
  [5, 4, 1296.3], [4, 5, 1262.0], [2, 7, 1158.7], [5, 4, 1301.1], [3, 6, 1219.4], [4, 5, 1240.6],
]
const seedOf = (i: number) =>
  1 + STANDINGS.filter(([, , pf]) => pf > STANDINGS[i]![2]).length

/*
 * Other teams' players are empty: the GET strips them for a member (handler.ts), and every POST action the panel
 * can run here reads only the viewer's own roster — trade-find, the one action that reads other rosters, returns
 * its disabled state before looking.
 */
const teams: BestBallTeamSummary[] = TEAMS.map((teamName, i) => ({
  rosterId: rosterId(i),
  ownerId: `e2e-bb-owner-${String(i + 1).padStart(2, '0')}`,
  ownerName: i === 0 ? 'You' : teamName.split(' ')[0]!,
  teamName,
  wins: STANDINGS[i]![0],
  losses: STANDINGS[i]![1],
  ties: 0,
  pointsFor: STANDINGS[i]![2],
  playoffSeed: seedOf(i),
  isUserTeam: i === 0,
  players: i === 0 ? USER_PLAYERS : [],
}))

/** What `buildBestBallWarRoomContext` returns for this league (its availability and flag rules applied by hand). */
const CONTEXT = {
  leagueId: LEAGUE_ID,
  leagueType: 'best_ball',
  ruleConfigurationVerified: true,
  sport: 'NFL',
  season: 2026,
  teamCount: TEAM_COUNT,
  draftComplete: true,
  scoring: {
    sport: 'NFL',
    scoringPreset: 'HALF_PPR',
    scoringPeriod: 'weekly',
    matchupFormat: 'cumulative',
    cumulative: true,
  },
  // buildRosterSettings: single-position seats → requiredByPosition, the rest → flexSlots.
  roster: {
    lineupSlots: [
      { code: 'QB', count: 1, allowedPositions: ['QB'] },
      { code: 'RB', count: 2, allowedPositions: ['RB'] },
      { code: 'WR', count: 3, allowedPositions: ['WR'] },
      { code: 'TE', count: 1, allowedPositions: ['TE'] },
      { code: 'FLEX', count: 1, allowedPositions: ['RB', 'WR', 'TE'] },
    ],
    startingSlots: 8,
    recommendedRosterSize: 18,
    recommendedBenchSize: 9,
    requiredByPosition: { QB: 1, RB: 2, WR: 3, TE: 1 },
    flexSlots: [{ code: 'FLEX', count: 1, allowedPositions: ['RB', 'WR', 'TE'] }],
  },
  bestBall: {
    mode: 'underdog',
    draftMode: 'snake',
    contestStructure: 'season_long',
    waiversEnabled: false,
    tradesEnabled: false,
    substitutionsEnabled: false,
    regularSeasonLength: 14,
    draftComplete: true,
  },
  userRosterId: USER_ROSTER_ID,
  isCommissioner: false,
  teams,
  availability: {
    scoringRules: 'available',
    rosterRules: 'available',
    rosters: 'available',
    playerValues: 'available',
    weeklyScores: 'available',
    projections: 'available',
    injuries: 'available',
    news: 'available',
    teamData: 'available',
    byeWeeks: 'available',
    standings: 'available',
  },
  freshness: {
    generatedAt: '2026-11-12T15:04:00.000Z',
    scoresAsOf: '2026-11-10T09:30:00.000Z',
    injuriesAsOf: '2026-11-12T14:45:00.000Z',
  },
  // Rules verified and both off → exactly these two, in this order (bestBallWarRoomContext.ts).
  missingDataFlags: [
    'Waivers are disabled in this best-ball league (draft-only).',
    'Trades are disabled in this best-ball league (draft-only).',
  ],
  featureAvailability: {
    rosterConstruction: true,
    depth: true,
    upside: true,
    draftPlan: true,
    stacks: true,
    waivers: false,
    tradeAnalyze: false,
    tradeFind: false,
  },
} satisfies BestBallWarRoomContext

// ── GET: handler.ts. Plan held (constructionLocked false), so construction rides along. ──
const stateBody = {
  context: CONTEXT,
  construction: evaluateUserRosterConstruction(CONTEXT),
  depth: evaluateDepth(CONTEXT, USER_ROSTER_ID),
  constructionLocked: false,
} satisfies {
  context: BestBallWarRoomContext
  construction: BestBallConstructionResult | null
  depth: BestBallDepthResult | null
  constructionLocked?: boolean
}

// ── POST actions: [action]/route.ts, each with the viewer's own roster (no rosterId in the body). ──
const upsideBody = { upside: evaluateUpside(CONTEXT, USER_ROSTER_ID) } satisfies { upside: BestBallUpsideResult }
const draftPlanBody = { draftPlan: buildBestBallDraftPlan(CONTEXT, USER_ROSTER_ID) } satisfies { draftPlan: BestBallDraftPlanResult }
const stacksBody = { stacks: evaluateStacks(CONTEXT, USER_ROSTER_ID) } satisfies { stacks: BestBallStackResult }
const riskBody = { risk: evaluateRisk(CONTEXT, USER_ROSTER_ID) } satisfies { risk: BestBallRiskResult }
const waiversBody = {
  waivers: buildBestBallWaiverRecommendations(CONTEXT, USER_ROSTER_ID),
} satisfies { waivers: BestBallWaiverResult }
const tradeFindBody = {
  tradeFinder: findBestBallTradeTargets(CONTEXT, USER_ROSTER_ID),
} satisfies { tradeFinder: BestBallTradeFinderResult }

/*
 * trade-analyze: `gradeWarRoomTrade` is server-only (it builds a league trade grader), but with trades off it
 * returns before grading — `{ graded: false, reason: WAR_ROOM_TRADES_DISABLED_REASON }`. That constant
 * (lib/decision-os/trade/warRoomTradeGrade.ts) is copied here because the module cannot be imported outside the
 * server; change both together.
 */
const WAR_ROOM_TRADES_DISABLED_REASON = 'Trades are disabled in this league.'
const tradeAnalyzeBody = {
  tradeAnalysis: warRoomTradeAnalysisForClient(
    bestBallTradeFacts(CONTEXT, { rosterId: USER_ROSTER_ID, outgoingPlayerIds: [], incomingPlayerIds: [] }),
  ),
  tradeGrade: { graded: false, reason: WAR_ROOM_TRADES_DISABLED_REASON },
} satisfies { tradeAnalysis: WarRoomTradeAnalysisView<BestBallTradeAnalysis>; tradeGrade?: SuggestionGrade | null }

/*
 * JSON round-trip: the list must be plain data for scripts/e2e-harness-api.ts, and this also drops the one
 * `undefined` an engine could carry, exactly as `NextResponse.json` would.
 */
const json = <T>(body: T): T => JSON.parse(JSON.stringify(body)) as T

export const BEST_BALL_WAR_ROOM_API: HarnessApiRoute[] = [
  { path: BASE, body: json(stateBody) },
  { path: `${BASE}/upside`, body: json(upsideBody) },
  { path: `${BASE}/draft-plan`, body: json(draftPlanBody) },
  { path: `${BASE}/stacks`, body: json(stacksBody) },
  { path: `${BASE}/risk`, body: json(riskBody) },
  { path: `${BASE}/waivers`, body: json(waiversBody) },
  { path: `${BASE}/trade-analyze`, body: json(tradeAnalyzeBody) },
  { path: `${BASE}/trade-find`, body: json(tradeFindBody) },
]
