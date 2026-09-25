import { describe, it, expect } from 'vitest'
import { playsToLiveEvents, type PbpGame, type PbpPlay } from '@/lib/live/rollingInsightsPlayByPlay'

/**
 * N3 (partial) — passer/receiver attribution was discarded at the mapper.
 *
 * `subjectOf` collapses a play to ONE player and prefers the receiver on a passing touchdown,
 * so the quarterback was gone by the time anything downstream could use him: the message could
 * not say "{QB} threw a {yards}-yard TD to {receiver}", and a manager rostering only the
 * passer could not be reached.
 *
 * ⚠ THIS BATCH PRESERVES THE EVIDENCE; IT DOES NOT FAN OUT ON IT. Who gets notified is
 * unchanged — the subject still decides — and the multi-participant audience is later work.
 * These tests pin the preservation and say plainly that they do not pin delivery.
 */

const play = (over: Partial<PbpPlay> = {}): PbpPlay =>
  ({
    sequence: 42,
    quarter: 2,
    gameClock: '07:31',
    event: 'pass',
    yardsGained: 25,
    yardLine: 'ATL 25',
    possession: 'ATL',
    isTouchdown: true,
    isScoringPlay: true,
    isReturned: false,
    isReversed: false,
    description: 'Michael Penix Jr. pass complete to Drake London for 25 yards, TOUCHDOWN',
    players: [
      { id: 900, name: 'Michael Penix Jr.', role: 'passer', action: 'pass', position: 'QB', teamAbbr: 'ATL' },
      { id: 901, name: 'Drake London', role: 'receiver', action: 'reception', position: 'WR', teamAbbr: 'ATL' },
    ],
    pointsAfterType: null,
    ...over,
  }) as PbpPlay

const game = (plays: PbpPlay[]): PbpGame => ({
  gameId: '20260920-1-26',
  awayTeamName: 'Carolina Panthers',
  homeTeamName: 'Atlanta Falcons',
  plays,
})

describe('participant preservation', () => {
  it('carries every credited player, not just the subject', () => {
    const [event] = playsToLiveEvents(game([play()]))

    expect(event.participants).toHaveLength(2)
    expect(event.participants?.map((p) => p.role).sort()).toEqual(['passer', 'receiver'])
  })

  it('keeps the passer even though the receiver is the subject', () => {
    const [event] = playsToLiveEvents(game([play()]))

    // The subject rule is unchanged — this is what makes the preservation necessary.
    expect(event.playerName).toBe('Drake London')
    expect(event.participants?.find((p) => p.role === 'passer')?.name).toBe('Michael Penix Jr.')
  })

  it('preserves ids as strings, matching the LiveEvent id convention', () => {
    const [event] = playsToLiveEvents(game([play()]))
    expect(event.participants?.find((p) => p.role === 'passer')?.id).toBe('900')
  })

  it('keeps position and team so IDP and team-defense audiences stay resolvable later', () => {
    const [event] = playsToLiveEvents(game([play()]))
    const passer = event.participants?.find((p) => p.role === 'passer')
    expect(passer).toMatchObject({ position: 'QB', team: 'ATL' })
  })

  it('carries a null id rather than dropping an unidentified participant', () => {
    const [event] = playsToLiveEvents(
      game([
        play({
          players: [
            { id: null, name: 'Unlisted Defender', role: 'defender', action: 'tackle', position: null, teamAbbr: 'CAR' },
            ...play().players,
          ],
        }),
      ]),
    )

    expect(event.participants?.find((p) => p.name === 'Unlisted Defender')?.id).toBeNull()
  })
})

describe('one play, one event — already true on this source', () => {
  it('emits a TOUCHDOWN and no separate 20+ gain for a 25-yard scoring pass', () => {
    // `classify` short-circuits on `isTouchdown`, so the "one TD alert" rule holds here by
    // construction. The box-score detector is the source that needed a collapse.
    const events = playsToLiveEvents(game([play()]))

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('TOUCHDOWN')
  })

  it('gives two distinct plays two distinct idempotency keys', () => {
    const events = playsToLiveEvents(
      game([
        play({ sequence: 42, isTouchdown: false, isScoringPlay: false, yardsGained: 22 }),
        play({ sequence: 55 }),
      ]),
    )

    expect(events).toHaveLength(2)
    expect(events[0].idempotencyKey).not.toBe(events[1].idempotencyKey)
  })

  it('does not emit a reversed play at all', () => {
    expect(playsToLiveEvents(game([play({ isReversed: true })]))).toHaveLength(0)
  })
})
