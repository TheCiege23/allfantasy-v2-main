/**
 * Guillotine league harness fixtures (2026-11-06). A 12-team NFL Guilly league in week 4: weeks 1–3
 * each chopped one team, nine are alive, and the viewer ("Gridiron Ghosts") sits in the danger tier.
 * Every payload has the shape the real route serves (app/api/leagues/[leagueId]/guillotine/summary),
 * answered in the browser so no request reaches a database. Labelled fixture data, not real teams.
 */
import { buildSurvivalHistory } from '@/lib/guillotine/survivalHistory'

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
    if (p === '/api/subscription/entitlements') return json({ hasAccess: true, entitlement: { plans: ['pro'], status: 'active' } })
    if (p === '/api/guest-mode/status') return json({ isGuest: false })
    // Writes and AI calls are not part of a visual harness: answer "unavailable" rather than reach a route.
    return json({ error: 'Not part of this harness.' }, 404)
  }
}
