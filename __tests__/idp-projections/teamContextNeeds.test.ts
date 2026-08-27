import { describe, expect, it } from 'vitest'

import { computeTeamContext } from '@/lib/engine/team-context-adjustment'
import type { TradePlayerAsset } from '@/lib/engine/trade-types'

/**
 * Team context read the league's own slots — or, as it turned out, three separate ways of not
 * reading them. This was the last hardcoded roster-need table still disagreeing with the rest of
 * the repo, and the disagreement was invisible in exactly the leagues it mattered for.
 */

const roster = (...positions: string[]): TradePlayerAsset[] =>
  positions.map((pos, i) => ({ id: `p${i}`, name: `Player ${i}`, pos }))

const base = {
  sport: 'NFL' as const,
  wins: 6,
  losses: 6,
  pointsFor: 1000,
  pointsAgainst: 1000,
  totalTeams: 12,
}

/** A real Sleeper IDP league: nine offensive starters, four defensive, one flex, bench. */
const IDP_SLOTS = { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, DL: 1, LB: 2, DB: 1, BN: 8 }
const STANDARD_SLOTS = { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, BN: 7 }

describe('positional needs — the league states them, we do not assume them', () => {
  it('treats an empty slots object as an absence of information, not as "no requirements"', () => {
    /*
     * THE DEFECT. `rosterSlots ?? DEFAULT` let `{}` through, and `af-legacy/page.tsx:2127`
     * passes `roster?.slots || {}` — so a league whose slots we do not hold stated zero
     * requirements. Zero requirements cannot be unmet, so every team read as complete and
     * collected the -0.02 adjustment reserved for a roster with no holes.
     */
    const empty = computeTeamContext({ ...base, roster: roster('QB'), rosterSlots: {} })
    const absent = computeTeamContext({ ...base, roster: roster('QB') })

    expect(empty.needs).toEqual(absent.needs)
    expect(empty.needs.length).toBeGreaterThan(0)
    expect(empty.breakdown.needsAdj).toBe(absent.breakdown.needsAdj)
  })

  it('sees a defensive hole that the assumed table could not', () => {
    const positions = roster('QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'LB')

    const assumed = computeTeamContext({ ...base, roster: positions })
    expect(assumed.needs).not.toContain('LB')
    expect(assumed.needs).not.toContain('DL')
    expect(assumed.needs).not.toContain('DB')

    const actual = computeTeamContext({ ...base, roster: positions, rosterSlots: IDP_SLOTS })
    expect(actual.needs).toEqual(expect.arrayContaining(['DL', 'DB', 'LB']))
  })

  it('counts the roster in the same space the requirement is stated in', () => {
    /*
     * The slots collapse `DE`/`DT` onto `DL`. A roster counted by raw position holds zero `DL`
     * however many ends it has, so the requirement would read as unmet on every team alive.
     */
    const stacked = computeTeamContext({
      ...base,
      roster: roster('DE', 'DT', 'DE', 'CB', 'S', 'CB', 'LB', 'LB', 'LB'),
      rosterSlots: { DL: 1, LB: 2, DB: 1 },
    })
    expect(stacked.needs).toEqual([])
  })

  it('never turns a flex or a bench slot into a need no roster can satisfy', () => {
    /*
     * The counts are keyed by SLOT, and `FLEX`, `SUPER_FLEX`, `BN` and `IR` are slots no
     * player's position ever equals. Iterated raw they become permanent phantom holes — which
     * would have made passing the league's real slots worse than assuming them.
     */
    const full = computeTeamContext({
      ...base,
      roster: roster('QB', 'QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'WR', 'TE', 'TE'),
      rosterSlots: { ...STANDARD_SLOTS, IR: 2, SUPER_FLEX: 1 },
    })
    expect(full.needs).not.toContain('FLEX')
    expect(full.needs).not.toContain('SUPER_FLEX')
    expect(full.needs).not.toContain('BN')
    expect(full.needs).not.toContain('IR')
  })
})

describe('bench strength — measured against the real starting requirement', () => {
  it('stops counting a league’s actual starters as bench', () => {
    /*
     * It read the assumed table even when slots were supplied, so the starter count was seven
     * for every NFL league. An IDP league starting thirteen had six real starters reclassified
     * as depth, and a perfectly normal roster scored as unusually deep.
     */
    const positions = roster(
      'QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'DL', 'LB', 'LB', 'DB',
      'RB', 'WR', 'TE', 'LB',
    )

    const assumed = computeTeamContext({ ...base, roster: positions })
    const actual = computeTeamContext({ ...base, roster: positions, rosterSlots: IDP_SLOTS })

    expect(actual.benchStrength).toBeLessThan(assumed.benchStrength)
  })

  it('counts a flex slot as a starter, because someone has to fill it', () => {
    const positions = roster('QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'RB', 'WR')

    const withFlex = computeTeamContext({ ...base, roster: positions, rosterSlots: STANDARD_SLOTS })
    const withoutFlex = computeTeamContext({
      ...base,
      roster: positions,
      rosterSlots: { QB: 1, RB: 2, WR: 3, TE: 1, BN: 7 },
    })

    expect(withFlex.benchStrength).toBeLessThan(withoutFlex.benchStrength)
  })
})

describe('the leagues that pass no slots must not move', () => {
  it('is unchanged for a standard roster with no slots supplied', () => {
    /*
     * Around a hundred leagues reach this path without slots. Their numbers must not shift
     * underneath them because the IDP ones were fixed.
     */
    const complete = computeTeamContext({
      ...base,
      roster: roster('QB', 'QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'WR', 'TE', 'TE'),
    })
    expect(complete.needs).toEqual([])
    expect(complete.breakdown.needsAdj).toBe(-0.02)

    const thin = computeTeamContext({ ...base, roster: roster('QB', 'WR') })
    expect(thin.needs).toEqual(['QB', 'RB', 'WR', 'TE'])
  })
})
