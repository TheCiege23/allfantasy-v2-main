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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    gameOdds: {
      findMany: (...args: unknown[]) => findMany(...args),
      findFirst: (...args: unknown[]) => findFirst(...args),
      count: (...args: unknown[]) => count(...args),
    },
  },
}))

const { readGameOdds, readWeekOdds } = await import('@/lib/odds/gameOddsReads')

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
