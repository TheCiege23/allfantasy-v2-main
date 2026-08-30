import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { DevyLeagueSettingsHub } from '@/components/devy/settings/DevyLeagueSettingsHub'
import { DEVY_BRIDGE_MAX, DEVY_BRIDGE_MIN } from '@/lib/devy/devyMarketBridge'
import { defaultDevyLeagueSetup } from '@/lib/devy/devy-league-config'

/**
 * The commissioner control for the devy/NFL exchange rate.
 *
 * 🛑 THE DEFAULT STATE IS THE PRODUCT DECISION, AND THE SCREEN HAS TO SAY SO. Empty means mixed
 * trades stay ungradeable — the honest answer, because nothing prices college players. A
 * settings card that presented this as a calibration to be filled in, rather than a house rule
 * a league may opt into, would undo the refusal it is lifting.
 *
 * ⚠ AND THE PREVIEW IS THE POINT. "3.5" tells a commissioner nothing; "your top prospect
 * becomes 3,500" is what he can weigh against NFL players whose prices he knows.
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const ctx = (settings: unknown, isCommissioner = true) =>
  ({
    league: { id: 'L1', sport: 'NFL', settings },
    isCommissioner,
  }) as never

/*
 * ⚠ BUILT FROM THE REAL DEFAULT, NOT `{ version: 1 }`. `parseDevyLeagueConfig` is a plain cast
 * that only checks the version, so a stub passes it and is then handed to sibling panels that
 * read `rosterSlots.devy` and crash. The first run of this file did exactly that — the fixture
 * was accepted by the parser and rejected by the UI, which is a fair description of what a
 * half-written config would do in production too.
 */
const DEVY_CFG = (over: Record<string, unknown> = {}) => ({
  devy_league_config: { ...defaultDevyLeagueSetup('NFL'), ...over },
})

const openTrading = () => {
  fireEvent.click(screen.getByRole('button', { name: /trading/i }))
}

afterEach(() => vi.clearAllMocks())

describe('the exchange rate card', () => {
  it('starts unset and says what that means for mixed trades', () => {
    render(<DevyLeagueSettingsHub ctx={ctx(DEVY_CFG())} />)
    openTrading()
    const input = screen.getByLabelText(/market units per devy point/i) as HTMLInputElement
    expect(input.value).toBe('')
    expect(screen.getByText(/mixed devy\/NFL trades are reported as ungradeable/i)).toBeTruthy()
  })

  it('shows an existing rate the league already saved', () => {
    render(<DevyLeagueSettingsHub ctx={ctx(DEVY_CFG({ devyMarketUnitsPerDevyPoint: 3.5 }))} />)
    openTrading()
    const input = screen.getByLabelText(/market units per devy point/i) as HTMLInputElement
    expect(input.value).toBe('3.5')
  })

  /* The consequence, not the abstraction. */
  it('previews what the rate does to the top of the devy board', () => {
    render(<DevyLeagueSettingsHub ctx={ctx(DEVY_CFG())} />)
    openTrading()
    fireEvent.change(screen.getByLabelText(/market units per devy point/i), { target: { value: '3.5' } })
    expect(screen.getByText(/3,500/)).toBeTruthy()
  })

  /*
   * 🛑 A COMMISSIONER WHO TYPES 350 INSTEAD OF 3.5 MUST BE TOLD, ON THE SCREEN, BEFORE SAVING.
   * Otherwise he saves, sees mixed trades still refused, and concludes the feature is broken.
   */
  it('warns that an out-of-range rate will be ignored', () => {
    render(<DevyLeagueSettingsHub ctx={ctx(DEVY_CFG())} />)
    openTrading()
    fireEvent.change(screen.getByLabelText(/market units per devy point/i), { target: { value: '350' } })
    expect(screen.getByText(/Outside the accepted range/i)).toBeTruthy()
    expect(screen.queryByText(/top prospect on your devy board is worth/i)).toBeNull()
  })

  it('warns that a non-number will be ignored', () => {
    render(<DevyLeagueSettingsHub ctx={ctx(DEVY_CFG())} />)
    openTrading()
    fireEvent.change(screen.getByLabelText(/market units per devy point/i), { target: { value: 'lots' } })
    expect(screen.getByText(/not a number/i)).toBeTruthy()
  })

  it('accepts both ends of the range without warning', () => {
    render(<DevyLeagueSettingsHub ctx={ctx(DEVY_CFG())} />)
    openTrading()
    for (const v of [DEVY_BRIDGE_MIN, DEVY_BRIDGE_MAX]) {
      fireEvent.change(screen.getByLabelText(/market units per devy point/i), { target: { value: String(v) } })
      expect(screen.queryByText(/Outside the accepted range/i)).toBeNull()
    }
  })

  /*
   * ⚠ THE CAVEAT IS ON THE SETTINGS SCREEN TOO, not only on the eventual grade. The person
   * choosing the number is the one who most needs to know it is a house rule rather than a
   * measurement.
   */
  it('tells the commissioner it is a house rule, not a valuation', () => {
    render(<DevyLeagueSettingsHub ctx={ctx(DEVY_CFG())} />)
    openTrading()
    expect(screen.getByText(/house rule rather than/i)).toBeTruthy()
    expect(screen.getByText(/no such exchange rate has ever been measured/i)).toBeTruthy()
  })

  it('is read-only for a manager who is not the commissioner', () => {
    render(<DevyLeagueSettingsHub ctx={ctx(DEVY_CFG(), false)} />)
    openTrading()
    expect((screen.getByLabelText(/market units per devy point/i) as HTMLInputElement).disabled).toBe(true)
  })
})
