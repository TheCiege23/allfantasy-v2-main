import { describe, expect, it } from 'vitest'
import { scoreEspnCampusEvidence } from '@/lib/c2c/nbaEspnCampusScoring'
import type { ScheduleGame } from '@/lib/sports-data/riScheduleCache'
const player = { id: 'espn:ncaab:12', espnId: '12', espnTeamId: '10', riTeamId: '1', position: 'G' }
const game = (gameId: string): ScheduleGame => ({ gameId, day: '2026-11-01', startTime: null, status: 'completed', seasonType: 'regular', eventName: null, replacedBy: null, homeTeamId: '1', awayTeamId: '2' })
const box = (eventId: string, didNotPlay = false) => ({ eventId, status: 'final' as const, complete: true, rejected: 0, players: [{ espnId: '12', teamId: '10', didNotPlay, stats: didNotPlay ? null : { pts: 20, reb: 5, ast: 0, to: 0, stl: 0, blk: 0, threes: 0 } }] })
const base = { players: [player], games: [game('ri-1')], eventForGame: new Map([['ri-1', '100']]), boxes: new Map([['100', box('100')]]), scheduleCoversWindow: true, windowClosed: true, scorer: (s: Record<string, number>) => (s.pts ?? 0) + (s.reb ?? 0) }
describe('ESPN basketball campus scoring', () => {
  it('scores an exact player and school using the matched game', () => { expect(scoreEspnCampusEvidence(base)[0]).toEqual({ playerId: player.id, points: 25, missing: false, allFinal: true }) })
  it('treats an explicitly listed DNP as zero', () => { expect(scoreEspnCampusEvidence({ ...base, boxes: new Map([['100', box('100', true)]]) })[0]).toMatchObject({ points: 0, missing: false, allFinal: true }) })
  it('withholds final scores for unmatched, missing, partial, or different-school evidence', () => {
    expect(scoreEspnCampusEvidence({ ...base, eventForGame: new Map() })[0]).toMatchObject({ missing: true, allFinal: false })
    expect(scoreEspnCampusEvidence({ ...base, boxes: new Map([['100', { ...box('100'), players: [{ espnId: '12', teamId: '10', didNotPlay: false, stats: { pts: 20 } }] }]]) })[0]).toMatchObject({ missing: true, allFinal: false })
    expect(scoreEspnCampusEvidence({ ...base, boxes: new Map() })[0]).toMatchObject({ missing: true, allFinal: false })
    expect(scoreEspnCampusEvidence({ ...base, boxes: new Map([['100', { ...box('100'), complete: false }]]) })[0]).toMatchObject({ missing: true, allFinal: false })
    expect(scoreEspnCampusEvidence({ ...base, players: [{ ...player, espnTeamId: '99' }] })[0]).toMatchObject({ missing: true, allFinal: false })
  })
})
