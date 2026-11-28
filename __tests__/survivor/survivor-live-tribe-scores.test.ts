/**
 * lib/survivor/survivorLiveTribeScores.ts — each castaway's unofficial live points for an open NBA week.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/survivor/survivorNbaWeeklyScoring', () => ({ nbaSurvivorStarterPoints: vi.fn() }))

import { clearSurvivorLiveTribeScoresCache, loadNbaSurvivorLiveMemberScores, wantsSurvivorLiveScores } from '@/lib/survivor/survivorLiveTribeScores'

const points = (rows: Record<string, number>) =>
  new Map(Object.entries(rows).map(([id, p]) => [id, { points: p, final: false, games: 1 }]))

beforeEach(() => clearSurvivorLiveTribeScoresCache())

describe('loadNbaSurvivorLiveMemberScores', () => {
  it('sums each castaway’s starters, played games included', async () => {
    const starterPoints = vi.fn(async ({ legacyRosterId }: { legacyRosterId: string }) =>
      legacyRosterId === 'me' ? points({ jokic: 35.4, white: 6.1 }) : points({ tatum: 52 }))
    const r = await loadNbaSurvivorLiveMemberScores({ leagueId: 'L', week: 6, season: 2026, rosterIds: ['me', 'o1', 'me'] }, { starterPoints: starterPoints as never })
    expect(r).toEqual({ me: 41.5, o1: 52 })
    expect(starterPoints).toHaveBeenCalledTimes(2) // a roster listed twice is scored once
    expect(starterPoints).toHaveBeenCalledWith({ leagueId: 'L', legacyRosterId: 'me', week: 6, season: 2026 })
  })

  it('a roster that cannot be scored is left out, never reported as 0', async () => {
    const starterPoints = vi.fn(async ({ legacyRosterId }: { legacyRosterId: string }) => {
      if (legacyRosterId === 'bad') throw new Error('no season')
      return legacyRosterId === 'none' ? null : points({ a: 10 })
    })
    const r = await loadNbaSurvivorLiveMemberScores({ leagueId: 'L', week: 6, season: 2026, rosterIds: ['ok', 'bad', 'none'] }, { starterPoints: starterPoints as never })
    expect(r).toEqual({ ok: 10 })
  })

  it('caches a league week for a minute', async () => {
    const starterPoints = vi.fn(async () => points({ a: 1 }))
    const args = { leagueId: 'L', week: 6, season: 2026, rosterIds: ['x'] }
    await loadNbaSurvivorLiveMemberScores(args, { starterPoints: starterPoints as never, now: 1_000 })
    await loadNbaSurvivorLiveMemberScores(args, { starterPoints: starterPoints as never, now: 50_000 })
    expect(starterPoints).toHaveBeenCalledTimes(1)
    await loadNbaSurvivorLiveMemberScores(args, { starterPoints: starterPoints as never, now: 62_000 })
    expect(starterPoints).toHaveBeenCalledTimes(2)
  })
})

describe('wantsSurvivorLiveScores — the summary route computes live totals only when', () => {
  const open = [{ isFinalized: false }, { isFinalized: true }]
  it('the Matchup tab asks, in an NBA league, for a week that is not final', () => {
    expect(wantsSurvivorLiveScores({ liveParam: '1', sport: 'NBA', week: 6, rows: open })).toBe(true)
    expect(wantsSurvivorLiveScores({ liveParam: '1', sport: 'nba', week: 6, rows: [] })).toBe(true)
  })
  it('never otherwise: not asked (every other summary reader), not NBA, no week, or the week is final', () => {
    expect(wantsSurvivorLiveScores({ liveParam: null, sport: 'NBA', week: 6, rows: open })).toBe(false)
    expect(wantsSurvivorLiveScores({ liveParam: '1', sport: 'NFL', week: 6, rows: open })).toBe(false)
    expect(wantsSurvivorLiveScores({ liveParam: '1', sport: 'NBA', week: 0, rows: open })).toBe(false)
    expect(wantsSurvivorLiveScores({ liveParam: '1', sport: 'NBA', week: 6, rows: [{ isFinalized: true }] })).toBe(false)
  })
})

