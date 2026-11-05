// @vitest-environment node
import { getLeagueDefaults } from '@/lib/league-defaults/getLeagueDefaults'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { validateRedraftLineup } from '@/lib/redraft/lineupValidation'
import { describe, expect, it } from 'vitest'
import { replayBoxScores, replayRosterModel, replayPositions, type RecordedBox, type ReplayPlayer } from '@/lib/zombie/recordedBoxScoreReplay'
import { resolveFormatRosterDefaults } from '@/lib/league/roster-defaults'
const box = (stats: unknown, extra: Partial<RecordedBox> = {}): RecordedBox => ({ player: 'fixture-player', game: 'fixture-game', day: '2025-01-01', period: 1, position: 'QB', source: 'fixture', seasonType: 'regular', stats, ...extra })
const windows = [{ period: 1, start: '2025-01-01', end: '2025-01-08' }]
const run = (sport: string, stats: unknown) => replayBoxScores(sport, [box(stats)], windows, '2025-01-09T00:00:00Z')
describe('recorded box-score replay uses authoritative per-sport scoring', () => {
  it('re-scores NFL passing/rushing from stats rather than stored provider fantasy points', () => {
    // AF default: 250*.04 + 2*4 - 1*1 + 10*.1 = 18.
    expect(run('NFL', { pass_yd: 250, pass_td: 2, pass_int: 1, rush_yd: 10, pts_half_ppr: 999 }).diagnostics.scoredPlayerGames?.mean).toBe(18)
  })
  it('scores NBA per-game doubles and AF points weights', () => {
    // 20*.5 + 10 rebounds + 5 assists + 2*2 steals + 2 block - 3 TO + 2*.5 threes + 1 DD = 30.
    expect(run('NBA', { stats: { points: 20, total_rebounds: 10, assists: 5, steals: 2, blocks: 1, turnovers: 3, three_points_made: 2 } }).diagnostics.scoredPlayerGames?.mean).toBe(30)
  })
  it('scores NHL skater points and preserves untouched gated rows', () => {
    // G3 + A4 + SOG1.5 + HIT1.2 + BLK1 + +/-1 =11.7; faceoffs do not score in an untouched profile.
    expect(run('NHL', { group: 'skaters', stats: { goals: 1, assists: 2, shots_on_goal: 3, hits: 4, blocks: 2, plus_minus: 1, faceoffs_won: 10 } }).diagnostics.scoredPlayerGames?.mean).toBeCloseTo(11.7)
  })
  it('scores MLB batting independently from pitching', () => {
    expect(run('MLB', { group: 'batting', stats: { HR: 1 } }).diagnostics.scoredPlayerGames?.mean).toBe(4)
    // 5.2 baseball innings = 17 outs =>17 points, plus 5 K minus 4 ER points =18.
    expect(run('MLB', { group: 'pitching', stats: { IP: 5.2, K: 5, ER: 2 } }).diagnostics.scoredPlayerGames?.mean).toBe(18)
  })
  it('normalizes NCAAF dotted provider fields with half-PPR', () => {
    expect(run('NCAAF', { 'passing.YDS': 250, 'passing.TD': 2, 'passing.INT': 1, 'receiving.REC': 3 }).diagnostics.scoredPlayerGames?.mean).toBe(17.5)
  })
  it('replays NCAAB scoring without substituting NBA weights', () => {
    expect(run('NCAAB', { stats: { points: 20, total_rebounds: 5, assists: 5 } }).diagnostics.scoredPlayerGames?.mean).toBe(20)
  })
  it('replays Soccer goals/assists/minutes without double-counting penalty goals', () => {
    expect(run('SOCCER', { group: 'fielders', position: 'Forward', stats: { goals: 1, assists: 1, minutes_played: 90, penalties_scored: 1 } }).diagnostics.scoredPlayerGames?.mean).toBe(10.8)
  })
  it('excludes preseason/postseason, current days and unverified season types', () => {
    const data = replayBoxScores('NFL', [box({ pass_yd: 100 }, { seasonType: 'pre' }), box({}, { seasonType: 'post' }), box({}, { seasonType: null }), box({}, { day: '2025-01-09' })], windows, '2025-01-09T00:00:00Z')
    expect(data.diagnostics.normalizedRegularRows).toBe(0)
    expect(data.diagnostics.exclusions).toMatchObject({ excluded_pre: 1, excluded_post: 1, season_type_unknown: 1, missing_or_current_day: 1 })
  })
  it('deduplicates identical games and refuses conflicting canonical aliases', () => {
    expect(replayBoxScores('NFL', [box({ pass_yd: 100 }), box({ pass_yd: 100 })], windows, '2025-01-09').diagnostics.normalizedRegularRows).toBe(1)
    expect(() => replayBoxScores('NFL', [box({ pass_yd: 100 }), box({ pass_yd: 200 })], windows, '2025-01-09')).toThrow('Conflicting')
  })
  it('does not invent a scoring period when the historical calendar is unavailable', () => {
    const data = replayBoxScores('NFL', [box({ pass_yd: 100 })], [], '2025-01-09')
    expect(data.diagnostics.normalizedRegularRows).toBe(1)
    expect(data.players.size).toBe(0)
  })
  it('uses actual canonical Zombie creation profiles, not stale rules-document roster shapes', () => {
    expect(resolveFormatRosterDefaults({ sport: 'NFL', formatId: 'zombie' }).starterSlots).toEqual({ FLEX: 4, SUPERFLEX: 1 })
    expect(resolveFormatRosterDefaults({ sport: 'NHL', formatId: 'zombie' }).starterSlots).toEqual({ F: 2, D: 2, UTIL: 1, G: 1 })
  })
  it('does not use later scoring outcomes to select modeled rosters', () => {
    const data = new Map<string, ReplayPlayer>([1, 2, 3, 4].map(i => [`p${i}`, { id: `p${i}`, positions: ['QB'], periodPoints: new Map([[1, 50-i], [2, 50-i], [3, i]]), days: new Map() }]))
    const args = { sport: 'NFL', players: data, windows: [1,2,3].map(period => ({period,start:`2025-01-${String(period).padStart(2,'0')}`,end:`2025-01-${String(period+1).padStart(2,'0')}`})), slots:['QB'],bench:0,managers:2,seed:1 }
    const first = replayRosterModel(args)
    data.get('p4')!.periodPoints.set(3, 99999)
    expect(replayRosterModel(args).scores).toEqual(first.scores)
  })
  it('uses canonical Soccer goalkeeper labels without broadening other positions', () => {
    expect(replayPositions('Goalkeeper/GK/GKP', 'SOCCER')).toEqual(['GKP'])
    expect(replayPositions('G', 'NCAAB')).toEqual(['G'])
  })
  it('keeps the earliest recorded position and preserves points after a position change', () => {
    const data = replayBoxScores('NBA', [
      box({ stats: { points: 20 } }, { day: '2025-01-03', position: 'SG', game: 'later' }),
      box({ stats: { points: 10 } }, { day: '2025-01-01', position: 'PG', game: 'earlier' }),
    ], windows, '2025-01-09')
    expect(data.players.get('fixture-player')?.positions).toEqual(['PG'])
    expect(data.players.get('fixture-player')?.periodPoints.get(1)).toBe(15)
    expect(data.diagnostics.exclusions.position_changed_or_conflicting).toBe(1)
  })
  it('does not turn missing entire periods into artificial zero-score matchups', () => {
    const data = replayBoxScores('NFL', [box({ pass_yd: 100 })], [...windows, { period: 2, start: '2025-01-08', end: '2025-01-15' }], '2025-01-16')
    expect(data.windows.map(w => w.period)).toEqual([1])
    expect(data.diagnostics.unobservedCompletedPeriods).toEqual([2])
  })
  it('reports a granular college-position shortfall instead of inventing PG/SG eligibility', () => {
    const players = new Map([['p', { id: 'p', positions: ['G'], periodPoints: new Map([[1, 5], [2, 5], [3, 5]]), days: new Map<string, number>() }]])
    const model = replayRosterModel({ sport: 'NCAAB', players, windows: [1,2,3].map(period => ({ period, start: '2025-01-01', end: '2025-01-08' })), slots: ['PG'], bench: 0, managers: 2, seed: 1 })
    expect(model.status).toBe('roster_pool_or_position_shortfall')
    expect(model.shortfallBySlot).toEqual({ PG: 2 })
    expect(model.trainedEligibleBySlot).toEqual({ PG: 0 })
  })

  it('re-scores an unresolved provider line without admitting it as a draftable canonical identity', () => {
    const data = replayBoxScores('NFL', [box({ pass_yd: 100 }, { identityResolved: false })], windows, '2025-01-09')
    expect(data.diagnostics.normalizedRegularRows).toBe(1)
    expect(data.players.size).toBe(0)
    expect(data.diagnostics.exclusions.identity_unresolved_for_roster).toBe(1)
  })

})
it('creates a five-starter NCAAB Zombie roster and validates recorded guard and forward positions', () => {
  const { rosterSettings, draftSettings } = getLeagueDefaults({ sport: 'NCAAB', format: 'zombie', draftType: 'snake', managerCount: 20 })
  expect(rosterSettings.starter_slots).toEqual({ G: 2, F: 2, C: 1 })
  expect(rosterSettings.totalRosterSlots).toBe(8)
  expect(draftSettings.rounds).toBe(8)
  const rosterConfig = resolveRedraftRosterConfig('NCAAB', { roster: rosterSettings })
  const players = [
    ['G', 'G'], ['SG', 'G'], ['F', 'F'], ['PF', 'F'], ['C', 'C'],
  ].map(([position, slotType], index) => ({
    playerId: String(index), playerName: String(index), position, slotType, sport: 'NCAAB',
  }))
  const args = { sport: 'NCAAB', week: 1, players, rosterConfig }
  expect(validateRedraftLineup(args).ok).toBe(true)
  expect(validateRedraftLineup({
    ...args, players: [{ ...players[0], position: 'F' }, ...players.slice(1)],
  }).ok).toBe(false)
  expect(resolveFormatRosterDefaults({ sport: 'NBA', formatId: 'zombie' }).starterSlots)
    .toEqual({ PG: 1, SG: 1, SF: 1, PF: 1, C: 1 })
})
