import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

/**
 * 🛑 "RIGHT NOW I DON'T KNOW WHAT EITHER TEAM HAS."
 *
 * The roster was fetched, resolved, priced and passed into the picker — and then rendered only
 * INSIDE the "+ Add asset" modal. So the trade screen never showed what either side held, and
 * opening a modal was the only way to find out who was on a team.
 *
 * These drive the real component with a mocked hook, because a source scan cannot tell the
 * difference between "the list is on the page" and "the list is in a modal".
 */

const rosterData = vi.hoisted(() => ({ current: null as unknown }))
const hookCalls = vi.hoisted(() => ({ args: [] as Array<[string | null, boolean]> }))

vi.mock('@/components/core-app/screens/useLeagueRosters', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/components/core-app/screens/useLeagueRosters')
  >()
  return {
    ...actual,
    /*
     * 🛑 RECORDS ITS ARGUMENTS, WHICH THE FIRST VERSION OF THIS MOCK DID NOT.
     *
     * Returning data unconditionally made every test below pass while the real screen showed
     * NOTHING: the hook was gated on `picking !== null || assets.length > 0`, so on arrival it
     * never ran and `rosterData` was null. The mock supplied the very thing that was missing.
     * Confirmed in the dev server log — a full page load fired nine `trades-panel` reads and
     * ZERO `trades/rosters`.
     *
     * Mocking a dependency to test a component is fine. Mocking away the CONDITION under test
     * is how a feature ships unreachable with a green suite.
     */
    useLeagueRosters: (leagueId: string | null, enabled: boolean) => {
      hookCalls.args.push([leagueId, enabled])
      return { data: rosterData.current, state: 'idle' }
    },
  }
})

import { TradeCenter } from '@/components/core-app/screens/TradeCenter'

const LEAGUE = { id: 'l1', name: 'Draft Junkies', format: 'Dynasty · PPR', teamCount: 12 }

function player(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    position: 'WR',
    team: 'PIT',
    value: 1976,
    imageUrl: null,
    byeWeek: null,
    injuryStatus: null,
    stock: null,
    stockDelta: null,
    ...extra,
  }
}

function roster(rosterId: string, ownerName: string, players: unknown[]) {
  return {
    rosterId,
    platformUserId: `u-${rosterId}`,
    players,
    picks: [],
    teamExternalId: `t-${rosterId}`,
    ownerName,
    avatarUrl: null,
    wins: 0,
    losses: 0,
    ties: 0,
    faabRemaining: null,
  }
}

beforeEach(() => {
  rosterData.current = {
    rosters: [
      roster('r1', 'You', [player('p1', 'DK Metcalf'), player('p2', 'Luke McCaffrey')]),
      roster('r2', 'Matt Jones', [player('p9', 'Christian McCaffrey')]),
    ],
    viewerRosterId: 'r1',
    viewerTeamRosterId: 'r1',
  }
})

describe('🛑 the rosters are actually FETCHED on arrival', () => {
  it('🛑 asks for them as soon as the league is known — nothing picked, nothing added', () => {
    /*
     * The bug this catches shipped: the hook was gated on
     * `picking !== null || giveAssets.length + getAssets.length > 0`, so a manager landing on the
     * page triggered no fetch at all and the roster list — the whole point of the feature —
     * rendered nothing until they opened the modal it was meant to replace.
     *
     * ⚠ ASSERTS THE ARGUMENT, NOT THE RENDER. Every other test here supplies `rosterData`
     * through the mock, so they pass whether or not the real hook would ever have run. This is
     * the only one that can see the enablement condition.
     */
    hookCalls.args = []
    render(<TradeCenter league={LEAGUE} />)
    expect(hookCalls.args.length).toBeGreaterThan(0)
    const [leagueId, enabled] = hookCalls.args[0]!
    expect(leagueId).toBe('l1')
    expect(enabled).toBe(true)
  })

  it('⚠ does not ask when there is no league to ask about', () => {
    // A null league id would fetch nothing anyway; enabling it would be a request to nowhere.
    hookCalls.args = []
    render(<TradeCenter league={null} />)
    const call = hookCalls.args[0]
    if (call) expect(call[1]).toBe(false)
  })
})

