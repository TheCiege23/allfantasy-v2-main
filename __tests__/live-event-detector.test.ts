import { describe, expect, it } from 'vitest'
import {
  detectEvents,
  pollIntervalSeconds,
  selectNotifiable,
  type GameSnapshot,
} from '@/lib/live/eventDetector'

const AT = new Date('2026-09-13T18:00:00Z')

function snap(stats: Record<string, number>, status = 'in_progress'): GameSnapshot {
  return {
    gameId: 'G1',
    status,
    capturedAt: AT,
    players: [{ playerId: 'p1', playerName: 'Test Player', team: 'KC', stats }],
  }
}

describe('event detection', () => {
  it('emits NOTHING on the first snapshot', () => {
    // Joining a game at half-time must not fire an alert for every TD already
    // scored. The first poll is a baseline, not a burst of stale news.
    const events = detectEvents(null, snap({ rushing_touchdowns: 3, rushing_long: 45 }))
    expect(events).toHaveLength(0)
  })

  it('detects a touchdown exactly once', () => {
    const e = detectEvents(snap({ rushing_touchdowns: 0 }), snap({ rushing_touchdowns: 1 }))
    expect(e).toHaveLength(1)
    expect(e[0].type).toBe('TOUCHDOWN')
    expect(e[0].detail).toContain('rushing TD')
  })

  it('separates defensive and special-teams scores from offensive ones', () => {
    const e = detectEvents(
      snap({ defense_touchdowns: 0, kick_return_touchdowns: 0 }),
      snap({ defense_touchdowns: 1, kick_return_touchdowns: 1 })
    )
    expect(e.map((x) => x.type).sort()).toEqual(['DEFENSIVE_SCORE', 'SPECIAL_TEAMS_SCORE'])
  })

  it('detects turnovers', () => {
    const e = detectEvents(snap({ fumbles_lost: 0 }), snap({ fumbles_lost: 1 }))
    expect(e[0].type).toBe('TURNOVER')
  })

  describe('longest-gain fallback — used only when attempt counts are absent', () => {
    it('fires on the FIRST big play', () => {
      const e = detectEvents(snap({ rushing_long: 8 }), snap({ rushing_long: 40 }))
      expect(e).toHaveLength(1)
      expect(e[0].type).toBe('BIG_PLAY')
      expect(e[0].detail).toContain('40 yard rush')
    })

    it('alone, cannot see a second big play behind a longer one', () => {
      // With NO attempt counts, rushing_long is the only signal and it is stuck at
      // 40. This is why the single-attempt path exists — see the suite below,
      // which detects exactly this case when attempt data IS present.
      const e = detectEvents(snap({ rushing_long: 40 }), snap({ rushing_long: 40 }))
      expect(e).toHaveLength(0)
    })

    it('ignores a long gain below the threshold', () => {
      const e = detectEvents(snap({ rushing_long: 2 }), snap({ rushing_long: 12 }))
      expect(e).toHaveLength(0)
    })
  })

  it('IGNORES negative deltas — a stat correction is not a play', () => {
    // Providers revise numbers downward mid-game. Treating that as an event would
    // fire "touchdown!" in reverse.
    const e = detectEvents(snap({ rushing_touchdowns: 2 }), snap({ rushing_touchdowns: 1 }))
    expect(e).toHaveLength(0)
  })

  it('produces a retry-stable idempotency key', () => {
    const a = detectEvents(snap({ rushing_touchdowns: 0 }), snap({ rushing_touchdowns: 1 }))
    const b = detectEvents(snap({ rushing_touchdowns: 0 }), snap({ rushing_touchdowns: 1 }))
    // Same underlying state change -> same key, so a re-poll dedupes rather than
    // double-notifying.
    expect(a[0].idempotencyKey).toBe(b[0].idempotencyKey)
    expect(a[0].idempotencyKey).toContain('rushing_touchdowns')
  })

  it('treats a player absent from the previous snapshot as starting from zero', () => {
    const prev: GameSnapshot = { gameId: 'G1', status: 'in_progress', capturedAt: AT, players: [] }
    const e = detectEvents(prev, snap({ rushing_touchdowns: 1 }))
    expect(e).toHaveLength(1)
  })
})

