import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `PricedAsset.source` telling three different things apart that it used to collapse into one.
 *
 * 🛑 THREE BRANCHES OF `pricePlayer` RETURNED `source: 'unknown'`: the flat IDP positional
 * constant, the analytics lifetime-value fallback, and the terminal branch where nothing
 * matched. The first two hand back a real, usable number; the third hands back 0. Collapsing
 * them meant no surface could say "this defender was priced off a constant where every
 * linebacker is worth 800", and no test could assert it had stopped happening.
 *
 * ⚠ THE MOST IMPORTANT TESTS HERE ARE THE ONES THAT ASSERT NOTHING MOVED. Splitting the union
 * silently flips every `source !== 'unknown'` test in the codebase from correct to wrong, and
 * those tests feed CONFIDENCE — so the reward for making the pricing more honest would have
 * been a higher confidence score on exactly the trades priced worst. `isEvidencedPrice` exists
 * to keep that boolean where it was, and the cases below pin it.
 */

const getHistoricalPlayerValue = vi.fn()
const findPlayerByName = vi.fn()
const getPlayerAnalytics = vi.fn()

vi.mock('@/lib/historical-values', () => ({
  getHistoricalPlayerValue: (...a: unknown[]) => getHistoricalPlayerValue(...a),
  getHistoricalPickValueWeighted: vi.fn(() => ({ value: null })),
}))

vi.mock('@/lib/fantasycalc', () => ({
  findPlayerByName: (...a: unknown[]) => findPlayerByName(...a),
}))

vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: vi.fn(async () => []),
}))

vi.mock('@/lib/player-analytics', () => ({
  getPlayerAnalytics: (...a: unknown[]) => getPlayerAnalytics(...a),
}))

const { pricePlayer, priceAssets, isEvidencedPrice, unevidencedPlayerCount } = await import(
  '@/lib/hybrid-valuation',
)

const TODAY = new Date().toISOString().slice(0, 10)
const baseCtx = { asOfDate: TODAY, isSuperFlex: false, fantasyCalcPlayers: [] as never[] }

/*
 * ⚠ `playerPositionOverrides` IS KEYED LOWERCASED AND TRIMMED — `pricePlayer` looks it up as
 * `name.toLowerCase().trim()`. A display-cased key silently misses, the position falls through
 * to 'UNKNOWN', and the flat branch never fires; the first run of this file did exactly that
 * and reported the fallback as unpriced. It is the same lookup shape the IDP board uses.
 */
const asDefender = (name: string) => ({
  ...baseCtx,
  playerPositionOverrides: { [name.toLowerCase().trim()]: 'LB' },
})

beforeEach(() => {
  vi.clearAllMocks()
  findPlayerByName.mockReturnValue(null)
  getHistoricalPlayerValue.mockReturnValue({ value: null })
  getPlayerAnalytics.mockResolvedValue(null)
})

describe('the three branches that used to all say "unknown"', () => {
  it('names the flat IDP constant as its own source, with a real value attached', async () => {
    const priced = await pricePlayer('Nameless Backer', asDefender('Nameless Backer'))

    expect(priced.source).toBe('idp-flat-baseline')
    /* The positive control: this branch is only interesting because it DOES price him. */
    expect(priced.value).toBeGreaterThan(0)
    expect(priced.unpriced).toBeUndefined()
  })

  it('names the analytics lifetime-value fallback as its own source', async () => {
    getPlayerAnalytics.mockResolvedValue({
      position: 'WR',
      draft: { lifetimeValue: 1234 },
    })

    const priced = await pricePlayer('Fringe Receiver', baseCtx)

    expect(priced.source).toBe('analytics-lifetime')
    expect(priced.value).toBe(1234)
    expect(priced.unpriced).toBeUndefined()
  })

  it('leaves "unknown" meaning exactly one thing — nothing priced this asset', async () => {
    const priced = await pricePlayer('Totally Made Up Person', baseCtx)

    expect(priced.source).toBe('unknown')
    expect(priced.value).toBe(0)
    expect(priced.unpriced).toBe(true)
  })
})

