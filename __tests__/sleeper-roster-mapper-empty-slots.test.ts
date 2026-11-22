/**
 * 🛑 AN EMPTY SLEEPER STARTING SLOT KEEPS ITS PLACE.
 *
 * Sleeper's `starters` is positional — index i is `roster_positions[i]` — and an unfilled slot is
 * the marker `"0"`. The mapper filtered the markers out, so every starter AFTER a hole moved up one
 * slot: with QB/RB/WR/TE and an empty RB, the WR rendered in the RB slot, the TE in the WR slot, and
 * the lineup looked complete. My Team, the matchup board and commissioner health all read `"0"` as an
 * empty slot already; they only needed the marker to survive import.
 */
import { describe, expect, it } from 'vitest'

import { SleeperRosterMapper } from '@/lib/league-import/adapters/sleeper/SleeperRosterMapper'
import type { SleeperImportPayload } from '@/lib/league-import/adapters/sleeper/types'
import { emptyStarterSlots } from '@/lib/core-app/commissioner/health'

function payload(starters: unknown[] | undefined): SleeperImportPayload {
  return {
    league: {
      league_id: '1',
      name: 'x',
      sport: 'nfl',
      season: '2026',
      total_rosters: 1,
      roster_positions: ['QB', 'RB', 'WR', 'TE', 'BN'],
      settings: {} as SleeperImportPayload['league']['settings'],
    },
    users: [{ user_id: 'u1', username: 'u1', display_name: 'u1', is_owner: false } as NonNullable<SleeperImportPayload['users']>[number]],
    rosters: [
      {
        roster_id: 1,
        owner_id: 'u1',
        players: ['qb', 'wr', 'te', 'bench'],
        starters,
        settings: {},
      } as unknown as NonNullable<SleeperImportPayload['rosters']>[number],
    ],
  } as unknown as SleeperImportPayload
}

const startersOf = (starters: unknown[] | undefined) => SleeperRosterMapper.map(payload(starters))[0].starter_ids

describe('SleeperRosterMapper — empty starting slots', () => {
  it('🛑 keeps an empty slot in position, so the starters after it stay in their own slots', () => {
    const ids = startersOf(['qb', '0', 'wr', 'te'])
    expect(ids).toEqual(['qb', '0', 'wr', 'te'])
    // Index 2 is the league's WR slot and holds the WR — not the TE shifted up a slot.
    expect(ids[2]).toBe('wr')
  })

  it('a missing/blank slot is the same empty marker, never a player id', () => {
    expect(startersOf(['qb', null, '', 'te'])).toEqual(['qb', '0', '0', 'te'])
  })

  it('the empty slot is not a player: it is counted as empty and never joins player_ids', () => {
    const [roster] = SleeperRosterMapper.map(payload(['qb', '0', 'wr', 'te']))
    expect(roster.player_ids).not.toContain('0')
    expect(emptyStarterSlots(roster.starter_ids, 4)).toBe(1)
  })

  it('control: a full lineup and an absent one are unchanged', () => {
    expect(startersOf(['qb', 'rb', 'wr', 'te'])).toEqual(['qb', 'rb', 'wr', 'te'])
    expect(startersOf(undefined)).toEqual([])
  })
})
