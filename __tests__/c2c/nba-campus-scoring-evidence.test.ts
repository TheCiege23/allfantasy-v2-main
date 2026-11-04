import { describe, expect, it } from 'vitest'
import { scoreBasketballCampusEvidence } from '@/lib/c2c/nbaCampusScoringEvidence'
import type { ScheduleGame } from '@/lib/sports-data/riScheduleCache'
const player = { id: 'espn:ncaab:12', identityId: 'identity-12', riTeamId: '251', position: 'G' }
const game = (id: string, status = 'final'): ScheduleGame => ({ gameId: id, day: '2026-11-03', startTime: null, status, seasonType: 'regular', eventName: null, replacedBy: null, homeTeamId: '251', awayTeamId: '20' })
const score = (stats: Record<string, number>) => stats.pts ?? stats.points ?? 0

describe('college basketball scoring evidence', () => {
  it('scores matching school games and waits for every game and the week to finish', () => {
    const base = { players: [player], games: [game('one'), game('two', 'live')], stats: [{ playerId: 'identity-12', providerGameId: 'one', normalizedStatMap: { points: 20 } }], windowClosed: false, scheduleCoversWindow: true, scorer: score }
    expect(scoreBasketballCampusEvidence(base)[0]).toMatchObject({ playerId: player.id, points: 20, missing: true, allFinal: false })
    expect(scoreBasketballCampusEvidence({ ...base, windowClosed: true, games: [game('one'), game('two')], stats: [...base.stats, { playerId: 'identity-12', providerGameId: 'two', normalizedStatMap: { points: 10 } }] })[0]).toMatchObject({ points: 30, missing: false, allFinal: true })
  })
  it('never substitutes another player or a game from a different school', () => {
    const result = scoreBasketballCampusEvidence({ players: [player], games: [game('one')], stats: [{ playerId: 'someone-else', providerGameId: 'one', normalizedStatMap: { points: 40 } }, { playerId: player.identityId, providerGameId: 'other', normalizedStatMap: { points: 50 } }], windowClosed: true, scheduleCoversWindow: true, scorer: score })
    expect(result[0]).toMatchObject({ points: 0, missing: true, allFinal: false })
  })
  it('distinguishes a verified no-game week from missing schedule data', () => {
    const base = { players: [player], stats: [], windowClosed: true, scorer: score }
    expect(scoreBasketballCampusEvidence({ ...base, games: [], scheduleCoversWindow: true })[0]).toMatchObject({ points: 0, missing: false, allFinal: true })
    expect(scoreBasketballCampusEvidence({ ...base, games: null, scheduleCoversWindow: false })[0]).toMatchObject({ missing: true, allFinal: false })
  })
})
