// @vitest-environment node
/**
 * Why a claimed team is off the Matchup board. Measured on production 2026-09-28: the board said
 * "8 carry a roster id we cannot match to a schedule — our gap, not theirs", and none of the 8 was
 * our gap — 7 native leagues still in setup, and 1 second claimed copy of a Fantrax league whose
 * other copy was already ranked.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { classifyUnplaced } from '@/lib/core-app/matchupPulse'

type Claim = { id: string; league: { platform: string; platformLeagueId: string; status: string | null; lifecycleState: string | null } }
const claim = (id: string, platform: string, plid: string, status: string | null, lifecycleState: string | null = status): Claim => ({
  id,
  league: { platform, platformLeagueId: plid, status, lifecycleState },
})

describe('classifyUnplaced', () => {
  it('reproduces the audited account: nothing is "our gap"', () => {
    const fantraxRanked = claim('fx-numeric', 'fantrax', 'FX-1', 'in_season')
    const fantraxCopy = claim('fx-slug', 'fantrax', 'FX-1', 'in_season')
    const natives = [
      ...Array.from({ length: 6 }, (_, i) => claim(`n${i}`, 'manual', `AF-${i}`, 'setup')),
      claim('n6', 'manual', 'AF-6', 'setup', 'post_draft'),
    ]
    const claimed = [fantraxRanked, fantraxCopy, ...natives]
    expect(classifyUnplaced(claimed, [fantraxRanked])).toEqual({ unidentifiedRoster: 0, notStarted: 7 })
  })

  it('still reports a genuinely unmatchable roster in a live league as our gap', () => {
    const live = claim('espn-swid', 'espn', 'E-9', 'in_season')
    expect(classifyUnplaced([live], [])).toEqual({ unidentifiedRoster: 1, notStarted: 0 })
  })

  it('treats the same league id on another platform as a different league', () => {
    const sleeper = claim('s', 'sleeper', 'X', 'in_season')
    const espn = claim('e', 'espn', 'X', 'in_season')
    expect(classifyUnplaced([sleeper, espn], [sleeper])).toEqual({ unidentifiedRoster: 1, notStarted: 0 })
  })
})
