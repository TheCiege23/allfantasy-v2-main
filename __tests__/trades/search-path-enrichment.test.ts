import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 🛑 THE SEARCH PATH IS THE ONE THAT MATTERS, AND IT IS THE ONE THAT HAD NOTHING.
 *
 * Every feature on the trade screen — headshot, team crest, stock mark, pick price — was wired
 * to the roster picker. The dev server's request log showed the real usage: `player-search?q=dk`,
 * `q=luke mc`, `q=christian`, `q=marvin`, `q=ado`. Every player in a real deal arrived through
 * SEARCH, and the search row carried `playerId: null` and `headshotUrl: null`, so there was
 * nothing to render a face or an arrow from.
 *
 * The data was already in hand: `FantasyCalcPlayerIdentity` has `sleeperId` and
 * `FantasyCalcPlayer` has `trend30Day`. The route was discarding both.
 */

const fcRows = vi.hoisted(() => ({ current: [] as unknown[] }))

vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: vi.fn(async () => fcRows.current),
}))
vi.mock('@/lib/data/players', () => ({ searchPlayers: vi.fn(async () => []) }))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => '127.0.0.1',
}))

/**
 * ⚠ THE ROUTE HOLDS A MODULE-LEVEL `fcCache` WITH A 5-MINUTE TTL, so a static import would let
 * the FIRST test's fixture answer every later test — which is exactly what happened: three tests
 * failed with an empty array because they were being served DK Metcalf. The cache is correct in
 * production (it caches the whole FantasyCalc board, not a query), so the test resets the module
 * rather than the code changing to suit the test.
 */
async function route() {
  vi.resetModules()
  return (await import('@/app/api/trade-value/player-search/route')).GET
}

function fc(name: string, sleeperId: string, value: number, trend30Day: number, team = 'PIT') {
  return {
    player: { id: 1, name, mflId: '', sleeperId, position: 'WR', maybeTeam: team },
    value,
    overallRank: 10,
    trend30Day,
  }
}

function req(q: string, sport = 'NFL') {
  return { nextUrl: { searchParams: new URLSearchParams({ q, sport }) } } as never
}

beforeEach(() => {
  fcRows.current = []
})

