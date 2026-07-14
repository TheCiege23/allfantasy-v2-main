import { describe, it, expect } from 'vitest'
import { deriveMatchupHighlights, type MatchupForHighlights } from '@/lib/live-scoring/matchupHighlights'

/**
 * Pure-function tests for the league-home highlight signals extracted out of
 * LeagueScoringPreviews into lib/live-scoring/matchupHighlights (Phase 4F cleanup).
 */
describe('deriveMatchupHighlights', () => {
  it('returns all-null for an empty matchup list', () => {
    expect(deriveMatchupHighlights([])).toEqual({
      topScorerName: null,
      topScorerPts: null,
      closestMatchup: null,
      upsetAlert: null,
    })
  })

  it('picks the single highest-scoring team as top scorer', () => {
    const matchups: MatchupForHighlights[] = [
      { teamName: 'Alpha', totalPoints: 88.5 },
      { teamName: 'Bravo', totalPoints: 120.2 },
      { teamName: 'Charlie', totalPoints: 99.9 },
    ]
    const h = deriveMatchupHighlights(matchups)
    expect(h.topScorerName).toBe('Bravo')
    expect(h.topScorerPts).toBe(120.2)
  })

  it('finds the closest paired matchup and dedups the mirrored row', () => {
    // Each matchup is represented by two mirrored rows (home perspective + away perspective).
    const matchups: MatchupForHighlights[] = [
      { teamName: 'Alpha', totalPoints: 100, homeTeamName: 'Alpha', awayTeamName: 'Bravo', homeScore: 100, awayScore: 97 },
      { teamName: 'Bravo', totalPoints: 97, homeTeamName: 'Alpha', awayTeamName: 'Bravo', homeScore: 100, awayScore: 97 },
      { teamName: 'Charlie', totalPoints: 80, homeTeamName: 'Charlie', awayTeamName: 'Delta', homeScore: 80, awayScore: 60 },
      { teamName: 'Delta', totalPoints: 60, homeTeamName: 'Charlie', awayTeamName: 'Delta', homeScore: 80, awayScore: 60 },
    ]
    const h = deriveMatchupHighlights(matchups)
    expect(h.closestMatchup).not.toBeNull()
    expect(h.closestMatchup!.diff).toBeCloseTo(3, 5)
    expect([h.closestMatchup!.homeTeam, h.closestMatchup!.awayTeam].sort()).toEqual(['Alpha', 'Bravo'])
  })

  it('flags an upset when the lower-win team leads by more than 2', () => {
    const matchups: MatchupForHighlights[] = [
      {
        teamName: 'Underdog',
        totalPoints: 110,
        homeTeamName: 'Underdog',
        awayTeamName: 'Favorite',
        homeScore: 110,
        awayScore: 90,
        homeRosterWins: 1,
        awayRosterWins: 6,
      },
    ]
    const h = deriveMatchupHighlights(matchups)
    expect(h.upsetAlert).not.toBeNull()
    expect(h.upsetAlert!.leaderTeam).toBe('Underdog')
    expect(h.upsetAlert!.trailingTeam).toBe('Favorite')
  })

  it('does not flag an upset when the favorite (more wins) is leading', () => {
    const matchups: MatchupForHighlights[] = [
      {
        teamName: 'Favorite',
        totalPoints: 110,
        homeTeamName: 'Favorite',
        awayTeamName: 'Underdog',
        homeScore: 110,
        awayScore: 90,
        homeRosterWins: 6,
        awayRosterWins: 1,
      },
    ]
    expect(deriveMatchupHighlights(matchups).upsetAlert).toBeNull()
  })

  it('does not flag an upset when the lead is 2 or fewer points', () => {
    const matchups: MatchupForHighlights[] = [
      {
        teamName: 'Underdog',
        totalPoints: 92,
        homeTeamName: 'Underdog',
        awayTeamName: 'Favorite',
        homeScore: 92,
        awayScore: 90,
        homeRosterWins: 1,
        awayRosterWins: 6,
      },
    ]
    expect(deriveMatchupHighlights(matchups).upsetAlert).toBeNull()
  })

  it('ignores matchups without enriched score data for closest/upset', () => {
    const matchups: MatchupForHighlights[] = [
      { teamName: 'Alpha', totalPoints: 100 },
      { teamName: 'Bravo', totalPoints: 97 },
    ]
    const h = deriveMatchupHighlights(matchups)
    expect(h.topScorerName).toBe('Alpha')
    expect(h.closestMatchup).toBeNull()
    expect(h.upsetAlert).toBeNull()
  })
})
