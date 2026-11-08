import { describe, expect, it, vi } from 'vitest'
import { scoreRows, survivalSeasonScore } from '@/lib/core-app/rankingsEngine'
import type { CareerLedgerRow } from '@/lib/rank/careerLedger'
import { readSleeperSurvivalEvidence, sleeperSurvivalPeriods, verifySleeperSurvival } from '@/lib/league-import/sleeper/survivalEvidence'

const owner = 'sleeper-owner'
const roster = (roster_id: number, eliminated?: number) => ({
  roster_id, owner_id: roster_id === 1 ? owner : 'other-' + roster_id, settings: { eliminated },
})
const matchup = (roster_id: number, points: number, active = true) => ({
  roster_id, points, players: active ? ['1'] : [], starters: active ? ['1'] : ['0'],
})
const league = {
  sport: 'nfl', name: 'Test Guillotine', status: 'complete', total_rosters: 4,
  settings: { type: 3, start_week: 2, last_chopped_leg: 4, last_scored_leg: 4 },
}

describe('Sleeper survival evidence', () => {
  it('uses the provider cut week without scoring the week of elimination', async () => {
    const getWeek = vi.fn()
    const result = await verifySleeperSurvival(league, [roster(1, 3), roster(2, 2), roster(3, 4), roster(4)], owner, getWeek)
    expect(result?.method).toBe('sleeper_chopped')
    expect(sleeperSurvivalPeriods(result!)).toEqual({ periods: 1, totalPeriods: 3 })
    expect(getWeek).not.toHaveBeenCalled()
  })

  it('requires an unambiguous linked roster and a complete provider cut schedule', async () => {
    const getWeek = vi.fn()
    const rosters = [roster(1, 3), roster(2, 2), roster(3, 2), roster(4)]
    expect(await verifySleeperSurvival(league, rosters, owner, getWeek)).toBeNull()
    expect(await verifySleeperSurvival(league, [roster(1, 3), roster(2, 2), roster(3, 4), { ...roster(4), co_owners: [owner] }], owner, getWeek)).toBeNull()
  })

  it('verifies a custom exit from every weekly cut and rejects missing, tied, or returning rosters', async () => {
    const custom = { ...league, settings: { type: 0, start_week: 1, last_scored_leg: 4, playoff_week_start: 0 } }
    const rosters = [roster(1), roster(2), roster(3), roster(4)]
    const weeks = [
      [matchup(1, 5), matchup(2, 3), matchup(3, 10), matchup(4, 11)],
      [matchup(1, 1), matchup(2, 0, false), matchup(3, 10), matchup(4, 11)],
      [matchup(1, 0, false), matchup(2, 0, false), matchup(3, 12), matchup(4, 11)],
      [matchup(1, 0, false), matchup(2, 0, false), matchup(3, 11), matchup(4, 11)],
    ]
    const verified = await verifySleeperSurvival(custom, rosters, owner, async week => weeks[week - 1])
    expect(verified).toMatchObject({ method: 'verified_weekly_chops', eliminatedWeek: 2 })
    expect(sleeperSurvivalPeriods(verified!)).toEqual({ periods: 1, totalPeriods: 4 })
    expect(await verifySleeperSurvival(custom, rosters, owner, async week =>
      week === 4 ? [{ ...weeks[3][0], starters: ['stale-player'] }, ...weeks[3].slice(1)] : weeks[week - 1],
    )).toEqual(verified)
    expect(await verifySleeperSurvival(custom, rosters, owner, async week => week === 4 ? [] : weeks[week - 1])).toBeNull()
    expect(await verifySleeperSurvival(custom, rosters, owner, async week => week === 2 ? [matchup(1, 10), ...weeks[1].slice(1)] : weeks[week - 1])).toBeNull()
    expect(await verifySleeperSurvival(custom, rosters, owner, async week => week === 4 ? [matchup(1, 5), ...weeks[3].slice(1)] : weeks[week - 1])).toBeNull()
    expect(await verifySleeperSurvival({ ...custom, name: 'Survivor' }, rosters, owner, async week => weeks[week - 1])).toBeNull()
  })

  it('keeps Career display scores identical to single-season Rankings scores', () => {
    for (const periods of [0, 2, 10, 17]) {
      const survival = { periods, totalPeriods: 17 }
      const row = { survival, specialty: 'guillotine', season: 2025, completed: true } as CareerLedgerRow
      expect(survivalSeasonScore(survival)).toBe(scoreRows([row], new Map()).score)
    }
    expect(readSleeperSurvivalEvidence({ version: 1, method: 'sleeper_chopped', rosterId: 1, firstWeek: 1, finalWeek: 14, eliminatedWeek: 15 })).toBeNull()
  })
})
