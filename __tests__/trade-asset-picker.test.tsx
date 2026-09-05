/**
 * The asset picker, after it stopped being a search box.
 *
 * 🛑 WHY IT WAS ONE. `/api/leagues/[id]/trades/rosters` already fetched team, headshot, bye week,
 * injury status and (now) market value for every player, and the route kept `{ id, name, position }`
 * and dropped the rest. With nothing on the wire to browse, typing a name was the only way to
 * identify a player. The narrowing is gone; these pin the rendering that it made impossible.
 *
 * The assertions concentrate on the distinctions a manager can be misled by — a null bye rendered
 * as a week, an unpriced player rendered as zero, "no FAAB budget" rendered as "$0 available" — not
 * on layout.
 */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, within } from '@testing-library/react'
import React from 'react'

import { TradeAssetPicker } from '@/components/core-app/screens/TradeAssetPicker'
import type { RosterPlayer, RosterPick } from '@/components/core-app/screens/useLeagueRosters'

const player = (over: Partial<RosterPlayer> = {}): RosterPlayer => ({
  id: 'p1',
  name: 'Perry Vance',
  position: 'WR',
  team: 'GB',
  imageUrl: 'https://example.test/p1.png',
  byeWeek: 10,
  injuryStatus: null,
  value: 6552,
  ...over,
})

function open(props: Partial<React.ComponentProps<typeof TradeAssetPicker>> = {}) {
  return render(
    <TradeAssetPicker
      onPick={props.onPick ?? vi.fn()}
      onClose={props.onClose ?? vi.fn()}
      sport="NFL"
      rosterKnown
      {...props}
    />,
  )
}

describe('🛑 the roster is browsable without typing', () => {
  it('lists the players on the roster', () => {
    const { container } = open({ rosterPlayers: [player(), player({ id: 'p2', name: 'Dana Okoye', position: 'LB', team: 'CHI', byeWeek: 7, value: 3120 })] })
    const t = (container.textContent ?? '').replace(/\s+/g, ' ')
    expect(t).toContain('Perry Vance')
    expect(t).toContain('Dana Okoye')
  })

  it('picking one hands back the full asset, not just a name', () => {
    const onPick = vi.fn()
    const { getByText } = open({ rosterPlayers: [player()], onPick })

    fireEvent.click(getByText('Perry Vance').closest('button')!)

    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'player', playerId: 'p1', name: 'Perry Vance',
        position: 'WR', team: 'GB', value: 6552,
      }),
    )
  })

  it('filters locally across name, position AND team', () => {
    /*
     * A manager types "WR" or "GB" as readily as a surname. Matching names alone would return
     * nothing for either, which is indistinguishable from "you have no receivers".
     */
    const roster = [player(), player({ id: 'p2', name: 'Dana Okoye', position: 'LB', team: 'CHI' })]
    const { container, getByPlaceholderText } = open({ rosterPlayers: roster })
    const input = getByPlaceholderText(/Filter this roster/i)

    fireEvent.change(input, { target: { value: 'LB' } })
    let t = (container.textContent ?? '').replace(/\s+/g, ' ')
    expect(t).toContain('Dana Okoye')
    expect(t).not.toContain('Perry Vance')

    fireEvent.change(input, { target: { value: 'GB' } })
    t = (container.textContent ?? '').replace(/\s+/g, ' ')
    expect(t).toContain('Perry Vance')
    expect(t).not.toContain('Dana Okoye')
  })

  it('distinguishes an empty roster from an unknown one', () => {
    // Two different facts. Telling a manager their team is empty when we simply have not loaded it
    // is worse than saying nothing.
    const known = (open({ rosterPlayers: [], rosterKnown: true }).container.textContent ?? '')
    expect(known).toContain('No players are listed on this roster yet')

    const unknown = (open({ rosterPlayers: [], rosterKnown: false }).container.textContent ?? '')
    expect(unknown).not.toContain('No players are listed on this roster yet')
  })
})

describe('🛑 the distinctions a manager can act on', () => {
  it('renders a bye week when known and NOTHING when not', () => {
    const withBye = (open({ rosterPlayers: [player({ byeWeek: 10 })] }).container.textContent ?? '')
    expect(withBye).toContain('BYE 10')

    /*
     * A null bye means "we do not know". Rendering it as a week — or as 0 — states a fact a manager
     * could plan around and be wrong about.
     */
    const noBye = (open({ rosterPlayers: [player({ byeWeek: null })] }).container.textContent ?? '')
    expect(noBye).not.toContain('BYE')
  })

  it('🛑 shows an unpriced player as an em dash, never as 0', () => {
    // The whole verdict rests on this: an unpriced asset is why the engine declines to judge a
    // deal. A 0 would read as a worthless player and hide the reason.
    const { container } = open({ rosterPlayers: [player({ value: null })] })
    const cell = container.querySelector('[data-unpriced="true"]')
    expect(cell).not.toBeNull()
    expect(cell!.textContent).toBe('—')
    /*
     * ⚠ SCOPED TO THE VALUE CELL, NOT THE WHOLE CONTAINER. A container-wide "must not contain 0"
     * fails on "BYE 10" — which is a correct render — so the broad assertion tested the wrong
     * thing and would have been silenced by deleting the bye chip. The claim is about this cell.
     */
    expect(cell!.textContent).not.toContain('0')

    // And a priced player still shows the number, so the em dash is not simply always rendered.
    const priced = open({ rosterPlayers: [player({ value: 6552 })] }).container
    expect(priced.querySelector('[data-unpriced="true"]')).toBeNull()
    expect((priced.textContent ?? '').replace(/\s+/g, ' ')).toContain('6,552')
  })

  it('surfaces an injury designation', () => {
    const t = open({ rosterPlayers: [player({ injuryStatus: 'Q' })] }).container.textContent ?? ''
    expect(t).toContain('Q')
  })
})

