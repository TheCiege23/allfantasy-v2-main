import { describe, expect, it } from 'vitest'
import { selectKickoffLeague } from '@/lib/core-app/kickoffContext'

const urgentNfl = { id: 'nfl', sport: 'NFL' }
const college = { id: 'college', sport: 'NCAAF' }
describe('kickoff roster context', () => {
  it('a college kickoff does not open the most urgent NFL roster', () => {
    expect(selectKickoffLeague('NCAAF', [urgentNfl, college])).toBe(college)
  })
  it('retains priority among leagues in the game’s sport', () => {
    expect(selectKickoffLeague('NFL', [college, urgentNfl, { id: 'quiet', sport: 'NFL' }])).toBe(urgentNfl)
  })
  it('can select a quiet same-sport league when no same-sport league needs attention', () => {
    expect(selectKickoffLeague(' ncaaf ', [urgentNfl, college])).toBe(college)
  })
  it('falls back instead of routing to an unrelated sport', () => {
    expect(selectKickoffLeague('NCAAF', [urgentNfl])).toBeNull()
    expect(selectKickoffLeague(null, [urgentNfl])).toBeNull()
  })
})
