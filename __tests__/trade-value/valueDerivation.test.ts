/**
 * `explainPlayerValue` — the derivation chain behind a price.
 *
 * 🛑 THE PROPERTY THAT MATTERS MOST IS AGREEMENT. An explanation that disagrees with the number it
 * explains still reads perfectly, so nothing catches it by eye. `normalizedPlayerValue` returns
 * `explainPlayerValue(...).value`, which makes agreement structural — and these tests pin it
 * anyway, because the delegation is one edit away from being undone.
 */

import { describe, expect, it } from 'vitest'
import {
  ADP_PIVOT,
  ADP_SLOPE,
  PROJ_TO_VALUE,
  SOFT_KNEE,
  VALUE_CEILING,
  explainPlayerValue,
  normalizedPlayerValue,
} from '@/lib/trade-value/valueEngine'

const CASES = [
  { name: 'ordinary WR', projection: 240, position: 'WR' },
  { name: 'QB with adp', projection: 300, position: 'QB', adp: 15 },
  { name: 'elite, into the knee', projection: 400, position: 'RB' },
  { name: 'market fallback', projection: null, position: 'TE', marketValue: 5400 },
  { name: 'IDP', projection: null, position: 'LB', idpValue: 3120 },
  { name: 'adp only', projection: null, position: 'WR', adp: 10 },
  { name: 'nothing at all', projection: null, position: 'WR' },
  { name: 'negative projection', projection: -5, position: 'WR' },
  { name: 'zero projection', projection: 0, position: 'WR' },
] as const

describe('🛑 the explanation and the price are the same number', () => {
  it('agrees with normalizedPlayerValue on every case', () => {
    for (const c of CASES) {
      const input = {
        projection: c.projection,
        position: c.position,
        adp: 'adp' in c ? c.adp : null,
        marketValue: 'marketValue' in c ? c.marketValue : null,
        idpValue: 'idpValue' in c ? c.idpValue : null,
      }
      expect(explainPlayerValue(input).value, c.name).toBe(normalizedPlayerValue(input))
    }
  })

  it('the last step always carries the final value, rounded', () => {
    for (const c of CASES) {
      const input = {
        projection: c.projection,
        position: c.position,
        adp: 'adp' in c ? c.adp : null,
        marketValue: 'marketValue' in c ? c.marketValue : null,
        idpValue: 'idpValue' in c ? c.idpValue : null,
      }
      const d = explainPlayerValue(input)
      expect(Math.round(d.steps[d.steps.length - 1].value), c.name).toBe(d.value)
    }
  })
})

describe('🛑 a player with ONLY an ADP is priced at 660, not 0', () => {
  /*
   * THIS TEST EXISTS BECAUSE THE EXTRACTION BROKE IT AND NOTHING NOTICED.
   *
   * An early draft short-circuited `basis === 'none'` to return 0 — obviously right-looking: no
   * projection, no market, no IDP. Measured against the pre-extraction engine, a WR with an ADP of
   * 10 went from 660 to 0, and the entire existing suite stayed green because nothing covered a
   * player carrying draft capital alone.
   *
   * Whether pricing off ADP alone is CORRECT is a real open question. It is not one an explainer
   * gets to settle silently, so the behaviour is pinned here at the value the engine has always
   * produced.
   */
  const input = { projection: null, adp: 10, position: 'WR', marketValue: null, idpValue: null }

  it('holds the exact number', () => {
    const expected = Math.round((ADP_PIVOT - 10) * ADP_SLOPE) // 660
    expect(expected).toBe(660)
    expect(normalizedPlayerValue(input)).toBe(660)
    expect(explainPlayerValue(input).value).toBe(660)
  })

  it('explains it as a gap in the inputs, not as worthlessness', () => {
    const d = explainPlayerValue(input)
    expect(d.basis).toBe('none')
    expect(d.steps[0].detail).toMatch(/NOT a judgement that the player is worthless/)
    expect(d.steps.some((s) => /draft capital/.test(s.label))).toBe(true)
  })
})

describe('the projection chain', () => {
  const d = explainPlayerValue({ projection: 240, position: 'WR', adp: null, marketValue: null, idpValue: null })

  it('starts at the projection and names the scale conversion', () => {
    expect(d.basis).toBe('projection')
    expect(d.steps[0].value).toBe(240)
    expect(d.steps[1].label).toBe(`× ${PROJ_TO_VALUE}`)
    expect(d.steps[1].value).toBe(240 * PROJ_TO_VALUE)
  })

  it('applies scarcity as its own step', () => {
    expect(d.steps[2].label).toMatch(/scarcity/)
  })

  it('omits the draft-capital step entirely when there is no ADP', () => {
    // Absent, not a zero row — a "+0" step reads as a considered adjustment that did nothing.
    expect(d.steps.some((s) => /draft capital/.test(s.label))).toBe(false)
  })

  it('omits the soft knee when the value never reaches it', () => {
    expect(d.value).toBeLessThan(SOFT_KNEE)
    expect(d.steps.some((s) => s.label === 'Soft knee')).toBe(false)
  })

  it('shows the soft knee only when it actually moves the number', () => {
    const big = explainPlayerValue({ projection: 500, position: 'RB', adp: null, marketValue: null, idpValue: null })
    expect(big.value).toBeGreaterThan(SOFT_KNEE)
    expect(big.value).toBeLessThanOrEqual(VALUE_CEILING)
    expect(big.steps.some((s) => s.label === 'Soft knee')).toBe(true)
  })
})

describe('the two bases that skip scarcity, and say why', () => {
  it('market value is not multiplied by scarcity, and the step says so', () => {
    const d = explainPlayerValue({ projection: null, position: 'TE', marketValue: 5400, adp: null, idpValue: null })
    expect(d.basis).toBe('market')
    expect(d.value).toBe(5400)
    expect(d.steps).toHaveLength(1)
    expect(d.steps[0].detail).toMatch(/would count it twice/i)
  })

  it('IDP is not multiplied by scarcity, and the step says so', () => {
    const d = explainPlayerValue({ projection: null, position: 'LB', idpValue: 3120, adp: null, marketValue: null })
    expect(d.basis).toBe('idp')
    expect(d.value).toBe(3120)
    expect(d.steps).toHaveLength(1)
    expect(d.steps[0].detail).toMatch(/already inside this number/i)
  })

  it('🛑 an IDP value wins even when a projection exists', () => {
    // Mirrors the engine: IDP is checked first and returns immediately.
    const d = explainPlayerValue({ projection: 240, position: 'LB', idpValue: 3120, adp: null, marketValue: null })
    expect(d.basis).toBe('idp')
    expect(d.value).toBe(3120)
  })
})

describe('every step is legible', () => {
  it('carries a label and a sentence, never a bare formula', () => {
    for (const c of CASES) {
      const d = explainPlayerValue({
        projection: c.projection,
        position: c.position,
        adp: 'adp' in c ? c.adp : null,
        marketValue: 'marketValue' in c ? c.marketValue : null,
        idpValue: 'idpValue' in c ? c.idpValue : null,
      })
      for (const s of d.steps) {
        expect(s.label.length, c.name).toBeGreaterThan(0)
        // A sentence, not a symbol — the reason is the deliverable.
        expect(s.detail.length, `${c.name}: ${s.label}`).toBeGreaterThan(20)
        expect(Number.isFinite(s.value), `${c.name}: ${s.label}`).toBe(true)
      }
    }
  })
})