describe('the manager header', () => {
  it('names whose assets these are', () => {
    const t = open({
      rosterPlayers: [player()],
      managerName: 'Jordan',
      managerRecord: { wins: 6, losses: 2, ties: 0 },
    }).container.textContent ?? ''
    expect(t).toContain('Jordan')
    expect(t).toContain('6-2')
  })

  it('🛑 renders a 0-0-0 record rather than hiding it', () => {
    /*
     * Pre-season every team genuinely is 0-0-0. Suppressing it would read as "no record available"
     * in the month this screen gets the most use.
     */
    const t = open({
      rosterPlayers: [player()],
      managerName: 'Jordan',
      managerRecord: { wins: 0, losses: 0, ties: 0 },
    }).container.textContent ?? ''
    expect(t).toContain('0-0')
  })
})

describe('🛑 FAAB — null and zero are different claims', () => {
  const faabTab = (ui: ReturnType<typeof open>) => {
    fireEvent.click(within(ui.container).getByText('FAAB'))
    return ui.container
  }

  it('shows the balance when the league tracks one', () => {
    const c = faabTab(open({ faabAvailable: 73, managerName: 'Jordan' }))
    expect((c.textContent ?? '').replace(/\s+/g, ' ')).toContain('73 available')
  })

  it('says the league tracks no budget when the balance is null', () => {
    // Null is not $0. Offering a $0 input for a league with no FAAB invites a bid that cannot be
    // made.
    const c = faabTab(open({ faabAvailable: null }))
    expect(c.textContent).toContain('does not track a FAAB budget')
  })

  it('says a real zero is spent, rather than hiding the control', () => {
    const c = faabTab(open({ faabAvailable: 0 }))
    expect((c.textContent ?? '').replace(/\s+/g, ' ')).toContain('nothing left to offer')
  })

  it('🛑 clamps the amount to the balance', () => {
    const c = faabTab(open({ faabAvailable: 50 }))
    const input = c.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '999' } })
    expect(Number(input.value)).toBe(50)
  })

  it('🛑 refuses a negative and a non-number', () => {
    /*
     * `Number('')` is 0 and `Number('abc')` is NaN — both would otherwise reach the engine as an
     * amount. Clamped on the way in rather than on submit.
     */
    const c = faabTab(open({ faabAvailable: 50 }))
    const input = c.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '-5' } })
    expect(Number(input.value)).toBe(0)
  })

  it('will not add a zero offer', () => {
    const onPick = vi.fn()
    const c = faabTab(open({ faabAvailable: 0, onPick }))
    const btn = within(c).getByText(/Enter an amount/i).closest('button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(onPick).not.toHaveBeenCalled()
  })
})

describe('🛑 a draft pick shows a value like everything else', () => {
  const pick = (over: Partial<RosterPick> = {}): RosterPick => ({
    pickId: 'k1',
    season: 2027,
    round: 1,
    label: '2027 round 1',
    itemType: 'future_pick',
    value: 950,
    ...over,
  })

  /* Picks are on their own tab; rendering the picker does not show them until it is selected. */
  const pickTab = (ui: ReturnType<typeof open>) => {
    fireEvent.click(within(ui.container).getByText('Pick'))
    return ui.container
  }

  it('renders the number, not a blank', () => {
    /*
     * The reported bug: a 2027 1st sat in the builder with an em dash while every player beside it
     * had a number, and the side total said "1 unpriced".
     */
    const container = pickTab(open({ rosterPicks: [pick()] }))
    expect((container.textContent ?? '').replace(/\s+/g, ' ')).toContain('950')
  })

  it('🛑 hands the value back on pick, so the builder can total it', () => {
    // Without this the route's price is thrown away at the click and the total stays wrong.
    const onPick = vi.fn()
    const ui = open({ rosterPicks: [pick()], onPick })
    const container = pickTab(ui)

    fireEvent.click(within(container).getByText('2027 round 1').closest('button')!)

    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pick', value: 950 }))
  })

  it('🛑 an unpriced pick renders an em dash, never 0', () => {
    const container = pickTab(open({ rosterPicks: [pick({ value: null })] }))
    const cell = container.querySelector('[data-unpriced="true"]')
    expect(cell).not.toBeNull()
    expect(cell!.textContent).toBe('\u2014')
  })
})
