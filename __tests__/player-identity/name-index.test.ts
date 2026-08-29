/**
 * @vitest-environment node
 *
 * `buildNameIndex` exists because three production bugs shipped from
 * `new Map(rows.map(r => [name, r]))` taking the LAST duplicate silently. These assert the
 * refusal, so the fourth one does not.
 */

import { describe, expect, it, vi } from 'vitest'

import { buildNameIndex, findAmbiguousNames } from '@/lib/player-identity/nameIndex'

type Row = { name: string; team: string; id?: string }

describe('buildNameIndex', () => {
  it('keeps names that resolve to exactly one row', () => {
    const rows: Row[] = [
      { name: 'aidan hutchinson', team: 'DET' },
      { name: 'myles garrett', team: 'CLE' },
    ]
    const idx = buildNameIndex(rows, (r) => r.name)
    expect(idx.size).toBe(2)
    expect(idx.get('aidan hutchinson')?.team).toBe('DET')
  })

  it('REFUSES a name shared by two different rows rather than taking the last', () => {
    // The real case: mike hughes -> ATL | JAX in PlayerIdentityMap.
    const rows: Row[] = [
      { name: 'mike hughes', team: 'ATL' },
      { name: 'mike hughes', team: 'JAX' },
    ]
    const idx = buildNameIndex(rows, (r) => r.name)
    expect(idx.has('mike hughes')).toBe(false)
    expect(idx.get('mike hughes')).toBeUndefined()
  })

  it('does not let a later row overwrite an earlier one', () => {
    // The dob bug in miniature: last-write-wins handed a 2026 rookie a 1971 birth date.
    const rows: Row[] = [
      { name: 'chris johnson', team: '2004-11-09' },
      { name: 'chris johnson', team: '1971-08-07' },
    ]
    const idx = buildNameIndex(rows, (r) => r.name)
    expect(idx.get('chris johnson')).toBeUndefined()
  })

  it('collapses duplicate rows for the SAME entity when identityOf is given', () => {
    const rows: Row[] = [
      { name: 'justin jefferson', team: 'MIN', id: '6794' },
      { name: 'justin jefferson', team: 'MIN', id: '6794' },
    ]
    const idx = buildNameIndex(rows, (r) => r.name, { identityOf: (r) => r.id as string })
    expect(idx.get('justin jefferson')?.id).toBe('6794')
  })

  it('still refuses when identityOf shows the rows are DIFFERENT people', () => {
    // Both really are on one production roster: WR MIN and LB CLE.
    const rows: Row[] = [
      { name: 'justin jefferson', team: 'MIN', id: '6794' },
      { name: 'justin jefferson', team: 'CLE', id: '13524' },
    ]
    const idx = buildNameIndex(rows, (r) => r.name, { identityOf: (r) => r.id as string })
    expect(idx.has('justin jefferson')).toBe(false)
  })

  it('reports every refused key', () => {
    const onAmbiguous = vi.fn()
    const rows: Row[] = [
      { name: 'a', team: '1' },
      { name: 'a', team: '2' },
      { name: 'b', team: '3' },
    ]
    buildNameIndex(rows, (r) => r.name, { onAmbiguous })
    expect(onAmbiguous).toHaveBeenCalledTimes(1)
    expect(onAmbiguous.mock.calls[0][0]).toBe('a')
    expect(findAmbiguousNames(rows, (r) => r.name)).toEqual(['a'])
  })

  it('skips empty and whitespace-only keys instead of bucketing them together', () => {
    const rows: Row[] = [
      { name: '', team: 'X' },
      { name: '   ', team: 'Y' },
      { name: 'real', team: 'Z' },
    ]
    const idx = buildNameIndex(rows, (r) => r.name)
    expect(idx.size).toBe(1)
    expect(idx.get('real')?.team).toBe('Z')
  })

  it('trims the key so " name" and "name" are the same entry, not two', () => {
    const rows: Row[] = [{ name: ' solo ', team: 'A' }]
    const idx = buildNameIndex(rows, (r) => r.name)
    expect(idx.get('solo')?.team).toBe('A')
  })
})
