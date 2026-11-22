/**
 * Guillotine league harness fixtures (2026-11-06). A 12-team NFL Guilly league in week 4: weeks 1–3
 * each chopped one team, nine are alive, and the viewer ("Gridiron Ghosts") sits in the danger tier.
 * Every payload has the shape the real route serves (app/api/leagues/[leagueId]/guillotine/summary),
 * answered in the browser so no request reaches a database. Labelled fixture data, not real teams.
 */
import { buildSurvivalHistory } from '@/lib/guillotine/survivalHistory'
import { evaluateUserSurvivalRisk } from '@/lib/guillotine-war-room/guillotineSurvivalRiskEngine'
import { buildWeeklyPlan } from '@/lib/guillotine-war-room/guillotineWeeklyPlanEngine'
import type { GuillotinePlayerFact, GuillotineWarRoomContext } from '@/lib/guillotine-war-room/types'

export const GUILLOTINE_HARNESS_TABS = ['guillotine', 'war_room'] as const
export type GuillotineHarnessTab = (typeof GUILLOTINE_HARNESS_TABS)[number]
export type GuillotineHarnessMood = 'calm' | 'chop_week' | 'final' | 'eliminated'

export const GUILLOTINE_LEAGUE_ID = 'e2e-guillotine-league'
export const GUILLOTINE_WEEK = 4
const ME = 'r07'

const NAMES: Record<string, string> = {
  r01: 'Blitz Brigade', r02: 'Fourth & Forever', r03: 'Red Zone Rebels', r04: 'Hail Mary Club',
  r05: 'Pocket Presence', r06: 'The Waiver Hawks', r07: 'Gridiron Ghosts', r08: 'Sack Lunch',
  r09: 'Two-Minute Drill', r10: 'Taco Tuesday FC', r11: 'Bench Mob', r12: 'Fumble Recovery',
}
/** Week each team was chopped (r12 wk1, r11 wk2, r10 wk3). */
const CHOPPED: Record<string, number> = { r12: 1, r11: 2, r10: 3 }

/** Points by week, rosters in NAMES order. A chopped team stops scoring after its chop week. */
const WEEK_POINTS: number[][] = [
  [128.4, 121.0, 117.6, 112.2, 109.8, 104.5, 101.3, 99.0, 97.4, 95.1, 92.6, 84.3],
  [119.2, 131.7, 108.4, 115.0, 102.6, 111.9, 98.8, 106.1, 101.2, 94.0, 88.7],
  [134.1, 118.3, 121.9, 99.4, 113.7, 107.2, 96.5, 104.8, 102.3, 93.9],
  // Week 4, in progress: the live chop line.
  [96.2, 91.8, 88.4, 86.9, 84.1, 82.7, 79.3, 78.6, 74.0],
]

const ids = Object.keys(NAMES)
const scoreRows = WEEK_POINTS.flatMap((pts, i) => pts.map((points, j) => ({ rosterId: ids[j]!, week: i + 1, points })))

