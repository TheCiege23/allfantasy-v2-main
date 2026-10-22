/**
 * Owner's call, 2026-10-20: a Survivor cast is 12, 15, 16, 18, 20, 21, 22 or 24 managers, split into
 * 2, 3 or 4 EQUAL tribes. The tribe counts a cast allows follow from that arithmetic.
 */
import { describe, expect, it } from 'vitest'

import {
  SURVIVOR_CAST_SIZE_OPTIONS,
  SURVIVOR_CREATE_CAST_SIZES,
  clampSurvivorCastSize,
  survivorTribeCountOptions,
  survivorTribeSize,
} from '@/lib/league-creation-wizard/sport-team-limits'
import { getSurvivorTribeOptions } from '@/lib/create-league-v2/rules-engine'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'

describe('Survivor cast sizes and tribe splits', () => {
  it('offers exactly the eight sizes and keeps the legacy 17 and 19 inside the engine range', () => {
    expect([...SURVIVOR_CREATE_CAST_SIZES]).toEqual([12, 15, 16, 18, 20, 21, 22, 24])
    expect([...SURVIVOR_CAST_SIZE_OPTIONS]).toEqual([12, 15, 16, 17, 18, 19, 20, 21, 22, 24])
    for (const size of SURVIVOR_CREATE_CAST_SIZES) expect(SURVIVOR_CAST_SIZE_OPTIONS).toContain(size)
  })

  it('allows only the tribe counts that split the cast equally', () => {
    expect(survivorTribeCountOptions(12)).toEqual([2, 3, 4])
    expect(survivorTribeCountOptions(15)).toEqual([3])
    expect(survivorTribeCountOptions(16)).toEqual([2, 4])
    expect(survivorTribeCountOptions(18)).toEqual([2, 3])
    expect(survivorTribeCountOptions(20)).toEqual([2, 4])
    expect(survivorTribeCountOptions(21)).toEqual([3])
    expect(survivorTribeCountOptions(22)).toEqual([2])
    expect(survivorTribeCountOptions(24)).toEqual([2, 3, 4])
    for (const size of SURVIVOR_CREATE_CAST_SIZES) {
      for (const tribes of survivorTribeCountOptions(size)) expect(survivorTribeSize(size, tribes)).toBe(size / tribes)
    }
    expect(survivorTribeSize(15, 2)).toBeNull()
  })

  it('a legacy 17- or 19-manager league keeps a workable split rather than none', () => {
    expect(survivorTribeCountOptions(17)).toEqual([2, 3, 4])
    expect(survivorTribeCountOptions(19)).toEqual([2, 3, 4])
    expect(getSurvivorTribeOptions(16)).toEqual(survivorTribeCountOptions(16))
  })

  it('never offers five tribes', () => {
    for (const size of SURVIVOR_CAST_SIZE_OPTIONS) expect(survivorTribeCountOptions(size)).not.toContain(5)
  })

  it('clamps a submitted cast to the nearest engine size, so 24 is no longer rewritten to 20', () => {
    expect(clampSurvivorCastSize(24)).toBe(24)
    expect(clampSurvivorCastSize(12)).toBe(12)
    expect(clampSurvivorCastSize(13)).toBe(12)
    expect(clampSurvivorCastSize(23)).toBe(24)
  })

  it('foundation settings accept the full range', () => {
    expect(normalizeSurvivorFoundationSettings({ defaultTeamCount: 24, minTeamCount: 12, maxTeamCount: 24 }).defaultTeamCount).toBe(24)
    expect(normalizeSurvivorFoundationSettings({ defaultTeamCount: 12, minTeamCount: 12, maxTeamCount: 24 }).defaultTeamCount).toBe(12)
  })
})
