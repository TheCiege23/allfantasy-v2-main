import { describe, it, expect } from 'vitest'
import { findPackages, type DiscoveryRoster } from '@/lib/trade-discovery/redraftTradeDiscovery'
import { normalizedFaabValue, FAAB_VALUE_PER_DOLLAR } from '@/lib/trade-value/faabValue'

/**
 * 🛑 THIS FILE EXISTS BECAUSE THE EXISTING SUITE DOES NOT COVER FAAB AT ALL.
 *
 * `__tests__/trade-discovery/trade-discovery.test.ts` passes 12/12 with the FAAB asset value
 * multiplied by three — measured, not assumed. So its green run was never evidence that the
 * conversion here was right, and it would not have caught the `faab * 18` copy of the canonical
 * rate that this module carried, nor any drift in it afterwards.
 *
 * What is pinned: FAAB entering a package is priced by the SHARED converter, on the same
 * 0–10000 scale as the players it is weighed against, and the forward rate agrees with the
 * inverse one the gap-closing branch uses.
 */

function player(playerId: string, position: string, value: number | null) {
  return { playerId, playerName: `P-${playerId}`, position, value, isLocked: false }
}

/** A roster with surplus RB and a need at WR, so the finder has something to propose. */
function roster(over: Partial<DiscoveryRoster> = {}): DiscoveryRoster {
  return {
    rosterId: 'r1',
    teamName: 'Team',
    stance: 'middle',
    weakPositions: [],
    strongPositions: [],
    players: [
      player('a', 'RB', 3000),
      player('b', 'RB', 2800),
      player('c', 'RB', 2600),
      player('d', 'QB', 4000),
      player('e', 'TE', 1500),
    ],
    faabBalance: 100,
    ...over,
  }
}

describe('trade discovery — FAAB is priced by the shared converter', () => {
  function packagesWithFaab() {
    const mine = roster({ rosterId: 'mine' })
    const theirs = roster({
      rosterId: 'theirs',
      players: [
        player('w1', 'WR', 3100),
        player('w2', 'WR', 2900),
        player('w3', 'WR', 2700),
        player('q', 'QB', 1000),
      ],
    })
    const out = findPackages({
      myRoster: mine,
      partnerRoster: theirs,
      sport: 'NFL',
      faabSupported: true,
      draftPickTrading: false,
      max: 10,
    })
    return out.filter((p) => p.giveAssets.some((a) => a.kind === 'faab'))
  }

  it('produces at least one package containing FAAB (otherwise this file guards nothing)', () => {
    // ⚠ A guard whose fixture never reaches the branch is the failure mode this file was
    // written to correct. Assert the path is exercised before asserting anything about it.
    expect(packagesWithFaab().length).toBeGreaterThan(0)
  })

  it('values the FAAB leg exactly as normalizedFaabValue does', () => {
    for (const pkg of packagesWithFaab()) {
      const leg = pkg.giveAssets.find((a) => a.kind === 'faab')!
      expect(leg.faabAmount).toBeGreaterThan(0)
      expect(leg.value).toBe(normalizedFaabValue(leg.faabAmount!))
    }
  })

  it('counts that same value in myTotalValue, not a second private rate', () => {
    for (const pkg of packagesWithFaab()) {
      const leg = pkg.giveAssets.find((a) => a.kind === 'faab')!
      const players = pkg.giveAssets
        .filter((a) => a.kind === 'player')
        .reduce((s, a) => s + (a.value ?? 0), 0)
      expect(pkg.myTotalValue).toBe(players + normalizedFaabValue(leg.faabAmount!))
    }
  })

  it('keeps the dollars it asks for within what the inverse rate implies', () => {
    // The branch picks `ceil(gap / FAAB_VALUE_PER_DOLLAR)` dollars, capped at $30 of gap.
    // If the forward and inverse rates ever disagree, this is where it shows.
    for (const pkg of packagesWithFaab()) {
      const leg = pkg.giveAssets.find((a) => a.kind === 'faab')!
      expect(leg.faabAmount!).toBeLessThanOrEqual(30)
      expect(leg.faabAmount!).toBeLessThanOrEqual(100) // never reaches the full-budget cap
      expect(leg.value).toBe(leg.faabAmount! * FAAB_VALUE_PER_DOLLAR)
    }
  })

  it('offers no FAAB when the league does not support it', () => {
    const mine = roster({ rosterId: 'mine' })
    const theirs = roster({ rosterId: 'theirs', players: [player('w1', 'WR', 3100)] })
    const out = findPackages({
      myRoster: mine,
      partnerRoster: theirs,
      sport: 'NFL',
      faabSupported: false,
      draftPickTrading: false,
      max: 10,
    })
    const faabLegs = out.flatMap((p) => p.giveAssets.filter((a) => a.kind === 'faab'))
    for (const leg of faabLegs) expect(leg.faabAmount).toBe(0)
  })
})
