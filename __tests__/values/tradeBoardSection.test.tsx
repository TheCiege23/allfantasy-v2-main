import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { TradeBoardSection } from '@/app/idp/defense-hub/[leagueId]/TradeBoardSection'

/**
 * The board a manager reads before making an offer.
 *
 * 🛑 EVERY ASSERTION HERE IS A MEASUREMENT THE TABLE COULD SILENTLY UN-MAKE. The IDP stack
 * spent real effort establishing that an unpriced defender is not a cheap one, that a floor
 * price is not a measured price, and that kickers cannot be ranked. All three survive the
 * loader and can be thrown away by a renderer that does the ordinary thing — `?? 0`, a plain
 * number, a value column per row. These pin the rendering, not the arithmetic.
 */

const mount = (payload: unknown, ok = true) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => payload })),
  )
  return render(<TradeBoardSection leagueId="L1" />)
}

const row = (over: Record<string, unknown> = {}) => ({
  sleeperId: 'lb_target',
  name: 'Target Backer',
  team: 'DAL',
  position: 'LB',
  value: 5200,
  vorp: 9.4,
  projectedPoints: 17.8,
  positionRank: 1,
  valueIsFloor: false,
  ownedBy: { teamName: 'Their Team', ownerName: 'Them', isMine: false },
  ...over,
})

const BOARD = (over: Record<string, unknown> = {}) => ({
  state: 'ok',
  projectedFor: { season: 2026, week: 4 },
  rows: [row()],
  kickerValue: null,
  kickers: [],
  coverage: { defenders: 1, projected: 1, priced: 1 },
  notes: [],
  ...over,
})

afterEach(() => vi.unstubAllGlobals())

describe('the board renders what the manager came for', () => {
  it('shows a defender he does not own, with the team holding him', async () => {
    mount(BOARD())
    expect(await screen.findByText('Target Backer')).toBeTruthy()
    expect(screen.getByText('5,200')).toBeTruthy()
    expect(screen.getByText('Their Team')).toBeTruthy()
    expect(screen.getByText('Them')).toBeTruthy()
  })

  it('marks his own players as his rather than showing an owner name', async () => {
    mount(BOARD({ rows: [row({ ownedBy: { teamName: 'My Team', ownerName: 'Me', isMine: true } })] }))
    expect(await screen.findByText('you')).toBeTruthy()
  })

  /*
   * ⚠ THE WEEK IS NOT DECORATION. "5,200" reads as current; in the offseason it is a
   * projection for a week not played in months. The loader returns `projectedFor` precisely so
   * a surface rendering these numbers can say which week they describe.
   */
  it('states which week the projections are for', async () => {
    mount(BOARD())
    expect(await screen.findByText(/2026 week 4/i)).toBeTruthy()
  })

  it('warns instead of going quiet when the week is unknown', async () => {
    mount(BOARD({ projectedFor: null }))
    expect(await screen.findByText(/can’t say which week/i)).toBeTruthy()
  })
})

describe('the honesty rules a table can silently un-make', () => {
  /*
   * 🛑 AN UNPRICED DEFENDER IS NOT A CHEAP ONE. `value: null` means replacement level could not
   * be established for him. A renderer reaching for `?? 0` prints "0" and tells the manager he
   * is the worst asset in the league.
   */
  it('renders an unpriced defender as a dash, never as 0', async () => {
    mount(BOARD({ rows: [row({ value: null, vorp: null, projectedPoints: null })] }))
    await screen.findByText('Target Backer')
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.queryByText('0.0')).toBeNull()
    expect(
      screen.getByTitle(/not the same as being worth nothing/i),
    ).toBeTruthy()
  })

  /*
   * A floor price is not a measured value — roughly half a real board sits on it. Rendered as a
   * plain number, two floor-priced defenders look like equivalent trade assets.
   */
  it('marks a floor price rather than printing it like a measured one', async () => {
    mount(BOARD({ rows: [row({ value: 240, valueIsFloor: true })] }))
    await screen.findByText('Target Backer')
    expect(screen.getByText('floor')).toBeTruthy()
    expect(screen.getByTitle(/Do not compare two floor-priced defenders/i)).toBeTruthy()
  })

  /*
   * 🛑 KICKERS: ONE VALUE, STATED ONCE. Repeating an identical number down a column reads as a
   * rendering bug rather than as the finding it is, and rank/proj columns beside kickers invite
   * a comparison seven seasons of data refuse.
   */
  it('states the kicker value once and gives kickers no rank or projection', async () => {
    mount(
      BOARD({
        kickerValue: { value: 500, replacementRank: 13, scarcity: 0.4, rankPredictability: 'none', basis: 'flat by design' },
        kickers: [
          { sleeperId: 'k1', name: 'Boot One', team: 'BUF', ownedBy: { teamName: 'A', ownerName: 'a', isMine: false } },
          { sleeperId: 'k2', name: 'Boot Two', team: 'NYJ', ownedBy: { teamName: 'B', ownerName: 'b', isMine: false } },
        ],
      }),
    )
    await screen.findByText('Boot One')
    /* The value appears ONCE despite two kickers — not once per row. */
    expect(screen.getAllByText('500')).toHaveLength(1)
    expect(screen.getByText(/for any kicker in this league/i)).toBeTruthy()
    expect(screen.getByText('flat by design')).toBeTruthy()
  })

  it('renders no kicker block at all when the league starts none', async () => {
    mount(BOARD({ kickerValue: null, kickers: [] }))
    await screen.findByText('Target Backer')
    expect(screen.queryByText(/for any kicker in this league/i)).toBeNull()
  })

  it('surfaces the loader’s notes rather than dropping them', async () => {
    mount(BOARD({ notes: ['These values are specific to THIS league.'] }))
    expect(await screen.findByText(/specific to THIS league/i)).toBeTruthy()
  })
})

describe('states that are not an error', () => {
  it.each([
    ['not_idp_league', /does not score defenders/i],
    ['no_projection_history', /No projection history/i],
    ['valuation_refused', /refused rather than guessed/i],
  ])('explains %s instead of rendering an empty table', async (state, copy) => {
    mount(BOARD({ state, rows: [] }))
    expect(await screen.findByText(copy)).toBeTruthy()
  })

  it('says access was refused rather than showing a broken board', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })))
    render(<TradeBoardSection leagueId="L1" />)
    await waitFor(() => expect(screen.getByText(/don’t have access/i)).toBeTruthy())
  })
})
