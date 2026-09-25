import { describe, expect, it } from 'vitest'

import {
  parseRosterSlots,
  toLeagueRosterConfig,
  describeRosterSlots,
} from '@/lib/league-context-engine/normalizeRosterSlots'
import { computeReplacementThreshold } from '@/lib/vorp-engine'

/**
 * The league's starting lineup was imported all along and thrown away as `unknown`.
 * These tests hold the door open: the lineup must survive parsing intact, and it must
 * actually move replacement level — otherwise a 3-WR league and a 2-WR league get the
 * same WR values again and the league-specific claim quietly stops being true.
 */

const SLEEPER_3WR = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'IR']
const SLEEPER_2WR = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN']
const SLEEPER_SUPERFLEX = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF', 'BN']
const YAHOO_STYLE = ['QB', 'WR', 'WR', 'RB', 'RB', 'TE', 'W/R/T', 'K', 'DEF', 'BN', 'BN']
const IDP_LEAGUE = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DL', 'LB', 'DB', 'IDP_FLEX', 'BN']

describe('parsing a platform lineup', () => {
  it('counts real starting slots and drops bench, IR and taxi', () => {
    const parsed = parseRosterSlots(SLEEPER_3WR)

    expect(parsed.resolved).toBe(true)
    expect(parsed.counts.WR).toBe(3)
    expect(parsed.counts.RB).toBe(2)
    expect(parsed.counts.QB).toBe(1)
    expect(parsed.counts.FLEX).toBe(1)
    // 13 raw entries in, 2 BN + 1 IR removed.
    expect(parsed.totalStarters).toBe(10)
  })

  it('separates superflex from dedicated quarterback slots', () => {
    const parsed = parseRosterSlots(SLEEPER_SUPERFLEX)

    expect(parsed.superflex).toBe(true)
    expect(parsed.counts.SUPER_FLEX).toBe(1)
    // The superflex slot must NOT inflate the dedicated QB count — that would overstate
    // QB replacement level in the one format where QB pricing matters most.
    expect(parsed.counts.QB).toBe(1)
  })

  it("reads Yahoo's W/R/T as a flex rather than three positions", () => {
    const parsed = parseRosterSlots(YAHOO_STYLE)

    expect(parsed.counts.FLEX).toBe(1)
    expect(parsed.counts.WR).toBe(2)
    expect(parsed.counts.RB).toBe(2)
  })

  it('recognizes IDP slots', () => {
    const parsed = parseRosterSlots(IDP_LEAGUE)
    expect(parsed.counts.IDP).toBe(4)
  })

  it('reports unresolved rather than inventing a default', () => {
    for (const input of [null, undefined, 'QB,RB', [], {}]) {
      const parsed = parseRosterSlots(input)
      expect(parsed.resolved).toBe(false)
      expect(toLeagueRosterConfig(parsed, 12)).toBeNull()
    }
  })
})

describe('the lineup reaches replacement level', () => {
  it('raises the WR replacement threshold in a 3-WR league', () => {
    const twoWr = toLeagueRosterConfig(parseRosterSlots(SLEEPER_2WR), 12)!
    const threeWr = toLeagueRosterConfig(parseRosterSlots(SLEEPER_3WR), 12)!

    const shallow = computeReplacementThreshold('WR', twoWr)
    const deep = computeReplacementThreshold('WR', threeWr)

    // 12 more WRs are starters league-wide, so replacement moves a full round deeper.
    expect(deep).toBeGreaterThan(shallow)
    expect(deep - shallow).toBe(12)
  })

  it('raises the QB replacement threshold in superflex', () => {
    const oneQb = toLeagueRosterConfig(parseRosterSlots(SLEEPER_2WR), 12)!
    const superflex = toLeagueRosterConfig(parseRosterSlots(SLEEPER_SUPERFLEX), 12)!

    expect(computeReplacementThreshold('QB', superflex)).toBeGreaterThan(
      computeReplacementThreshold('QB', oneQb),
    )
  })

  it('keeps the superflex slot inside startingFlex, as the VORP engine expects', () => {
    // computeReplacementThreshold subtracts one flex slot when `superflex` is set before
    // sharing the rest among RB/WR/TE. Counting regular flex only would delete a slot.
    const config = toLeagueRosterConfig(parseRosterSlots(SLEEPER_SUPERFLEX), 12)!

    expect(config.superflex).toBe(true)
    expect(config.startingFlex).toBe(2) // 1 FLEX + 1 SUPER_FLEX
  })

  it('scales the threshold with league size', () => {
    const ten = toLeagueRosterConfig(parseRosterSlots(SLEEPER_3WR), 10)!
    const fourteen = toLeagueRosterConfig(parseRosterSlots(SLEEPER_3WR), 14)!

    expect(computeReplacementThreshold('WR', fourteen)).toBeGreaterThan(
      computeReplacementThreshold('WR', ten),
    )
  })
})

describe('the same fact explains the verdict', () => {
  it('describes the lineup in words a user can check', () => {
    expect(describeRosterSlots(parseRosterSlots(SLEEPER_3WR))).toBe(
      '1 QB, 2 RB, 3 WR, 1 TE, 1 FLEX, 1 K, 1 DST',
    )
  })

  it('returns null when there is nothing honest to say', () => {
    expect(describeRosterSlots(parseRosterSlots(null))).toBeNull()
  })
})
