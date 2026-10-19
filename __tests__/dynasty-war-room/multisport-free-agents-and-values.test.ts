/**
 * @vitest-environment node
 *
 * 🛑 THE DYNASTY WAR ROOM ONLY KNEW NFL POSITIONS AND NFL AGE CURVES.
 *
 * - `fetchDynastyFreeAgentPool` filtered every sport's pool to NFL+IDP positions, so an NBA/MLB/NHL
 *   league's PG/SP/LW/D free agents were all dropped and the panel read "unavailable".
 * - `ageTrajectory` modeled only QB/RB/WR/TE, so every MLB/NBA/NHL player was 'unknown'.
 * - `adpToDynastyValue` zeroed every ADP ≥ 260, which in a deep MLB/NHL dynasty is most rosters.
 *
 * NFL outputs are pinned against frozen copies of the original functions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ adpRows: [] as unknown[] }))
vi.mock('@/lib/prisma', () => ({
  prisma: { allFantasyAdpSnapshot: { findMany: vi.fn(async () => db.adpRows) } },
}))

import { fetchDynastyFreeAgentPool, isDynastyFantasyPosition } from '@/lib/dynasty-war-room/dynastyFreeAgentPool'
import { adpToDynastyValue, ageTrajectory, dynastyValue } from '@/lib/dynasty-war-room/dynastyPlayerValue'
import { getPeakAgeRange } from '@/lib/dynasty-engine/SportDynastyResolver'
import type { DynastyPlayerFact } from '@/lib/dynasty-war-room/types'

function adpRow(name: string, pos: string, adp: number) {
  return {
    playerKey: `${name.toLowerCase()}|${pos.toLowerCase()}`,
    playerName: name,
    scoringFormat: 'points',
    averageOverallPick: adp,
    sampleSize: 10,
    contextHash: 'ctx',
    draftMode: 'snake',
  }
}

describe('free-agent pool keeps each sport’s real positions', () => {
  beforeEach(() => {
    db.adpRows = []
  })

  it.each([
    ['NBA', ['PG', 'SG', 'SF', 'PF', 'C']],
    ['MLB', ['SP', 'RP', 'C', '1B', 'SS', 'OF']],
    ['NHL', ['C', 'LW', 'RW', 'D', 'G']],
  ])('%s: keeps %j', async (sport, positions) => {
    db.adpRows = positions.map((pos, i) => adpRow(`Player ${i}`, pos, 10 + i))
    const pool = await fetchDynastyFreeAgentPool({ sport, season: 2026, rosteredKeys: new Set() })
    expect(pool.map((p) => p.position).sort()).toEqual([...positions].sort())
  })

  it('keeps multi-eligible tokens (PG/SG) and still drops junk', async () => {
    db.adpRows = [adpRow('Combo Guard', 'PG/SG', 5), adpRow('Coach', 'HC', 6), adpRow('Runner', 'RB', 7)]
    const pool = await fetchDynastyFreeAgentPool({ sport: 'NBA', season: 2026, rosteredKeys: new Set() })
    expect(pool.map((p) => p.playerName)).toEqual(['Combo Guard'])
  })

  it('NFL keeps its exact NFL+IDP set', () => {
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'LB', 'CB', 'S']) expect(isDynastyFantasyPosition('NFL', pos)).toBe(true)
    for (const pos of ['PG', 'SP', 'LW', 'D', 'G', 'C']) expect(isDynastyFantasyPosition('NFL', pos)).toBe(false)
  })
})

/** Frozen copy of the original NFL age table. */
function legacyAgeTrajectory(position: string, age: number | null): string {
  if (age == null) return 'unknown'
  const pos = position.toUpperCase()
  if (pos === 'RB') return age <= 23 ? 'ascending' : age <= 25 ? 'prime' : age <= 27 ? 'aging' : 'cliff'
  if (pos === 'WR') return age <= 23 ? 'ascending' : age <= 28 ? 'prime' : age <= 30 ? 'aging' : 'cliff'
  if (pos === 'TE') return age <= 24 ? 'ascending' : age <= 29 ? 'prime' : age <= 31 ? 'aging' : 'cliff'
  if (pos === 'QB') return age <= 25 ? 'ascending' : age <= 33 ? 'prime' : age <= 36 ? 'aging' : 'cliff'
  return 'unknown'
}

