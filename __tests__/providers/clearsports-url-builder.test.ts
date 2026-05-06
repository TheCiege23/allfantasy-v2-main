import { describe, expect, it } from 'vitest'
import { buildClearSportsNflUrl } from '@/lib/providers/clearSportsUrls'

describe('buildClearSportsNflUrl', () => {
  it('builds player-stats URL with supplied filters', () => {
    const u = buildClearSportsNflUrl('player_stats', {
      season: 2025,
      week: 3,
      playerId: 'p1',
      teamId: 'KC',
      gameId: 'g99',
    })
    expect(u).toContain('/api/v1/nfl/player-stats')
    expect(u).toContain('season=2025')
    expect(u).toContain('week=3')
    expect(u).toContain('player_id=p1')
    expect(u).toContain('team_id=KC')
    expect(u).toContain('game_id=g99')
  })

  it('builds team by id path', () => {
    const u = buildClearSportsNflUrl('team_by_id', { teamId: 'BUF' })
    expect(u).toContain('/api/v1/nfl/teams/BUF')
    expect(u).not.toContain('team_id=')
  })

  it('omits unset query params', () => {
    const u = buildClearSportsNflUrl('games', { season: 2025 })
    expect(u).toContain('season=2025')
    expect(u).not.toContain('week=')
    expect(u).not.toContain('team_id=')
  })
})
