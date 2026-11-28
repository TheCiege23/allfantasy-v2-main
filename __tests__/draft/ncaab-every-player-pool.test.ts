/**
 * A college basketball draft offers every current Division I player, not the top ~2,400
 * (lib/draft-room/getResolvedDraftPoolForLeague.ts, owner decision 2026-11-28).
 */
import { describe, expect, it } from 'vitest'
import {
  draftPoolFetchLimit,
  draftPoolMergeCap,
  NCAAB_EVERY_PLAYER_POOL_LIMIT,
} from '@/lib/draft-room/getResolvedDraftPoolForLeague'

const DIVISION_I_ROSTER_ATHLETES = 5_526 // ESPN's 361 rosters, production 2026-11-28

describe('NCAAB draft pool size', () => {
  it('reads past every Division I player at the draft room default (limit 300)', () => {
    expect(draftPoolFetchLimit('NCAAB', 300)).toBeGreaterThan(DIVISION_I_ROSTER_ATHLETES)
    // The old 300 x 8 = 2,400 is what left 1,590 players out.
    expect(draftPoolFetchLimit('NCAAB', 300)).not.toBe(2_400)
  })
  it('does not depend on the requested limit', () => {
    expect(draftPoolFetchLimit('NCAAB', 1)).toBe(NCAAB_EVERY_PLAYER_POOL_LIMIT)
    expect(draftPoolFetchLimit('NCAAB', 500)).toBe(NCAAB_EVERY_PLAYER_POOL_LIMIT)
  })
  it('merges as many rows as it reads, so the extra players are not dropped again', () => {
    expect(draftPoolMergeCap('NCAAB', 300)).toBeGreaterThanOrEqual(draftPoolFetchLimit('NCAAB', 300))
  })
})

describe('every other sport keeps its size', () => {
  it.each([
    ['NBA', 300, 2_400],
    ['NHL', 300, 2_400],
    ['MLB', 500, 4_000],
    ['SOCCER', 1, 1_600],
    ['NCAAF', 600, 4_500],
    ['NFL', 300, 16_000],
    ['NFL', 2_000, 24_000],
  ])('%s at limit %i reads %i rows', (sport, limit, expected) => {
    expect(draftPoolFetchLimit(sport, limit)).toBe(expected)
  })
  it.each(['NBA', 'NFL', 'NCAAF'])('%s merge cap is unchanged', (sport) => {
    expect(draftPoolMergeCap(sport, 300)).toBe(6_000)
    expect(draftPoolMergeCap(sport, 1_000)).toBe(14_000)
  })
})
