/**
 * College football and soccer boards rank by AF projection, and soccer shows clubs, not ids (2026-11-27).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { normalizeDraftPlayer } from '@/lib/draft-sports-models/normalize-draft-player'
import { applySoccerClubNames } from '@/lib/draft-room/draftPoolTeamLogos'

const raw = (sport: string) => ({ name: 'Player', position: 'QB', team: 'University of Oregon', afProjectionPerGame: 14.234, sport })

describe('AF projection reaches the board for every sport that attaches one', () => {
  it.each(['NCAAF', 'SOCCER', 'MLB', 'NHL', 'NCAAB'])('%s', (sport) => {
    const entry = normalizeDraftPlayer(raw(sport) as never, sport as never)
    expect(entry.display?.stats?.projectedPointsPerGame).toBe(14.23)
  })
})

describe('applySoccerClubNames', () => {
  const entry = () => ({
    team: '17',
    display: { team: { displayName: '17', abbreviation: '17', logoUrl: 'x' }, metadata: { teamAffiliation: '17', teamAbbreviation: '17' } },
  })
  it('names the club on what the board shows, and leaves the stored id alone', () => {
    const [e] = applySoccerClubNames([entry()] as never, new Map([['17', { name: 'Tottenham Hotspur', shortName: 'TOT' }]])) as never as ReturnType<typeof entry>[]
    expect(e.display.team).toMatchObject({ displayName: 'Tottenham Hotspur', abbreviation: 'TOT', logoUrl: 'x' })
    expect(e.display.metadata).toMatchObject({ teamAffiliation: 'Tottenham Hotspur', teamAbbreviation: 'TOT' })
    expect(e.team).toBe('17')
  })
  it('leaves an unknown id and a named team as they are', () => {
    const [a, b] = applySoccerClubNames([entry(), { ...entry(), team: 'Arsenal' }] as never, new Map([['99', { name: 'X', shortName: null }]])) as never as ReturnType<typeof entry>[]
    expect(a.display.team.displayName).toBe('17')
    expect(b.display.team.displayName).toBe('17')
  })
})