describe('ageTrajectory is sport-aware', () => {
  it.each([
    ['NBA', 'PG'],
    ['NBA', 'C'],
    ['MLB', 'SP'],
    ['MLB', 'SS'],
    ['NHL', 'G'],
    ['NHL', 'D'],
  ])('%s %s is never "unknown" for a known age', (sport, pos) => {
    for (let age = 18; age <= 42; age++) expect(ageTrajectory(pos, age, sport)).not.toBe('unknown')
  })

  it.each([
    ['NBA', 'PG'],
    ['MLB', 'SP'],
    ['NHL', 'G'],
  ])('%s %s follows the sport’s peak-age range', (sport, pos) => {
    const { peakStart, peakEnd, hardCliff } = getPeakAgeRange(sport, pos)
    expect(ageTrajectory(pos, peakStart - 1, sport)).toBe('ascending')
    expect(ageTrajectory(pos, peakStart, sport)).toBe('prime')
    expect(ageTrajectory(pos, peakEnd, sport)).toBe('prime')
    if (hardCliff > peakEnd + 1) expect(ageTrajectory(pos, peakEnd + 1, sport)).toBe('aging')
    expect(ageTrajectory(pos, hardCliff, sport)).toBe('cliff')
  })

  it('null age stays unknown in every sport', () => {
    for (const sport of ['NFL', 'NBA', 'MLB', 'NHL']) expect(ageTrajectory('C', null, sport)).toBe('unknown')
  })

  it('NFL output is identical to the original table (with and without a sport)', () => {
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'LB']) {
      for (let age = 18; age <= 42; age++) {
        expect(ageTrajectory(pos, age)).toBe(legacyAgeTrajectory(pos, age))
        expect(ageTrajectory(pos, age, 'NFL')).toBe(legacyAgeTrajectory(pos, age))
      }
    }
  })
})

describe('adpToDynastyValue cutoff scales with roster depth', () => {
  const legacy = (adp: number) => Math.round((Math.max(0, 260 - adp) / 10) * 100) / 100

  it('NFL (and no sport) is bit-identical to the original', () => {
    for (let adp = 0; adp <= 400; adp += 0.5) {
      expect(adpToDynastyValue(adp)).toBe(legacy(adp))
      expect(adpToDynastyValue(adp, 'NFL')).toBe(legacy(adp))
    }
  })

  it('MLB and NHL still value players drafted past 260', () => {
    expect(adpToDynastyValue(300, 'MLB')).toBeGreaterThan(0)
    expect(adpToDynastyValue(280, 'NHL')).toBeGreaterThan(0)
  })

  it('stays on the same 0–26 scale and stays monotonic', () => {
    for (const sport of ['NBA', 'MLB', 'NHL']) {
      expect(adpToDynastyValue(0, sport)).toBeCloseTo(26, 1)
      expect(adpToDynastyValue(5, sport)).toBeGreaterThan(adpToDynastyValue(50, sport))
      expect(adpToDynastyValue(5000, sport)).toBe(0)
    }
  })

  it('NBA never loses value it had before (cutoff ≥ 260)', () => {
    for (let adp = 0; adp <= 300; adp += 5) expect(adpToDynastyValue(adp, 'NBA')).toBeGreaterThanOrEqual(legacy(adp))
  })

  it('dynastyValue threads the sport into the ADP fallback', () => {
    const p = { adp: 300, dynastyValue: null } as DynastyPlayerFact
    expect(dynastyValue(p).value).toBe(0)
    expect(dynastyValue(p, 'MLB')).toEqual({ value: adpToDynastyValue(300, 'MLB'), source: 'adp' })
  })
})
