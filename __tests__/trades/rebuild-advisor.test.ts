/**
 * The rebuild advisor (lib/trade-intel/rebuildAdvisor.ts): the healthy alternative to tanking.
 * Every call is checked against the market read that justifies it, and no package leaves the fair band.
 */
import { describe, expect, it } from 'vitest'

import { buildRebuildPlan, FAIR_BAND, type RebuildPlayer, type RebuildRoster } from '@/lib/trade-intel/rebuildAdvisor'

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN']

const pl = (id: string, position: string, value: number | null, lean: RebuildPlayer['lean'], leanRatio: number | null = null): RebuildPlayer => ({
  id,
  name: id,
  position,
  value,
  lean,
  leanRatio,
})

/** Out of the race: an aging RB to sell, a young WR to keep, and his own 1st. */
const rebuilder = (): RebuildRoster => ({
  rosterId: 'me',
  ownerName: 'Punt Gods',
  posture: 'selling',
  players: [
    pl('Vet RB', 'RB', 5000, 'declining', 0.7),
    pl('Young WR', 'WR', 4000, 'rising', 1.5),
    pl('Filler QB', 'QB', 2000, 'flat', 1),
    pl('Filler RB', 'RB', 1500, 'flat', 1),
    pl('Filler WR', 'WR', 1500, 'flat', 1),
    pl('Filler TE', 'TE', 1200, 'flat', 1),
    pl('Unpriced', 'WR', null, null),
  ],
  picks: [{ pickId: 'me-27-1', label: '2027 1st (own)', value: 3000, originalRosterId: 'me' }],
})

/** In the race, weak at RB, holding a 1st and a rising bench WR. */
const contender = (): RebuildRoster => ({
  rosterId: 'aces',
  ownerName: 'Aces',
  posture: 'contending',
  players: [
    pl('Aces QB', 'QB', 6000, 'flat', 1),
    pl('Aces RB1', 'RB', 6000, 'flat', 1),
    pl('Aces RB2', 'RB', 1800, 'flat', 1),
    pl('Aces WR1', 'WR', 6000, 'flat', 1),
    pl('Aces WR2', 'WR', 5500, 'flat', 1),
    pl('Aces WR3', 'WR', 5000, 'flat', 1),
    pl('Aces TE', 'TE', 3000, 'flat', 1),
    pl('Aces Rookie WR', 'WR', 2600, 'rising', 1.6),
  ],
  picks: [{ pickId: 'aces-27-1', label: '2027 1st (Aces)', value: 2600, originalRosterId: 'aces' }],
})

/** In the race but stacked at RB: the vet would not start here. */
const stackedContender = (): RebuildRoster => ({
  rosterId: 'bees',
  ownerName: 'Bees',
  posture: 'contending',
  players: [
    pl('Bees QB', 'QB', 6000, 'flat', 1),
    pl('Bees RB1', 'RB', 8000, 'flat', 1),
    pl('Bees RB2', 'RB', 7500, 'flat', 1),
    pl('Bees RB3', 'RB', 7000, 'flat', 1),
    pl('Bees WR1', 'WR', 6000, 'flat', 1),
    pl('Bees WR2', 'WR', 5800, 'flat', 1),
    pl('Bees TE', 'TE', 5000, 'flat', 1),
  ],
  picks: [{ pickId: 'bees-27-1', label: '2027 1st (Bees)', value: 5000, originalRosterId: 'bees' }],
})

/** Also out of the race: never a buyer. */
const otherRebuilder = (): RebuildRoster => ({
  rosterId: 'cats',
  ownerName: 'Cats',
  posture: 'selling',
  players: [pl('Cats RB', 'RB', 500, 'flat', 1)],
  picks: [{ pickId: 'cats-27-1', label: '2027 1st (Cats)', value: 4500, originalRosterId: 'cats' }],
})

const plan = (rosters = [rebuilder(), contender(), stackedContender(), otherRebuilder()]) =>
  buildRebuildPlan({ viewerRosterId: 'me', rosters, starterSlots: SLOTS, trigger: 'eliminated', basis: 'Out of the race.' })

