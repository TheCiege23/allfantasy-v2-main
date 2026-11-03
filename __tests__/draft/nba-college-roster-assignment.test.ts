import { describe, expect, it } from 'vitest'
import { addFollowUpDraftPlayers, mergeNbaCollegeDraftPlayers } from '@/lib/live-draft-engine/RosterAssignmentService'
const college = { playerId: 'espn:ncaab:12', playerName: 'College Guard', position: 'G', team: 'School', assetType: 'c2c_college' }

describe('NBA college draft roster assignment', () => {
  it('places a college player in devy and removes it from pro slots', () => {
    const old = { players: ['pro', college.playerId], starters: [college.playerId], lineup_sections: { starters: [{ id: college.playerId, position: 'G' }], bench: [{ id: 'pro' }], devy: [] } }
    const result = mergeNbaCollegeDraftPlayers(old, [college])
    expect(result.starters).toEqual([])
    expect(result.players).toEqual(['pro', college.playerId])
    expect(result.devy).toEqual([college.playerId])
    expect(result.lineup_sections).toMatchObject({ starters: [], bench: [{ id: 'pro' }], devy: [{ id: college.playerId, position: 'G' }] })
    expect(mergeNbaCollegeDraftPlayers(result, [college])).toEqual(result)
  })
  it('adds a follow-up college pick to devy rather than the pro bench', () => {
    const old = { players: ['pro'], starters: ['pro'], lineup_sections: { starters: [{ id: 'pro', position: 'PG' }], bench: [], ir: [], taxi: [], devy: [] } }
    const result = addFollowUpDraftPlayers(old, [college], null)
    expect(result.lineup_sections).toMatchObject({ starters: [{ id: 'pro' }], bench: [], devy: [{ id: college.playerId }] })
    expect(result.players).toContain(college.playerId)
  })
  it('does not infer college status from a provider ID without a college asset type', () => {
    const old = { players: ['pro'], lineup_sections: { devy: [] } }
    expect(mergeNbaCollegeDraftPlayers(old, [{ ...college, assetType: 'player' }])).toBe(old)
  })
})