describe('🛑 a searched player carries what a picked player carries', () => {
  it('[control] the route returns the row at all', async () => {
    // Without this, every "field is present" assertion below could pass on an empty array.
    fcRows.current = [fc('DK Metcalf', '5846', 1976, -142)]
    const body = await (await (await route())(req('metcalf'))).json()
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('DK Metcalf')
  })

  it('🛑 sends the sleeperId instead of the hardcoded null it used to send', async () => {
    /*
     * This is not cosmetic. Without an id the row cannot be looked up, cannot be priced against
     * a snapshot, and cannot be proposed — a searched player was a name and a number, nothing else.
     */
    fcRows.current = [fc('DK Metcalf', '5846', 1976, -142)]
    const body = await (await (await route())(req('metcalf'))).json()
    expect(body[0].playerId).toBe('5846')
  })

  it('derives the headshot from that id rather than sending null', async () => {
    fcRows.current = [fc('DK Metcalf', '5846', 1976, -142)]
    const body = await (await (await route())(req('metcalf'))).json()
    expect(body[0].headshotUrl).toContain('5846')
    expect(body[0].headshotUrl).toMatch(/^https:\/\//)
  })

  it('🛑 reports the 30-day direction from the SAME rule the roster path uses', async () => {
    /*
     * -142 against a value of 1,976 clears the 1% band (19.76), so it is a real fall. The rule
     * is imported, not re-implemented: a second copy is how the same player ends up rising in
     * one place and flat in another.
     */
    fcRows.current = [fc('DK Metcalf', '5846', 1976, -142)]
    const body = await (await (await route())(req('metcalf'))).json()
    expect(body[0].stock).toBe('down')
    expect(body[0].stockDelta).toBe(-142)
  })

  it('calls a drift inside the band flat, not a confident arrow', async () => {
    fcRows.current = [fc('Steady Guy', '999', 9000, 30)]
    const body = await (await (await route())(req('steady'))).json()
    expect(body[0].stock).toBe('flat')
  })

  it('🛑 a missing trend is null, NOT flat — unmeasured is not unmoved', async () => {
    /*
     * `directionFor` answers 'flat' for a non-finite input, which is right for a measured zero
     * and wrong for a player nobody has measured. The finite check lives at the route for that
     * reason, and this is the test that stops someone "simplifying" it away.
     */
    fcRows.current = [{ ...fc('Unknown', '111', 500, 0), trend30Day: null }]
    const body = await (await (await route())(req('unknown'))).json()
    expect(body[0].stock).toBeNull()
    expect(body[0].stockDelta).toBeNull()
  })

  it('a player with no sleeperId still returns, just without a face', async () => {
    // Degrading to the coloured initial is correct; dropping the row is not.
    fcRows.current = [fc('No Id', '', 400, 5)]
    const body = await (await (await route())(req('no id'))).json()
    expect(body).toHaveLength(1)
    expect(body[0].playerId).toBeNull()
    expect(body[0].headshotUrl).toBeNull()
  })
})

describe('🛑 the client must not discard what the route sends', () => {
  const PICKER = readFileSync(
    resolve(process.cwd(), 'components/core-app/screens/TradeAssetPicker.tsx'),
    'utf8',
  )
  const CENTER = readFileSync(
    resolve(process.cwd(), 'components/core-app/screens/TradeCenter.tsx'),
    'utf8',
  )

  it('[control] the scans are reading the right files', () => {
    expect(PICKER).toContain('type SearchRow')
    expect(CENTER).toContain('<TradeAssetPicker')
  })

  it('🛑 SearchRow DECLARES the fields — an omitted field is a silent discard', () => {
    /*
     * The route always sent `headshotUrl`. `SearchRow` did not declare it, so the client threw
     * it away and a searched player showed an initial while the same player off a roster showed
     * a face. A narrower type is not a smaller contract; it is a discard with no error.
     */
    const decl = PICKER.slice(PICKER.indexOf('type SearchRow'), PICKER.indexOf('const DEBOUNCE_MS'))
    expect(decl).toContain('headshotUrl')
    expect(decl).toContain('stock')
    expect(decl).toContain('stockDelta')
  })

  it('passes all three into the deal when a search result is clicked', () => {
    expect(PICKER).toContain('imageUrl: r.headshotUrl ?? null')
    expect(PICKER).toContain('stock: r.stock ?? null')
    expect(PICKER).toContain('stockDelta: r.stockDelta ?? null')
  })

  it('shows them in the search list too, so the picker and the deal agree', () => {
    expect(PICKER).toContain('<StockMark stock={r.stock} delta={r.stockDelta} />')
    expect(PICKER).toMatch(/r\.headshotUrl \?[\s\S]{0,260}?af-tc-headshot/)
  })
})

describe('🛑 a hand-typed pick is priced', () => {
  const PICKER = readFileSync(
    resolve(process.cwd(), 'components/core-app/screens/TradeAssetPicker.tsx'),
    'utf8',
  )
  const CENTER = readFileSync(
    resolve(process.cwd(), 'components/core-app/screens/TradeCenter.tsx'),
    'utf8',
  )

  it('🛑 uses the round the manager typed instead of leaving it unpriced', () => {
    /*
     * The previous reasoning — "a hand-typed pick has no round we can trust" — was wrong. The
     * round comes from a number input the manager fills in. Leaving it null put an em dash on
     * the row and "1 unpriced" on the total for the commonest way to add a pick.
     */
    const block = PICKER.slice(PICKER.indexOf('Add a pick by hand'))
    expect(block).toContain('pickValueByOverall({')
    expect(block).toContain('round: pickRound')
    expect(block).toContain('FIRST_ROUND_IN_MARKET_UNITS')
  })

  it('prices against the real league size when the screen knows it', () => {
    expect(PICKER).toContain('teams: props.teamCount ?? null')
    expect(CENTER).toContain('teamCount={props.league?.teamCount ?? null}')
  })

  it('⚠ priced is not proposable, and the copy still says so', () => {
    // Without a pickId the engine has nothing to point an offer at. Pricing it does not change that.
    expect(PICKER).toContain('cannot be sent as part of an offer')
  })
})
