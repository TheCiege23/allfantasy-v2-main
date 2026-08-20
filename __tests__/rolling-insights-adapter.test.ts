import { describe, expect, it } from 'vitest'
import {
  hasActiveGames,
  interpretPollResponse,
  liveUrl,
  normaliseStatus,
  parseLivePayload,
} from '@/lib/live/rollingInsightsAdapter'
import { detectEvents } from '@/lib/live/eventDetector'

const AT = new Date('2025-11-16T18:00:00Z')

/** Shape taken from a real 200 response (2025-11-16, 13 games), trimmed. */
const REAL_SHAPE = {
  data: {
    NFL: [
      {
        game_ID: '20251116-11-9',
        game_status: 'Final OT',
        away_team_name: 'Washington Commanders',
        home_team_name: 'Miami Dolphins',
        player_box: {
          away_team: {
            '8735': {
              player: 'Ollie Gordon Ii', position: 'RB', position_category: 'OFF', status: 'ACT',
              rushing_attempts: 12, rushing_yards: 58, rushing_touchdowns: 1, rushing_long: 22,
              snap_counts: { offense: 40 }, DK_fantasy_points: 14.8, passer_rating: 0,
            },
          },
          home_team: {
            '143': {
              player: 'Marcus Mariota', position: 'QB', position_category: 'OFF', status: 'ACT',
              passing_yards: 213, passing_touchdowns: 1, passing_interceptions: 1,
              rushing_long: 44, fumbles_lost: 0, DK_fantasy_points: 16.42,
            },
          },
        },
      },
    ],
  },
}

describe('Rolling Insights adapter', () => {
  it('parses the real payload shape into snapshots', () => {
    const snaps = parseLivePayload(REAL_SHAPE, AT)
    expect(snaps).toHaveLength(1)
    expect(snaps[0].gameId).toBe('20251116-11-9')
    expect(snaps[0].players).toHaveLength(2)
  })

  it('NEVER lets DK_fantasy_points into a stat payload', () => {
    // It encodes DraftKings scoring — no TE premium, no custom IDP, no 6-pt
    // passing TDs. A caller reading it as "the" fantasy score would be wrong for
    // most leagues.
    const snaps = parseLivePayload(REAL_SHAPE, AT)
    for (const p of snaps[0].players) {
      expect(p.stats).not.toHaveProperty('DK_fantasy_points')
    }
  })

  it('drops non-stat fields but keeps every real counter', () => {
    const snaps = parseLivePayload(REAL_SHAPE, AT)
    const rb = snaps[0].players.find((p) => p.playerName.startsWith('Ollie'))!
    expect(rb.stats.rushing_touchdowns).toBe(1)
    expect(rb.stats.rushing_long).toBe(22)
    expect(rb.stats).not.toHaveProperty('snap_counts')
    expect(rb.stats).not.toHaveProperty('passer_rating')
  })

  it('attributes players to the correct side', () => {
    const snaps = parseLivePayload(REAL_SHAPE, AT)
    const away = snaps[0].players.find((p) => p.playerName.startsWith('Ollie'))!
    expect(away.team).toBe('Washington Commanders')
  })

  it('normalises the status strings the feed actually emits', () => {
    expect(normaliseStatus('Final OT')).toBe('final')
    expect(normaliseStatus('Final')).toBe('final')
    expect(normaliseStatus('In Progress')).toBe('in_progress')
    expect(normaliseStatus('Scheduled')).toBe('scheduled')
  })

  describe('304 is success, not emptiness', () => {
    it('reports unchanged so the caller skips parse AND diff', () => {
      // The entire cost advantage of a 12s cadence depends on doing no work here.
      expect(interpretPollResponse(304, null, AT)).toEqual({ kind: 'unchanged' })
    })

    it('reports changed on a 200 with games', () => {
      const r = interpretPollResponse(200, REAL_SHAPE, AT)
      expect(r.kind).toBe('changed')
    })

    it('reports a real error separately from unchanged', () => {
      expect(interpretPollResponse(500, null, AT)).toEqual({ kind: 'error', status: 500 })
    })
  })

  it('stops polling once every game is final', () => {
    // A poller left running on finished games returns 304 forever and looks
    // healthy while burning quota.
    const snaps = parseLivePayload(REAL_SHAPE, AT)
    expect(hasActiveGames(snaps)).toBe(false)
  })

  it('always builds an https url', () => {
    // The docs show http:// throughout; https works and keeps the token off the
    // wire in cleartext.
    expect(liveUrl('2025-11-16', 'tok')).toMatch(/^https:\/\//)
    expect(liveUrl('2025-11-16', 'tok')).toContain('RSC_token=tok')
  })

  it('feeds the detector end to end', () => {
    const [next] = parseLivePayload(REAL_SHAPE, AT)
    const prev = { ...next, players: next.players.map((p) => ({ ...p, stats: { ...p.stats, rushing_touchdowns: 0 } })) }
    const events = detectEvents(prev, next)
    expect(events.some((e) => e.type === 'TOUCHDOWN')).toBe(true)
  })
})
