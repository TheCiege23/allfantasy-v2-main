import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * The CFBD passing endpoints (air yards / ADOT / pass location / YAC), published
 * 2026-08-30 and ingested onto `DevyPlayer` the same day.
 *
 * ⚠ WHAT THESE ACTUALLY GUARD IS THE DENOMINATOR. CFBD says its air-yard
 * coverage is partial — 2025 thin, 2026 "mostly complete" but with per-game and
 * per-field gaps — and ships availability counts for that reason. So ADOT has
 * TWO plausible denominators and only one is correct: `airYardsAttempts` (the
 * throws that were measured) rather than `attempts` (every throw). Dividing by
 * `attempts` produces a number that is wrong smoothly and plausibly — always too
 * low, and worst for exactly the players with the least data, which is the
 * failure mode nobody notices because nothing looks broken.
 *
 * The API is still over its monthly quota, so these mock fetch. That is also the
 * only way to exercise a partial-coverage payload on demand.
 */

const findUnique = vi.fn()
const upsert = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      upsert: (...a: unknown[]) => upsert(...a),
    },
  },
}))
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

beforeEach(() => {
  vi.resetModules()
  // No cached row, and a write that resolves — the adapter caches through prisma.
  findUnique.mockReset().mockResolvedValue(null)
  upsert.mockReset().mockResolvedValue({})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the OBSERVED payload shape maps completely', () => {
  /*
   * 🛑 THE REGRESSION THIS PINS. The adapter shipped with guessed field names and
   * three were wrong: the availability counts are `...AttemptsAvailable`, not
   * `...Attempts`, and YAC is `totalYardsAfterCatch`, not `totalYac`. Production
   * wrote 116 profiles with adot set and airYardsAttempts NULL on every single
   * one — an ADOT with no denominator, which is the one state this feature
   * exists to make impossible.
   *
   * This row is copied verbatim from the real response (Gunner Stockton,
   * Georgia 2025, fetched 2026-08-30), so it fails if anyone "tidies" the alias
   * lists back to the guesses.
   */
  const OBSERVED_ROW = {
    season: 2025,
    playerId: '4685578',
    player: 'Gunner Stockton',
    team: 'Georgia',
    conference: 'SEC',
    attempts: 385,
    completions: 270,
    incompletions: 110,
    interceptions: 5,
    completionRate: 0.701,
    airYardsAttemptsAvailable: 153,
    totalAirYards: 1108,
    averageDepthOfTarget: 7.2,
    totalYardsAttemptsAvailable: 385,
    totalYards: 2947,
    yardsAfterCatchAttemptsAvailable: 108,
    totalYardsAfterCatch: 685,
    averageYardsAfterCatch: 6.3,
  }

  it('reads every metric field out of the real response', async () => {
    vi.stubGlobal('fetch', mockJson([OBSERVED_ROW]))

    const { getCFBPassingPlayerSeason } = await import('@/lib/cfb-player-data')
    const [p] = await getCFBPassingPlayerSeason(2025)

    expect(p.playerName).toBe('Gunner Stockton')
    // playerId arrives as a STRING in the real payload.
    expect(p.playerId).toBe(4685578)
    expect(p.attempts).toBe(385)
    expect(p.completions).toBe(270)
    expect(p.airYards).toBe(1108)
    expect(p.adot).toBeCloseTo(7.2, 5)
    expect(p.airYardsAttempts, 'the denominator that shipped NULL in production').toBe(153)
    expect(p.yardsAfterCatch).toBe(685)
    expect(p.yacCompletions).toBe(108)
    expect(p.avgYardsAfterCatch).toBeCloseTo(6.3, 5)
  })

  it('shows why the denominator matters on this exact row', async () => {
    vi.stubGlobal('fetch', mockJson([OBSERVED_ROW]))

    const { getCFBPassingPlayerSeason } = await import('@/lib/cfb-player-data')
    const [p] = await getCFBPassingPlayerSeason(2025)

    // 1108/153 = 7.24 (what CFBD reports) vs 1108/385 = 2.88 (dividing by every
    // throw). Only 40% of his attempts carry air-yard data, and the wrong
    // denominator understates his depth by 2.5x while still looking plausible.
    expect(p.adot).toBeCloseTo(7.2, 1)
    expect(p.airYards! / p.attempts!).toBeCloseTo(2.88, 1)
    expect(p.adot).not.toBeCloseTo(p.airYards! / p.attempts!, 1)
  })

  it('returns an empty location grid — season rows carry no location at all', async () => {
    // Confirmed against the live endpoint: neither the season nor the team
    // response has a locations key. Location is per-attempt, on /passing/plays.
    vi.stubGlobal('fetch', mockJson([OBSERVED_ROW]))

    const { getCFBPassingPlayerSeason } = await import('@/lib/cfb-player-data')
    const [p] = await getCFBPassingPlayerSeason(2025)
    expect(Object.keys(p.locations)).toHaveLength(0)
  })
})

