import { describe, expect, it } from 'vitest'
import { buildBigBrotherStandings, type StandingsCycle } from '@/lib/big-brother/standings'

export const cycle = (patch: Partial<StandingsCycle> = {}): StandingsCycle => ({
  week: 1, phase: 'HOH_OPEN', hohRosterId: null, vetoWinnerRosterId: null, nominee1RosterId: null, nominee2RosterId: null,
  vetoUsed: false, vetoSavedRosterId: null, replacementNomineeRosterId: null, evictedRosterId: null, closedAt: null, ...patch,
})
const base = {
  leagueId: 'league', season: 2026, rosters: ['a', 'b', 'c', 'd'].map(id => ({ id, teamName: `Team ${id}` })),
  cycles: [] as StandingsCycle[], juryRosterIds: [] as string[], finaleSize: 2, winnerRosterId: null as string | null,
  viewerRosterId: 'c', scores: [] as Array<{ rosterId: string; week: number; totalPoints: number }>,
}

describe('Big Brother standings projection', () => {
  it('shows real seats before play without fabricated records, scores or ranks', () => {
    const result = buildBigBrotherStandings(base)
    expect(result.state).toBe('setup')
    expect(result.remainingCount).toBe(4)
    expect(result.rows.every(r => r.place === null && r.processedPoints === null && r.status === 'AWAITING_START')).toBe(true)
    expect(result.history).toEqual([])
  })
  it('keeps active houseguests unranked regardless of points or competition wins', () => {
    const result = buildBigBrotherStandings({ ...base, cycles: [cycle({ hohRosterId: 'd', vetoWinnerRosterId: 'c' })],
      scores: [{ rosterId: 'b', week: 1, totalPoints: 300 }] })
    expect(result.rows.map(r => r.rosterId)).toEqual(['a', 'b', 'c', 'd'])
    expect(result.rows.every(r => r.place === null)).toBe(true)
    expect(result.rows.find(r => r.rosterId === 'd')).toMatchObject({ hohWins: 1, status: 'HOH' })
  })
  it('uses actual evictions for finishes and jury, even with cycles delivered out of order', () => {
    const result = buildBigBrotherStandings({ ...base, juryRosterIds: ['b', 'd'], cycles: [
      cycle({ week: 2, evictedRosterId: 'b', hohRosterId: 'c' }), cycle({ evictedRosterId: 'a' }),
    ] })
    expect(result.rows.map(r => [r.rosterId, r.place, r.status])).toEqual([
      ['c', null, 'FINALIST'], ['d', null, 'FINALIST'], ['b', 3, 'JURY'], ['a', 4, 'ELIMINATED'],
    ])
    expect(result).toMatchObject({ state: 'finale', remainingCount: 2, juryCount: 1, week: 2 })
    expect(result.history.map(c => c.week)).toEqual([2, 1])
  })
  it('removes veto-saved nominees from the current block while retaining their nomination record', () => {
    const result = buildBigBrotherStandings({ ...base, cycles: [cycle({ hohRosterId: 'd', nominee1RosterId: 'a', nominee2RosterId: 'b',
      vetoWinnerRosterId: 'a', vetoUsed: true, vetoSavedRosterId: 'a', replacementNomineeRosterId: 'c' })] })
    expect(result.rows.find(r => r.rosterId === 'a')).toMatchObject({ status: 'VETO_WINNER', timesNominated: 1 })
    expect(result.rows.filter(r => r.status === 'NOMINATED').map(r => r.rosterId)).toEqual(['b', 'c'])
  })
  it('shows public veto participation without overriding HOH or nominations', () => {
    const result = buildBigBrotherStandings({ ...base, cycles: [cycle({ hohRosterId: 'a', nominee1RosterId: 'b', nominee2RosterId: 'd', vetoParticipantRosterIds: ['a', 'b', 'c'] })] })
    expect(result.rows.find(r => r.rosterId === 'a')?.status).toBe('HOH')
    expect(result.rows.find(r => r.rosterId === 'b')?.status).toBe('NOMINATED')
    expect(result.rows.find(r => r.rosterId === 'c')?.status).toBe('VETO_PLAYER')
  })
  it('does not keep last cycle power badges after eviction', () => {
    const result = buildBigBrotherStandings({ ...base, cycles: [cycle({ hohRosterId: 'a', nominee1RosterId: 'b', nominee2RosterId: 'c', evictedRosterId: 'b' })] })
    expect(result.rows.find(r => r.rosterId === 'a')?.status).toBe('SAFE')
    expect(result.rows.find(r => r.rosterId === 'c')?.status).toBe('SAFE')
  })
  it('requires an eligible published finale winner and leaves other finalist positions unknown', () => {
    const cycles = [cycle({ evictedRosterId: 'a' }), cycle({ week: 2, evictedRosterId: 'b' })]
    const result = buildBigBrotherStandings({ ...base, cycles, winnerRosterId: 'd' })
    expect(result.state).toBe('completed')
    expect(result.rows[0]).toMatchObject({ rosterId: 'd', status: 'WINNER', place: 1 })
    expect(result.rows[1]).toMatchObject({ rosterId: 'c', status: 'FINALIST', place: null })
    for (const winnerRosterId of ['a', 'missing']) expect(buildBigBrotherStandings({ ...base, cycles, winnerRosterId }).winnerRosterId).toBeNull()
    expect(buildBigBrotherStandings({ ...base, winnerRosterId: 'd' }).state).toBe('setup')
  })
  it('handles final-three configuration, duplicate eviction references and unknown rosters', () => {
    const result = buildBigBrotherStandings({ ...base, finaleSize: 3, cycles: [cycle({ evictedRosterId: 'a' }),
      cycle({ week: 2, evictedRosterId: 'a' }), cycle({ week: 3, evictedRosterId: 'missing' })] })
    expect(result).toMatchObject({ remainingCount: 3, state: 'finale' })
    expect(result.rows.find(r => r.rosterId === 'a')).toMatchObject({ place: 4, evictedWeek: 1 })
  })
  it('preserves genuine zero and negative scores, filters invalid numbers, and reports score coverage', () => {
    const result = buildBigBrotherStandings({ ...base, scores: [
      { rosterId: 'a', week: 1, totalPoints: 0 }, { rosterId: 'b', week: 1, totalPoints: -2.5 },
      { rosterId: 'b', week: 2, totalPoints: 1 }, { rosterId: 'c', week: 1, totalPoints: NaN },
    ] })
    expect(result.rows.find(r => r.rosterId === 'a')).toMatchObject({ processedPoints: 0, scoredWeeks: 1 })
    expect(result.rows.find(r => r.rosterId === 'b')).toMatchObject({ processedPoints: -1.5, scoredWeeks: 2 })
    expect(result.rows.find(r => r.rosterId === 'c')?.processedPoints).toBeNull()
  })
  it('handles an empty league without declaring a finale', () => {
    expect(buildBigBrotherStandings({ ...base, rosters: [] })).toMatchObject({ state: 'setup', rows: [], remainingCount: 0 })
  })
})