describe('poll cadence', () => {
  it('polls fast while live and stops when final', () => {
    // 15s, not 12s: the provider's own SLA is ~60s, so polling faster cannot
    // outrun data that refreshes once a minute.
    expect(pollIntervalSeconds('in_progress')).toBe(15)
    expect(pollIntervalSeconds('Final')).toBe(0)
    expect(pollIntervalSeconds('scheduled')).toBe(60)
  })
})

describe('notification selection — the attention budget', () => {
  const mk = (playerId: string, type: 'TOUCHDOWN' | 'BIG_PLAY') => ({
    gameId: 'G1', playerId, playerName: playerId, team: 'KC',
    type, stat: 's', delta: 1, value: 1, detectedAt: AT,
    idempotencyKey: `${playerId}|${type}`, detail: '',
  })

  it('defaults to the user\'s own players', () => {
    const out = selectNotifiable(
      [mk('mine', 'TOUCHDOWN'), mk('theirs', 'TOUCHDOWN')],
      { rosteredPlayerIds: new Set(['mine']), maxPerWindow: 10 }
    )
    expect(out.map((e) => e.playerId)).toEqual(['mine'])
  })

  it('ranks touchdowns above long gains when the cap bites', () => {
    // With one slot, the TD must win — a 21-yard gain usually is not news.
    const out = selectNotifiable(
      [mk('a', 'BIG_PLAY'), mk('b', 'TOUCHDOWN')],
      { rosteredPlayerIds: new Set(['a', 'b']), maxPerWindow: 1 }
    )
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('TOUCHDOWN')
  })

  it('enforces the cap, because an uncapped feed is spam', () => {
    const many = Array.from({ length: 50 }, (_, i) => mk(`p${i}`, 'TOUCHDOWN'))
    const ids = new Set(many.map((m) => m.playerId))
    expect(selectNotifiable(many, { rosteredPlayerIds: ids, maxPerWindow: 5 })).toHaveLength(5)
  })
})

describe('single-attempt inference — big plays without play-by-play', () => {
  const p = (stats: Record<string, number>): GameSnapshot => ({
    gameId: 'G1', status: 'in_progress', capturedAt: AT,
    players: [{ playerId: 'p1', playerName: 'Test Player', team: 'KC', stats }],
  })

  it('SEES a 25-yard run that follows an earlier 40-yarder', () => {
    // The exact case longest-gain cannot detect: rushing_long stays at 40, but
    // one extra carry produced 25 yards, so that carry was a 25-yard run.
    const before = p({ rushing_attempts: 5, rushing_yards: 60, rushing_long: 40 })
    const after = p({ rushing_attempts: 6, rushing_yards: 85, rushing_long: 40 })
    const e = detectEvents(before, after)
    expect(e).toHaveLength(1)
    expect(e[0].type).toBe('BIG_PLAY')
    expect(e[0].detail).toContain('25 yard rush')
  })

  it('detects a big reception the same way', () => {
    const before = p({ receptions: 3, receiving_yards: 30, receiving_long: 18 })
    const after = p({ receptions: 4, receiving_yards: 62, receiving_long: 32 })
    const e = detectEvents(before, after)
    expect(e.filter((x) => x.type === 'BIG_PLAY')).toHaveLength(1)
  })

  it('stays SILENT when several touches share one interval', () => {
    // 30 yards across 3 carries cannot be attributed to one play. Guessing here
    // would fabricate a big play that never happened.
    const before = p({ rushing_attempts: 5, rushing_yards: 60, rushing_long: 40 })
    const after = p({ rushing_attempts: 8, rushing_yards: 90, rushing_long: 40 })
    expect(detectEvents(before, after)).toHaveLength(0)
  })

  it('does not double-emit when both signals fire on the same play', () => {
    // One 45-yard carry raises yards by 45 AND rushing_long to 45.
    const before = p({ rushing_attempts: 5, rushing_yards: 60, rushing_long: 20 })
    const after = p({ rushing_attempts: 6, rushing_yards: 105, rushing_long: 45 })
    const e = detectEvents(before, after).filter((x) => x.type === 'BIG_PLAY')
    expect(e).toHaveLength(1)
  })

  it('ignores a single short carry', () => {
    const before = p({ rushing_attempts: 5, rushing_yards: 60 })
    const after = p({ rushing_attempts: 6, rushing_yards: 64 })
    expect(detectEvents(before, after)).toHaveLength(0)
  })
})
