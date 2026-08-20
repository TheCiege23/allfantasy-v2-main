import { describe, it, expect } from 'vitest'
import {
  parsePlayByPlay,
  playsToLiveEvents,
} from '@/lib/live/rollingInsightsPlayByPlay'

/**
 * Shapes here are built from contracts/rolling-insights/PLAY-BY-PLAY.yaml, which
 * is normative and fully typed. Nothing was captured from the live API — these
 * are not probe fixtures.
 *
 * Each test covers a trap the contract calls out by name, because those are the
 * ways this parser silently produces wrong sentences rather than failing.
 */

function game(plays: unknown[]) {
  return {
    data: {
      NFL: [
        {
          game_ID: '20251221-1-26',
          awayTeamName: 'Buffalo Bills',
          homeTeamName: 'Houston Texans',
          plays,
        },
      ],
    },
  }
}

const basePlay = {
  sequence: 2,
  quarter: 1,
  gameClock: '14:56 - 1st',
  event: 'run',
  down: 1,
  yardsToGo: 10,
  yardLine: 'BUF 25',
  yardsGained: 4,
  possession: 'Buffalo Bills',
  success: true,
  isBlocked: false,
  isReturned: false,
  isReversed: false,
  isFirstDown: false,
  isRecovered: false,
  isTouchdown: false,
  isChallenged: false,
  isScoringPlay: false,
  description: 'J.Cook rushed up the middle for 4 yards.',
  players: [
    { id: 4242, name: 'James Cook', role: 'rusher', action: 'rush', position: 'RB', teamAbbr: 'BUF' },
  ],
  details: {},
}

describe('parsePlayByPlay', () => {
  it('reads the data.NFL[] envelope and its required game fields', () => {
    const games = parsePlayByPlay(game([basePlay]))
    expect(games).toHaveLength(1)
    expect(games[0]!.gameId).toBe('20251221-1-26')
    expect(games[0]!.homeTeamName).toBe('Houston Texans')
    expect(games[0]!.plays).toHaveLength(1)
  })

  it('skips a play missing a contract-required key rather than half-building it', () => {
    const games = parsePlayByPlay(game([{ ...basePlay, description: '' }]))
    expect(games[0]!.plays).toHaveLength(0)
  })

  it('returns [] for a payload that is not the documented envelope', () => {
    expect(parsePlayByPlay(null)).toEqual([])
    expect(parsePlayByPlay({ data: {} })).toEqual([])
  })
})

describe('playsToLiveEvents — the classification traps', () => {
  it('TOUCHDOWN is not in the event enum, so it must come from isTouchdown', () => {
    // The contract's biggest gotcha: `event` stays 'run' on a rushing TD.
    const g = parsePlayByPlay(game([{ ...basePlay, isTouchdown: true, isScoringPlay: true, yardsGained: 3 }]))[0]!
    const events = playsToLiveEvents(g)
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('TOUCHDOWN')
    expect(events[0]!.playerName).toBe('James Cook')
  })

  it('a defensive touchdown is attributed by player role, not by event alone', () => {
    const g = parsePlayByPlay(game([{
      ...basePlay,
      event: 'interception',
      isTouchdown: true,
      isScoringPlay: true,
      description: 'Intercepted and returned for a touchdown.',
      players: [{ id: 77, name: 'Christian Benford', role: 'interceptor', action: 'intercepted', position: 'CB', teamAbbr: 'BUF' }],
    }]))[0]!
    expect(playsToLiveEvents(g)[0]!.type).toBe('DEFENSIVE_SCORE')
  })

  it('uses the contract threshold of 20 yards for a big play', () => {
    const under = parsePlayByPlay(game([{ ...basePlay, yardsGained: 19 }]))[0]!
    expect(playsToLiveEvents(under)).toHaveLength(0)

    const over = parsePlayByPlay(game([{ ...basePlay, yardsGained: 20 }]))[0]!
    const events = playsToLiveEvents(over)
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('BIG_PLAY')
    expect(events[0]!.delta).toBe(20)
  })

  it('drops a reversed play — it did not happen', () => {
    const g = parsePlayByPlay(game([{ ...basePlay, isTouchdown: true, isReversed: true }]))[0]!
    expect(playsToLiveEvents(g)).toHaveLength(0)
  })

  it('never attributes a turnover to the ambiguous `fumbler` role', () => {
    // GAPS N-06: `fumbler` may mean who fumbled OR who forced it. A turnover
    // with only a fumbler present must emit nothing rather than blame someone.
    const onlyFumbler = parsePlayByPlay(game([{
      ...basePlay,
      event: 'fumble',
      players: [{ id: 9, name: 'Unclear Person', role: 'fumbler', action: 'fumble', position: 'RB', teamAbbr: 'BUF' }],
    }]))[0]!
    expect(playsToLiveEvents(onlyFumbler)).toHaveLength(0)

    // With a recoverer present, that is who the event belongs to.
    const withRecoverer = parsePlayByPlay(game([{
      ...basePlay,
      event: 'fumble',
      players: [
        { id: 9, name: 'Unclear Person', role: 'fumbler', action: 'fumble', position: 'RB', teamAbbr: 'BUF' },
        { id: 10, name: 'Recovering Player', role: 'recoverer', action: 'fumble_recovery', position: 'LB', teamAbbr: 'HOU' },
      ],
    }]))[0]!
    const ev = playsToLiveEvents(withRecoverer)
    expect(ev).toHaveLength(1)
    expect(ev[0]!.playerName).toBe('Recovering Player')
  })
})

describe('playsToLiveEvents — sequence is a high-water mark, not a count', () => {
  it('emits only plays after the given sequence, despite sparse numbering', () => {
    // The contract warns sequence is monotonic but sparse — never 1..N.
    const g = parsePlayByPlay(game([
      { ...basePlay, sequence: 2, yardsGained: 25 },
      { ...basePlay, sequence: 41, yardsGained: 30 },
      { ...basePlay, sequence: 96, yardsGained: 22 },
    ]))[0]!

    expect(playsToLiveEvents(g)).toHaveLength(3)
    expect(playsToLiveEvents(g, { sinceSequence: 41 })).toHaveLength(1)
    expect(playsToLiveEvents(g, { sinceSequence: 96 })).toHaveLength(0)
  })

  it('gives every event a stable idempotency key so a re-poll cannot double-notify', () => {
    const g = parsePlayByPlay(game([{ ...basePlay, yardsGained: 25 }]))[0]!
    const a = playsToLiveEvents(g, { now: new Date('2026-08-21T00:10:00Z') })
    const b = playsToLiveEvents(g, { now: new Date('2026-08-21T00:10:12Z') })
    expect(a[0]!.idempotencyKey).toBe(b[0]!.idempotencyKey)
    expect(a[0]!.idempotencyKey).toContain('20251221-1-26')
  })
})
