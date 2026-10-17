// @vitest-environment node
/**
 * The follow prompt opens on College Football for college fans (owner's call, 2026-10-03), judged
 * from the league list the shell already holds; NFL otherwise.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { teamFollowPromptSport } from '@/lib/follows/teamFollowPromptSport'

describe('teamFollowPromptSport', () => {
  it('a college football league → College Football, whatever the case of the sport field', () => {
    expect(teamFollowPromptSport([{ sport: 'NFL' }, { sport: 'NCAAF' }])).toBe('NCAAF')
    expect(teamFollowPromptSport([{ sport: 'ncaaf' }])).toBe('NCAAF')
  })

  it('a devy or campus-to-canton league counts — by variant or by league type', () => {
    expect(teamFollowPromptSport([{ sport: 'NFL', leagueVariant: 'devy_dynasty' }])).toBe('NCAAF')
    expect(teamFollowPromptSport([{ sport: 'NFL', leagueVariant: 'merged_devy_c2c' }])).toBe('NCAAF')
    expect(teamFollowPromptSport([{ sport: 'NFL', leagueType: 'C2C' }])).toBe('NCAAF')
    expect(teamFollowPromptSport([{ sport: 'NFL', leagueType: 'devy' }])).toBe('NCAAF')
  })

  it('pro leagues only, or none at all → NFL, the prompt’s default', () => {
    expect(teamFollowPromptSport([{ sport: 'NFL', leagueType: 'dynasty' }, { sport: 'NBA', leagueVariant: 'big_brother' }])).toBe('NFL')
    expect(teamFollowPromptSport([])).toBe('NFL')
    expect(teamFollowPromptSport([{ sport: null, leagueType: null, leagueVariant: null }])).toBe('NFL')
  })
})