describe('isEvidencedPrice', () => {
  /*
   * These are the exact booleans `source !== 'unknown'` produced BEFORE the split. If any row
   * flips, a confidence score somewhere moved without anyone deciding it should.
   */
  const CASES: ReadonlyArray<[PricedSource, boolean]> = [
    ['fantasycalc', true],
    ['excel', true],
    ['curve', true],
    ['idp-vorp', true],
    ['kicker-flat', true],
    ['idp-flat-baseline', false],
    ['analytics-lifetime', false],
    ['unknown', false],
  ]

  it.each(CASES)('%s → evidenced: %s', (source, expected) => {
    expect(isEvidencedPrice({ source })).toBe(expected)
  })

  /*
   * ⚠ THE ONE PAIR MOST LIKELY TO BE "TIDIED" INTO AGREEING. Both are a single number shared
   * by many players, so they look like the same kind of thing. A kicker's value is flat
   * because seven seasons say rank does not persist — the flatness is the finding. The IDP
   * baseline is flat because nobody measured it.
   */
  it('separates the measured flat kicker price from the unmeasured flat IDP constant', () => {
    expect(isEvidencedPrice({ source: 'kicker-flat' })).toBe(true)
    expect(isEvidencedPrice({ source: 'idp-flat-baseline' })).toBe(false)
  })
})

describe('valuationStats counts fallbacks apart from unpriced', () => {
  it('puts a flat-baseline defender in playersFromFallback, not playersUnknown', async () => {
    const res = await priceAssets(
      { players: ['Nameless Backer'], picks: [] },
      asDefender('Nameless Backer'),
    )

    expect(res.stats.playersFromFallback).toBe(1)
    expect(res.stats.playersUnknown).toBe(0)
  })

  it('still counts a genuinely unpriced player as unknown', async () => {
    const res = await priceAssets({ players: ['Totally Made Up Person'], picks: [] }, baseCtx)

    expect(res.stats.playersUnknown).toBe(1)
    expect(res.stats.playersFromFallback).toBe(0)
  })

  /*
   * 🛑 THE PROPERTY THE SPLIT MUST NOT BREAK. Confidence penalises `playersFromFallback +
   * playersUnknown`, and their SUM is what the single `playersUnknown` counted before. If a
   * future edit drops one term from that sum, this is the test that notices.
   */
  it('keeps the unevidenced total that confidence is computed from unchanged', async () => {
    const res = await priceAssets(
      { players: ['Nameless Backer', 'Totally Made Up Person'], picks: [] },
      asDefender('Nameless Backer'),
    )

    expect(res.stats.playersFromFallback + res.stats.playersUnknown).toBe(2)
  })
})

describe('unevidencedPlayerCount', () => {
  /*
   * 🛑 THIS BLOCK EXISTS BECAUSE A MUTATION SURVIVED. Deleting the fallback term from
   * confidence's penalty — leaving it reading `playersUnknown` alone — passed every other test
   * in this file. The stats tests proved the two populations were counted APART and never that
   * confidence added them back, so the one regression the split makes possible was unguarded.
   */
  it('adds both unevidenced populations, so neither can be dropped unnoticed', () => {
    expect(unevidencedPlayerCount({ playersFromFallback: 3, playersUnknown: 4 })).toBe(7)
  })

  it('counts a fallback-priced player even when nothing is unpriced', () => {
    expect(unevidencedPlayerCount({ playersFromFallback: 2, playersUnknown: 0 })).toBe(2)
  })

  it('counts an unpriced player even when nothing used a fallback', () => {
    expect(unevidencedPlayerCount({ playersFromFallback: 0, playersUnknown: 2 })).toBe(2)
  })

  it('is zero when every player was priced by evidence — the positive control', () => {
    expect(unevidencedPlayerCount({ playersFromFallback: 0, playersUnknown: 0 })).toBe(0)
  })

  /*
   * The invariant against the pre-split world: whatever the mix, the total this returns is
   * what the single `playersUnknown` count used to be, and it is what confidence penalises.
   */
  it('equals what the old single unknown count would have been for the same trade', async () => {
    const res = await priceAssets(
      { players: ['Nameless Backer', 'Totally Made Up Person'], picks: [] },
      asDefender('Nameless Backer'),
    )
    expect(unevidencedPlayerCount(res.stats)).toBe(2)
  })
})

type PricedSource = Awaited<ReturnType<typeof pricePlayer>>['source']
