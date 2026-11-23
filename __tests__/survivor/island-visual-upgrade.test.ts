// @vitest-environment node
/**
 * The island visual upgrade (2026-11-23 audit): a passed deadline must read as passed, the tribe
 * page must show real scores and only the badges that set a member apart, and episodes must not
 * claim "nobody went home" for a week whose vote is still open.
 */
import { describe, expect, it } from 'vitest'

import {
  islandHeroCopy,
  islandDeadlineLabel,
  islandTribeTotals,
  islandMemberBadge,
  islandEpisodeTribalLine,
  islandSeasonLabel,
  islandExileCountLine,
} from '@/lib/survivor/survivorIslandView'

const now = Date.parse('2026-11-23T12:00:00Z')

describe('islandHeroCopy', () => {
  it('an open council with time left names the council without repeating the deadline', () => {
    const c = islandHeroCopy({ councilStatus: 'voting_open', voteEnd: now + 3 * 3600_000, now, phase: 'pre_merge' })
    expect(c.title).toBe('Tribal Council is open')
    expect(c.title).not.toMatch(/Soon|closes in/)
  })

  it('an open council past its deadline says the votes are in', () => {
    const c = islandHeroCopy({ councilStatus: 'voting_open', voteEnd: now - 60_000, now, phase: 'pre_merge' })
    expect(c.title).toBe('The votes are in')
    expect(c.voteClosed).toBe(true)
  })

  it('an open challenge past its lock is not "closing soon"', () => {
    const c = islandHeroCopy({ challengeStatus: 'open', challengeEnd: now - 1, now, phase: 'pre_merge' })
    expect(c.title).not.toMatch(/Soon|closes in/)
  })
})

describe('islandDeadlineLabel', () => {
  it('counts down while there is time and says closed once it has passed', () => {
    expect(islandDeadlineLabel(now + 90 * 60_000, now)).toBe('1h 30m left')
    expect(islandDeadlineLabel(now + 2 * 86400_000, now)).toBe('2d 0h left')
    expect(islandDeadlineLabel(now, now)).toBe('Closed')
    expect(islandDeadlineLabel(now - 5_000, now)).toBe('Closed')
  })
})

describe('islandTribeTotals', () => {
  it('adds the counted scores per tribe, the same numbers the home page shows', () => {
    const totals = islandTribeTotals([
      { userId: 'a', tribeId: 't1', finalScore: 124.6, countedTowardTribeTotal: true },
      { userId: 'b', tribeId: 't1', finalScore: 118.2, countedTowardTribeTotal: true },
      { userId: 'c', tribeId: 't1', finalScore: 50, countedTowardTribeTotal: false },
      { userId: 'd', tribeId: 't2', finalScore: 96.4, countedTowardTribeTotal: true },
    ])
    expect(totals.get('t1')).toBeCloseTo(242.8, 5)
    expect(totals.get('t2')).toBeCloseTo(96.4, 5)
  })
})

describe('islandMemberBadge', () => {
  const active = { playerState: 'active', hasImmunityThisWeek: false } as const
  it('an ordinary member carries no badge: the tribe header already says whether the tribe is at council', () => {
    expect(islandMemberBadge(active)).toBeNull()
  })
  it('only what sets a member apart gets a badge', () => {
    expect(islandMemberBadge({ ...active, hasImmunityThisWeek: true })).toBe('immune')
    expect(islandMemberBadge({ ...active, playerState: 'exile' })).toBe('exiled')
    expect(islandMemberBadge({ ...active, playerState: 'eliminated' })).toBe('eliminated')
  })
})

describe('islandEpisodeTribalLine', () => {
  const quiet = { week: 9, scenes: [{ label: 'Challenge', text: 'Manu took immunity.' }] }
  it('the current week with its vote still open says so, never "nobody went home"', () => {
    expect(islandEpisodeTribalLine(quiet, { openCouncilWeek: 9 })).toBe('The vote is still open.')
  })
  it('a past week with no Tribal scene shows no Tribal line at all', () => {
    expect(islandEpisodeTribalLine({ ...quiet, week: 8 }, { openCouncilWeek: 9 })).toBeNull()
  })
  it('a written Tribal scene is used as written', () => {
    expect(islandEpisodeTribalLine({ week: 8, scenes: [{ label: 'Tribal Council', text: 'Riley was voted out.' }] }, { openCouncilWeek: 9 })).toBe('Riley was voted out.')
    expect(islandEpisodeTribalLine({ week: 8, scenes: [{ label: 'Tribal', text: 'Riley survived 3-2.' }] }, { openCouncilWeek: 9 })).toBe('Riley survived 3-2.')
  })
})

describe('islandSeasonLabel / islandExileCountLine', () => {
  it('names the sport and week rather than a bare "Season"', () => {
    expect(islandSeasonLabel({ sport: 'NFL', week: 9, phase: 'pre_merge' })).toBe('NFL Survivor · Week 9')
    expect(islandSeasonLabel({ sport: null, week: null, phase: 'pre_draft' })).toBe('Survivor · Before the draft')
  })
  it('counts one player in the singular', () => {
    expect(islandExileCountLine(1)).toBe('1 player on Exile')
    expect(islandExileCountLine(3)).toBe('3 players on Exile')
  })
})
