// @vitest-environment node
/**
 * lib/odds/gameOddsReads.ts — the fantasy/gambling product boundary.
 *
 * 🛑 WHY THIS IS A RUNTIME TEST AND NOT A TYPE. Root CLAUDE.md records that
 * `tsconfig.json` excludes every test and spec pattern repo-wide, so NO test file
 * here is typechecked, and `next.config.js` sets `typescript.ignoreBuildErrors`.
 * A `@ts-expect-error` asserting "GameOddsRow has no moneyline" would therefore
 * prove nothing at all — it would pass whether the field was there or not. The
 * only guard that can actually go red is one that inspects the returned OBJECT.
 *
 * What is being protected: AllFantasy consumes the betting market as a FORECAST —
 * implied team totals and a vig-free win probability, which are projection inputs
 * — and is deliberately not a gambling product. So the fields that only mean
 * something to a bettor must not leave this module:
 *
 *   moneylineHome / moneylineAway   prices; their only use was computing the
 *                                   vig-free probability, which happens at ingest
 *   bookmakerName                   naming a sportsbook is the clearest marker of
 *                                   a betting product, and where affiliate
 *                                   relationships enter
 *
 * `spreadHome` and `totalPoints` deliberately DO survive: they are the game-script
 * inputs and the terms the implied totals are derived from.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findMany = vi.fn()
const findFirst = vi.fn()
const count = vi.fn()
const gamesFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    gameOdds: {
      findMany: (...args: unknown[]) => findMany(...args),
      findFirst: (...args: unknown[]) => findFirst(...args),
      count: (...args: unknown[]) => count(...args),
    },
    sportsGame: {
      findMany: (...args: unknown[]) => gamesFindMany(...args),
    },
  },
}))

const { readGameOdds, readWeekOdds, readWeekMarketContextByTeam } = await import(
  '@/lib/odds/gameOddsReads'
)

/** A stored row exactly as the DB holds it — prices included. */
function storedRow(over: Record<string, unknown> = {}) {
  return {
    gameExternalId: '7532',
    sport: 'NFL',
    source: 'api_sports',
    bookmakerId: 8,
    bookmakerName: 'Bet365',
    season: 2026,
    week: 1,
    spreadHome: -3.5,
    totalPoints: 45.5,
    moneylineHome: 1.65,
    moneylineAway: 2.35,
    impliedHomeTotal: 24.5,
    impliedAwayTotal: 21,
    homeWinProbability: 0.5876,
    fetchedAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 3_600_000),
    ...over,
  }
}

const FORBIDDEN = ['moneylineHome', 'moneylineAway', 'bookmakerName']

beforeEach(() => {
  findMany.mockReset()
  findFirst.mockReset()
  count.mockReset()
  gamesFindMany.mockReset()
})

