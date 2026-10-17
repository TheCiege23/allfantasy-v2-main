import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { auditSeasonPeriodPlayerBoxes } from '@/lib/tournament/seasonPeriodBoxAudit'
import { defaultSeasonRules } from '@/lib/tournament/seasonRules'

const fixture = JSON.parse(readFileSync('contracts/rolling-insights/fixtures/live.NBA.json', 'utf8')).data.NBA[0] as Record<string, unknown>
const supportedRules = () => {
  const rules = defaultSeasonRules('NBA', 'nba_points')
  rules.weights = rules.weights.filter(weight => ['points', 'rebounds', 'assists', 'double_double'].includes(weight.statKey))
  return rules
}
const audit = (raw: Record<string, unknown>) => auditSeasonPeriodPlayerBoxes({ sport: 'NBA', rules: supportedRules(), rawGames: new Map([['game-1', raw]]) })

describe('measured NBA player-box preflight', () => {
  it('extracts the measured side/player map without claiming drafted-player coverage', () => {
    const report = audit(fixture)
    expect(report).toMatchObject({ measuredSport: true, gamesWithPlayerBoxes: 1, missingBoxGameIds: [], malformedBoxGameIds: [], duplicatePlayerGameIds: [], invalidWeightedBoxGameIds: [], draftedPlayerCoverageVerified: false })
    expect(report.providerPlayerRows).toBeGreaterThan(10)
  })
  it('keeps frozen default foul penalties unscorable from the NBA box', () => {
    const report = auditSeasonPeriodPlayerBoxes({ sport: 'NBA', rules: defaultSeasonRules('NBA', 'nba_points'), rawGames: new Map([['game-1', fixture]]) })
    expect(report.unscorableWeightedStats).toEqual(['flagrant_foul', 'technical_foul'])
    expect(report.draftedPlayerCoverageVerified).toBe(false)
    const sides = fixture.player_box as Record<string, Record<string, unknown>>
    const playerId = Object.keys(sides.away_team!)[0]!
    const broken = { player_box: { away_team: { ...sides.away_team, [playerId]: { ...(sides.away_team![playerId] as object), points: '0' } }, home_team: sides.home_team } }
    expect(auditSeasonPeriodPlayerBoxes({ sport: 'NBA', rules: defaultSeasonRules('NBA', 'nba_points'), rawGames: new Map([['game-1', broken]]) }).invalidWeightedBoxGameIds).toEqual(['game-1'])
  })
  it('reports missing, malformed, duplicate, and invalid weighted lines', () => {
    expect(audit({ player_box: null }).missingBoxGameIds).toEqual(['game-1'])
    expect(audit({ player_box: { away_team: [], home_team: {} } }).malformedBoxGameIds).toEqual(['game-1'])
    const sides = fixture.player_box as Record<string, Record<string, unknown>>
    const playerId = Object.keys(sides.away_team!)[0]!
    expect(audit({ player_box: { away_team: sides.away_team, home_team: { ...sides.home_team, [playerId]: sides.away_team![playerId] } } }).duplicatePlayerGameIds).toEqual(['game-1'])
    expect(audit({ player_box: { away_team: { [playerId]: { points: '0' } }, home_team: { other: { points: 0 } } } }).invalidWeightedBoxGameIds).toEqual(['game-1'])
  })
  it('does not infer an NFL box contract from the NBA fixture', () => {
    const report = auditSeasonPeriodPlayerBoxes({ sport: 'NFL', rules: defaultSeasonRules('NFL', 'ppr'), rawGames: new Map([['game-1', fixture]]) })
    expect(report).toMatchObject({ measuredSport: false, gamesWithPlayerBoxes: 0, providerPlayerRows: 0, draftedPlayerCoverageVerified: false })
  })
})
