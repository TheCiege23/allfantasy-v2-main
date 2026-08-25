import { describe, expect, it } from 'vitest'

import {
  computeRosterNeed,
  counterpartyPriceDelta,
  readSlotRequirements,
} from '@/lib/trade-intel/rosterNeed'

/**
 * The bug this module replaces is concrete and live:
 * `DraftAdvisorContextService.computeRosterNeeds` scores against a hardcoded
 * STANDARD_STARTS map, so in a superflex league it reports a team holding one
 * quarterback as having no quarterback need — the single most valuable fact in
 * that format, inverted.
 */

const ONE_QB = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']
const SUPERFLEX = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF']

describe('readSlotRequirements: the league’s own lineup, never a default', () => {
  it('⚠ returns null rather than assuming a standard lineup', () => {
    // A guessed lineup produces confident needs for a league we cannot see.
    expect(readSlotRequirements(null)).toBeNull()
    expect(readSlotRequirements([])).toBeNull()
  })

  it('ignores bench, IR and taxi — they cannot generate a need', () => {
    const req = readSlotRequirements(['QB', 'BN', 'BN', 'IR', 'TAXI'])
    expect(req!.dedicated.get('QB')).toBe(1)
    expect(req!.dedicated.has('BN')).toBe(false)
    expect(req!.dedicated.has('IR')).toBe(false)
  })

  it('separates flex slots from dedicated ones, with what each accepts', () => {
    const req = readSlotRequirements(SUPERFLEX)!
    expect(req.dedicated.get('RB')).toBe(2)
    expect(req.flex.map((f) => f.slot).sort()).toEqual(['FLEX', 'SUPER_FLEX'])
    expect(req.flex.find((f) => f.slot === 'SUPER_FLEX')!.eligible).toContain('QB')
  })
})

describe('computeRosterNeed', () => {
  it('⚠ a one-QB roster in superflex has a real hole', () => {
    /*
     * THE BUG, DIRECTLY. Under a hardcoded one-QB ideal this team looks
     * complete. Under the league's own lineup it is short a startable
     * quarterback, which in superflex is the most expensive hole in fantasy.
     */
    const need = computeRosterNeed({
      requirements: readSlotRequirements(SUPERFLEX)!,
      rostered: ['QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'K', 'DEF'],
    })
    // The dedicated QB slot is filled; the SUPER_FLEX is not, because the only
    // spare bodies are RB and WR and they are consumed by FLEX first.
    expect(need.unfilledFlex).toBe(0)

    const thin = computeRosterNeed({
      requirements: readSlotRequirements(SUPERFLEX)!,
      rostered: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
    })
    expect(thin.holes).toContain('RB')
    expect(thin.unfilledFlex).toBeGreaterThan(0)
  })

  it('⚠ depth at one position fills flex — it is not a need at another', () => {
    /*
     * Counting each empty flex slot as its own hole is how a team deep at wide
     * receiver gets told to trade for a running back it does not need.
     */
    const need = computeRosterNeed({
      requirements: readSlotRequirements(ONE_QB)!,
      rostered: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'K', 'DEF'],
    })
    expect(need.unfilledFlex).toBe(0)
    expect(need.holes).toEqual([])
  })

  it('counts a genuine shortfall at a dedicated slot', () => {
    const need = computeRosterNeed({
      requirements: readSlotRequirements(ONE_QB)!,
      rostered: ['QB', 'RB', 'WR', 'WR', 'TE', 'K', 'DEF'],
    })
    const rb = need.byPosition.find((p) => p.position === 'RB')!
    expect(rb.required).toBe(2)
    expect(rb.have).toBe(1)
    expect(rb.deficit).toBe(1)
  })

  it('fills the narrowest flex slot first, so it is not stranded', () => {
    // One spare TE and one spare WR against REC_FLEX (WR/TE) and SUPER_FLEX
    // (anything). If SUPER_FLEX drew first it could take the TE and strand
    // REC_FLEX behind a position it cannot accept.
    const need = computeRosterNeed({
      requirements: readSlotRequirements(['QB', 'REC_FLEX', 'SUPER_FLEX'])!,
      rostered: ['QB', 'TE', 'RB'],
    })
    expect(need.unfilledFlex).toBe(0)
  })
})

describe('counterpartyPriceDelta: a preference, stated as one', () => {
  const need = computeRosterNeed({
    requirements: readSlotRequirements(ONE_QB)!,
    rostered: ['QB', 'RB', 'WR', 'WR', 'WR', 'WR', 'TE', 'K', 'DEF'],
  })

  it('⚠ returns null when the need is unknown, not a neutral 1.0', () => {
    // 1.0 reads as "we checked and it makes no difference". Null is the truth.
    expect(counterpartyPriceDelta({ position: 'RB', need: null })).toBeNull()
    expect(counterpartyPriceDelta({ position: null, need })).toBeNull()
  })

  it('pays more at a position they cannot fill', () => {
    const d = counterpartyPriceDelta({ position: 'RB', need })!
    expect(d.factor).toBeGreaterThan(1)
    expect(d.basis).toContain('cannot fill')
  })

  it('pays slightly less where they are already deep', () => {
    const d = counterpartyPriceDelta({ position: 'WR', need })!
    expect(d.factor).toBeLessThan(1)
  })

  it('⚠ the premium is capped so it can never overturn a real value gap', () => {
    /*
     * Nothing in this repo measures what managers actually overpay for need. A
     * large multiplier would let the engine recommend giving up a materially
     * better player and present the preference as arithmetic. The band breaks
     * ties; it does not decide trades.
     */
    const desperate = computeRosterNeed({
      requirements: readSlotRequirements(['RB', 'RB', 'RB', 'RB', 'RB'])!,
      rostered: ['WR'],
    })
    const d = counterpartyPriceDelta({ position: 'RB', need: desperate })!
    expect(d.factor).toBeLessThanOrEqual(1.15)
  })
})
