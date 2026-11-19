/**
 * 🛑 THE CHAMPION WAS ONLY RECORDED WHEN THE SEASON WAS FINALIZED.
 *
 * Finalizing also archives the season and opens the offseason, and runs on a later pass. A league whose
 * title game had a winner had no champion on record in between, and none at all if finalizing was held.
 * The winner now goes on record when the title game is decided.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const upsert = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: { leagueChampionship: { upsert } } }))

import { decidedTitleWinnerRosterId } from '@/lib/playoff-runtime/titleWinner'
import { recordTitleWinnerOnceDecided } from '@/lib/playoff-runtime/resolveNflRedraftPlayoffRuntime'
import { playoffRaceStatus } from '@/lib/league-media/redraftScreens'

const game = (winnerRosterId: string | null, nextMatchupId: string | null = null, status = 'final') => ({ winnerRosterId, nextMatchupId, status })
const semis = { matchups: [game('A', 'f'), game('B', 'f')] }

describe('decidedTitleWinnerRosterId', () => {
  it('names the winner of the title game as soon as it has one', () => {
    expect(decidedTitleWinnerRosterId({ rounds: [semis, { matchups: [game('A')] }] })).toBe('A')
  })
  it('null while the title game has no winner, however far the bracket has got', () => {
    expect(decidedTitleWinnerRosterId({ rounds: [semis, { matchups: [game(null, null, 'scheduled')] }] })).toBeNull()
    expect(decidedTitleWinnerRosterId({ rounds: [] })).toBeNull()
  })
  it('🛑 a semifinal winner is never the champion', () => {
    // The last round on file is still the semifinals: both games lead somewhere.
    expect(decidedTitleWinnerRosterId({ rounds: [semis] })).toBeNull()
  })
  it('a final round it cannot read as one title game names nobody', () => {
    expect(decidedTitleWinnerRosterId({ rounds: [{ matchups: [game('A'), game('B')] }] })).toBeNull()
  })
})

describe('recordTitleWinnerOnceDecided', () => {
  const state = { leagueId: 'L', season: 2026, teams: [{ rosterId: 'A', ownerId: 'user-a', displayName: 'Aces', pointsFor: 1500.5 }] } as never
  beforeEach(() => {
    upsert.mockReset()
    upsert.mockResolvedValue({})
  })

  it('writes the championship row for the league and season', async () => {
    expect(await recordTitleWinnerOnceDecided({ state, winnerRosterId: 'A', actorUserId: 'commish' })).toBe(true)
    const args = upsert.mock.calls[0][0]
    expect(args.where).toEqual({ leagueId_season: { leagueId: 'L', season: 2026 } })
    expect(args.create).toEqual({ leagueId: 'L', season: 2026, championUserId: 'user-a', teamName: 'Aces', pointsFor: 1500.5, recordedBy: 'commish' })
  })
  it('an update leaves a playoff record the finalizer wrote alone', async () => {
    await recordTitleWinnerOnceDecided({ state, winnerRosterId: 'A' })
    const { update } = upsert.mock.calls[0][0]
    expect('playoffRecord' in update).toBe(false)
    expect(update.recordedBy).toBe('system')
  })
  it('no winner yet: nothing is written', async () => {
    expect(await recordTitleWinnerOnceDecided({ state, winnerRosterId: null })).toBe(false)
    expect(upsert).not.toHaveBeenCalled()
  })
  it('a failed write is reported, never thrown: the round is already saved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    upsert.mockRejectedValue(new Error('down'))
    expect(await recordTitleWinnerOnceDecided({ state, winnerRosterId: 'A' })).toBe(false)
  })
})

describe('the Standings label', () => {
  const bracket = (championRosterId: string | null, finalWinner: string | null) => ({
    bracket: { generated: true, championRosterId, rounds: [semis, { matchups: [game(finalWinner, null, finalWinner ? 'final' : 'scheduled')] }] },
    seeds: [{ rosterId: 'A' }, { rosterId: 'B' }],
  })
  it('reads Champion once the title game is decided, before the season is finalized', () => {
    expect(playoffRaceStatus(bracket(null, 'A'), 'A')).toBe('champion')
    expect(playoffRaceStatus(bracket(null, 'A'), 'B')).toBe('clinched')
    expect(playoffRaceStatus(bracket(null, 'A'), 'Z')).toBe('eliminated')
  })
  it('and nobody is Champion while the title game is still to play', () => {
    expect(playoffRaceStatus(bracket(null, null), 'A')).toBe('clinched')
  })
})