describe('sell and hold come from the market’s own read on each player', () => {
  it('sells the player priced lower in dynasty, and says why', () => {
    const p = plan()
    expect(p.sell.map((s) => s.asset.name)).toEqual(['Vet RB'])
    expect(p.sell[0]!.why).toContain('30% lower in dynasty')
  })

  it('holds the player priced higher in dynasty, and the team’s own pick', () => {
    const p = plan()
    expect(p.hold.map((h) => h.asset.name)).toEqual(['Young WR', '2027 1st (own)'])
    expect(p.hold[0]!.why).toContain('50% higher in dynasty')
  })

  it('makes no call on a player it cannot price, and says so', () => {
    expect(plan().gaps.some((g) => g.includes('no market value'))).toBe(true)
  })
})

describe('who to sell to', () => {
  it('only teams in the race, and only where he would actually start', () => {
    const buyers = plan().sell[0]!.buyers.map((b) => b.rosterId)
    expect(buyers).toEqual(['aces'])
    expect(plan().sell[0]!.buyers[0]!.why).toBe('In the race, and he would start over Aces RB2.')
  })

  it('a team out of the race is never a buyer or a target', () => {
    const p = plan()
    expect(p.sell.flatMap((s) => s.buyers).some((b) => b.rosterId === 'cats')).toBe(false)
    expect(p.targets.some((t) => t.rosterId === 'cats')).toBe(false)
  })
})

describe('what to target', () => {
  it('contenders’ picks and their rising players who do not start for them', () => {
    const names = plan().targets.map((t) => t.asset.name)
    expect(names).toContain('2027 1st (Aces)')
    expect(names).toContain('Aces Rookie WR')
    // A contender’s own starter is not a target, however good.
    expect(names).not.toContain('Aces WR1')
  })

  it('warns that a contender’s own pick lands late', () => {
    const t = plan().targets.find((x) => x.asset.name === '2027 1st (Aces)')!
    expect(t.why).toMatch(/land late/)
  })
})

describe('packages: fair or nothing', () => {
  it('offers the vet to the contender who needs him, for a fair return', () => {
    const [pkg] = plan().packages
    expect(pkg).toBeDefined()
    expect(pkg!.rosterId).toBe('aces')
    expect(pkg!.give.map((a) => a.name)).toEqual(['Vet RB'])
    expect(pkg!.percentApart).toBeLessThanOrEqual(FAIR_BAND)
    // 2,600 + 2,600 = 5,200 against 5,000: 3.8% apart.
    expect(pkg!.get.map((a) => a.name).sort()).toEqual(['2027 1st (Aces)', 'Aces Rookie WR'])
  })

  it('offers nothing when no fair return exists, rather than a lopsided deal', () => {
    const lowball = contender()
    lowball.picks = [{ pickId: 'aces-27-3', label: '2027 3rd (Aces)', value: 400, originalRosterId: 'aces' }]
    lowball.players = lowball.players.filter((p) => p.name !== 'Aces Rookie WR')
    const p = plan([rebuilder(), lowball])
    expect(p.packages).toEqual([])
    expect(p.gaps.some((g) => g.includes('fair trade'))).toBe(true)
  })
})

describe('honest about what it could not judge', () => {
  it('with no lineup on file, buyers are not need-checked and the plan says so', () => {
    const p = buildRebuildPlan({ viewerRosterId: 'me', rosters: [rebuilder(), contender()], starterSlots: null, trigger: 'strategy', basis: 'You chose to rebuild.' })
    expect(p.gaps.some((g) => g.includes('lineup is not on file'))).toBe(true)
    expect(p.sell[0]!.buyers[0]!.why).toBe('In the race.')
  })

  it('with nobody in the race, says there is nobody to sell to yet', () => {
    const p = plan([rebuilder(), otherRebuilder()])
    expect(p.sell[0]!.buyers).toEqual([])
    expect(p.gaps.some((g) => g.includes('nobody to sell to'))).toBe(true)
  })
})
