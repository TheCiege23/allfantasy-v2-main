const test = require('node:test')
const assert = require('node:assert/strict')
const { seasonStats, planLinks } = require('../../scripts/sync-fantrax-nba-trade-data.cjs')

test('NBA season rows require games and every stat in the public points rules', () => {
  const row = { player_id: 123, player: 'Player One', regular_season: {
    games_played: 7, points: 100, total_rebounds: 30, assists: 20,
    steals: 5, blocks: 0, turnovers: 10,
  } }
  assert.equal(seasonStats(row)?.gamesPlayed, 7)
  assert.equal(seasonStats({ ...row, regular_season: { ...row.regular_season, steals: null } }), null)
  assert.equal(seasonStats({ ...row, regular_season: { ...row.regular_season, games_played: 0 } }), null)
})

test('Fantrax links require a unique roster name and matching provider identity', () => {
  const identities = [
    { id: 'one', canonicalName: 'Player One', rollingInsightsId: 'ri-one', fantraxId: null },
    { id: 'two', canonicalName: 'Player Two', rollingInsightsId: 'ri-two', fantraxId: 'other-id' },
    { id: 'three', canonicalName: 'Player Three', rollingInsightsId: 'ri-three', fantraxId: null },
    { id: 'four', canonicalName: 'Player Three', rollingInsightsId: 'ri-four', fantraxId: null },
  ]
  const directory = { a: { name: 'One, Player' }, b: { name: 'Two, Player' },
    c: { name: 'Three, Player' }, d: { name: 'Four, Player' } }
  const rows = [{ player_id: 'ri-one', player: 'Player One' },
    { player_id: 'ri-two', player: 'Player Two' }]
  const plan = planLinks(['a', 'b', 'c', 'd'], directory, identities, rows)
  assert.deepEqual(plan.links, [{ id: 'one', fantraxId: 'a', unchanged: false }])
  assert.deepEqual(plan.skipped, { noUniqueName: 2, noProviderProof: 0, conflictingLink: 1 })
})
