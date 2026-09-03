/**
 * BUG-4 — keeper leagues were indistinguishable from redraft, end to end.
 *
 * The bug was FILED as "isDynasty false on a league the owner says is dynasty; the import is
 * not capturing dynasty status". Measured against production, that premise is wrong and the
 * real defect is a different one:
 *
 *   - Sleeper reports league 1335730625293844480 ("King Gingerbeards SF 2026!!!") as
 *     `settings.type === 1`, which is KEEPER — not dynasty (2). `isDynasty: false` was the
 *     CORRECT value, and dynasty capture works: 110 of 225 imported Sleeper leagues carry
 *     `isDynasty = true` and `leagueType = 'dynasty'`, agreeing on every single row.
 *   - What was never captured is KEEPER. `settings.type` reaches the database nowhere —
 *     absent from the stored settings blob on 225/225 rows — so a keeper league landed as a
 *     plain redraft and `isKeeper` in the grounding packet was false for every league in
 *     production.
 *
 * Both halves are covered here because a reader without its writer is the failure mode this
 * repo names explicitly: pointing a surface at data nothing populates is worse than the gap
 * it replaces, because it fails silently and looks correct.
 */
import { describe, expect, it } from 'vitest'

import { SleeperLeagueMapper } from '@/lib/league-import/adapters/sleeper/SleeperLeagueMapper'
import type { SleeperImportPayload } from '@/lib/league-import/adapters/sleeper/types'
import { resolveSettings } from '@/lib/ai/leagueSportsGroundingPacket'

/**
 * Shaped on the real `/v1/league/1335730625293844480` response — the league BUG-4 was filed
 * against. `type: 1` and `max_keepers: 2` are its actual reported values.
 */
function payload(settings: Record<string, unknown>): SleeperImportPayload {
  return {
    league: {
      league_id: '1335730625293844480',
      name: 'King Gingerbeards SF 2026!!!',
      sport: 'nfl',
      season: '2026',
      total_rosters: 12,
      roster_positions: ['QB', 'RB', 'WR', 'TE', 'SUPER_FLEX', 'BN'],
      scoring_settings: { rec: 1 },
      settings,
    },
  } as unknown as SleeperImportPayload
}

describe('BUG-4 · the Sleeper mapper captures keeper, not just dynasty', () => {
  it('type 1 (keeper) sets is_keeper and leaves isDynasty false', () => {
    const l = SleeperLeagueMapper.map(payload({ type: 1, max_keepers: 2 }))
    expect(l?.is_keeper).toBe(true)
    expect(l?.isDynasty).toBe(false)
  })

  it('type 2 (dynasty) sets isDynasty and NOT is_keeper — the two are distinct formats', () => {
    const l = SleeperLeagueMapper.map(payload({ type: 2, max_keepers: 20 }))
    expect(l?.isDynasty).toBe(true)
    expect(l?.is_keeper).toBe(false)
  })

  it('type 0 (redraft) sets neither', () => {
    const l = SleeperLeagueMapper.map(payload({ type: 0, max_keepers: 1 }))
    expect(l?.isDynasty).toBe(false)
    expect(l?.is_keeper).toBe(false)
  })

  /**
   * 🛑 THE CHECK THAT KILLED THE OBVIOUS FIX. `max_keepers` looks like the natural keeper
   * signal and is useless as one: it is >= 1 on 225/225 imported Sleeper leagues in
   * production — dynasty, redraft, guillotine, zombie and survivor alike. Deriving keeper
   * status from it would mark every league in the database a keeper league.
   */
  it('max_keepers alone NEVER implies keeper — it is a Sleeper default on every league', () => {
    for (const type of [0, 2]) {
      const l = SleeperLeagueMapper.map(payload({ type, max_keepers: 9 }))
      expect(l?.is_keeper).toBe(false)
    }
  })

  it('a missing settings.type does not fabricate a format', () => {
    const l = SleeperLeagueMapper.map(payload({ max_keepers: 2 }))
    expect(l?.is_keeper).toBe(false)
    expect(l?.isDynasty).toBe(false)
  })
})

describe('BUG-4 · the grounding packet reads the captured keeper flag', () => {
  it('settings.is_keeper is honoured', () => {
    const s = resolveSettings({ leagueType: 'redraft', settings: { is_keeper: true } })
    expect(s.isKeeper).toBe(true)
  })

  /**
   * The regression proper. Before the fix `isKeeper` tested only
   * `leagueType.includes('keeper')`, and across all 225 imported Sleeper leagues `leagueType`
   * holds exactly five values — dynasty (110), redraft (100), guillotine (12), zombie (2),
   * survivor (1). None contains the substring, so the flag could never be true for anyone.
   */
  it('🛑 a keeper league whose leagueType is "redraft" still reads as keeper', () => {
    const before = resolveSettings({ leagueType: 'redraft', settings: {} })
    expect(before.isKeeper).toBe(false)

    const after = resolveSettings({ leagueType: 'redraft', settings: { is_keeper: true } })
    expect(after.isKeeper).toBe(true)
  })

  it('keeper and dynasty stay independent — a keeper league is not reported as dynasty', () => {
    const s = resolveSettings({ leagueType: 'redraft', isDynasty: false, settings: { is_keeper: true } })
    expect(s.isKeeper).toBe(true)
    expect(s.isDynasty).toBe(false)
  })

  it('a dynasty league is not reported as keeper', () => {
    const s = resolveSettings({ leagueType: 'dynasty', isDynasty: true, settings: {} })
    expect(s.isDynasty).toBe(true)
    expect(s.isKeeper).toBe(false)
  })

  it('the leagueType substring still works, so a human-confirmed keeper type is honoured', () => {
    const s = resolveSettings({ leagueType: 'keeper', settings: {} })
    expect(s.isKeeper).toBe(true)
  })
})