describe('ADOT is derived over the MEASURED denominator', () => {
  it('divides air yards by airYardsAttempts, not by attempts', async () => {
    /*
     * The case the whole feature turns on: a passer with 400 attempts of which
     * only 100 carried an air-yard value. True ADOT is 900/100 = 9.0. Dividing
     * by `attempts` gives 2.25 — a plausible-looking number that would rank a
     * genuine deep thrower below a checkdown artist with full coverage.
     */
    vi.stubGlobal(
      'fetch',
      mockJson([
        { season: 2026, player: 'Test Passer', team: 'Georgia', attempts: 400, airYards: 900, airYardsAttempts: 100 },
      ]),
    )

    const { getCFBPassingPlayerSeason } = await import('@/lib/cfb-player-data')
    const [p] = await getCFBPassingPlayerSeason(2026)

    expect(p.adot).toBeCloseTo(9.0, 5)
    expect(p.adot, 'divided by attempts — ADOT diluted by unmeasured throws').not.toBeCloseTo(2.25, 2)
    expect(p.airYardsAttempts, 'the denominator must survive to the caller').toBe(100)
  })

  it('prefers the ADOT the feed supplies over a derived one', async () => {
    vi.stubGlobal(
      'fetch',
      mockJson([
        { season: 2026, player: 'A', team: 'Georgia', attempts: 100, airYards: 500, airYardsAttempts: 50, adot: 11.2 },
      ]),
    )

    const { getCFBPassingPlayerSeason } = await import('@/lib/cfb-player-data')
    const [p] = await getCFBPassingPlayerSeason(2026)
    expect(p.adot).toBeCloseTo(11.2, 5)
  })

  it('reports ADOT as null — never 0 — when the feed carries no air yards', async () => {
    /*
     * A 2025 passer outside the covered window. 0 would say "threw every ball at
     * the line of scrimmage", which is a real and very different claim.
     */
    vi.stubGlobal('fetch', mockJson([{ season: 2025, player: 'B', team: 'Georgia', attempts: 300 }]))

    const { getCFBPassingPlayerSeason } = await import('@/lib/cfb-player-data')
    const [p] = await getCFBPassingPlayerSeason(2025)

    expect(p.adot).toBeNull()
    expect(p.airYards).toBeNull()
    expect(p.airYardsAttempts).toBeNull()
    expect(p.attempts, 'attempts was present and must still be read').toBe(300)
  })

  it('does not derive an ADOT from a zero denominator', async () => {
    vi.stubGlobal(
      'fetch',
      mockJson([{ season: 2026, player: 'C', team: 'Georgia', airYards: 0, airYardsAttempts: 0 }]),
    )

    const { getCFBPassingPlayerSeason } = await import('@/lib/cfb-player-data')
    const [p] = await getCFBPassingPlayerSeason(2026)
    expect(p.adot, 'divided by zero').toBeNull()
  })
})

describe('pass locations', () => {
  it('reads a nested short/deep × left/middle/right grid', async () => {
    vi.stubGlobal(
      'fetch',
      mockJson([
        {
          season: 2026,
          player: 'D',
          team: 'Georgia',
          locations: {
            short: { left: { attempts: 40, completions: 30, yards: 250 } },
            deep: { right: { attempts: 12, completions: 5, yards: 180, touchdowns: 2 } },
          },
        },
      ]),
    )

    const { getCFBPassingPlayerSeason } = await import('@/lib/cfb-player-data')
    const [p] = await getCFBPassingPlayerSeason(2026)

    expect(p.locations.short?.left?.attempts).toBe(40)
    expect(p.locations.deep?.right?.touchdowns).toBe(2)
    // Absent cells stay absent — the grid is sparse on purpose.
    expect(p.locations.short?.right).toBeUndefined()
  })

  it('reads the flat-keyed shape too, since the published payload is unseen', async () => {
    vi.stubGlobal(
      'fetch',
      mockJson([
        { season: 2026, player: 'E', team: 'Georgia', locations: { short_middle: { attempts: 22, yards: 140 } } },
      ]),
    )

    const { getCFBPassingPlayerSeason } = await import('@/lib/cfb-player-data')
    const [p] = await getCFBPassingPlayerSeason(2026)
    expect(p.locations.short?.middle?.attempts).toBe(22)
  })

  it('returns an empty grid rather than inventing cells when no location is carried', async () => {
    vi.stubGlobal('fetch', mockJson([{ season: 2026, player: 'F', team: 'Georgia', attempts: 100 }]))

    const { getCFBPassingPlayerSeason } = await import('@/lib/cfb-player-data')
    const [p] = await getCFBPassingPlayerSeason(2026)
    expect(Object.keys(p.locations)).toHaveLength(0)
  })
})

