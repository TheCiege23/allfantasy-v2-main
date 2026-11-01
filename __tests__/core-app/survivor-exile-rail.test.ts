import { describe, expect, it } from 'vitest'
import { pairExileUnderSurvivor, pairedExileIds } from '@/lib/core-app/survivorExileRail'

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id)

describe('pairExileUnderSurvivor', () => {
  // The rail from the report: two NBA Survivor leagues, their islands listed apart from them.
  const rail = [
    { id: 'exile-a', exileOf: 'survivor-a' },
    { id: 'exile-b', exileOf: 'survivor-b' },
    { id: 'fantrax' },
    { id: 'guillotine' },
    { id: 'survivor-a' },
    { id: 'redraft' },
    { id: 'survivor-b' },
  ]

  it('puts each Exile Island directly under its own Survivor league', () => {
    expect(ids(pairExileUnderSurvivor(rail))).toEqual([
      'fantrax',
      'guillotine',
      'survivor-a',
      'exile-a',
      'redraft',
      'survivor-b',
      'exile-b',
    ])
  })

  it('leaves an island in place when its Survivor league is not on the rail', () => {
    const rows = [{ id: 'exile-a', exileOf: 'hidden-survivor' }, { id: 'redraft' }]
    expect(ids(pairExileUnderSurvivor(rows))).toEqual(['exile-a', 'redraft'])
    expect(pairedExileIds(rows).size).toBe(0)
  })

  it('reports only the islands it paired', () => {
    expect([...pairedExileIds(rail)].sort()).toEqual(['exile-a', 'exile-b'])
  })

  it('returns the rail unchanged when there is no island', () => {
    const rows = [{ id: 'a' }, { id: 'b' }]
    expect(ids(pairExileUnderSurvivor(rows))).toEqual(['a', 'b'])
  })
})
