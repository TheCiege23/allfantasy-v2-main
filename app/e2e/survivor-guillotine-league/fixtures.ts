/**
 * Survivor Guillotine league harness (/e2e/survivor-guillotine-league?mood=<mood>), 2026-11-24 visual audit. Browser-side
 * fetch override only: no route handler, no Prisma, no database.
 *
 * Built on the island harness's period-4 fixture (app/e2e/survivor-guillotine/fixtures.ts), typed `satisfies Data`
 * against the island's own payload type, so a mood that drifts from the real shape fails the typecheck.
 *
 *   GET /api/leagues/[id]/survivor-guillotine              the island's whole payload (`Data`)
 *   GET /api/leagues/[id]/survivor-guillotine/operations   commissioner-only; answered only in the `commissioner` mood,
 *                                                          so every other mood sees the island as a manager does
 * Writes (lineups, bids, powers, votes) are POSTs and get the harness's 503.
 */
import type { HarnessApiRoute } from '../harnessApi'
import type { Data } from '@/components/survivor-guillotine/SurvivorGuillotineLeague'
import { season as base, operations } from '../survivor-guillotine/fixtures'

export const SG_LEAGUE_ID = 'e2e-sg-league'

export const SG_HARNESS_MOODS = ['in_season', 'commissioner', 'tribe_choice', 'captain_draft', 'viewer_chopped', 'finale'] as const
export type SgHarnessMood = (typeof SG_HARNESS_MOODS)[number]

const clone = (): Data => structuredClone(base) as Data
const ME = base.ownRoster.id
const ids = base.teams.map((t) => t.legacyRosterId!)

/** The island payload for one moment of the season. */
export function sgData(mood: SgHarnessMood): Data {
  const d = clone()
  if (mood === 'tribe_choice' || mood === 'captain_draft') {
    // Before period 1: no tribes yet, no scores, nobody chopped, no history.
    d.season.currentPeriod = 0
    d.season.status = 'setup'
    d.season.periodState = null
    d.season.periodHistory = {}
    d.season.config = { ...d.season.config, tribeFormation: mood === 'tribe_choice' ? 'manager_choice' : 'captain_draft' }
    d.teams = d.teams.map((t) => ({ ...t, eliminatedAt: null }))
    d.scores = d.scores.map((s) => ({ ...s, totalPoints: 0, status: 'active' }))
    d.chops = []
    d.releasedPlayers = []
    d.powers = []
    d.ownRoster = { ...d.ownRoster, ownBid: null, tribeChoice: null }
    if (mood === 'tribe_choice') d.season.tribes = []
    else {
      // Two captains elected, four managers drafted, Koa on the clock.
      d.season.tribes = [ids[0]!, ids[1]!, ids[2]!, ids[3]!].map((rosterId, i) => ({ rosterId, tribeId: i % 2 === 0 ? 'tribe-0' : 'tribe-1', captain: i < 2 }))
      d.season.tribeDraftState = {
        status: 'active', phase: 'starting', pickMode: 'snake', pickIndex: 2, deadlineAt: '2026-09-04T00:00:00.000Z',
        leaders: [{ tribeId: 'tribe-0', rosterId: ids[0]! }, { tribeId: 'tribe-1', rosterId: ids[1]! }],
      }
    }
  }
  if (mood === 'viewer_chopped') {
    // Period 6: the viewer was chopped in period 5.
    d.season.currentPeriod = 6
    d.teams = d.teams.map((t) => (t.legacyRosterId === ME ? { ...t, eliminatedAt: '2026-10-14T10:00:00.000Z' } : t))
    d.scores = d.scores.map((s) => (s.rosterId === ME ? { ...s, status: 'chopped' } : s))
    d.chops = [...d.chops, { period: 5, rosterId: ME }]
    d.season.periodHistory = {
      ...d.season.periodHistory,
      '5': { mode: 'match_play', completedAt: '2026-10-14T10:00:00.000Z', choppedTeamIds: [ME], savedTeamIds: [], immuneTribeId: 'tribe-1',
        scores: Object.fromEntries(ids.map((id, i) => [id, 90 - i])) },
    }
    d.powers = []
    d.ownRoster = { ...d.ownRoster, ownBid: null }
  }
  if (mood === 'finale') {
    // Season over: the viewer won.
    d.season.currentPeriod = 17
    d.season.status = 'completed'
    const order = [ME, ids[3]!, ids[6]!]
    d.season.periodState = { ...d.season.periodState!, period: 17, matchups: [], placements: order, ceremonyStarted: true }
    d.teams = d.teams.map((t) => (order.includes(t.legacyRosterId!) ? t : { ...t, eliminatedAt: t.eliminatedAt ?? '2026-12-20T10:00:00.000Z' }))
    d.scores = d.scores.map((s) => (order.includes(s.rosterId) ? s : { ...s, status: 'chopped' }))
    d.powers = []
    d.ownRoster = { ...d.ownRoster, ownBid: null }
  }
  return d satisfies Data
}

export function sgHarnessApi(mood: SgHarnessMood): HarnessApiRoute[] {
  return [
    ...(mood === 'commissioner' ? [{ path: `/api/leagues/${SG_LEAGUE_ID}/survivor-guillotine/operations`, body: operations }] : []),
    { path: `/api/leagues/${SG_LEAGUE_ID}/survivor-guillotine`, body: sgData(mood) },
    { path: '/api/subscription/entitlements', body: { hasAccess: true, entitlement: { plans: ['pro'], status: 'active' } } },
  ]
}

/** Every /api/ call the harness saw and did not answer. */
export const SG_UNANSWERED_KEY = '__sgLeagueHarnessUnanswered'

export function installSgHarnessFetch(mood: SgHarnessMood) {
  if (typeof window === 'undefined') return
  const w = window as typeof window & { __sgLeagueHarnessFetch?: boolean; [SG_UNANSWERED_KEY]?: string[] }
  if (w.__sgLeagueHarnessFetch) return
  w.__sgLeagueHarnessFetch = true
  w[SG_UNANSWERED_KEY] = []
  const routes = sgHarnessApi(mood)
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return real(input, init)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const hit = method === 'GET' ? routes.find((r) => r.path === url.pathname) : undefined
    if (hit) return new Response(JSON.stringify(hit.body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    w[SG_UNANSWERED_KEY]!.push(`${method} ${url.pathname}${url.search}`)
    return new Response(JSON.stringify({ error: 'Not part of this harness.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }
}