describe('team summaries keep offense and defense apart', () => {
  /*
   * ⚠ THE INVERSION THIS PREVENTS. A team's DEFENSIVE ADOT is how deep opponents
   * threw against it. Stored unlabelled beside the offensive figure, a strong
   * pass defence reads as a vertical passing attack — and `teamPassAdot` is
   * written onto every eligible player at the school, so one mislabelled row
   * would poison a whole roster's context.
   */
  it('splits a nested offense/defense row into two labelled units', async () => {
    // The nested shape is the OBSERVED one (2026-08-30): the team response is
    // one row per team with `offense` and `defense` objects side by side.
    vi.stubGlobal(
      'fetch',
      mockJson([
        {
          season: 2026,
          team: 'Georgia',
          offense: { attempts: 400, totalAirYards: 3600, airYardsAttemptsAvailable: 400 },
          defense: { attempts: 380, totalAirYards: 2280, airYardsAttemptsAvailable: 380 },
        },
      ]),
    )

    const { getCFBPassingTeamSeason } = await import('@/lib/cfb-player-data')
    const rows = await getCFBPassingTeamSeason(2026)

    const off = rows.find((r) => r.unit === 'offense')
    const def = rows.find((r) => r.unit === 'defense')

    expect(off?.adot).toBeCloseTo(9.0, 5)
    expect(def?.adot).toBeCloseTo(6.0, 5)
    expect(off?.adot).not.toBe(def?.adot)
  })

  it('honours a flat row that declares its own unit', async () => {
    vi.stubGlobal(
      'fetch',
      mockJson([
        { season: 2026, team: 'Georgia', unit: 'defense', airYards: 1000, airYardsAttempts: 200 },
      ]),
    )

    const { getCFBPassingTeamSeason } = await import('@/lib/cfb-player-data')
    const rows = await getCFBPassingTeamSeason(2026)

    expect(rows).toHaveLength(1)
    expect(rows[0].unit).toBe('defense')
    expect(rows[0].adot).toBeCloseTo(5.0, 5)
  })
})

describe('play-level attempts', () => {
  it('keeps NEGATIVE air yards, which are a real throw behind the line', async () => {
    /*
     * The announcement calls this out explicitly: air yards include "throws
     * behind" the line of scrimmage. A truthiness guard (`|| null`) anywhere on
     * this path would erase every screen and swing pass — and screens are most
     * of the modern college passing game, so the loss would be systematic rather
     * than incidental.
     */
    vi.stubGlobal(
      'fetch',
      mockJson([
        {
          id: 1,
          season: 2026,
          week: 3,
          offense: 'Georgia',
          defense: 'Alabama',
          passer: 'G',
          airYards: -3,
          yardsAfterCatch: 12,
          yards: 9,
          completion: true,
          depth: 'short',
          direction: 'left',
        },
      ]),
    )

    const { getCFBPassingPlays } = await import('@/lib/cfb-player-data')
    const [play] = await getCFBPassingPlays(2026, { team: 'Georgia', week: 3 })

    expect(play.airYards, 'a screen was flattened to null or 0').toBe(-3)
    expect(play.yardsAfterCatch).toBe(12)
    expect(play.depth).toBe('short')
    expect(play.direction).toBe('left')
  })

  it('rejects a depth or direction it does not recognise instead of passing it through', async () => {
    vi.stubGlobal(
      'fetch',
      mockJson([{ id: 2, season: 2026, offense: 'Georgia', defense: 'Alabama', passer: 'H', depth: 'medium', direction: 'wide' }]),
    )

    const { getCFBPassingPlays } = await import('@/lib/cfb-player-data')
    const [play] = await getCFBPassingPlays(2026, { team: 'Georgia', week: 1 })

    expect(play.depth).toBeNull()
    expect(play.direction).toBeNull()
  })
})

describe('a refusal is not an empty passing feed', () => {
  it('throws CfbdUnavailableError on a 429 rather than returning []', async () => {
    /*
     * The rule the rest of this adapter already follows. An empty array here
     * would mean "no passer at any school threw a measured ball this season",
     * and the ingest would then write nothing while reporting a clean zero —
     * exactly how `ingestCFBDStats` reported `upserted: 0, errors: 0` against a
     * quota wall.
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

    const { getCFBPassingPlayerSeason, CfbdUnavailableError } = await import('@/lib/cfb-player-data')
    await expect(getCFBPassingPlayerSeason(2026)).rejects.toBeInstanceOf(CfbdUnavailableError)
  })
})