export function guillotineSummary(mood: GuillotineHarnessMood) {
  const week = GUILLOTINE_WEEK
  const alive = ids.filter((id) => CHOPPED[id] == null)
  const live = WEEK_POINTS[week - 1]!
  const scores: Record<string, number> = Object.fromEntries(alive.map((id, i) => [id, live[i]!]))
  const sorted = [...alive].sort((a, b) => scores[b]! - scores[a]!)
  const cut = scores[sorted[sorted.length - 1]!]!
  const dangerTiers = sorted.map((id, i) => {
    const gap = Math.round((scores[id]! - cut) * 10) / 10
    const tier = i === sorted.length - 1 ? 'chop_zone' : gap <= 12 ? 'danger' : 'safe'
    return { rosterId: id, displayName: NAMES[id], tier, pointsFromChopZone: gap }
  })
  const myRosterId = mood === 'eliminated' ? 'r10' : ME
  const history = buildSurvivalHistory({
    scores: scoreRows.filter((r) => r.week < week),
    chopped: Object.entries(CHOPPED).map(([rosterId, w]) => ({ rosterId, week: w })),
    names: NAMES,
    closeCallMargin: 12,
  })
  const now = Date.now()
  return {
    leagueId: GUILLOTINE_LEAGUE_ID,
    weekOrPeriod: week,
    choppedThisWeek: [],
    survivalStandings: sorted.map((id, i) => ({
      rosterId: id,
      displayName: NAMES[id],
      rank: i + 1,
      seasonPointsCumul: Math.round(scoreRows.filter((r) => r.rosterId === id).reduce((s, r) => s + r.points, 0) * 10) / 10,
    })),
    dangerTiers,
    recentChopEvents: Object.entries(CHOPPED).map(([rosterId, w]) => ({ weekOrPeriod: w, choppedRosterIds: [rosterId] })).reverse(),
    myEscapes: [
      { weekOrPeriod: 3, myPoints: 96.5, chopLine: 93.9, margin: 2.6, choppedCount: 1 },
      { weekOrPeriod: 2, myPoints: 98.8, chopLine: 88.7, margin: 10.1, choppedCount: 1 },
    ],
    assets: { leagueImage: '/guillotine/Guillotine.png', introVideo: '/guillotine/Guillotine.mp4' },
    myRosterId,
    nextChopPick: mood === 'eliminated'
      ? {
          week,
          canPick: true,
          myPick: null,
          candidates: alive.map((id) => ({ rosterId: id, name: NAMES[id]! })),
          leaderboard: [
            { rosterId: 'r12', name: NAMES.r12!, correct: 2, settled: 2, isMe: false },
            { rosterId: 'r10', name: NAMES.r10!, correct: 0, settled: 0, isMe: true },
          ],
          lastResult: null,
        }
      : null,
    config: {
      eliminationStartWeek: 1,
      eliminationEndWeek: 11,
      teamsPerChop: 1,
      tiebreakerOrder: ['season_points', 'previous_period', 'draft_slot', 'commissioner'],
      dangerMarginPoints: 12,
      rosterReleaseTiming: 'next_waiver_run',
    },
    chopWatch: mood === 'chop_week' ? { live: true, week, chopCount: 1, chopLine: cut } : null,
    home: {
      season: 2026,
      scores,
      teamCount: ids.length,
      aliveCount: alive.length,
      chopped: Object.entries(CHOPPED)
        .map(([rosterId, w]) => ({ rosterId, name: NAMES[rosterId]!, week: w, points: WEEK_POINTS[w - 1]![ids.indexOf(rosterId)]! }))
        .sort((a, b) => b.week - a.week),
      nextChopAt: new Date(now + (mood === 'chop_week' ? 5 : 53) * 3600_000 + 17 * 60_000).toISOString(),
      chopLabel: 'Tue 9:00 AM ET',
      nextWaiversAt: new Date(now + 70 * 3600_000).toISOString(),
      waiverLabel: 'Wed 3:00 AM ET',
      lastChop: {
        week: 3,
        bottom: [
          { rosterId: 'r09', name: NAMES.r09!, points: 102.3 },
          { rosterId: 'r07', name: NAMES.r07!, points: 96.5 },
          { rosterId: 'r10', name: NAMES.r10!, points: 93.9 },
        ],
        choppedRosterIds: ['r10'],
        releases: [
          { playerId: 'p1', playerName: 'Jalen Carter', position: 'RB', team: 'DAL', availableAt: new Date(now + 70 * 3600_000).toISOString(), status: 'pending' },
          { playerId: 'p2', playerName: 'Marcus Webb', position: 'WR', team: 'SEA', availableAt: new Date(now + 70 * 3600_000).toISOString(), status: 'pending' },
          { playerId: 'p3', playerName: 'Devon Price', position: 'TE', team: 'KC', availableAt: new Date(now + 70 * 3600_000).toISOString(), status: 'pending' },
          { playerId: 'p4', playerName: 'Tyler Moss', position: 'QB', team: 'CIN', availableAt: new Date(now + 70 * 3600_000).toISOString(), status: 'pending' },
        ],
      },
      history,
    },
  }
}

/** The viewer's roster for the War Room: starters, a bench, one questionable starter. Labelled fixture players. */
const MY_PLAYERS: [string, string, string, boolean, string | null, number, number][] = [
  // name, position, team, starter, injury, week projection, season average
  ['Cole Ridley', 'QB', 'BUF', true, null, 21.4, 22.8],
  ['Marcus Hale', 'RB', 'ATL', true, 'Questionable', 13.2, 15.1],
  ['Dante Wilks', 'RB', 'MIA', true, null, 11.8, 10.9],
  ['Jaylen Price', 'WR', 'CIN', true, null, 15.6, 16.2],
  ['Trey Bowman', 'WR', 'DET', true, null, 12.1, 11.4],
  ['Nate Ortega', 'TE', 'KC', true, null, 9.8, 10.3],
  ['Ray Castillo', 'WR', 'SF', true, null, 10.4, 9.7],
  ['Eli Brandt', 'K', 'BAL', true, null, 8.1, 8.6],
  ['Steel Curtain DEF', 'DEF', 'PIT', true, null, 7.4, 7.9],
  ['Omar Banks', 'RB', 'NYG', false, null, 7.9, 6.8],
  ['Luke Fenn', 'WR', 'LV', false, null, 8.6, 7.2],
  ['Grant Moyer', 'QB', 'TEN', false, null, 14.1, 13.0],
]

