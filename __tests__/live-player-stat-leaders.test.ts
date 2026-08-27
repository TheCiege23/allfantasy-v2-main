import { describe, expect, it } from 'vitest'
import {
  detectStatFamily,
  leadersFromEvents,
  type StatFamily,
} from '@/lib/live/playerStatLeaders'
import type { LiveEvent } from '@/lib/live/eventDetector'

function ev(over: Partial<LiveEvent> = {}): LiveEvent {
  return {
    gameId: 'g1',
    playerId: 'p1',
    playerName: 'Josh Allen',
    team: 'BUF',
    type: 'TOUCHDOWN',
    stat: 'rushing_touchdowns',
    delta: 1,
    value: 1,
    detectedAt: new Date('2026-08-27T23:30:00Z'),
    idempotencyKey: 'k1',
    detail: 'J.Allen 3 yd rush TOUCHDOWN',
    ...over,
  } as LiveEvent
}

describe('detectStatFamily', () => {
  it('reads the abbreviation people actually use', () => {
    expect(detectStatFamily('who has the most TDs today?')).toBe('touchdowns')
    expect(detectStatFamily('who leads in touchdowns?')).toBe('touchdowns')
    expect(detectStatFamily('most passing yards today')).toBe('passing_yards')
  })

  it('is null for anything that is not a stat question', () => {
    expect(detectStatFamily('who should I start?')).toBeNull()
    expect(detectStatFamily('when is the next game?')).toBeNull()
  })
})

describe('leadersFromEvents', () => {
  const TD: StatFamily = 'touchdowns'

  it('ranks players by their cumulative total', () => {
    const leaders = leadersFromEvents(
      [
        ev({ playerId: 'p1', playerName: 'Josh Allen', value: 2 }),
        ev({ playerId: 'p2', playerName: 'James Cook', value: 1, idempotencyKey: 'k2' }),
      ],
      TD,
    )

    expect(leaders.map((l) => l.playerName)).toEqual(['Josh Allen', 'James Cook'])
    expect(leaders[0].total).toBe(2)
  })

  /*
   * THE bug this reducer exists to avoid. Polling plus retries re-emit the same
   * change — the feed carries an idempotencyKey precisely because of it — so
   * summing deltas counts one touchdown several times.
   */
  it('does not double count a play the feed re-emitted', () => {
    const leaders = leadersFromEvents(
      [
        ev({ value: 1, idempotencyKey: 'same' }),
        ev({ value: 1, idempotencyKey: 'same' }),
        ev({ value: 1, idempotencyKey: 'same' }),
      ],
      TD,
    )

    expect(leaders[0].total).toBe(1)
  })

  it('takes the newest cumulative value, not the first seen', () => {
    const leaders = leadersFromEvents([ev({ value: 1 }), ev({ value: 3 }), ev({ value: 2 })], TD)
    expect(leaders[0].total).toBe(3)
  })

  it('adds a player’s rushing and receiving scores together', () => {
    const leaders = leadersFromEvents(
      [
        ev({ stat: 'rushing_touchdowns', value: 1 }),
        ev({ stat: 'receiving_touchdowns', value: 2 }),
      ],
      TD,
    )

    expect(leaders[0].total).toBe(3)
    expect(leaders[0].stats).toEqual(['receiving_touchdowns', 'rushing_touchdowns'])
  })

  it('ignores stats from another family', () => {
    const leaders = leadersFromEvents(
      [ev({ stat: 'passing_yards', value: 300 }), ev({ stat: 'rushing_touchdowns', value: 1 })],
      TD,
    )

    expect(leaders).toHaveLength(1)
    expect(leaders[0].total).toBe(1)
  })

  /*
   * The real feed carries negative cumulative values — a production row had
   * `interception` at -2. Those are corrections or defensive stats, never a
   * touchdown count.
   */
  it('drops a negative cumulative value rather than reporting it', () => {
    const leaders = leadersFromEvents(
      [ev({ stat: 'defensive_touchdowns', value: -2, playerId: 'p9' })],
      TD,
    )

    expect(leaders).toEqual([])
  })

  it('keeps a team once it appears, since early events carry null', () => {
    const leaders = leadersFromEvents([ev({ team: null, value: 1 }), ev({ team: 'BUF', value: 2 })], TD)
    expect(leaders[0].team).toBe('BUF')
  })

  it('breaks ties by name so repeated calls agree', () => {
    const leaders = leadersFromEvents(
      [
        ev({ playerId: 'b', playerName: 'Zach Moss', value: 1 }),
        ev({ playerId: 'a', playerName: 'Amari Cooper', value: 1 }),
      ],
      TD,
    )

    expect(leaders.map((l) => l.playerName)).toEqual(['Amari Cooper', 'Zach Moss'])
  })

  it('is empty for an empty feed, which is not the same as nobody scoring', () => {
    expect(leadersFromEvents([], TD)).toEqual([])
  })

  it('survives malformed rows without dropping the good ones', () => {
    const leaders = leadersFromEvents(
      [
        { ...ev(), stat: undefined as never },
        { ...ev(), value: Number.NaN },
        ev({ playerId: 'ok', playerName: 'Real Player', value: 1 }),
      ],
      TD,
    )

    expect(leaders.map((l) => l.playerName)).toEqual(['Real Player'])
  })
})
