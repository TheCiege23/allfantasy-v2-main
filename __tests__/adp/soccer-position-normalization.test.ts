/**
 * Locks the SOCCER position canonicalization shape used by:
 *   - scripts/normalize-soccer-sports-players.ts (one-time DB cleanup)
 *
 * Bug history this guards against:
 *   - SOCCER SportsPlayer rows came from two writers:
 *       (a) lib/api-football.ts → uppercased short codes ("G", "D", "M", "F")
 *       (b) scripts/sync-thesportsdb-players.ts → full English ("Midfielder")
 *     Plus cross-sport contamination tagged sport=SOCCER (positions like 1B/OF/DB).
 *   - The draft pool resolver returned pool=0 for SOCCER until the cleanup script
 *     normalized them to GK/DEF/MID/FWD and removed the contamination.
 */
import { describe, expect, it } from 'vitest'
import {
  canonicalSoccerPosition,
  SOCCER_POSITION_MAP,
} from '@/scripts/normalize-soccer-sports-players'

describe('canonicalSoccerPosition', () => {
  it('maps full English names to short codes', () => {
    expect(canonicalSoccerPosition('Goalkeeper')).toBe('GK')
    expect(canonicalSoccerPosition('Defender')).toBe('DEF')
    expect(canonicalSoccerPosition('Midfielder')).toBe('MID')
    expect(canonicalSoccerPosition('Forward')).toBe('FWD')
  })

  it('handles uppercased and mixed-case variants from thesportsdb drift', () => {
    expect(canonicalSoccerPosition('GOALKEEPER')).toBe('GK')
    expect(canonicalSoccerPosition('DEFENDER')).toBe('DEF')
    expect(canonicalSoccerPosition('MIDFIELDER')).toBe('MID')
    expect(canonicalSoccerPosition('Attacker')).toBe('FWD')
  })

  it('handles api-football single-letter codes', () => {
    expect(canonicalSoccerPosition('G')).toBe('GK')
    expect(canonicalSoccerPosition('D')).toBe('DEF')
    expect(canonicalSoccerPosition('M')).toBe('MID')
    expect(canonicalSoccerPosition('F')).toBe('FWD')
  })

  it('idempotent on already-canonical short codes', () => {
    expect(canonicalSoccerPosition('GK')).toBe('GK')
    expect(canonicalSoccerPosition('DEF')).toBe('DEF')
    expect(canonicalSoccerPosition('MID')).toBe('MID')
    expect(canonicalSoccerPosition('FWD')).toBe('FWD')
  })

  it('returns null for cross-sport contamination so the caller can delete the row', () => {
    // Baseball positions seen in the wild on rows tagged sport=SOCCER:
    expect(canonicalSoccerPosition('1B')).toBeNull()
    expect(canonicalSoccerPosition('2B')).toBeNull()
    expect(canonicalSoccerPosition('OF')).toBeNull()
    expect(canonicalSoccerPosition('CF')).toBeNull()
    expect(canonicalSoccerPosition('P')).toBeNull()
    // Football positions seen in the wild:
    expect(canonicalSoccerPosition('OL')).toBeNull()
    expect(canonicalSoccerPosition('DB')).toBeNull()
    expect(canonicalSoccerPosition('FLEX')).toBeNull()
    // Genuinely empty / null:
    expect(canonicalSoccerPosition(null)).toBeNull()
    expect(canonicalSoccerPosition('')).toBeNull()
    expect(canonicalSoccerPosition('   ')).toBeNull()
  })

  it('every map entry produces a canonical short code in {GK, DEF, MID, FWD}', () => {
    const allowed = new Set(['GK', 'DEF', 'MID', 'FWD'])
    for (const value of Object.values(SOCCER_POSITION_MAP)) {
      expect(allowed.has(value)).toBe(true)
    }
  })
})
