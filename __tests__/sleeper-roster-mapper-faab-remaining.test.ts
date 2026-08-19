/**
 * Tier 0 — SleeperRosterMapper.faab_remaining unit tests.
 *
 * Prior behavior: `faab_remaining` was always null with a comment claiming the
 * league total was unavailable. Runtime audit proved the total IS available on
 * the same payload. This test locks in the corrected computation.
 */
import { describe, expect, it } from 'vitest'

import { SleeperRosterMapper } from '@/lib/league-import/adapters/sleeper/SleeperRosterMapper'
import type { SleeperImportPayload } from '@/lib/league-import/adapters/sleeper/types'

function payloadWith(
  budget: number | null,
  rosterWaiverBudgetUsed: number | null,
): SleeperImportPayload {
  return {
    league: {
      league_id: '1',
      name: 'x',
      sport: 'nfl',
      season: '2026',
      total_rosters: 1,
      roster_positions: [],
      settings:
        budget === null
          ? ({} as SleeperImportPayload['league']['settings'])
          : ({ waiver_budget: budget } as unknown as SleeperImportPayload['league']['settings']),
    },
    users: [
      { user_id: 'u1', username: 'u1', display_name: 'u1', is_owner: false } as SleeperImportPayload['users'][number],
    ],
    rosters: [
      {
        roster_id: 1,
        owner_id: 'u1',
        players: [],
        settings:
          rosterWaiverBudgetUsed === null
            ? {}
            : { waiver_budget_used: rosterWaiverBudgetUsed },
      } as unknown as SleeperImportPayload['rosters'][number],
    ],
  }
}

describe('SleeperRosterMapper — faab_remaining computation', () => {
  it('200 budget - 3 used = 197', () => {
    const r = SleeperRosterMapper.map(payloadWith(200, 3))[0]
    expect(r.faab_remaining).toBe(197)
  })

  it('200 budget - 0 used = 200', () => {
    const r = SleeperRosterMapper.map(payloadWith(200, 0))[0]
    expect(r.faab_remaining).toBe(200)
  })

  it('clamps negative to 0 (over-spent, e.g. deducted after roll)', () => {
    const r = SleeperRosterMapper.map(payloadWith(100, 250))[0]
    expect(r.faab_remaining).toBe(0)
  })

  it('returns null when budget missing (legacy provider)', () => {
    const r = SleeperRosterMapper.map(payloadWith(null, 3))[0]
    expect(r.faab_remaining).toBeNull()
  })

  it('returns null when waiver_budget_used missing on roster', () => {
    const r = SleeperRosterMapper.map(payloadWith(200, null))[0]
    expect(r.faab_remaining).toBeNull()
  })

  it('accepts string values in the payload (Sleeper occasionally serializes as strings)', () => {
    const p = payloadWith(200, 0)
    // Force stringified inputs like some Sleeper responses
    ;(p.league.settings as unknown as Record<string, unknown>).waiver_budget = '200'
    ;(p.rosters![0].settings as unknown as Record<string, unknown>).waiver_budget_used = '17'
    const r = SleeperRosterMapper.map(p)[0]
    expect(r.faab_remaining).toBe(183)
  })
})
