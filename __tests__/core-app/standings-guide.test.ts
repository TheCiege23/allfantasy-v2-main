import { describe, expect, it } from 'vitest'
import { ordinalEn, standingsHeadline } from '@/lib/core-app/standingsGuide'
import { standingsGuideMessages } from '@/lib/core-app/messages/standingsGuide'

type Me = { seed: number; zone: 'bye' | 'playoff' | 'bubble' | 'out' | 'eliminated'; clinched: 'bye' | 'playoff' | null; gamesBack: number | null }
const me = (over: Partial<Me>): Me => ({ seed: 4, zone: 'playoff', clinched: null, gamesBack: null, ...over })
const base = { teamCount: 12, playoffTeams: 6, elimination: false, oddsPct: 72 }

describe('standingsHeadline', () => {
  it('no team of yours, or an elimination league, says only what can be said', () => {
    expect(standingsHeadline({ ...base, me: null })).toEqual({ kind: 'unknown' })
    expect(standingsHeadline({ ...base, me: me({}), elimination: true })).toEqual({ kind: 'place', seed: 4, of: 12 })
  })

  it('clinched and eliminated beat the seed', () => {
    expect(standingsHeadline({ ...base, me: me({ clinched: 'bye', seed: 1 }) })).toEqual({ kind: 'clinched', seed: 1, of: 12, bye: true })
    expect(standingsHeadline({ ...base, me: me({ zone: 'eliminated', seed: 11 }) })).toEqual({ kind: 'eliminated', seed: 11, of: 12 })
  })

  it('in or out by SEED against the playoff spots — a bubble team can be either', () => {
    expect(standingsHeadline({ ...base, me: me({ seed: 4, zone: 'playoff' }) })).toEqual({ kind: 'in', seed: 4, of: 12, odds: 72, bubble: false })
    // The harness case: the last spot in is a bubble team, and it is IN.
    expect(standingsHeadline({ ...base, me: me({ seed: 6, zone: 'bubble' }) })).toMatchObject({ kind: 'in', bubble: true })
    expect(standingsHeadline({ ...base, me: me({ seed: 7, zone: 'bubble', gamesBack: 1 }) })).toEqual({ kind: 'out', seed: 7, of: 12, gamesBack: 1, odds: 72, bubble: true })
    expect(standingsHeadline({ ...base, me: me({ seed: 10, zone: 'out', gamesBack: 3 }) })).toMatchObject({ kind: 'out', bubble: false })
  })
})

describe('ordinalEn', () => {
  it('handles the teens', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinalEn)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd'])
  })
})

describe('standings guide copy', () => {
  const en = standingsGuideMessages.en
  it('says the place, the line and the odds in plain words', () => {
    expect(en.headIn(4, 12, 72)).toBe('4th of 12 · in a playoff spot · 72% playoff odds')
    expect(en.headIn(6, 12, 55, true)).toBe('6th of 12 · in a playoff spot, on the bubble · 55% playoff odds')
    expect(en.headOut(7, 12, 1, 23)).toBe('7th of 12 · 1 game out of a playoff spot · 23% playoff odds')
    expect(en.headOut(7, 12, null, null, true)).toBe('7th of 12 · just outside the playoff spots')
    expect(en.ifTheyWin).toBe('if they win')
  })

  it('has Spanish for every key and never says «waiver»', () => {
    const es = standingsGuideMessages.es!
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
    const text = JSON.stringify(Object.values(es).map((v) => (typeof v === 'function' ? String(v) : v)))
    expect(text.toLowerCase()).not.toMatch(/waiver/)
  })
})
