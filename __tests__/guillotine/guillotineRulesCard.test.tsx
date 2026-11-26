/**
 * The Guilly hub's Rules & Settings card in words (2026-11-06). It printed the stored config verbatim:
 * `season_points → previous_period → draft_slot → commissioner`, "Elimination end 11" (no "Week"), "— pts" when no
 * danger margin was set, and "Release timing: next waiver run" in the waiver card. The same page's "Ties are broken
 * by" card already words the tiebreak order (tiebreakLabels), and the settings editor already words the release
 * timing (RELEASE_OPTIONS) — this card now uses both, so one page never states a rule two ways.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('@/components/decide/shareCard', () => ({ shareCardImage: vi.fn(async () => 'downloaded') }))
vi.mock('@/components/guillotine/GuillotineAIPanel', () => ({ GuillotineAIPanel: () => null }))
vi.mock('@/components/guillotine/GuillotineChopAnimation', () => ({ GuillotineChopAnimation: () => null }))

import { GuillotineHome } from '@/components/guillotine/GuillotineHome'
import { tiebreakLabels } from '@/components/guillotine/guillotineHomeModel'

const CONFIG = {
  eliminationStartWeek: 1,
  eliminationEndWeek: 11,
  teamsPerChop: 1,
  tiebreakerOrder: ['season_points', 'previous_period', 'draft_slot', 'commissioner'],
  dangerMarginPoints: 12,
  rosterReleaseTiming: 'next_waiver_run',
}

const summary = (config: Record<string, unknown> | null) => ({
  leagueId: 'league-1',
  weekOrPeriod: 4,
  choppedThisWeek: [],
  survivalStandings: [],
  dangerTiers: [],
  recentChopEvents: [],
  assets: { leagueImage: '/guillotine/Guillotine.png', introVideo: '/guillotine/Guillotine.mp4' },
  config,
})

async function rulesCard(config: Record<string, unknown> | null) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => summary(config) }))
  render(<GuillotineHome leagueId="league-1" sport="NFL" leagueName="Blade League" />)
  await waitFor(() => expect(screen.getByTestId('guillotine-rules')).toBeTruthy())
  return screen.getByTestId('guillotine-rules')
}
const value = (card: HTMLElement, label: string) => {
  const dt = within(card).getByText(label, { selector: 'dt' })
  return dt.nextElementSibling as HTMLElement
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Guilly Rules & Settings, in words', () => {
  it('the rules are a closed row, the heading its summary (2026-11-24)', async () => {
    const card = await rulesCard(CONFIG)
    expect(card.tagName).toBe('DETAILS')
    expect((card as HTMLDetailsElement).open).toBe(false)
    expect(card.querySelector('summary h2')?.textContent).toContain('Rules & Settings')
  })


  it('prints no stored keys: no snake_case anywhere in the card', async () => {
    const card = await rulesCard(CONFIG)
    expect(card.textContent).not.toMatch(/[a-z]+_[a-z]+/)
    expect(card.textContent).not.toContain('→')
  })

  it('lists the tiebreak order in the same words as the hub’s "Ties are broken by" card, in order', async () => {
    const card = await rulesCard(CONFIG)
    const items = within(value(card, 'Ties are broken by')).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(tiebreakLabels(CONFIG.tiebreakerOrder))
    expect(items[0]).toBe('Total season points')
  })

  it('says "Week" on both chop weeks, counts teams, and names the margin unit once', async () => {
    const card = await rulesCard(CONFIG)
    expect(value(card, 'First chop').textContent).toBe('Week 1')
    expect(value(card, 'Last chop').textContent).toBe('Week 11')
    expect(value(card, 'Chopped each week').textContent).toBe('1 team')
    expect(value(card, 'Danger tier').textContent).toBe('Within 12 points of the cut')
  })

  it('plural teams; unset end week and margin read as unset, not as "—" or "— pts"', async () => {
    const card = await rulesCard({ ...CONFIG, teamsPerChop: 2, eliminationEndWeek: null, dangerMarginPoints: null })
    expect(value(card, 'Chopped each week').textContent).toBe('2 teams')
    expect(value(card, 'Last chop').textContent).toBe('No last week set')
    expect(value(card, 'Danger tier').textContent).toBe('Not set')
    expect(card.textContent).not.toContain('pts')
  })

  it('the waiver card words the release timing the way the settings editor does', async () => {
    await rulesCard(CONFIG)
    expect(screen.getByTestId('guillotine-release-timing').textContent).toBe('Chopped players are released: At the next waiver run')
    cleanup()
    vi.unstubAllGlobals()
    await rulesCard({ ...CONFIG, rosterReleaseTiming: 'immediate' })
    expect(screen.getByTestId('guillotine-release-timing').textContent).toBe('Chopped players are released: Right after the chop')
  })
})

describe('trades on the home (owner, 2026-11-26): said before a manager makes an offer', () => {
  const trades = (over: Record<string, unknown> = {}) => ({ tradesAllowed: true, tradesCloseAtTeamsLeft: 4, tradesClosed: false, teamsLeft: 7, ...over })

  it('trades on with a closing point: one line on the home, and a row in the rules', async () => {
    const card = await rulesCard({ ...CONFIG, trades: trades() })
    expect(screen.getByTestId('guillotine-trade-window').textContent).toBe('Trades close once 4 teams are left. 7 are left now.')
    expect(value(card, 'Trades').textContent).toBe('On until 4 teams are left')
  })

  it('once closed it says so', async () => {
    const card = await rulesCard({ ...CONFIG, trades: trades({ tradesClosed: true, teamsLeft: 4 }) })
    expect(screen.getByTestId('guillotine-trade-window').textContent).toBe('Trades are closed. They closed once 4 teams were left.')
    expect(value(card, 'Trades').textContent).toBe('Closed')
  })

  it('[control] trades off, or on with no closing point: no line, nothing to warn about', async () => {
    const off = await rulesCard({ ...CONFIG, trades: { tradesAllowed: false, tradesCloseAtTeamsLeft: null, tradesClosed: false, teamsLeft: null } })
    expect(screen.queryByTestId('guillotine-trade-window')).toBeNull()
    expect(value(off, 'Trades').textContent).toBe('Off')
    cleanup()
    vi.unstubAllGlobals()
    await rulesCard({ ...CONFIG, trades: trades({ tradesCloseAtTeamsLeft: null }) })
    expect(screen.queryByTestId('guillotine-trade-window')).toBeNull()
  })

  it('a skip-waivers week shows as a rule row', async () => {
    const card = await rulesCard({ ...CONFIG, freeAgencyFromWeek: 12 })
    expect(value(card, 'Chopped players skip waivers').textContent).toBe('From week 12')
  })

  it('a two-week league labels the week being played as its period', async () => {
    const { guillotineWeekLabel } = await import('@/components/guillotine/guillotineHomeModel')
    expect(guillotineWeekLabel(4, 18, 2)).toBe('Weeks 3–4 of 18')
    expect(guillotineWeekLabel(4, 18)).toBe('Week 4 of 18')
    const card = await rulesCard({ ...CONFIG, periodWeeks: 2 })
    expect(value(card, 'Chopped each two-week period').textContent).toBe('1 team')
  })
})
