import { describe, expect, it } from 'vitest'
import { computeSeasonTournamentStandings, previewSeasonTournamentCut, type TournamentWeeklyResult, type TournamentStageEntrant } from '@/lib/tournament/seasonTournamentStandings'

const entrants = (): TournamentStageEntrant[] => Array.from({ length: 4 }, (_, i) => ({
  id: 'team-' + (i + 1), displayName: 'Team ' + (i + 1), leagueId: 'league-' + (i % 2), previousSeed: null,
}))
const result = (entrantId: string, points: number, update: Partial<TournamentWeeklyResult> = {}): TournamentWeeklyResult => ({
  stageId: 'opening', entrantId, leagueId: entrants().find(e => e.id === entrantId)?.leagueId ?? 'invalid',
  period: 1, revision: 1, status: 'final', wins: 0, points, ...update,
})
const board = (results: TournamentWeeklyResult[], update: Partial<Parameters<typeof computeSeasonTournamentStandings>[0]> = {}) => computeSeasonTournamentStandings({
  stageId: 'opening', entrants: entrants(), periods: [1], results, tiebreakers: ['best_week', 'wins', 'previous_seed'], ...update,
})
describe('stage score ledger and half-field cuts', () => {
  it('ranks by stage points and previews exactly half the field', () => {
    const snapshot = board([result('team-1', 10), result('team-2', 20), result('team-3', 30), result('team-4', 40)])
    expect(snapshot.scoresFinal).toBe(true)
    expect(previewSeasonTournamentCut(snapshot)).toEqual({ ok: true, advancing: [{ entrantId: 'team-4', seed: 1 }, { entrantId: 'team-3', seed: 2 }], eliminated: ['team-2', 'team-1'] })
  })
  it('distinguishes absent data from a genuine zero and blocks a cut', () => {
    const snapshot = board([result('team-1', 0)])
    expect(snapshot.rows.find(r => r.id === 'team-1')!.pointsFor).toBe(0)
    expect(snapshot.rows.find(r => r.id === 'team-2')!.pointsFor).toBeNull()
    expect(snapshot.rows.find(r => r.id === 'team-2')!.missingPeriods).toEqual([1])
    expect(previewSeasonTournamentCut(snapshot).ok).toBe(false)
  })
  it('uses only the newest score revision regardless of input order', () => {
    const a = result('team-1', 10), correction = result('team-1', 25, { revision: 2 })
    for (const results of [[a, correction], [correction, a], [a, a, correction, correction]]) {
      expect(board(results).rows.find(r => r.id === 'team-1')!.pointsFor).toBe(25)
    }
  })
  it('does not keep a superseded final status if a correction is provisional', () => {
    const results = entrants().map((e, i) => result(e.id, 10 + i))
    results.push(result('team-1', 99, { revision: 2, status: 'provisional' }))
    const snapshot = board(results)
    expect(snapshot.rows[0]!.provisionalPeriods).toEqual([1])
    expect(previewSeasonTournamentCut(snapshot).ok).toBe(false)
  })
  it('requires a result for every elapsed period', () => {
    const snapshot = board(entrants().map((e, i) => result(e.id, i)), { periods: [1, 2] })
    expect(snapshot.rows.every(r => r.missingPeriods.join(',') === '2')).toBe(true)
    expect(snapshot.scoresFinal).toBe(false)
  })
  it('does not carry scores across redrafts or count future periods', () => {
    const snapshot = board([result('team-1', 900, { stageId: 'other-stage' }), result('team-1', 500, { period: 2 }), result('team-1', 20)])
    expect(snapshot.rows[0]!.pointsFor).toBe(20)
  })
  it('detects conflicting payloads for a revision even if already superseded', () => {
    for (const results of [
      [result('team-1', 10), result('team-1', 11)],
      [result('team-1', 99, { revision: 2 }), result('team-1', 10), result('team-1', 11)],
      [result('team-1', 10), result('team-1', 10, { status: 'provisional' })],
    ]) expect(() => board(results)).toThrow(/conflicting/i)
  })
  it('rejects scores mapped to the wrong league or entrant', () => {
    expect(() => board([result('team-1', 10, { leagueId: 'wrong' })])).toThrow()
    expect(() => board([result('unknown', 10)])).toThrow()
  })
  it.each([NaN, Infinity, 0.12345])('rejects unsafe score %s', points => expect(() => board([result('team-1', points)])).toThrow())
  it('compares fantasy points as exact fixed decimal units', () => {
    const snapshot = board([result('team-1', 0.1 + 0.2), result('team-2', 0.3)])
    expect(snapshot.rows[0]!.pointsFor).toBe(0.3)
    expect(snapshot.rows[0]!.rank).toBe(snapshot.rows[1]!.rank)
    expect(snapshot.rows[0]!.tied).toBe(true)
  })
  it('handles negative totals without inserting a zero best week', () => {
    const snapshot = board([result('team-1', -20), result('team-1', -30, { period: 2 }), result('team-2', -10), result('team-2', -40, { period: 2 })], { periods: [1, 2] })
    expect(snapshot.rows[0]!.id).toBe('team-2')
    expect(snapshot.rows[0]!.bestWeek).toBe(-10)
    expect(snapshot.rows[1]!.pointsFor).toBe(-50)
  })
  it('honors the configured tiebreaker order', () => {
    const results = [result('team-1', 20), result('team-1', 10, { period: 2 }), result('team-2', 15, { wins: 1 }), result('team-2', 15, { period: 2, wins: 1 })]
    expect(board(results, { periods: [1, 2], tiebreakers: ['best_week', 'wins'] }).rows[0]!.id).toBe('team-1')
    expect(board(results, { periods: [1, 2], tiebreakers: ['wins', 'best_week'] }).rows[0]!.id).toBe('team-2')
  })
  it('uses previous stage seeds only as the configured tiebreaker', () => {
    const stageEntrants = entrants().map((e, i) => ({ ...e, previousSeed: 4 - i }))
    expect(board(stageEntrants.map(e => result(e.id, 10)), { entrants: stageEntrants }).rows[0]!.id).toBe('team-4')
  })
  it('reports ties honestly and blocks tied advancing seeds', () => {
    const snapshot = board(entrants().map(e => result(e.id, 10)))
    expect(snapshot.rows.every(r => r.rank === 1 && r.tied)).toBe(true)
    expect(previewSeasonTournamentCut(snapshot)).toMatchObject({ ok: false, reason: expect.stringMatching(/tied/i) })
  })
  it('allows irrelevant eliminated ties when advancing seeds are distinct', () => {
    const snapshot = board([result('team-1', 30), result('team-2', 20), result('team-3', 10), result('team-4', 10)])
    expect(previewSeasonTournamentCut(snapshot).ok).toBe(true)
  })
  it('reports weekly movement independently from previous-stage seed', () => {
    const snapshot = board([result('team-1', 30)], { previousWeekRanks: { 'team-1': 4 } })
    expect(snapshot.rows[0]!.seedMovement).toBe(3)
  })
  it('rejects ambiguous entrant identities, periods and prior seeds', () => {
    expect(() => board([], { entrants: [entrants()[0]!, entrants()[0]!] })).toThrow()
    expect(() => board([], { periods: [1, 1] })).toThrow()
    expect(() => board([], { entrants: entrants().map(e => ({ ...e, previousSeed: 1 })) })).toThrow()
  })
})
