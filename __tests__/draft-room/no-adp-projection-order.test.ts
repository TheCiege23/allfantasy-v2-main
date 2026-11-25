import { describe, expect, it } from 'vitest'

import { applyPoolSort } from '@/components/app/draft-room/SleeperPoolSort'
import { compareDraftEntriesByStableRank } from '@/lib/draft-room/adp-ordering'

/**
 * A sport with no ADP feed listed — and autopicked — alphabetically. NBA did until its ADP import;
 * college basketball did on production 2026-11-25, where a pool opened on "A.C. Kelly". With no ADP
 * on either side the higher projected points per game now comes first, in the server's pool order
 * and in the room's list alike.
 */

type Entry = { name: string; position: string; team: string; adp?: number | null; aiAdp?: number | null; display?: { stats?: { projectedPointsPerGame?: number | null } } }
const player = (name: string, proj: number | null, adp: number | null = null): Entry => ({
  name, position: 'G', team: 'DUKE', adp, display: { stats: { projectedPointsPerGame: proj } },
})
const serverOrder = (entries: Entry[]) =>
  entries.map((entry, index) => ({ entry, index })).sort((a, b) => compareDraftEntriesByStableRank(a.entry, b.entry, a.index, b.index)).map((x) => x.entry.name)

describe('server pool order (compareDraftEntriesByStableRank)', () => {
  it('orders players with no ADP by projected points per game, not by name', () => {
    expect(serverOrder([player('A.C. Kelly', 6.2), player('Zvonimir Ivisic', 31.4), player('Mekhi Mason', 28.1)]))
      .toEqual(['Zvonimir Ivisic', 'Mekhi Mason', 'A.C. Kelly'])
  })

  it('control: with no projection either, the order is still alphabetical', () => {
    expect(serverOrder([player('Zvonimir Ivisic', null), player('A.C. Kelly', null), player('Mekhi Mason', null)]))
      .toEqual(['A.C. Kelly', 'Mekhi Mason', 'Zvonimir Ivisic'])
  })

  it('puts a projected player ahead of one with nothing, and ties fall back to the name', () => {
    expect(serverOrder([player('Aaron Nothing', null), player('Zed Scorer', 12), player('Abe Scorer', 12)]))
      .toEqual(['Abe Scorer', 'Zed Scorer', 'Aaron Nothing'])
    // Zero and junk are "no projection", not the lowest one.
    expect(serverOrder([player('Abe Zero', 0), player('Bo Junk', Number.NaN), player('Cy Real', 1)]))
      .toEqual(['Cy Real', 'Abe Zero', 'Bo Junk'])
  })

  it('never lets a projection outrank an ADP, or reorder two players who both have one', () => {
    expect(serverOrder([player('Huge Projection', 60), player('Has Adp', 5, 40)])).toEqual(['Has Adp', 'Huge Projection'])
    expect(serverOrder([player('Later Pick', 60, 20), player('Earlier Pick', 5, 3)])).toEqual(['Earlier Pick', 'Later Pick'])
    // An AI ADP is an ADP too.
    expect(serverOrder([player('Huge Projection', 60), { ...player('Has Ai Adp', 5), aiAdp: 80 }])).toEqual(['Has Ai Adp', 'Huge Projection'])
  })
})

describe('the room’s list sort (applyPoolSort)', () => {
  const sorted = (entries: Entry[], key = 'adp') => applyPoolSort(entries as never[], { key, direction: 'asc' }, 'NCAAB').map((p: { name: string }) => p.name)

  it('breaks an all-missing ADP sort by projected points per game', () => {
    expect(sorted([player('A.C. Kelly', 6.2), player('Zvonimir Ivisic', 31.4), player('Mekhi Mason', 28.1)]))
      .toEqual(['Zvonimir Ivisic', 'Mekhi Mason', 'A.C. Kelly'])
  })

  it('control: with no projection the tie still falls to the name', () => {
    expect(sorted([player('Zvonimir Ivisic', null), player('A.C. Kelly', null)])).toEqual(['A.C. Kelly', 'Zvonimir Ivisic'])
  })

  it('keeps ADP first and leaves two ADP-ranked players in ADP order', () => {
    expect(sorted([player('Huge Projection', 60), player('Later Pick', 1, 20), player('Earlier Pick', 2, 3)]))
      .toEqual(['Earlier Pick', 'Later Pick', 'Huge Projection'])
  })
})