describe('🛑 the screen shows what each team holds', () => {
  it('🛑 lists your roster on the PAGE, without opening the picker', () => {
    /*
     * The whole complaint. Before this, the only DK Metcalf on screen was one you had already
     * added — the roster itself lived behind a modal.
     */
    render(<TradeCenter league={LEAGUE} />)
    expect(screen.getByText('DK Metcalf')).toBeTruthy()
    expect(screen.getByText('Luke McCaffrey')).toBeTruthy()
  })

  it('says whose roster it is and how many are on it', () => {
    render(<TradeCenter league={LEAGUE} />)
    expect(document.body.textContent).toContain("You's roster")
    expect(document.body.textContent).toContain('2')
  })

  it('🛑 clicking a player puts him in that side of the deal', () => {
    /*
     * "the ability to click them and add them to the trade" — asserted through the real click
     * path, not by checking that an onAdd prop exists.
     */
    const { container } = render(<TradeCenter league={LEAGUE} />)
    const before = container.querySelectorAll('.af-tc-remove').length
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    expect(container.querySelectorAll('.af-tc-remove').length).toBe(before + 1)
  })

  it('🛑 a player already in the deal is DIMMED, not removed from the list', () => {
    /*
     * ⚠ SHOWN, NOT HIDDEN. Removing the row would shrink the roster as you build and leave a
     * manager wondering where someone went. The list stays a stable picture of the team.
     */
    const { container } = render(<TradeCenter league={LEAGUE} />)
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    const added = container.querySelector('.af-tc-row--button[data-added="true"]')
    expect(added).not.toBeNull()
    expect(added?.textContent).toContain('DK Metcalf')
    expect((added as HTMLButtonElement).disabled).toBe(true)
  })

  it('⚠ says to pick a team rather than claiming the other side holds nothing', () => {
    /*
     * "We do not know whose roster" is not "they hold nothing" — the same rule the picker and
     * the cross-league strip carry. No counterparty is chosen on first render.
     */
    render(<TradeCenter league={LEAGUE} />)
    expect(document.body.textContent).toContain('Pick a team above to see what they hold')
    expect(document.body.textContent).not.toContain('No players are listed on this roster')
  })

  it('renders an empty roster as empty, which is a different statement', () => {
    rosterData.current = {
      rosters: [roster('r1', 'You', [])],
      viewerRosterId: 'r1',
      viewerTeamRosterId: 'r1',
    }
    render(<TradeCenter league={LEAGUE} />)
    expect(document.body.textContent).toContain('No players are listed on this roster')
  })
})

describe('🛑 one row component, not a third copy of the markup', () => {
  const PICKER = readFileSync(
    resolve(process.cwd(), 'components/core-app/screens/TradeAssetPicker.tsx'),
    'utf8',
  )
  const CENTER = readFileSync(
    resolve(process.cwd(), 'components/core-app/screens/TradeCenter.tsx'),
    'utf8',
  )

  it('[control] the scans are reading the right files', () => {
    expect(PICKER).toContain('export function TradeAssetPicker')
    expect(CENTER).toContain('export function TradeCenter')
  })

  it('🛑 the row is EXPORTED and both surfaces render it', () => {
    /*
     * Writing this markup a second time is exactly the mistake that made the pick price need
     * three separate fixes — one per path that created it. One component, two callers.
     */
    expect(PICKER).toContain('export function RosterPlayerRow')
    expect(PICKER).toContain('<RosterPlayerRow')
    expect(CENTER).toMatch(
      /import\s*\{[^}]*\bRosterPlayerRow\b[^}]*\}\s*from\s*'@\/components\/core-app\/screens\/TradeAssetPicker'/,
    )
    expect(CENTER).toContain('<RosterPlayerRow')
    /* And the builder must not grow its own copy. */
    expect(CENTER).not.toContain('function RosterPlayerRow')
  })

  it('⚠ the team chip uses af-tc-row-team, never the team CARD class', () => {
    /*
     * `af-tc-team` is the team CARD in TradeCenter. Carrying it into a row inherited
     * flex-direction: column, padding and a border, stacking the logo above the abbreviation and
     * making every row ~130px tall against an intended ~48px. The DOM was right and the tests
     * passed throughout — a textContent assertion cannot see a layout.
     */
    const row = PICKER.slice(PICKER.indexOf('export function RosterPlayerRow'))
    expect(row).toContain('af-tc-row-team')
    expect(row).not.toMatch(/className="af-tc-team"/)
  })
})