/** GET /api/leagues/[id]/guillotine-war-room: the summary's chop line, run through the real War Room engines. */
export function guillotineWarRoomState(mood: GuillotineHarnessMood) {
  const s = guillotineSummary(mood)
  const tierOf = Object.fromEntries(s.dangerTiers.map((t) => [t.rosterId, t]))
  const players: GuillotinePlayerFact[] = MY_PLAYERS.map(([playerName, position, team, starter, injury, proj, avg], i) => ({
    playerId: `p-${i}`, playerName, position, team, slotType: starter ? position : 'BN', isStarterSlot: starter,
    injuryStatus: injury, adp: 20 + i * 9, weekProjection: proj, seasonAvgActual: avg, hasNoValueSignal: false,
  }))
  const now = new Date().toISOString()
  const context: GuillotineWarRoomContext = {
    leagueId: GUILLOTINE_LEAGUE_ID, leagueType: 'guillotine', sport: 'NFL', season: 2026, currentWeek: GUILLOTINE_WEEK,
    scoring: { sport: 'NFL', scoringPreset: 'half_ppr' },
    roster: { totalStarterSlots: 9, benchSlots: 6, requiredByPosition: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 } },
    guillotine: { eliminationStartWeek: 1, eliminationEndWeek: 11, teamsPerChop: 1, dangerMarginPoints: 12, tiebreaker: 'season_points', rosterReleaseTiming: 'next_waiver_run', tradesEnabled: true },
    userRosterId: s.myRosterId,
    isCommissioner: true,
    standings: ids.map((id) => {
      const t = tierOf[id]
      const row = s.survivalStandings.find((r) => r.rosterId === id)
      return {
        rosterId: id, ownerName: NAMES[id]!, teamName: NAMES[id]!, isUserTeam: id === s.myRosterId,
        eliminated: CHOPPED[id] != null, choppedInPeriod: CHOPPED[id] ?? null, rank: row?.rank ?? null,
        seasonPointsCumul: Math.round(scoreRows.filter((r) => r.rosterId === id).reduce((a, r) => a + r.points, 0) * 10) / 10,
        periodPoints: s.home.scores[id] ?? null,
        tier: (t?.tier ?? 'unknown') as GuillotineWarRoomContext['standings'][number]['tier'],
        pointsFromChopZone: t?.pointsFromChopZone ?? null,
      }
    }),
    activeTeamCount: 9,
    eliminatedTeamCount: 3,
    teams: ids.map((id) => ({
      rosterId: id, ownerId: `u-${id}`, ownerName: NAMES[id]!, teamName: NAMES[id]!, isUserTeam: id === s.myRosterId,
      eliminated: CHOPPED[id] != null, faabRemaining: id === s.myRosterId ? 64 : 40, players: id === s.myRosterId ? players : [],
    })),
    droppedPlayers: s.home.lastChop.releases.map((r) => ({
      playerId: r.playerId, playerName: r.playerName, position: r.position, team: r.team, fromEliminatedRosterId: 'r10', availableAt: r.availableAt, adp: 60,
    })),
    availability: { config: 'available', rosters: 'available', periodScores: 'available', eliminationLine: 'available', rosterStates: 'available', playerValues: 'available', projections: 'available', injuries: 'available', news: 'missing', faab: 'available', droppedPlayerPool: 'available' },
    freshness: { generatedAt: now, scoresAsOf: now, injuriesAsOf: now },
    missingDataFlags: [],
    featureAvailability: { survivalRisk: true, rosterRisk: true, lineupSafety: true, waivers: true, faabPlan: true, droppedPlayers: true, tradeAnalyze: true, weeklyPlan: true },
  }
  const survival = evaluateUserSurvivalRisk(context)
  const mine = context.userRosterId
  const weeklyPlan = mine && CHOPPED[mine] == null ? buildWeeklyPlan(context, mine) : null
  return { context, survival, weeklyPlan }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Install once per page. Only same-origin `/api/` requests are answered; everything else passes through. */
export function installGuillotineHarnessFetch(mood: GuillotineHarnessMood) {
  if (typeof window === 'undefined') return
  const w = window as typeof window & { __glHarnessFetch?: boolean }
  if (w.__glHarnessFetch) return
  w.__glHarnessFetch = true
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return real(input, init)
    const p = url.pathname
    const method = (init?.method ?? 'GET').toUpperCase()
    if (p === `/api/leagues/${GUILLOTINE_LEAGUE_ID}/guillotine/summary` && method === 'GET') {
      if (url.searchParams.get('view') === 'preview') return json({ error: 'Not part of this harness.' }, 409)
      return json(guillotineSummary(mood))
    }
    if (p === `/api/leagues/${GUILLOTINE_LEAGUE_ID}/guillotine-war-room` && method === 'GET') return json(guillotineWarRoomState(mood))
    if (p === '/api/subscription/entitlements') return json({ hasAccess: true, entitlement: { plans: ['pro'], status: 'active' } })
    if (p === '/api/guest-mode/status') return json({ isGuest: false })
    // Writes and AI calls are not part of a visual harness: answer "unavailable" rather than reach a route.
    return json({ error: 'Not part of this harness.' }, 404)
  }
}
