import { describe, expect, it } from 'vitest'
import { coverOptions, coverSlotLabel, type CoverCandidate } from '@/lib/core-app/lineupCover'
import { coverText } from '@/components/core-app/screens/Dash3ATriageView'

/*
 * The reported league, 2026-10-17 (Guillotine League 26, Friday morning of week 7): Jeremiyah Love
 * (RB) Out in an RB slot; J.K. Dobbins played Thursday; Isaac TeSlaa and Sam LaPorta on bye. Three
 * W/R/T flex seats and a superflex. The old picker said "swap in J.K. Dobbins or Tyler Allgeier".
 */
const c = (id: string, position: string, canPlay = true, rank: number | null = null): CoverCandidate => ({
  id,
  name: id,
  position,
  rank,
  canPlay,
})

const SLOTS = ['RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'SUPER_FLEX']
const ORDER = ['Cook', 'Love', 'Nabers', 'Odunze', 'Kincaid', 'Pollard', 'Bourne', 'Marks', 'Watson']
const STARTERS = new Map(
  [c('Cook', 'RB'), c('Nabers', 'WR'), c('Odunze', 'WR'), c('Kincaid', 'TE'), c('Pollard', 'RB'), c('Bourne', 'WR'), c('Marks', 'RB'), c('Watson', 'QB')].map(
    (s) => [s.id, s] as const,
  ),
)
const BENCH = [
  c('Sanders', 'QB'),
  c('Dobbins', 'RB', false), // played Thursday
  c('Allgeier', 'RB'),
  c('TeSlaa', 'WR', false), // bye
  c('LaPorta', 'TE', false), // bye
  c('Washington', 'TE'),
]
const base = { slots: SLOTS, orderedStarters: ORDER, injuredId: 'Love', injuredPosition: 'RB', starters: STARTERS }

describe('coverOptions', () => {
  it('drops a bench player whose game is over, and offers the flex chain as a true second option', () => {
    const out = coverOptions({ ...base, bench: BENCH })
    expect(out.direct.map((d) => d.name)).toEqual(['Allgeier'])
    expect(out.chain).toEqual({ move: 'Pollard', toSlot: 'RB', fromSlot: 'FLEX', fill: 'Washington' })
  })

  it('never routes the chain through someone the direct answer already covers', () => {
    const out = coverOptions({ ...base, bench: [c('Allgeier', 'RB')] })
    expect(out.direct.map((d) => d.name)).toEqual(['Allgeier'])
    expect(out.chain).toBeNull()
  })

  it('a locked starter is never moved', () => {
    const locked = new Map(STARTERS)
    locked.set('Pollard', c('Pollard', 'RB', false))
    locked.set('Marks', c('Marks', 'RB', false))
    const out = coverOptions({ ...base, starters: locked, bench: BENCH })
    expect(out.chain).toBeNull()
  })

  it('with nothing on the bench, points the open flex seat at the waiver wire', () => {
    const out = coverOptions({ ...base, bench: [c('Dobbins', 'RB', false), c('Sanders', 'QB')] })
    expect(out.direct).toEqual([])
    expect(out.chain).toEqual({ move: 'Pollard', toSlot: 'RB', fromSlot: 'FLEX', fill: null })
  })

  it('superflex: a second QB slides into the QB slot and a skill player takes superflex', () => {
    const out = coverOptions({
      slots: ['QB', 'RB', 'SUPER_FLEX'],
      orderedStarters: ['Burrow', 'Cook', 'Watson'],
      injuredId: 'Burrow',
      injuredPosition: 'QB',
      starters: new Map([c('Cook', 'RB'), c('Watson', 'QB')].map((s) => [s.id, s] as const)),
      bench: [c('Allgeier', 'RB')],
    })
    expect(out.direct).toEqual([])
    expect(out.chain).toEqual({ move: 'Watson', toSlot: 'QB', fromSlot: 'SUPER_FLEX', fill: 'Allgeier' })
  })

  it('orders cover by market rank, unranked last', () => {
    const out = coverOptions({ ...base, bench: [c('Zed', 'RB', true, null), c('Bob', 'RB', true, 80), c('Al', 'RB', true, 20)] })
    expect(out.direct.map((d) => d.name)).toEqual(['Al', 'Bob'])
  })

  it('slot unknown (starters and slots disagree): same position only, no chain', () => {
    const out = coverOptions({ ...base, slots: SLOTS.slice(1), bench: BENCH })
    expect(out.direct.map((d) => d.name)).toEqual(['Allgeier'])
    expect(out.chain).toBeNull()
  })
})

describe('coverText', () => {
  it('reads as one sentence, simple move first', () => {
    expect(coverText({ bench: ['Allgeier'], cover: { move: 'Pollard', toSlot: 'RB', fromSlot: 'FLEX', fill: 'Washington' } }, false)).toBe(
      'swap in Allgeier · or move Pollard to RB, start Washington at FLEX',
    )
    expect(coverText({ bench: [], cover: { move: 'Pollard', toSlot: 'RB', fromSlot: 'FLEX', fill: null } }, false)).toBe(
      'move Pollard to RB, then add a free agent at FLEX',
    )
    expect(coverText({ bench: [], cover: null }, false)).toBeNull()
    expect(coverText({ bench: ['Allgeier'], cover: null }, true)).toBe('pon a Allgeier')
  })

  it('labels flex slots the way a reader says them', () => {
    expect(coverSlotLabel('SUPER_FLEX')).toBe('SUPERFLEX')
    expect(coverSlotLabel('REC_FLEX')).toBe('W/T FLEX')
  })
})
