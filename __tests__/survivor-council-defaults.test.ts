import { describe, expect, it } from 'vitest'
import { survivorCouncilDefaultsForSport } from '@/lib/survivor/survivorCouncilDefaults'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'
import { buildSurvivorSettingsSnapshot } from '@/lib/league-concepts/survivorDefaults'

/** Council rules a new league starts with (owner's call, 2026-10-20). */
describe('council defaults', () => {
  it('follow the sport schedule: NFL on Tuesday evening, the daily sports on Monday, in Eastern time', () => {
    expect(survivorCouncilDefaultsForSport('NFL')).toMatchObject({ tribalCouncilDay: 'Tuesday', tribalCouncilTime: '19:00', voteCloseOffset: 24 })
    expect(survivorCouncilDefaultsForSport('NBA')).toMatchObject({ tribalCouncilDay: 'Monday', tribalCouncilTime: '19:00' })
    expect(survivorCouncilDefaultsForSport('NHL').tribalCouncilDay).toBe('Monday')
    expect(survivorCouncilDefaultsForSport('MLB').tribalCouncilDay).toBe('Monday')
    expect(survivorCouncilDefaultsForSport('NCAAF').tribalCouncilDay).toBe('Sunday')
  })

  it('start every league on revote-then-rocks, ballots changeable until close, and auto-cast missing ballots', () => {
    for (const sport of ['NFL', 'NBA', 'NHL', 'MLB']) {
      expect(survivorCouncilDefaultsForSport(sport)).toMatchObject({ tieRule: 'revote_then_rocks', voteChangePolicy: 'allow_until_close', nonVoterAutoCast: true })
    }
    expect(normalizeSurvivorFoundationSettings(null)).toMatchObject({ tieRule: 'revote_then_rocks', voteChangePolicy: 'allow_until_close', nonVoterAutoCast: true })
  })

  it('keep the two legacy season-points rules readable and fall back to revote-then-rocks for anything else', () => {
    expect(normalizeSurvivorFoundationSettings({ tieRule: 'season_points_only' }).tieRule).toBe('season_points_only')
    expect(normalizeSurvivorFoundationSettings({ tieRule: 'revote_then_season_points' }).tieRule).toBe('revote_then_season_points')
    expect(normalizeSurvivorFoundationSettings({ tieRule: 'rocks_immediately' }).tieRule).toBe('rocks_immediately')
    expect(normalizeSurvivorFoundationSettings({ tieRule: 'coin_flip' }).tieRule).toBe('revote_then_rocks')
    expect(normalizeSurvivorFoundationSettings({ nonVoterAutoCast: false }).nonVoterAutoCast).toBe(false)
  })

  it('are written into a new league\'s settings snapshot at creation', () => {
    const nba = buildSurvivorSettingsSnapshot({ sport: 'NBA' })
    expect(nba?.survivorFoundationSettings).toMatchObject({ tribalCouncilDay: 'Monday', tribalCouncilTime: '19:00', tieRule: 'revote_then_rocks', voteChangePolicy: 'allow_until_close', nonVoterAutoCast: true })
    const nfl = buildSurvivorSettingsSnapshot({ sport: 'NFL' })
    expect(nfl?.survivorFoundationSettings).toMatchObject({ tribalCouncilDay: 'Tuesday' })
  })
})
