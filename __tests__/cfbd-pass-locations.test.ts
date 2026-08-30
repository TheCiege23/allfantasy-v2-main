import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Pass locations — the half of the CFBD passing feed that had a column, a read
 * layer, and no possible writer.
 *
 * 🛑 WHAT THIS GUARDS. `DevyPlayer.passLocations` shipped 2026-08-30 alongside
 * air yards, ADOT and YAC. The writer looked for `p.locations` on
 * `/passing/players/season`, but that endpoint carries no location key at all —
 * the adapter's own return type says "ALWAYS `{}` FOR THE SEASON AND TEAM
 * ENDPOINTS". The branch was not rarely taken; it could not be taken. Location
 * is per-attempt and exists only on `/passing/plays`, so the grid has to be
 * folded out of plays or it does not exist.
 *
 * ⚠ AND THE FOLD IS WHERE THE DENOMINATOR BUG COMES BACK. This is the same
 * feature that shipped an ADOT over a NULL `airYardsAttempts` — an average with
 * no record of what it averaged. A location grid fails the same way and looks
 * even more convincing: "6 deep lefts" is a tendency chart if you assume it
 * covers the season, and noise if 30 of the passer's 400 attempts were tagged.
 * CFBD tags location only "when provided in the play data", so most of these
 * tests are about attempts that could NOT be placed still being counted.
 */

const findFirst = vi.fn()
const update = vi.fn()
const findUnique = vi.fn()
const upsert = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    devyPlayer: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      update: (...a: unknown[]) => update(...a),
    },
    sportsDataCache: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      upsert: (...a: unknown[]) => upsert(...a),
    },
  },
}))
vi.mock('@/lib/prisma-json', () => ({ toPrismaJsonInput: (v: unknown) => v }))
vi.mock('@/lib/cfbd-env', () => ({
  getCfbdApiKey: () => 'test-key-not-a-real-credential',
  hasCfbdApiKey: () => true,
  CFBD_ENV_VARS: ['CFBD_API_KEY'],
}))

function mockJson(payload: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  })
}

/** One `/passing/plays` row. Only the fields a test cares about are overridden. */
function play(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    season: 2026,
    week: 1,
    offense: 'Georgia',
    defense: 'Alabama',
    passer: 'Gunner Stockton',
    airYards: 8,
    yards: 10,
    completion: true,
    touchdown: false,
    interception: false,
    depth: 'short',
    direction: 'left',
    ...over,
  }
}

