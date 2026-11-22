// @vitest-environment node
/**
 * `fetchFleaflickerScoreboard`'s season guard, against the three committed scoreboard shapes.
 *
 * 🛑 THE DEFECT (contracts/fleaflicker/GAPS.md, the live-league `G-08` entry). The guard required
 * `schedulePeriod.low.season === season`. A league that is IN its current season carries NO `season`
 * key anywhere in the body, so the one live Fleaflicker league in production (344624, NFL 2026) was
 * refused on every run as "provider returned unknown (silently clamped)" and never got a
 * `WeeklyMatchup` row.
 *
 * The bodies are the committed contract fixtures, not hand-written shapes:
 *   - scoreboard.NFL.2026.live.json  — league 344624, week 11 IN PROGRESS, no `season` key at all;
 *                                      its first period starts 2026-09-08
 *   - scoreboard.NFL.2021.week1.json — league 206154, every period carries `season: 2021`. This is
 *                                      the body Fleaflicker serves for 2024/2025/2026/2099 (the clamp)
 *   - scoreboard.NFL.json            — pre-draft league 356670, no `season` key, no `games` key
 *
 * No network: `globalThis.fetch` is replaced for every test.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  fetchFleaflickerScoreboard,
  FleaflickerSeasonMismatchError,
} from '@/lib/league-import/fleaflicker/FleaflickerLeagueFetchService'

const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(process.cwd(), 'contracts/fleaflicker/fixtures', name), 'utf8'))

const LIVE_2026 = 'scoreboard.NFL.2026.live.json'
const CLAMPED_TO_2021 = 'scoreboard.NFL.2021.week1.json'
const PRE_DRAFT = 'scoreboard.NFL.json'

const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})

function serve(body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as never
}

async function mismatchOf(promise: Promise<unknown>): Promise<FleaflickerSeasonMismatchError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(FleaflickerSeasonMismatchError)
  return error as FleaflickerSeasonMismatchError
}

/** Remove every `season` key under a schedule period, leaving the dates. */
function withoutSeasonKeys(body: Record<string, any>) {
  const copy = JSON.parse(JSON.stringify(body))
  delete copy.schedulePeriod?.low?.season
  for (const p of copy.eligibleSchedulePeriods ?? []) delete p.low?.season
  return copy
}

describe('the fixtures say what this file assumes they say', () => {
  it('live 2026: no season key anywhere, first period starts in 2026, every game in progress', () => {
    const body = fixture(LIVE_2026)
    expect(JSON.stringify(body)).not.toContain('"season"')
    expect(new Date(Number(body.eligibleSchedulePeriods[0].low.startEpochMilli)).getUTCFullYear()).toBe(2026)
    expect(body.games.length).toBeGreaterThan(0)
    for (const g of body.games) {
      expect(g.isInProgress).toBe(true)
      expect('isFinalScore' in g).toBe(false)
    }
  })

  it('clamped 2021: an explicit season on the current period and on every eligible period', () => {
    const body = fixture(CLAMPED_TO_2021)
    expect(body.schedulePeriod.low.season).toBe(2021)
    for (const p of body.eligibleSchedulePeriods) expect(p.low.season).toBe(2021)
  })
})

describe('fetchFleaflickerScoreboard — a live current-season league', () => {
  it('accepts the live 2026 body for a 2026 request (the defect: this used to throw)', async () => {
    serve(fixture(LIVE_2026))
    const result = await fetchFleaflickerScoreboard('NFL', 344624, 2026)
    expect(result.currentPeriod).toBe(11)
    expect(result.periods).toHaveLength(17)
    expect(result.week?.season).toBe(2026)
    expect(result.week?.week).toBe(11)
    expect(result.week?.games).toHaveLength(6)
  })

  it('still refuses that same body for a 2027 request — a clamp onto the CURRENT season', async () => {
    serve(fixture(LIVE_2026))
    const error = await mismatchOf(fetchFleaflickerScoreboard('NFL', 344624, 2027))
    expect(error.requestedSeason).toBe(2027)
    // The provider stated no season; the dates are corroboration, never a label.
    expect(error.returnedSeason).toBeNull()
  })

  it('still refuses it for a 2025 request', async () => {
    serve(fixture(LIVE_2026))
    await mismatchOf(fetchFleaflickerScoreboard('NFL', 344624, 2025))
  })
})

describe('fetchFleaflickerScoreboard — the clamp case keeps its protection', () => {
  it('refuses league 206154’s clamped body for a 2026 request and names 2021', async () => {
    serve(fixture(CLAMPED_TO_2021))
    const error = await mismatchOf(fetchFleaflickerScoreboard('NFL', 206154, 2026))
    expect(error.returnedSeason).toBe(2021)
  })

  it('positive control: the same body IS accepted for a 2021 request', async () => {
    serve(fixture(CLAMPED_TO_2021))
    const result = await fetchFleaflickerScoreboard('NFL', 206154, 2021, 1)
    expect(result.week?.season).toBe(2021)
  })

  it('an explicit season outranks the dates: 2026 dates labelled 2025 are refused for 2026', async () => {
    const body = fixture(LIVE_2026)
    body.schedulePeriod.low.season = 2025
    serve(body)
    const error = await mismatchOf(fetchFleaflickerScoreboard('NFL', 344624, 2026))
    expect(error.returnedSeason).toBe(2025)
  })

  it('a missing season key is NOT a pass on its own: 2021 dates with the key stripped are refused for 2026', async () => {
    serve(withoutSeasonKeys(fixture(CLAMPED_TO_2021)))
    const error = await mismatchOf(fetchFleaflickerScoreboard('NFL', 206154, 2026))
    expect(error.returnedSeason).toBeNull()
  })

  it('a body with no season key and no dates at all is refused', async () => {
    const body = withoutSeasonKeys(fixture(CLAMPED_TO_2021))
    delete body.schedulePeriod.low.startEpochMilli
    for (const p of body.eligibleSchedulePeriods) delete p.low.startEpochMilli
    serve(body)
    await mismatchOf(fetchFleaflickerScoreboard('NFL', 206154, 2021))
  })

  it('a late-season week starting in January does not move the season: week 1 decides', async () => {
    const body = fixture(LIVE_2026)
    // Ask as if for the last period: its own start may fall in the next calendar year.
    body.schedulePeriod = { ordinal: 17, value: 17, low: { ordinal: 17, startEpochMilli: String(Date.UTC(2027, 0, 5)) } }
    serve(body)
    const result = await fetchFleaflickerScoreboard('NFL', 344624, 2026, 17)
    expect(result.week?.season).toBe(2026)
  })
})

describe('fetchFleaflickerScoreboard — a pre-draft league', () => {
  it('2026 dates and no games key: accepted for 2026 with a null week', async () => {
    serve(fixture(PRE_DRAFT))
    const result = await fetchFleaflickerScoreboard('NFL', 356670, 2026)
    expect(result.week).toBeNull()
  })

  it('and refused for 2027', async () => {
    serve(fixture(PRE_DRAFT))
    const error = await mismatchOf(fetchFleaflickerScoreboard('NFL', 356670, 2027))
    expect(error.returnedSeason).toBeNull()
  })
})
