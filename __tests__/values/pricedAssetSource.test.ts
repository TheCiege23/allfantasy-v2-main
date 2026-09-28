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

/*
 * 🛑 NOTHING BELOW THE LIVE BOARD PRICES A LIVE GRADE (2026-09-28). The three fallbacks this file
 * was written to tell apart — the flat IDP constant, the analytics lifetime value, the historical
 * snapshot — each put a number on the wrong scale into a grade as if it were the market (the
 * snapshot measured 1.4–2.4× the live board at the fringe it served). A player arriving with a
 * Sleeper id was already refused all three; a typed name now gets the same answer, with a reason.
 */
describe('the fallbacks below the live board refuse, and say why', () => {
  it('refuses a defender with no league board rather than pricing him off a flat constant', async () => {
    const priced = await pricePlayer('Nameless Backer', asDefender('Nameless Backer'))

    expect(priced.unpriced).toBe(true)
    expect(priced.value).toBe(0)
    expect(priced.unpricedReason?.code).toBe('defender')
  })

  it('does not price off the analytics lifetime value — a different unit, never calibrated', async () => {
    getPlayerAnalytics.mockResolvedValue({
      position: 'WR',
      draft: { lifetimeValue: 1234 },
    })

    const priced = await pricePlayer('Fringe Receiver', baseCtx)

    expect(priced.unpriced).toBe(true)
    expect(priced.value).toBe(0)
  })

  it('refuses a player only the historical snapshot carries, naming the snapshot date', async () => {
    getHistoricalPlayerValue.mockReturnValue({ value: 1605, actualDate: '2026-02-05', source: 'historical' })

    const priced = await pricePlayer('Joe Mixon', baseCtx)

    expect(priced.unpriced).toBe(true)
    expect(priced.value).toBe(0)
    expect(priced.unpricedReason?.code).toBe('not_on_feed')
    expect(priced.unpricedReason?.label).toContain('2026-02-05')
  })

  /* The positive controls: the refusal is for a player the live board lacks, and for a live grade only. */
  it('prices from the live board when it carries him, whatever the snapshot says', async () => {
    getHistoricalPlayerValue.mockReturnValue({ value: 9000, actualDate: '2026-02-05', source: 'historical' })
    findPlayerByName.mockReturnValue({
      value: 4200, redraftValue: 3000, positionRank: 20, player: { name: 'Board Receiver', position: 'WR', maybeAge: 26 },
    })

    const priced = await pricePlayer('Board Receiver', baseCtx)

    expect(priced.source).toBe('fantasycalc')
    expect(priced.value).toBe(4200)
  })

  it('still answers a question about the PAST from the historical file', async () => {
    getHistoricalPlayerValue.mockReturnValue({ value: 1605, actualDate: '2025-10-01', source: 'historical' })

    const priced = await pricePlayer('Joe Mixon', { ...baseCtx, asOfDate: '2025-10-01' })

    expect(priced.source).toBe('excel')
    expect(priced.value).toBe(1605)
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
  it('counts a defender with no league board as unknown now that no constant prices him', async () => {
    const res = await priceAssets(
      { players: ['Nameless Backer'], picks: [] },
      asDefender('Nameless Backer'),
    )

    expect(res.stats.playersFromFallback).toBe(0)
    expect(res.stats.playersUnknown).toBe(1)
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