beforeEach(() => {
  vi.resetModules()
  findFirst.mockReset().mockResolvedValue({ id: 'p1' })
  update.mockReset().mockResolvedValue({})
  findUnique.mockReset().mockResolvedValue(null)
  upsert.mockReset().mockResolvedValue({})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('folding plays into the grid', () => {
  it('counts an UNLOCATED attempt in `attempts` but not in `located`', async () => {
    /*
     * The single most important behaviour here. CFBD says location is present
     * only when the play data provided it, so a passer can have 400 attempts and
     * 30 tagged ones. Dropping the untagged 370 would leave a grid summing to 30
     * with nothing to say it describes 7% of the season, and every surface would
     * read it as a complete tendency chart.
     */
    const { aggregatePassLocations } = await import('@/lib/devy-classification')

    const plays = [
      play({ depth: 'short', direction: 'left' }),
      play({ depth: null, direction: null }),
      play({ depth: 'deep', direction: null }),
      play({ depth: null, direction: 'right' }),
    ] as never

    const byPasser = aggregatePassLocations(plays, 'Georgia', 2026)
    const profile = byPasser.get('gunner stockton')!

    expect(profile.attempts, 'untagged attempts were dropped from the denominator').toBe(4)
    expect(profile.located, 'a half-tagged play was placed in the grid anyway').toBe(1)
    expect(profile.grid.short?.left?.attempts).toBe(1)
    expect(profile.grid.deep, 'a play with a depth but no direction was placed').toBeUndefined()
  })

  it('does NOT credit the opposing quarterback to this school', async () => {
    /*
     * `/passing/plays` describes both sides of a game and `team=` is a filter on
     * the game, not on the offense. An unguarded fold writes Alabama's passer
     * onto a Georgia row — and because the join is by normalized name against
     * `school`, it would mostly land as a silent no-op rather than a visible
     * error, right up until two schools share a passer name.
     */
    const { aggregatePassLocations } = await import('@/lib/devy-classification')

    const plays = [
      play({ offense: 'Georgia', passer: 'Gunner Stockton' }),
      play({ offense: 'Alabama', defense: 'Georgia', passer: 'Ty Simpson' }),
    ] as never

    const byPasser = aggregatePassLocations(plays, 'Georgia', 2026)

    expect([...byPasser.keys()]).toEqual(['gunner stockton'])
  })

  it('measures a 0-yard and a NEGATIVE-yard throw instead of discarding them', async () => {
    /*
     * A truthiness guard here erases every screen and every stuffed checkdown.
     * The adapter already learned this for `airYards`; the aggregate has to
     * learn it separately, because summing is where `|| 0` is most tempting.
     */
    const { aggregatePassLocations } = await import('@/lib/devy-classification')

    const plays = [
      play({ yards: 0 }),
      play({ yards: -4 }),
      play({ yards: 10 }),
    ] as never

    const cell = aggregatePassLocations(plays, 'Georgia', 2026).get('gunner stockton')!.grid.short!.left!

    expect(cell.yardsMeasured, 'a 0 or negative yardage was treated as missing').toBe(3)
    expect(cell.yards).toBe(6)
  })

  it('reports null, not 0, for a quantity no play measured', async () => {
    const { aggregatePassLocations } = await import('@/lib/devy-classification')

    const plays = [play({ yards: null, completion: null, touchdown: null, interception: null })] as never
    const cell = aggregatePassLocations(plays, 'Georgia', 2026).get('gunner stockton')!.grid.short!.left!

    expect(cell.attempts, 'the play itself is always countable').toBe(1)
    expect(cell.yards, 'an unmeasured sum became a real-looking 0').toBeNull()
    expect(cell.yardsMeasured).toBe(0)
    expect(cell.completions).toBeNull()
    expect(cell.touchdowns).toBeNull()
    expect(cell.interceptions).toBeNull()
  })

  it('keeps the grid sparse — an untouched cell is absent, not a row of zeroes', async () => {
    const { aggregatePassLocations } = await import('@/lib/devy-classification')

    const grid = aggregatePassLocations([play({ depth: 'deep', direction: 'right' })] as never, 'Georgia', 2026)
      .get('gunner stockton')!.grid

    expect(Object.keys(grid)).toEqual(['deep'])
    expect(Object.keys(grid.deep!)).toEqual(['right'])
  })
})

describe('the school rotation', () => {
  it('covers every school within one cycle and repeats none inside it', async () => {
    /*
     * ⚠ THE BUG THIS EXISTS FOR IS THE ONE `rotateForFairness` WARNS ABOUT,
     * reintroduced by slicing. That helper advances the offset by ONE unit per
     * period, so `rotateForFairness(TOP_CFB_TEAMS, day).slice(0, 12)` would
     * re-fetch eleven of the same twelve schools every day and take fifty days
     * to come around — a rotation that looks fair and starves the tail anyway.
     * Rotating CHUNKS is what makes a five-day sweep actually five days.
     */
    const { passLocationTeamsForRun, TOP_CFB_TEAMS } = await import('@/lib/devy-classification')

    const DAY = 24 * 60 * 60 * 1000
    const seen: string[] = []
    for (let day = 0; day < 5; day++) {
      seen.push(...passLocationTeamsForRun(() => day * DAY))
    }

    expect(new Set(seen).size, 'a school was fetched twice in one cycle').toBe(seen.length)
    expect(new Set(seen)).toEqual(new Set(TOP_CFB_TEAMS))
  })

  it('fetches a bounded slice, not all fifty schools in one tick', async () => {
    const { passLocationTeamsForRun } = await import('@/lib/devy-classification')

    expect(passLocationTeamsForRun(() => 0).length).toBeLessThanOrEqual(12)
  })
})

describe('the ingest writes what the season endpoint never could', () => {
  it('stores the grid WITH its denominators and stamps the season', async () => {
    vi.stubGlobal('fetch', mockJson([play(), play({ depth: 'deep', direction: 'right', yards: 30 })]))

    const { ingestCFBDPassLocations } = await import('@/lib/devy-classification')
    const result = await ingestCFBDPassLocations(2026, { teams: ['Georgia'] })

    expect(result.errors).toEqual([])
    expect(result.updated).toBe(1)

    const written = update.mock.calls[0][0].data
    expect(written.passingProfileSeason, 'an unstamped grid is invisible to the DB-first read').toBe(2026)
    expect(written.passLocations.attempts).toBe(2)
    expect(written.passLocations.located).toBe(2)
    expect(written.passLocations.grid.short.left.attempts).toBe(1)
    expect(written.passLocations.grid.deep.right.yards).toBe(30)
  })

  it('does not blank an existing grid when a school returns nothing', async () => {
    /*
     * A thin or failed response must not overwrite a better-covered earlier run.
     * This is the same rule the season aggregates follow — write only what the
     * feed actually supplied.
     */
    vi.stubGlobal('fetch', mockJson([]))

    const { ingestCFBDPassLocations } = await import('@/lib/devy-classification')
    const result = await ingestCFBDPassLocations(2026, { teams: ['Georgia'] })

    expect(update).not.toHaveBeenCalled()
    expect(result.updated).toBe(0)
  })

  it('lets a quota wall reach the scheduler instead of reporting a clean zero', async () => {
    /*
     * The failure this whole CFBD stack keeps relearning: an empty array on a
     * 429 is indistinguishable from "nobody threw a measured ball", and the
     * intel sweep would record a healthy run over a month-long outage.
     */
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => '{"message":"Monthly call quota exceeded."}',
        json: async () => ({ message: 'Monthly call quota exceeded.' }),
      }),
    )

    const mod = await import('@/lib/devy-classification')
    const { CfbdUnavailableError } = await import('@/lib/cfb-player-data')

    await expect(mod.ingestCFBDPassLocations(2026, { teams: ['Georgia'] })).rejects.toBeInstanceOf(
      CfbdUnavailableError,
    )
  })
})
