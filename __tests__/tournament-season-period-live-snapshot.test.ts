import { describe, expect, it, vi } from 'vitest'
import { collectSeasonPeriodLiveSnapshot } from '@/lib/tournament/seasonPeriodLiveSnapshot'
import { defaultSeasonRules } from '@/lib/tournament/seasonRules'

function collect(input: Omit<Parameters<typeof collectSeasonPeriodLiveSnapshot>[0], 'sport' | 'rules'>) {
  return collectSeasonPeriodLiveSnapshot({ ...input, sport: 'NBA', rules: defaultSeasonRules('NBA', 'nba_points') })
}

const assignments = [
  { gameId: 'g1', startsAt: '2026-10-20T23:00:00Z', period: 1 },
  { gameId: 'g2', startsAt: '2026-10-21T23:00:00Z', period: 1 },
  { gameId: 'g3', startsAt: '2026-10-25T23:00:00Z', period: 1 },
]
const schedule = assignments.map(game => ({ gameId: game.gameId, startTime: game.startsAt, seasonType: 'regular' as const, status: 'scheduled', replacedBy: null }))
const observedAt = new Date('2026-10-22T12:00:00Z')
const row = (gameId: string, status: string) => ({ game_ID: gameId, season_type: 'Regular Season', status, player_box: { home: {}, away: {} } })

describe('whole-period Rolling Insights live snapshot', () => {
  it('fetches elapsed Eastern dates, reports unfinished and future games, and keeps raw rows private', async () => {
    const fetchDay = vi.fn(async (day: string) => ({ rows: day === '2026-10-20' ? [row('g1', 'final')] : [row('g2', 'scheduled')] }))
    const { report, rawGames } = await collect({ period: 1, assignments, currentSchedule: schedule, observedAt, fetchDay })
    expect(fetchDay.mock.calls.map(call => call[0])).toEqual(['2026-10-20', '2026-10-21'])
    expect(report).toMatchObject({ expectedGames: 3, fetchedGames: 2, finalGames: 1, futureGameIds: ['g3'], missingGameIds: [],
      allGameRowsFinal: false, exactStartVerified: false, playerCoverageVerified: false, scoringCertified: false, launchReady: false })
    expect(report.snapshotDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(report)).not.toContain('player_box')
    expect(rawGames.get('g1')).toMatchObject({ status: 'final' })
  })
  it('reports missing rows instead of treating absent games as zero', async () => {
    const result = await collect({ period: 1, assignments, currentSchedule: schedule, observedAt, fetchDay: async () => ({ rows: [] }) })
    expect(result.report).toMatchObject({ fetchedGames: 0, missingGameIds: ['g1', 'g2'], scoringCertified: false })
  })
  it('keeps a game scheduled later on the current Eastern day pending', async () => {
    const laterToday = { gameId: 'g4', startsAt: '2026-10-22T23:00:00Z', period: 1 }
    const fetchDay = vi.fn(async () => ({ rows: [] }))
    const { report } = await collect({ period: 1, assignments: [laterToday], currentSchedule: [{ gameId: 'g4', startTime: laterToday.startsAt, seasonType: 'regular', status: 'scheduled', replacedBy: null }], observedAt, fetchDay })
    expect(report).toMatchObject({ futureGameIds: ['g4'], missingGameIds: [], fetchedGames: 0 })
    expect(fetchDay).not.toHaveBeenCalled()
  })
  it('rejects duplicate games, stale cache responses and schedule drift before use', async () => {
    const duplicate = async () => ({ rows: [row('g1', 'final'), row('g1', 'final')] })
    await expect(collect({ period: 1, assignments, currentSchedule: schedule, observedAt, fetchDay: duplicate })).rejects.toThrow('duplicate live rows')
    await expect(collect({ period: 1, assignments, currentSchedule: schedule, observedAt, fetchDay: async () => ({ rows: [], notModified: true }) })).rejects.toThrow('fresh provider slate')
    const fetchDay = vi.fn(async () => ({ rows: [] }))
    await expect(collect({ period: 1, assignments, currentSchedule: [{ ...schedule[0]!, startTime: '2026-10-20T23:05:00Z' }, ...schedule.slice(1)], observedAt, fetchDay })).rejects.toThrow('Review drift')
    expect(fetchDay).not.toHaveBeenCalled()
  })
  it('rejects unknown season classification and never certifies player coverage from final status alone', async () => {
    await expect(collect({ period: 1, assignments, currentSchedule: schedule, observedAt, fetchDay: async () => ({ rows: [{ ...row('g1', 'final'), season_type: 'unknown' }] }) })).rejects.toThrow('classification')
    const onlyTwo = assignments.slice(0, 2), current = schedule.slice(0, 2)
    const { report } = await collect({ period: 1, assignments: onlyTwo, currentSchedule: current, observedAt,
      fetchDay: async day => ({ rows: [row(day === '2026-10-20' ? 'g1' : 'g2', 'final')] }) })
    expect(report).toMatchObject({ allGameRowsFinal: true, playerCoverageVerified: false, scoringCertified: false })
  })
})
