import { describe, expect, it } from 'vitest'
import { buildPipeline, parseStoredDraftPicks } from '@/lib/league/collegePro/pipeline'

const pick = (id: string, name: string, round: number, pickNo: number, nflTeam = 'NYG') => ({
  collegeAthleteId: id, name, position: 'WR', nflTeam, round, pick: pickNo, overall: (round - 1) * 32 + pickNo,
})

describe('parseStoredDraftPicks', () => {
  it('reads the row the writer stores, and skips a pick with no athlete id', () => {
    const parsed = parseStoredDraftPicks({ year: 2026, fetchedAt: 'x', picks: [pick('1', 'A', 1, 2), { name: 'No id', round: 1, pick: 3 }] })
    expect(parsed?.year).toBe(2026)
    expect(parsed?.picks.map((p) => p.collegeAthleteId)).toEqual(['1'])
  })

  it('is null for anything that is not a stored draft', () => {
    expect(parseStoredDraftPicks(null)).toBeNull()
    expect(parseStoredDraftPicks({ picks: [] })).toBeNull()
  })
})

describe('buildPipeline', () => {
  const picks = [pick('100', 'Mine Late', 3, 10), pick('200', 'Mine Early', 1, 8, 'CAR'), pick('300', 'Rival', 2, 1), pick('400', 'Nobody', 4, 4)]
  const myPlayers = [
    { id: 'fx-a', cfbdId: '100', name: 'Mine Late' },
    { id: 'fx-b', cfbdId: '200', name: 'Mine Early' },
    { id: 'fx-c', cfbdId: '999', name: 'Still In College' },
    { id: 'fx-d', cfbdId: null, name: 'Unlinked' },
  ]
  const leagueCfbdIds = new Set(['100', '200', '300', '999'])

  it('lists your drafted college players by draft slot, matched only by athlete id', () => {
    const r = buildPipeline({ year: 2026, picks, myPlayers, leagueCfbdIds })
    expect(r.movingUp.map((p) => [p.playerId, p.round, p.pick, p.nflTeam])).toEqual([
      ['fx-b', 1, 8, 'CAR'],
      ['fx-a', 3, 10, 'NYG'],
    ])
  })

  it('the rookie pool is the drafted players no team held in college', () => {
    expect(buildPipeline({ year: 2026, picks, myPlayers, leagueCfbdIds }).rookiePool).toEqual({ drafted: 4, heldInCollege: 3, unheld: 1 })
  })

  it('a player with the same NAME as a draftee but a different id is not moved', () => {
    const r = buildPipeline({ year: 2026, picks, myPlayers: [{ id: 'fx-z', cfbdId: '555', name: 'Mine Early' }], leagueCfbdIds })
    expect(r.movingUp).toEqual([])
  })
})
