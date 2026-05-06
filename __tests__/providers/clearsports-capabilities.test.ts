import { describe, expect, it } from 'vitest'
import {
  CLEARSPORTS_NFL_CAPABILITIES,
  CLEARSPORTS_NFL_ENDPOINTS,
  CLEARSPORTS_NFL_QUERY_PARAMS,
  hasClearSportsExperienceSignal,
} from '@/lib/providers/clearSportsFieldMaps'

describe('ClearSports NFL capabilities', () => {
  it('documents NFL endpoints from screenshots', () => {
    expect(CLEARSPORTS_NFL_ENDPOINTS.playerStats).toContain('/api/v1/nfl/player-stats')
    expect(CLEARSPORTS_NFL_ENDPOINTS.teamStats).toContain('/api/v1/nfl/team-stats')
    expect(CLEARSPORTS_NFL_ENDPOINTS.injuryStats).toContain('/api/v1/nfl/injury-stats')
    expect(CLEARSPORTS_NFL_ENDPOINTS.teamById).toContain('/api/v1/nfl/teams/')
    expect(CLEARSPORTS_NFL_ENDPOINTS.games).toContain('/api/v1/nfl/games')
  })

  it('lists query params per endpoint bucket', () => {
    expect([...CLEARSPORTS_NFL_QUERY_PARAMS.playerStats]).toContain('season')
    expect([...CLEARSPORTS_NFL_QUERY_PARAMS.injuryStats]).toContain('player_id')
    expect([...CLEARSPORTS_NFL_QUERY_PARAMS.games]).toContain('date')
  })

  it('marks stats/injuries/teams/schedules supported and rookie_experience unknown', () => {
    expect(CLEARSPORTS_NFL_CAPABILITIES.player_stats).toBe('supported')
    expect(CLEARSPORTS_NFL_CAPABILITIES.injuries).toBe('supported')
    expect(CLEARSPORTS_NFL_CAPABILITIES.rookie_experience).toBe('unknown')
    expect(CLEARSPORTS_NFL_CAPABILITIES.projections).toBe('unknown')
  })

  it('hasClearSportsExperienceSignal false for stats-only payload', () => {
    expect(hasClearSportsExperienceSignal({ yards: 120, touchdowns: 2 })).toBe(false)
  })

  it('hasClearSportsExperienceSignal true when explicit draft year exists', () => {
    expect(hasClearSportsExperienceSignal({ draftYear: 2024 })).toBe(true)
  })
})
