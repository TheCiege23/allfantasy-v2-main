/**
 * 🛑 A HOSTED NBA ROSTER SHOWED NO PHOTOS AND NO CRESTS (owner report, 2026-11-24). Two causes, measured on
 * production: the roster API returned `headshotUrl: null` for every player, and every crest was built from
 * the full club name — `…/nba/500/denver nuggets.png`, a 404.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const resolver = vi.hoisted(() => ({ calls: [] as Array<{ sport: string; ids: string[] }> }))
vi.mock('@/lib/draft-room/storedPickHeadshot', () => ({
  resolveStoredHeadshotsBatch: vi.fn(async (sport: string, players: Array<{ playerId: string }>) => {
    resolver.calls.push({ sport, ids: players.map((p) => p.playerId) })
    return new Map(players.filter((p) => p.playerId !== 'unknown').map((p) => [p.playerId, `https://img/${p.playerId}.png`]))
  }),
}))

import { getPrimaryLogoUrlForTeam } from '@/lib/sport-teams/SportTeamMetadataRegistry'
import { getTeamLogo } from '@/lib/players/getTeamLogo'
import { fillStoredHeadshots } from '@/lib/player-media/fillStoredHeadshots'

describe('team crest from a full club name', () => {
  it('🛑 "Denver Nuggets" builds the Nuggets crest, never a URL with the name in it', () => {
    for (const team of ['Denver Nuggets', 'DEN', 'Nuggets', 'denver nuggets']) {
      const url = getPrimaryLogoUrlForTeam('NBA', team)
      expect(url, team).toMatch(/den\.png$/)
      expect(url).not.toMatch(/ /)
    }
  })
  it('the names whose code differs from the obvious one still resolve', () => {
    expect(getPrimaryLogoUrlForTeam('NBA', 'Golden State Warriors')).toBe(getPrimaryLogoUrlForTeam('NBA', 'GSW'))
    expect(getPrimaryLogoUrlForTeam('NBA', 'Portland Trail Blazers')).toBe(getPrimaryLogoUrlForTeam('NBA', 'POR'))
    expect(getPrimaryLogoUrlForTeam('NBA', 'LA Clippers')).toBe(getPrimaryLogoUrlForTeam('NBA', 'LAC'))
    expect(getPrimaryLogoUrlForTeam('NBA', 'Los Angeles Lakers')).toBe(getPrimaryLogoUrlForTeam('NBA', 'LAL'))
    expect(getPrimaryLogoUrlForTeam('MLB', 'Chicago White Sox')).toBe(getPrimaryLogoUrlForTeam('MLB', 'CWS'))
    expect(getPrimaryLogoUrlForTeam('NHL', 'Toronto Maple Leafs')).toBe(getPrimaryLogoUrlForTeam('NHL', 'TOR'))
  })
  it('an ambiguous nickname or a short code is never guessed as a name', () => {
    // "Los Angeles" alone is two NBA clubs: no crest rather than the wrong one.
    expect(getPrimaryLogoUrlForTeam('NBA', 'Los Angeles')).not.toBe(getPrimaryLogoUrlForTeam('NBA', 'LAL'))
    expect(getPrimaryLogoUrlForTeam('NBA', 'BOS')).toMatch(/bos\.png$/)
  })
  it('every surface that reads `getTeamLogo` gets the fixed crest', () => {
    expect(getTeamLogo('Toronto Raptors', 'NBA')).toBe(getTeamLogo('TOR', 'NBA'))
    expect(getTeamLogo('Toronto Raptors', 'NBA')).not.toMatch(/ /)
  })
})

describe('fillStoredHeadshots', () => {
  it('🛑 fills a missing photo from the stored row, and only where one is missing', async () => {
    resolver.calls.length = 0
    const rows = [
      { id: '114', name: 'Nikola Jokic', team: 'Denver Nuggets', headshotUrl: null, imageUrl: null },
      { id: '1586', name: 'Victor Wembanyama', team: 'San Antonio Spurs', headshotUrl: 'https://have.png', imageUrl: 'https://have.png' },
      { id: 'unknown', name: 'Nobody', team: null, headshotUrl: null, imageUrl: null },
    ]
    const out = await fillStoredHeadshots('NBA', rows)
    expect(out[0]).toMatchObject({ headshotUrl: 'https://img/114.png', imageUrl: 'https://img/114.png' })
    expect(out[1]!.headshotUrl).toBe('https://have.png')
    expect(out[2]!.headshotUrl).toBeNull()
    // Only the rows without a photo were looked up.
    expect(resolver.calls).toEqual([{ sport: 'NBA', ids: ['114', 'unknown'] }])
  })
  it('leaves the NFL alone (its ids are Sleeper ids with their own headshot)', async () => {
    resolver.calls.length = 0
    const rows = [{ id: '4046', name: 'Patrick Mahomes', headshotUrl: null }]
    expect(await fillStoredHeadshots('NFL', rows)).toEqual(rows)
    expect(resolver.calls).toEqual([])
  })
})
