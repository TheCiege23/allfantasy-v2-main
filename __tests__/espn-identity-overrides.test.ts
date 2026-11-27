import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany, updateMany } = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { playerIdentityMap: { findMany, updateMany } } }))

import {
  ESPN_IDENTITY_OVERRIDES,
  applyEspnIdentityOverrides,
  planEspnIdentityOverrides,
  type EspnIdentityOverride,
  type IdentityRow,
} from '@/lib/espn/espnIdentityOverrides'

const o = (patch: Partial<EspnIdentityOverride> = {}): EspnIdentityOverride => ({
  espnId: '100', sleeperId: '200', name: 'A Player', position: 'WR', team: 'CLE', reason: 'test', ...patch,
})
const facts = (p: { bySleeper?: Record<string, IdentityRow[]>; byEspn?: Record<string, IdentityRow[]>; adopt?: Record<string, IdentityRow[]> }) => ({
  bySleeperId: new Map(Object.entries(p.bySleeper ?? {})),
  byEspnId: new Map(Object.entries(p.byEspn ?? {})),
  adoptCandidates: new Map(Object.entries(p.adopt ?? {})),
})
const kindOf = (override: EspnIdentityOverride, f: ReturnType<typeof facts>) => planEspnIdentityOverrides([override], f)[0]

describe('the reviewed list', () => {
  it('gives every entry a reason and numeric ids, with no id used twice', () => {
    for (const entry of ESPN_IDENTITY_OVERRIDES) {
      expect(entry.reason.length, entry.name).toBeGreaterThan(10)
      expect(entry.espnId).toMatch(/^\d+$/)
      expect(entry.sleeperId).toMatch(/^\d+$/)
    }
    const espn = ESPN_IDENTITY_OVERRIDES.map((e) => e.espnId)
    const sleeper = ESPN_IDENTITY_OVERRIDES.map((e) => e.sleeperId)
    expect(new Set(espn).size).toBe(espn.length)
    expect(new Set(sleeper).size).toBe(sleeper.length)
  })

  it('carries KC Concepcion, the player that started this', () => {
    expect(ESPN_IDENTITY_OVERRIDES.find((e) => e.espnId === '4870653')?.sleeperId).toBe('13298')
  })
})

describe('planEspnIdentityOverrides', () => {
  it('fills the ESPN id on the one row holding the Sleeper id', () => {
    expect(kindOf(o(), facts({ bySleeper: { '200': [{ id: 'r1', sleeperId: '200', espnId: null }] } })))
      .toMatchObject({ kind: 'set-espn', rowId: 'r1' })
  })

  it('reports an existing identical link as already done', () => {
    expect(kindOf(o(), facts({ byEspn: { '100': [{ id: 'r1', sleeperId: '200', espnId: '100' }] } })).kind).toBe('already')
  })

  it('refuses when the ESPN id already sits on another player', () => {
    expect(kindOf(o(), facts({
      byEspn: { '100': [{ id: 'r9', sleeperId: '999', espnId: '100' }] },
      bySleeper: { '200': [{ id: 'r1', sleeperId: '200', espnId: null }] },
    })).kind).toBe('refused')
  })

  it('refuses rather than overwrite a different ESPN id on the Sleeper row', () => {
    expect(kindOf(o(), facts({ bySleeper: { '200': [{ id: 'r1', sleeperId: '200', espnId: '555' }] } })).kind).toBe('refused')
  })

  it('refuses when no row holds the Sleeper id and there is nothing to adopt', () => {
    expect(kindOf(o(), facts({})).kind).toBe('refused')
  })

  describe('adopting a row (one player stored under two names)', () => {
    const adopting = o({ adoptRow: { normalizedName: 'bam knight', position: 'RB' } })

    it('completes the one empty matching row', () => {
      expect(kindOf(adopting, facts({ adopt: { '100': [{ id: 'bk', sleeperId: null, espnId: null }] } })))
        .toMatchObject({ kind: 'adopt', rowId: 'bk' })
    })

    it('refuses with no candidate, two candidates, or a candidate that already holds an id', () => {
      expect(kindOf(adopting, facts({ adopt: { '100': [] } })).kind).toBe('refused')
      expect(kindOf(adopting, facts({ adopt: { '100': [
        { id: 'a', sleeperId: null, espnId: null }, { id: 'b', sleeperId: null, espnId: null },
      ] } })).kind).toBe('refused')
      expect(kindOf(adopting, facts({ adopt: { '100': [{ id: 'a', sleeperId: '7', espnId: null }] } })).kind).toBe('refused')
    })

    it('never adopts when a row already holds the Sleeper id', () => {
      expect(kindOf(adopting, facts({
        bySleeper: { '200': [{ id: 'r1', sleeperId: '200', espnId: null }] },
        adopt: { '100': [{ id: 'bk', sleeperId: null, espnId: null }] },
      }))).toMatchObject({ kind: 'set-espn', rowId: 'r1' })
    })
  })
})

describe('applyEspnIdentityOverrides', () => {
  beforeEach(() => {
    findMany.mockReset()
    updateMany.mockReset()
  })

  it('writes only through guards that make a changed row a no-op, and reports each outcome', async () => {
    const list = [
      o({ espnId: '1', sleeperId: '11' }), // set-espn
      o({ espnId: '2', sleeperId: '22' }), // already
      o({ espnId: '3', sleeperId: '33', adoptRow: { normalizedName: 'bam knight', position: 'RB' } }), // adopt
      o({ espnId: '4', sleeperId: '44' }), // refused: nothing holds 44
    ]
    findMany
      .mockResolvedValueOnce([{ id: 'r11', sleeperId: '11', espnId: null, normalizedName: 'x', position: 'WR' }])
      .mockResolvedValueOnce([{ id: 'r22', sleeperId: '22', espnId: '2', normalizedName: 'y', position: 'WR' }])
      .mockResolvedValueOnce([{ id: 'bk', sleeperId: null, espnId: null, normalizedName: 'bam knight', position: 'RB' }])
    updateMany.mockResolvedValue({ count: 1 })

    const summary = await applyEspnIdentityOverrides(list)

    expect(updateMany).toHaveBeenCalledTimes(2)
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'r11', sport: 'NFL', espnId: null, sleeperId: '11' },
      data: { espnId: '1' },
    })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'bk', sport: 'NFL', espnId: null, sleeperId: null },
      data: { espnId: '3', sleeperId: '33' },
    })
    expect(summary).toEqual({ already: 1, written: 2, refused: [{ espnId: '4', why: 'no identity row holds Sleeper 44' }] })
  })

  it('counts a write that matched nothing as refused, not written', async () => {
    findMany
      .mockResolvedValueOnce([{ id: 'r11', sleeperId: '11', espnId: null, normalizedName: 'x', position: 'WR' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    updateMany.mockResolvedValue({ count: 0 })
    const summary = await applyEspnIdentityOverrides([o({ espnId: '1', sleeperId: '11' })])
    expect(summary.written).toBe(0)
    expect(summary.refused).toEqual([{ espnId: '1', why: 'row changed before the write' }])
  })
})
