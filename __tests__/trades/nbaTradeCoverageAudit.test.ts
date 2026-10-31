import { describe, expect, it } from 'vitest'

const { summarize, leagueHasPointsRules } = require('../../scripts/audits/nba-trade-coverage.cjs')

describe('NBA trade coverage audit', () => {
  it('separates a usable identity from an extra-column bridge and an unresolved starter', () => {
    const rows = [{ platform: 'fantrax', leagueId: 'league', pointsReady: true,
      rosterCount: 1, ids: ['fx-one', 'sports-two', 'missing'], starterIds: ['fx-one', 'missing'] }]
    const identities = [
      { id: 'one', fantraxId: 'fx-one', position: 'PG' },
      { id: 'two', apiSportsId: 'sports-two', position: null },
    ]
    const report = summarize(rows, identities, [{ playerId: 'fx-one' }], [])
    expect(report.fantrax).toMatchObject({
      teams: 1, rosterMatched: 1, rosterPlayers: 3,
      identityCurrent: 1, identityExtraOnly: 1, identityMissing: 1,
      missingStarterIdentities: 1, positionMissing: 1, seasonMissing: 1,
    })
  })

  it('accepts an explicit points mode with numeric rules and refuses an unknown mode', () => {
    const league = { scoring: null, settings: { scoringSettings: { format: 'custom',
      scoringMode: 'head-to-head points', rules: { points: 1 } } } }
    expect(leagueHasPointsRules(league)).toBe(false)
    expect(leagueHasPointsRules({ ...league, settings: { scoringSettings: {
      scoringMode: 'h2h_points', rules: { points: 1 },
    } } })).toBe(true)
  })
})