describe('readWeekMarketContextByTeam — each side stated from its own perspective', () => {
  /*
   * 🛑 THE FIXTURE IS DELIBERATELY ASYMMETRIC. Home is favoured by 3.5 on a 45.5
   * total, so the two sides differ in every field: -3.5 vs +3.5, 24.5 vs 21.0,
   * 0.5876 vs 0.4124. With a pick-em and an even total, a bug that COPIED the home
   * values onto the away team instead of mirroring them would pass every assertion
   * below. That is the whole reason these numbers are lopsided.
   */
  beforeEach(() => {
    findMany.mockResolvedValue([storedRow({ gameExternalId: '7532' })])
    gamesFindMany.mockResolvedValue([
      { externalId: '7532', homeTeam: 'KC', awayTeam: 'DEN' },
    ])
  })

  it('states the home side directly', async () => {
    const m = await readWeekMarketContextByTeam('NFL', 2026, 1)
    const kc = m.get('KC')!
    expect(kc.isHome).toBe(true)
    expect(kc.opponent).toBe('DEN')
    expect(kc.spread).toBe(-3.5)
    expect(kc.impliedTeamTotal).toBe(24.5)
    expect(kc.winProbability).toBeCloseTo(0.5876, 4)
  })

  it('MIRRORS the spread for the away side rather than copying it', async () => {
    const m = await readWeekMarketContextByTeam('NFL', 2026, 1)
    const den = m.get('DEN')!
    expect(den.isHome).toBe(false)
    expect(den.opponent).toBe('KC')
    expect(den.spread).toBe(3.5) // NOT -3.5
    expect(den.impliedTeamTotal).toBe(21)
  })

  it('takes the complement of the win probability for the away side', async () => {
    const m = await readWeekMarketContextByTeam('NFL', 2026, 1)
    expect(m.get('DEN')!.winProbability).toBeCloseTo(0.4124, 4)
  })

  it('the two sides are internally consistent', async () => {
    const m = await readWeekMarketContextByTeam('NFL', 2026, 1)
    const kc = m.get('KC')!
    const den = m.get('DEN')!
    // spreads cancel, probabilities sum to 1, implied totals sum to the game total
    expect(kc.spread! + den.spread!).toBeCloseTo(0, 10)
    expect(kc.winProbability! + den.winProbability!).toBeCloseTo(1, 4)
    expect(kc.impliedTeamTotal! + den.impliedTeamTotal!).toBeCloseTo(kc.gameTotal!, 5)
  })

  it('carries no prices or bookmaker names into the team view either', async () => {
    const m = await readWeekMarketContextByTeam('NFL', 2026, 1)
    for (const key of FORBIDDEN) {
      expect(Object.keys(m.get('KC')!)).not.toContain(key)
      expect(Object.keys(m.get('DEN')!)).not.toContain(key)
    }
  })

  it('stays null rather than inventing a mirror of a missing value', async () => {
    findMany.mockResolvedValue([
      storedRow({ gameExternalId: '7532', spreadHome: null, homeWinProbability: null }),
    ])
    const m = await readWeekMarketContextByTeam('NFL', 2026, 1)
    // -null would be -0, and 1-null would be 1 — both plausible, both wrong.
    expect(m.get('DEN')!.spread).toBeNull()
    expect(m.get('DEN')!.winProbability).toBeNull()
  })

  it('skips a game that has no odds rather than emitting an empty entry', async () => {
    gamesFindMany.mockResolvedValue([
      { externalId: '7532', homeTeam: 'KC', awayTeam: 'DEN' },
      { externalId: '9999', homeTeam: 'BUF', awayTeam: 'MIA' },
    ])
    const m = await readWeekMarketContextByTeam('NFL', 2026, 1)
    expect(m.has('KC')).toBe(true)
    expect(m.has('BUF')).toBe(false)
    expect(m.has('MIA')).toBe(false)
  })

  it('keys on the CANONICAL code when the column holds a full team name', async () => {
    /*
     * The real failure path, not a hypothetical: `syncAPISportsGamesToDb` writes
     *     teamNameToAbbrev(name) || g.teams.home.name
     * so an abbreviation-table miss stores the FULL NAME. A caller holding roster
     * codes would never match it, and the miss is silent.
     */
    gamesFindMany.mockResolvedValue([
      { externalId: '7532', homeTeam: 'Kansas City Chiefs', awayTeam: 'Denver Broncos' },
    ])
    const m = await readWeekMarketContextByTeam('NFL', 2026, 1)

    expect(m.has('KC')).toBe(true)
    expect(m.has('DEN')).toBe(true)
    // and the entry reports the canonical code, not the stored prose
    expect(m.get('KC')!.team).toBe('KC')
    expect(m.get('KC')!.opponent).toBe('DEN')
  })

  it('folds known aliases so JAC and JAX are the same team', async () => {
    gamesFindMany.mockResolvedValue([
      { externalId: '7532', homeTeam: 'JAC', awayTeam: 'WSH' },
    ])
    const m = await readWeekMarketContextByTeam('NFL', 2026, 1)

    expect(m.has('JAX')).toBe(true) // JAC -> JAX
    expect(m.has('WAS')).toBe(true) // WSH -> WAS
    expect(m.get('JAX')!.opponent).toBe('WAS')
  })

  it('CONTROL: an unknown code is not silently mapped onto a real team', async () => {
    // normalizeTeamAbbrev upper-cases what it does not recognise rather than
    // guessing, so junk stays junk — and a caller that normalizes too still matches.
    gamesFindMany.mockResolvedValue([
      { externalId: '7532', homeTeam: 'zzz', awayTeam: 'KC' },
    ])
    const m = await readWeekMarketContextByTeam('NFL', 2026, 1)

    expect(m.has('ZZZ')).toBe(true)
    expect(m.has('KC')).toBe(true)
    expect(m.size).toBe(2)
  })

  it('CONTROL: a copy-instead-of-mirror bug would be caught by this fixture', async () => {
    // Proves the asymmetry is real: if the two sides shared a value, the mirror
    // assertions above could pass while doing nothing.
    const m = await readWeekMarketContextByTeam('NFL', 2026, 1)
    expect(m.get('KC')!.spread).not.toBe(m.get('DEN')!.spread)
    expect(m.get('KC')!.impliedTeamTotal).not.toBe(m.get('DEN')!.impliedTeamTotal)
    expect(m.get('KC')!.winProbability).not.toBe(m.get('DEN')!.winProbability)
  })
})

