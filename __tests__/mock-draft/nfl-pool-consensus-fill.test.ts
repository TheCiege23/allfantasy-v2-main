/**
 * The NFL redraft mock pool is topped up from the consensus board (2026-11-16). Found live: FFC alone
 * gave an 8-team, 15-round mock 118 players (fewer than its 120 picks) and no Bijan Robinson.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { consensusPosition, fillPoolFromConsensus, type ConsensusRow, type MockPoolEntry } from '@/lib/mock-draft/nflPoolConsensusFill'

const ffc = (name: string, position: string, adp: number): MockPoolEntry => ({
  name, position, team: 'DET', adp, adpFormatted: String(adp), adpTrend: null, age: null, value: null, source: 'ffc',
  ffcPlayerId: 1, timesDrafted: 100, adpHigh: null, adpLow: null, adpStdev: null, bye: null,
})

/* 118 FFC players with no Bijan, like production. */
const FFC = Array.from({ length: 118 }, (_, i) => ffc(i === 0 ? 'Jahmyr Gibbs' : `Ffc Player ${i}`, ['RB', 'WR', 'QB', 'TE'][i % 4]!, i + 1.5))
const CONSENSUS: ConsensusRow[] = [
  { name: 'Bijan Robinson', adp: 3.24, position: 'RB', team: 'ATL' },
  { name: 'Jahmyr Gibbs', adp: 3.39, position: 'RB', team: 'DET' },
  ...Array.from({ length: 60 }, (_, i) => ({ name: `Deep Player ${i}`, adp: 120 + i, position: 'WR', team: 'BUF' })),
  { name: 'Brandon Aubrey', adp: 140.5, position: 'K', team: 'DAL' },
  { name: 'Buffalo Bills', adp: 141.5, position: 'DST', team: 'BUF' },
  { name: 'Fred Warner', adp: 150, position: 'LB', team: 'SF' },
  { name: '', adp: 5, position: 'RB', team: null },
  { name: 'No Adp', adp: Number.NaN, position: 'RB', team: null },
]

describe('fillPoolFromConsensus', () => {
  const pool = fillPoolFromConsensus(FFC, CONSENSUS, 300)

  it('adds the consensus players FFC is missing, at their consensus ADP, in ADP order', () => {
    const bijan = pool.find((p) => p.name === 'Bijan Robinson')!
    expect(bijan).toMatchObject({ adp: 3.24, position: 'RB', source: 'consensus', ffcPlayerId: null })
    // Between FFC's 2.5 and 3.5.
    expect(pool.findIndex((p) => p.name === 'Bijan Robinson')).toBe(2)
    expect(pool.map((p) => p.adp)).toEqual([...pool.map((p) => p.adp)].sort((a, b) => a - b))
  })

  it('a pool too small for the draft is filled past the picks it needs', () => {
    expect(FFC.length).toBeLessThan(8 * 15)
    expect(pool.length).toBeGreaterThanOrEqual(8 * 15)
  })

  it('never re-prices a player the list already has', () => {
    const gibbs = pool.filter((p) => p.name === 'Jahmyr Gibbs')
    expect(gibbs).toHaveLength(1)
    expect(gibbs[0]).toMatchObject({ adp: 1.5, source: 'ffc' })
  })

  it("uses the room's position spellings, and leaves out defenders and bad rows", () => {
    expect(pool.find((p) => p.name === 'Brandon Aubrey')?.position).toBe('PK')
    expect(pool.find((p) => p.name === 'Buffalo Bills')?.position).toBe('DEF')
    expect(pool.some((p) => p.name === 'Fred Warner' || p.name === '' || p.name === 'No Adp')).toBe(false)
    expect(consensusPosition('d/st')).toBe('DEF')
    expect(consensusPosition('LB')).toBeNull()
  })

  it('respects the limit, and returns the list unchanged when there is nothing to add', () => {
    expect(fillPoolFromConsensus(FFC, CONSENSUS, 50)).toHaveLength(50)
    expect(fillPoolFromConsensus(FFC, [], 300)).toEqual(FFC)
  })
})

describe('wiring', () => {
  it('the pool builder tops up redraft pools (not rookie pools) from the DB-first consensus board', () => {
    const src = readFileSync(path.resolve(__dirname, '..', '..', 'lib/mock-draft/mock-draft-pool-cache.ts'), 'utf8')
    expect(src).toMatch(/if \(type === 'redraft' && pool !== 'rookie'\) \{\s*const consensus = await getLiveAdpByName\(\{ sport: 'NFL' \}\)\.catch\(\(\) => new Map\(\)\)\s*entries = fillPoolFromConsensus\(entries, consensus\.values\(\), limit\)/)
    // The fill comes before the Sleeper-id and injury passes, so added players get ids and badges too.
    expect(src.indexOf('fillPoolFromConsensus(entries')).toBeLessThan(src.indexOf('resolveSleeperIdsBatch('))
  })
})
