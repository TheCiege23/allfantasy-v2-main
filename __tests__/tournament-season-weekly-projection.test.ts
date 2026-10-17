import { describe, expect, it } from 'vitest'
import { defaultSeasonRules } from '@/lib/tournament/seasonRules'
import { projectSeasonWeek, type SeasonWeeklyEvidence } from '@/lib/tournament/seasonWeeklyProjection'

function fixture(sport: 'NFL' | 'NBA' = 'NFL') {
  const rules = defaultSeasonRules(sport, sport === 'NBA' ? 'nba_points' : 'ppr')
  rules.calendar.periods = [{ number: 1, startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-08T00:00:00Z', finalizesAt: '2026-10-09T00:00:00Z' }]
  const expected = { rulesHash: 'rules-v1', rosterHash: 'prepared-v1', rosterIds: ['a', 'b'] }
  const evidence: SeasonWeeklyEvidence = { sport, period: 1, ...expected, source: 'trusted-fixture', coverage: 'complete', observedAt: '2026-10-09T00:01:00Z',
    rosters: [{ rosterId: 'a', playerIds: ['p', 'bench'] }, { rosterId: 'b', playerIds: ['q'] }],
    games: [{ gameId: 'g', actualStartsAt: '2026-10-02T00:00:00Z', playerIds: ['p', 'q', 'bench'], lineups: [{ rosterId: 'a', lockedAt: '2026-10-01T00:00:00Z', starterIds: ['p'] }, { rosterId: 'b', lockedAt: '2026-10-01T00:00:00Z', starterIds: ['q'] }] }],
    scores: [{ gameId: 'g', playerId: 'p', revision: 1, status: 'final', points: 0 }, { gameId: 'g', playerId: 'q', revision: 1, status: 'final', points: -1.2345 }, { gameId: 'g', playerId: 'bench', revision: 1, status: 'final', points: 999 }],
  }
  delete (evidence as any).rosterIds
  const now = new Date('2026-10-09T00:02:00Z')
  return { rules, expected, evidence, now, run() { return projectSeasonWeek(rules, expected, evidence, now) } }
}
describe('tournament weekly scoring policy', () => {
  it.each(['NFL', 'NBA'] as const)('%s counts only locked starters, preserves zero/negative points and leaves launch locked', sport => {
    const f = fixture(sport), report = f.run()
    expect(report.canFinalize).toBe(true)
    expect(report.launchReady).toBe(false)
    expect(report.teams.map(t => t.points)).toEqual([0, -1.2345])
  })
  it('missing is null, not zero, while known points remain visible', () => {
    const f = fixture(); f.evidence.scores = f.evidence.scores.filter(s => s.playerId !== 'p')
    expect(f.run().teams[0]).toMatchObject({ points: null, knownPoints: 0 })
    expect(f.run().canFinalize).toBe(false)
  })
  it('newest correction wins independent of arrival order', () => {
    const f = fixture(); f.evidence.scores.unshift({ ...f.evidence.scores[0]!, revision: 2, points: 3.125 })
    expect(f.run().teams[0]!.points).toBe(3.125)
    expect(f.run().canFinalize).toBe(true)
  })
  it('a newer provisional correction blocks an older final result', () => {
    const f = fixture(); f.evidence.scores.push({ ...f.evidence.scores[0]!, revision: 2, status: 'provisional' })
    expect(f.run().canFinalize).toBe(false)
    expect(f.run().teams[0]!.provisional).toHaveLength(1)
  })
  it('identical revision replays are safe', () => {
    const f = fixture(); f.evidence.scores.push({ ...f.evidence.scores[0]! }); expect(f.run().canFinalize).toBe(true)
  })
  it.each(['missing', 'provisional'] as const)('blocks %s coverage including an empty schedule', coverage => {
    const f = fixture(); f.evidence.coverage = coverage; f.evidence.games = []; f.evidence.scores = []
    expect(f.run().canFinalize).toBe(false)
    expect(f.run().teams[0]!.points).toBeNull()
  })
  it('allows a verified no-game week to be real zero', () => {
    const f = fixture(); f.evidence.games = []; f.evidence.scores = []
    expect(f.run().canFinalize).toBe(true); expect(f.run().teams[0]!.points).toBe(0)
  })
  it('waits for correction closure even if every game is final', () => {
    const f = fixture(); f.now.setTime(Date.parse('2026-10-08T12:00:00Z')); f.evidence.observedAt = f.now.toISOString()
    expect(f.run().canFinalize).toBe(false)
    expect(f.run().blockers).toContain('The correction window is still open.')
  })
  it('requires source reconciliation after corrections close', () => {
    const f = fixture(); f.evidence.observedAt = '2026-10-08T12:00:00Z'
    expect(f.run().canFinalize).toBe(false)
  })
  it.each([
    ['rules drift', (f: ReturnType<typeof fixture>) => { f.evidence.rulesHash = 'changed' }],
    ['roster drift', (f: ReturnType<typeof fixture>) => { f.evidence.rosterHash = 'changed' }],
    ['sport drift', (f: ReturnType<typeof fixture>) => { f.evidence.sport = 'NBA' }],
    ['missing team', (f: ReturnType<typeof fixture>) => { f.evidence.rosters.pop() }],
    ['duplicate team', (f: ReturnType<typeof fixture>) => { f.evidence.rosters.push(f.evidence.rosters[0]!) }],
    ['duplicate player', (f: ReturnType<typeof fixture>) => { f.evidence.rosters[0]!.playerIds.push('p') }],
    ['duplicate game', (f: ReturnType<typeof fixture>) => { f.evidence.games.push(f.evidence.games[0]!) }],
    ['missing lock', (f: ReturnType<typeof fixture>) => { f.evidence.games[0]!.lineups.pop() }],
    ['duplicate lock', (f: ReturnType<typeof fixture>) => { f.evidence.games[0]!.lineups[1] = f.evidence.games[0]!.lineups[0]! }],
    ['late lock', (f: ReturnType<typeof fixture>) => { f.evidence.games[0]!.lineups[0]!.lockedAt = '2026-10-03T00:00:00Z' }],
    ['unowned starter', (f: ReturnType<typeof fixture>) => { f.evidence.games[0]!.lineups[0]!.starterIds.push('q') }],
    ['foreign score', (f: ReturnType<typeof fixture>) => { f.evidence.scores[0]!.gameId = 'unknown' }],
    ['foreign player', (f: ReturnType<typeof fixture>) => { f.evidence.scores[0]!.playerId = 'unknown' }],
    ['conflicting revision', (f: ReturnType<typeof fixture>) => { f.evidence.scores.push({ ...f.evidence.scores[0]!, points: 9 }) }],
    ['excess precision', (f: ReturnType<typeof fixture>) => { f.evidence.scores[0]!.points = 0.00001 }],
    ['null score', (f: ReturnType<typeof fixture>) => { (f.evidence.scores[0] as any).points = null }],
    ['future observation', (f: ReturnType<typeof fixture>) => { f.evidence.observedAt = '2026-10-10T00:00:00Z' }],
    ['wrong scoring window', (f: ReturnType<typeof fixture>) => { f.evidence.games[0]!.actualStartsAt = '2026-10-08T00:00:00Z' }],
    ['invalid finalization date', (f: ReturnType<typeof fixture>) => { f.rules.calendar.periods[0]!.finalizesAt = 'invalid' }],
    ['invalid server time', (f: ReturnType<typeof fixture>) => { f.now.setTime(NaN) }],
    ['insufficient correction window', (f: ReturnType<typeof fixture>) => { f.rules.correctionHours = 48 }],
  ] as const)('refuses %s', (_, mutate) => { const f = fixture(); mutate(f); expect(() => f.run()).toThrow() })
  it('uses period-start locks when configured', () => {
    const f = fixture(); f.rules.lineupLock = 'period_start'; f.evidence.games[0]!.lineups[0]!.lockedAt = '2026-10-01T12:00:00Z'
    expect(() => f.run()).toThrow('late')
  })
  it('NBA cap consumes starts by actual tipoff, excludes later missing scores and prorates short weeks', () => {
    const f = fixture('NBA'); f.rules.nbaGames.startsPerPeriod = 1
    f.evidence.games.unshift({ ...structuredClone(f.evidence.games[0]!), gameId: 'later', actualStartsAt: '2026-10-03T00:00:00Z' })
    const report = f.run()
    expect(report.canFinalize).toBe(true)
    expect(report.teams[0]).toMatchObject({ countedStarts: 1, excludedStarts: 1, points: 0 })
    f.rules.calendar.periods[0]!.endsAt = '2026-10-04T00:00:00Z'
    f.rules.nbaGames.startsPerPeriod = 4
    expect(f.run().teams[0]!.countedStarts).toBe(1)
    f.rules.nbaGames.shortPeriods = 'same_cap'
    expect(f.run().teams[0]!.countedStarts).toBe(2)
    expect(f.run().canFinalize).toBe(false)
  })
  it('NBA all-scheduled mode counts every start', () => {
    const f = fixture('NBA'); f.rules.nbaGames.mode = 'all_scheduled'; f.rules.nbaGames.startsPerPeriod = 1
    f.evidence.games.push({ ...structuredClone(f.evidence.games[0]!), gameId: 'later', actualStartsAt: '2026-10-03T00:00:00Z' })
    expect(f.run().teams[0]!.countedStarts).toBe(2); expect(f.run().canFinalize).toBe(false)
  })
  it('equal tipoffs use stable game identity order regardless of feed order', () => {
    const f = fixture('NBA'); f.rules.nbaGames.startsPerPeriod = 1
    f.evidence.games.unshift({ ...structuredClone(f.evidence.games[0]!), gameId: 'z' })
    expect(f.run().teams[0]).toMatchObject({ countedStarts: 1, excludedStarts: 1, points: 0 })
    f.evidence.games.reverse()
    expect(f.run().teams[0]!.points).toBe(0)
  })
  it('uses each game lock snapshot rather than the current starter choice', () => {
    const f = fixture(); f.evidence.games.push({ ...structuredClone(f.evidence.games[0]!), gameId: 'later', actualStartsAt: '2026-10-03T00:00:00Z' })
    f.evidence.games[1]!.lineups[0]!.starterIds = ['bench']
    f.evidence.scores.push({ gameId: 'later', playerId: 'bench', revision: 1, status: 'final', points: 2 }, { gameId: 'later', playerId: 'q', revision: 1, status: 'final', points: 0 })
    expect(f.run().teams[0]!.points).toBe(2)
    expect(f.run().canFinalize).toBe(true)
  })
  it('projection does not mutate evidence', () => {
    const f = fixture(), before = structuredClone(f.evidence); f.run(); expect(f.evidence).toEqual(before)
  })
})