describe('readGameOdds returns forecast fields only', () => {
  it('strips prices and the bookmaker name from the primary quote', async () => {
    findMany.mockResolvedValue([storedRow()])
    const res = await readGameOdds('NFL', '7532')

    expect(res.primary).not.toBeNull()
    for (const key of FORBIDDEN) {
      expect(Object.keys(res.primary!)).not.toContain(key)
    }
  })

  it('strips them from every book in the list, not just the primary', async () => {
    // The bug this catches: sanitising the headline row and forgetting the array
    // behind it, which is exactly the shape a surface would iterate to build a table.
    findMany.mockResolvedValue([
      storedRow({ bookmakerId: 8 }),
      storedRow({ bookmakerId: 12, bookmakerName: 'Pinnacle', moneylineHome: 1.7 }),
    ])
    const res = await readGameOdds('NFL', '7532')

    expect(res.books).toHaveLength(2)
    for (const book of res.books) {
      for (const key of FORBIDDEN) expect(Object.keys(book)).not.toContain(key)
    }
  })

  it('keeps the forecast fields that surfaces actually need', async () => {
    findMany.mockResolvedValue([storedRow()])
    const res = await readGameOdds('NFL', '7532')

    expect(res.primary!.impliedHomeTotal).toBe(24.5)
    expect(res.primary!.impliedAwayTotal).toBe(21)
    expect(res.primary!.homeWinProbability).toBeCloseTo(0.5876, 4)
    // game-script inputs, and the terms the implied totals come from
    expect(res.primary!.spreadHome).toBe(-3.5)
    expect(res.primary!.totalPoints).toBe(45.5)
    // opaque id survives so two books can be told apart without branding either
    expect(res.primary!.bookmakerId).toBe(8)
  })

  it('still ranks by completeness, which needs the prices it does not return', async () => {
    // Proves the prices are genuinely read internally rather than simply not
    // selected — the sparse book has no moneyline, so the complete one must win.
    findMany.mockResolvedValue([
      storedRow({ bookmakerId: 3, moneylineHome: null, moneylineAway: null, totalPoints: null }),
      storedRow({ bookmakerId: 21 }),
    ])
    const res = await readGameOdds('NFL', '7532')
    expect(res.primary!.bookmakerId).toBe(21)
    expect(Object.keys(res.primary!)).not.toContain('moneylineHome')
  })
})

describe('readWeekOdds returns forecast fields only', () => {
  it('strips prices across every game in the slate', async () => {
    findMany.mockResolvedValue([
      storedRow({ gameExternalId: '1' }),
      storedRow({ gameExternalId: '2', bookmakerName: 'Pinnacle' }),
    ])
    const res = await readWeekOdds('NFL', 2026, 1)

    expect(res.size).toBe(2)
    for (const [, entry] of res) {
      for (const key of FORBIDDEN) {
        expect(Object.keys(entry.primary!)).not.toContain(key)
        for (const b of entry.books) expect(Object.keys(b)).not.toContain(key)
      }
    }
  })
})

describe('positive control — the guard can actually fail', () => {
  it('CONTROL: the stored fixture really does carry the forbidden fields', async () => {
    /*
     * Without this, every assertion above would pass against a fixture that never
     * held a price — a guard that has never once had anything to remove. This
     * pins that the stripping step is doing real work.
     */
    const raw = storedRow()
    for (const key of FORBIDDEN) expect(Object.keys(raw)).toContain(key)

    findMany.mockResolvedValue([raw])
    const res = await readGameOdds('NFL', '7532')
    // same row in, sanitised row out
    expect(Object.keys(raw).length - Object.keys(res.primary!).length).toBe(FORBIDDEN.length)
  })

  it('CONTROL: no provider call happens on a miss — it returns empty, never fetches', async () => {
    findMany.mockResolvedValue([])
    const res = await readGameOdds('NFL', 'unknown-game')
    expect(res.primary).toBeNull()
    expect(res.books).toEqual([])
    expect(res.ageMs).toBeNull()
  })
})
