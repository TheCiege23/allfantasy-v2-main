/**
 * Fleaflicker import must label a payload with the season it DESCRIBES, not the season requested.
 *
 * 🛑 THE DEFECT. Fleaflicker silently clamps a `season` past a league's last to that last season and
 * returns its complete, played data under HTTP 200, and `FetchLeagueStandings` echoes the REQUESTED
 * season back (contracts/fleaflicker/ENDPOINTS.yaml, `season` note). So league 206154 (last season
 * 2021) imported 2021's 13-game standings labelled 2026. `schedulePeriod.low.season` on the
 * scoreboard is the only authority, and `fetchFleaflickerScoreboard` already asserts it.
 *
 * The scoreboard bodies are the committed contract fixtures, not hand-written shapes:
 *   - scoreboard.NFL.2021.week1.json — league 206154, `schedulePeriod.low.season: 2021`
 *   - scoreboard.NFL.json            — pre-draft league 356670, `schedulePeriod.low` has NO season
 *
 * No network: `globalThis.fetch` is replaced with a URL router for every test.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { fetchFleaflickerLeagueForImport } from '@/lib/league-import/fleaflicker/FleaflickerLeagueFetchService'

const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(process.cwd(), 'contracts/fleaflicker/fixtures', name), 'utf8'))

const CLAMPED_TO_2021 = fixture('scoreboard.NFL.2021.week1.json')
const PRE_DRAFT = fixture('scoreboard.NFL.json')

type Route = { scoreboard: () => Response }
let calls: string[] = []
let route: Route
const original = globalThis.fetch

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function seasonOf(url: string): number | null {
  const m = /[?&]season=(\d+)/.exec(url)
  return m ? Number(m[1]) : null
}

beforeEach(() => {
  calls = []
  route = { scoreboard: () => json(CLAMPED_TO_2021) }
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('/FetchLeagueScoreboard')) return route.scoreboard()
    if (url.includes('/FetchLeagueStandings')) {
      // Echoes the requested season, exactly as the real endpoint does — that is the trap.
      const s = seasonOf(url)
      return json({ league: { id: 206154, name: 'Test League' }, season: s, divisions: [], marker: `standings-${s}` })
    }
    if (url.includes('/FetchLeagueRosters')) return json({ rosters: [], marker: `rosters-${seasonOf(url)}` })
    if (url.includes('/FetchLeagueDraftBoard')) return json({ marker: `draft-${seasonOf(url)}` })
    if (url.includes('/FetchLeagueRules')) return json({})
    if (url.includes('/FetchLeagueTransactions')) return json({ items: [] })
    throw new Error(`unrouted ${url}`)
  }) as never
})

afterEach(() => {
  globalThis.fetch = original
})

const standingsCalls = () => calls.filter((u) => u.includes('/FetchLeagueStandings'))

describe('fetchFleaflickerLeagueForImport — season clamp', () => {
  it('a request past the league’s last season is re-fetched and labelled with the season served', async () => {
    const payload = await fetchFleaflickerLeagueForImport('NFL:206154:2026')
    expect(payload.season).toBe(2021)
    expect((payload.standings as unknown as { marker: string }).marker).toBe('standings-2021')
    expect((payload.rosters as unknown as { marker: string }).marker).toBe('rosters-2021')
    expect((payload.draftBoard as unknown as { marker: string }).marker).toBe('draft-2021')
    expect(standingsCalls().map(seasonOf)).toContain(2021)
  })

  it('a season the scoreboard confirms is fetched once and keeps its label', async () => {
    route.scoreboard = () => json(CLAMPED_TO_2021)
    const payload = await fetchFleaflickerLeagueForImport('NFL:206154:2021')
    expect(payload.season).toBe(2021)
    expect(standingsCalls()).toHaveLength(1)
  })

  it('a PRE-DRAFT league (no schedulePeriod.low.season) keeps the requested season', async () => {
    route.scoreboard = () => json(PRE_DRAFT)
    const payload = await fetchFleaflickerLeagueForImport('NFL:356670:2026')
    expect(payload.season).toBe(2026)
    expect(standingsCalls().map(seasonOf)).toEqual([2026])
  })

  it('a scoreboard outage does not fail the import — it keeps today’s behaviour', async () => {
    route.scoreboard = () => new Response('', { status: 503 })
    const payload = await fetchFleaflickerLeagueForImport('NFL:206154:2026')
    expect(payload.season).toBe(2026)
    expect(standingsCalls().map(seasonOf)).toEqual([2026])
  })
})
