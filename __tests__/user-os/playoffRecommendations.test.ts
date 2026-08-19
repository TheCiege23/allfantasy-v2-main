import { describe, expect, it } from 'vitest'
import { generatePlayoffRecommendations } from '@/lib/shared-services/league-hub/generators/playoffRecommendations'
import { baseContext, standing } from './fixtures'

const NOW = '2026-07-13T00:00:00.000Z'

describe('generatePlayoffRecommendations', () => {
  it('uses a real SeasonForecastSnapshot when one exists and is fresh enough', () => {
    const context = baseContext({
      currentWeek: 6,
      latestForecastWeek: 5,
      playoffForecastByTeamId: new Map([['team-1', { playoffProbability: 0.72, expectedFinalSeed: 3.2 }]]),
    })
    const recs = generatePlayoffRecommendations(context, NOW)
    expect(recs).toHaveLength(1)
    expect(recs[0].type).toBe('playoff_probability')
    expect(recs[0].summary).toContain('72%')
  })

  it('treats an old snapshot as stale and falls back to the qualitative path (no fabricated numeric probability)', () => {
    const context = baseContext({
      currentWeek: 10,
      latestForecastWeek: 3,
      playoffForecastByTeamId: new Map([['team-1', { playoffProbability: 0.72, expectedFinalSeed: 3.2 }]]),
      playoffTeams: 6,
      standings: [standing({ teamId: 'team-1', wins: 5, isViewerTeam: true })],
    })
    const recs = generatePlayoffRecommendations(context, NOW)
    expect(recs[0]?.type).toBe('playoff_position_qualitative')
    expect(recs[0]?.summary).not.toMatch(/%/)
  })

  it('uses real league playoff settings, never assuming 6 teams by default', () => {
    const viewer = standing({ teamId: 'team-1', wins: 3, isViewerTeam: true })
    const context = baseContext({
      playoffTeams: 2,
      viewerTeam: viewer,
      standings: [
        viewer,
        standing({ teamId: 'team-2', wins: 8, isViewerTeam: false }),
        standing({ teamId: 'team-3', wins: 6, isViewerTeam: false }),
      ],
    })
    const recs = generatePlayoffRecommendations(context, NOW)
    expect(recs[0]?.summary).toContain('2-team')
  })

  it('reports genuinely unavailable (empty) when playoffTeams is not configured at all', () => {
    const context = baseContext({ playoffTeams: null, playoffForecastByTeamId: null })
    const recs = generatePlayoffRecommendations(context, NOW)
    expect(recs).toEqual([])
  })

  it('returns nothing without a viewer team', () => {
    const context = baseContext({ viewerTeam: null, teamId: null })
    const recs = generatePlayoffRecommendations(context, NOW)
    expect(recs).toEqual([])
  })
})
