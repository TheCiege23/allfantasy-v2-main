import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/env/sports-media-keys', () => ({ getTheSportsDbApiKeyOrFallback: () => '123' }))
import { theSportsDbProvider } from '@/lib/workers/providers/thesportsdb'

const fixture = (name: string) => JSON.parse(readFileSync(`contracts/thesportsdb/fixtures/${name}`, 'utf8')).response
const player = fixture('v1.lookupplayer.NFL.json').players[0]
const teams = fixture('v1.search_all_teams.NFL.json').teams
beforeEach(() => vi.restoreAllMocks())

describe('TheSportsDB NFL/NBA artwork adapter', () => {
  it('maps the measured NFL headshot from either player response key', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ players: [player] })))
    const profile = await theSportsDbProvider.fetch({ sport: 'NFL', dataType: 'players', query: { search: 'Jalen Hurts' } }) as Array<{ imageUrl: string }>
    expect(profile[0]?.imageUrl).toContain('r2.thesportsdb.com/images/media/player/')
    const headshot = await theSportsDbProvider.fetch({ sport: 'NFL', dataType: 'player_headshots', query: { search: 'Jalen Hurts', teamCode: 'PHI' } }) as { headshotUrl: string }
    expect(headshot.headshotUrl).toContain('r2.thesportsdb.com/images/media/player/')
  })
  it('returns the measured Arizona team badge and never substitutes a different club', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ teams })))
    const logo = await theSportsDbProvider.fetch({ sport: 'NFL', dataType: 'team_logos', query: { teamCode: 'ARI' } }) as { logoUrl: string; teamName: string }
    expect(logo.teamName).toBe('Arizona Cardinals')
    expect(logo.logoUrl).toContain('r2.thesportsdb.com/images/media/team/')
    expect(request.mock.calls[0]![0]).toContain('search_all_teams.php?l=NFL')
    expect(await theSportsDbProvider.fetch({ sport: 'NFL', dataType: 'team_logos', query: { teamCode: 'XYZ' } })).toBeNull()
  })
  it('recognizes NBA basketball artwork shapes without claiming full NBA coverage', async () => {
    const nbaPlayer = { ...player, idPlayer: 'nba-1', strPlayer: 'Pilot Player', strSport: 'Basketball', strTeamShort: 'BOS' }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ player: [nbaPlayer] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ teams: [{ idTeam: 'nba-team', strTeam: 'Boston Celtics', strTeamShort: 'BOS', strBadge: 'https://www.thesportsdb.com/images/media/team/badge/test.png' }] })))
    const headshot = await theSportsDbProvider.fetch({ sport: 'NBA', dataType: 'player_headshots', query: { search: 'Pilot Player', teamCode: 'BOS' } }) as { headshotUrl: string }
    const logo = await theSportsDbProvider.fetch({ sport: 'NBA', dataType: 'team_logos', query: { teamCode: 'BOS' } }) as { logoUrl: string }
    expect(headshot.headshotUrl).toContain('r2.thesportsdb.com')
    expect(logo.logoUrl).toContain('r2.thesportsdb.com')
  })
})
