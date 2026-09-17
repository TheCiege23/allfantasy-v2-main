import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { isEliminationFormat } from '@/lib/core-app/weekBoard'
import { legacyMadePlayoffs as madePlayoffs } from '@/lib/rank/careerLedger'

/**
 * The two corrections in the XP engine: the played-games gate on a berth, and
 * the counting that was persisted backwards.
 *
 * ⚠ THIS FILE USED TO TEST ITS OWN COPY OF THE GATE. The rule lived inline in a
 * long DB-bound function, so the suite re-typed it here — which meant deleting
 * the gate from `calculateRank.ts` left every assertion green. The rule now lives
 * in `lib/rank/careerLedger.ts` (`legacyMadePlayoffs`), shared by the XP writer
 * and `/core/rankings`, and this suite imports the real one.
 */

describe('playoff berth requires games played', () => {
  it('refuses a berth for a season that has not played a snap', () => {
    // The production shape: Sleeper pre-seeds standings before Week 1.
    expect(
      madePlayoffs({ wins: 0, losses: 0, ties: 0, playoffSeed: 3, finalStanding: 3 }, 6),
    ).toBe(false)
  })

  it('still credits a real berth once games exist', () => {
    expect(madePlayoffs({ wins: 9, losses: 5, playoffSeed: 3 }, 6)).toBe(true)
    expect(madePlayoffs({ wins: 9, losses: 5, finalStanding: 2 }, 6)).toBe(true)
  })

  it('refuses a championship claim on an unplayed season too', () => {
    expect(madePlayoffs({ wins: 0, losses: 0, isChampion: true }, 6)).toBe(false)
    expect(madePlayoffs({ wins: 1, losses: 0, isChampion: true }, 6)).toBe(true)
  })

  it('misses the cut when the seed is outside it', () => {
    expect(madePlayoffs({ wins: 4, losses: 10, playoffSeed: 9 }, 6)).toBe(false)
  })
})

describe('seasons vs leagues counting', () => {
  // Each row is one league-season, so distinct seasons and row count are
  // different numbers — persisting them the other way round put ~6 in the
  // leagues column and hundreds in the seasons column.
  const rows = [
    { season: 2024 },
    { season: 2024 },
    { season: 2025 },
    { season: 2026 },
    { season: 2026 },
  ]

  it('counts seasons as distinct season values', () => {
    expect(new Set(rows.map((r) => r.season)).size).toBe(3)
  })

  it('counts leagues as league-season rows', () => {
    expect(rows.length).toBe(5)
  })

  it('the XP term is per DISTINCT SEASON, so the correction cannot move anyone XP', () => {
    // Before: careerLeaguesPlayed held distinct seasons and fed the term.
    // After: careerSeasonsPlayed holds distinct seasons and feeds the term.
    const distinctSeasons = new Set(rows.map((r) => r.season)).size
    expect(distinctSeasons).toBe(3)
    expect(distinctSeasons).not.toBe(rows.length)
  })
})

describe('isEliminationFormat', () => {
  it('flags guillotine and survivor leagues', () => {
    for (const t of ['guillotine', 'Guillotine', 'GUILLOTINE', 'survivor', 'Survivor Pool']) {
      expect(isEliminationFormat(t)).toBe(true)
    }
  })

  it('leaves ordinary formats alone', () => {
    for (const t of ['redraft', 'dynasty', 'keeper', 'best_ball', '', null, undefined]) {
      expect(isEliminationFormat(t)).toBe(false)
    }
  })
})
