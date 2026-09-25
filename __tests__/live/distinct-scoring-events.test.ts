import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * N2 — a big play could suppress a later touchdown.
 *
 * `lib/notification-engine.ts` applies a ten-minute cooldown for `live_score_swing`, keyed on
 * `buildSourceKey`: event type + league + player. Every qualifying play from
 * `bigPlayNotifier` becomes a `live_score_swing` for the same player, so a 22-yard gain and the
 * touchdown that followed it shared a key — the gain notified, and the score came back
 * `reason: 'cooldown'`.
 *
 * The producers already carried a stable per-play identity and nothing read it.
 */

const h = vi.hoisted(() => ({
  notifFindMany: vi.fn(),
  teamFindMany: vi.fn(),
  dispatchNotification: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformNotification: { findMany: h.notifFindMany },
    leagueTeam: { findMany: h.teamFindMany },
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: h.dispatchNotification,
}))

import { ingest, type NotificationEvent } from '@/lib/notification-engine'
import { collapseScoringDuplicates } from '@/lib/live/bigPlayNotifier'
import type { LiveEvent } from '@/lib/live/eventDetector'

const GAME = '20260920-1-26'

const swing = (over: Partial<NotificationEvent> = {}): NotificationEvent =>
  ({
    type: 'live_score_swing',
    title: 'Big play',
    userIds: ['user-1'],
    source: 'live-plays',
    meta: {
      gameId: GAME,
      playerId: '101',
      playerName: 'Bijan Robinson',
      sport: 'NFL',
      idempotencyKey: `${GAME}|101|rushing_yards|88`,
    },
    ...over,
  }) as NotificationEvent

/** The row the cooldown query returns for a user who already got THIS sourceKey. */
const cooling = () => [{ userId: 'user-1' }]

beforeEach(() => {
  h.notifFindMany.mockReset().mockResolvedValue([])
  h.teamFindMany.mockReset().mockResolvedValue([])
  h.dispatchNotification.mockReset().mockResolvedValue(undefined)
})

describe('dedupe key identity', () => {
  it('keys on the stable play identity, not on the player', async () => {
    await ingest(swing())
    const key = h.dispatchNotification.mock.calls[0][0].meta.sourceKey
    // Main's key format: `${type}:${sport}:${stableId}` — no `evt:` marker.
    expect(key).toBe(`live_score_swing:NFL:${GAME}|101|rushing_yards|88`)
    expect(key).not.toBe('live_score_swing:101:Bijan Robinson')
  })

  it('gives a gain and a touchdown by the SAME player different keys', async () => {
    await ingest(swing())
    await ingest(
      swing({
        meta: {
          gameId: GAME,
          playerId: '101',
          playerName: 'Bijan Robinson',
          sport: 'NFL',
          idempotencyKey: `${GAME}|101|rushing_touchdowns|1`,
        },
      }),
    )

    const [first, second] = h.dispatchNotification.mock.calls.map((c) => c[0].meta.sourceKey)
    expect(first).not.toBe(second)
  })

  it('gives a REPLAY of the same play the same key', async () => {
    await ingest(swing())
    await ingest(swing())

    const [first, second] = h.dispatchNotification.mock.calls.map((c) => c[0].meta.sourceKey)
    expect(first).toBe(second)
  })

  it('separates the same game/play id across sports', async () => {
    await ingest(swing())
    await ingest(swing({ meta: { ...swing().meta, sport: 'NCAAF' } }))

    const [a, b] = h.dispatchNotification.mock.calls.map((c) => c[0].meta.sourceKey)
    expect(a).not.toBe(b)
  })

  it('leaves events with no stable identity on the previous key shape', async () => {
    // Injuries, news, trades and waivers are identified perfectly well by player or trade id;
    // changing their keys would reset every cooldown in flight.
    await ingest({
      type: 'injury_update',
      title: 'Out',
      userIds: ['user-1'],
      meta: { playerId: '101', playerName: 'Bijan Robinson' },
    } as NotificationEvent)

    expect(h.dispatchNotification.mock.calls[0][0].meta.sourceKey).toBe(
      'injury_update:101:Bijan Robinson',
    )
  })
})

describe('the cooldown', () => {
  it('still suppresses a replay of the same play', async () => {
    // The dedupe half of the requirement: replaying an event must not duplicate it.
    h.notifFindMany.mockResolvedValue(cooling())

    const res = await ingest(swing())

    expect(res).toMatchObject({ dispatched: false, reason: 'cooldown' })
    expect(h.dispatchNotification).not.toHaveBeenCalled()
  })

  it('does NOT suppress a different play by the same player inside the window', async () => {
    /*
     * The reproduction. `filterUsersInCooldown` matches on the stored row's `meta.sourceKey`,
     * so it only returns a cooling user when the key MATCHES. Pre-fix both plays produced one
     * key and the touchdown was filtered out; here the query is asked about the touchdown's own
     * key and finds nothing.
     */
    h.notifFindMany.mockImplementation((args: { where: { meta: { equals: string } } }) =>
      Promise.resolve(
        args.where.meta.equals.includes('rushing_yards') ? cooling() : [],
      ),
    )

    const gain = await ingest(swing())
    const td = await ingest(
      swing({
        meta: {
          gameId: GAME,
          playerId: '101',
          playerName: 'Bijan Robinson',
          sport: 'NFL',
          idempotencyKey: `${GAME}|101|rushing_touchdowns|1`,
        },
      }),
    )

    expect(gain).toMatchObject({ dispatched: false, reason: 'cooldown' })
    expect(td.dispatched).toBe(true)
  })
})

// ── One play, one alert ──────────────────────────────────────────────────────

const live = (over: Partial<LiveEvent> = {}): LiveEvent =>
  ({
    gameId: GAME,
    playerId: '101',
    playerName: 'Bijan Robinson',
    team: 'ATL',
    type: 'BIG_PLAY',
    stat: 'rushing_yards',
    delta: 25,
    value: 88,
    detectedAt: new Date('2026-09-20T18:00:00Z'),
    idempotencyKey: `${GAME}|101|rushing_yards|88`,
    detail: 'run',
    ...over,
  }) as LiveEvent

/** A play-by-play observation: real play identity, sport-namespaced. */
const pbp = (over: Partial<LiveEvent> = {}): LiveEvent =>
  live({
    sport: 'NFL',
    provider: 'rolling_insights_pbp',
    idempotencyKey: `pbp:${GAME}:40:BIG_PLAY`,
    stat: 'rush',
    ...over,
  })

describe('distinct play-by-play sequences survive the same batch', () => {
  /*
   * 🛑 THE FIRST VERSION OF THE COLLAPSE DELETED REAL BIG PLAYS AND THIS IS THE REGRESSION.
   * It keyed on (game, player, stat family) across the whole batch with no notion of which PLAY
   * each event came from. `refreshPlayByPlayFeed` notifies on `fresh` — every play discovered
   * since the cursor — so one batch routinely spans a whole drive.
   */
  it('keeps a 30-yard run at sequence 40 when a TD lands at sequence 88', () => {
    const out = collapseScoringDuplicates([
      pbp({ idempotencyKey: `pbp:${GAME}:40:BIG_PLAY`, delta: 30 }),
      pbp({ idempotencyKey: `pbp:${GAME}:88:TOUCHDOWN`, type: 'TOUCHDOWN', delta: 1 }),
    ])

    expect(out).toHaveLength(2)
  })

  it('collapses only within ONE sequence', () => {
    // The safety net: `classify` already emits one event per play, so this should never fire.
    const out = collapseScoringDuplicates([
      pbp({ idempotencyKey: `pbp:${GAME}:40:BIG_PLAY`, delta: 25 }),
      pbp({ idempotencyKey: `pbp:${GAME}:40:TOUCHDOWN`, type: 'TOUCHDOWN', delta: 1 }),
    ])

    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('TOUCHDOWN')
  })

  it('keeps two touchdowns by the same player in one batch', () => {
    const out = collapseScoringDuplicates([
      pbp({ idempotencyKey: `pbp:${GAME}:30:TOUCHDOWN`, type: 'TOUCHDOWN' }),
      pbp({ idempotencyKey: `pbp:${GAME}:95:TOUCHDOWN`, type: 'TOUCHDOWN' }),
    ])

    expect(out).toHaveLength(2)
  })
})

describe('mixed box-score and play-by-play observations of one touchdown', () => {
  it('does not double-notify the same score when the box-score side has NO sport', () => {
    /*
     * 🛑 THIS IS THE CONFIGURATION PRODUCTION ACTUALLY PRODUCES, and the original test did not
     * use it. `detectEvents` sets `sport: opts.sport` and no caller passes one, so a box-score
     * event's namespace is the literal `'unknown'` while the PBP mapper hardcodes `'NFL'`. The
     * original assertion hand-supplied `sport: 'NFL'` on the box-score fixture — a value that
     * path cannot produce — so it passed over unreachable code.
     */
    const out = collapseScoringDuplicates([
      pbp({ idempotencyKey: `pbp:${GAME}:88:TOUCHDOWN`, type: 'TOUCHDOWN' }),
      live({ type: 'TOUCHDOWN', stat: 'rushing_touchdowns', delta: 1, value: 1, sport: undefined }),
    ])

    expect(out).toHaveLength(1)
    expect(out[0].provider).toBe('rolling_insights_pbp')
  })

  it('does not double-notify the same score when both name the sport', () => {
    /*
     * 🛑 THE TWO FEEDS KEY THE SAME TOUCHDOWN ON STRINGS THAT CANNOT BE COMPARED.
     * PBP: `pbp:game:88:TOUCHDOWN`. Box score: `game|101|rushing_touchdowns|1`. Nothing about
     * them matches, so every dedupe downstream — the engine's cooldown included — sees two
     * events and the phone buzzes twice for one score.
     */
    const out = collapseScoringDuplicates([
      pbp({ idempotencyKey: `pbp:${GAME}:88:TOUCHDOWN`, type: 'TOUCHDOWN' }),
      live({ type: 'TOUCHDOWN', stat: 'rushing_touchdowns', delta: 1, value: 1, sport: 'NFL' }),
    ])

    expect(out).toHaveLength(1)
  })

  it('keeps the play-scoped observation, which carries the description and participants', () => {
    const out = collapseScoringDuplicates([
      live({ type: 'TOUCHDOWN', stat: 'rushing_touchdowns', delta: 1, value: 1, sport: 'NFL' }),
      pbp({ idempotencyKey: `pbp:${GAME}:88:TOUCHDOWN`, type: 'TOUCHDOWN' }),
    ])

    expect(out).toHaveLength(1)
    expect(out[0].provider).toBe('rolling_insights_pbp')
  })

  it('does not drop a box-score touchdown that no play-by-play observation covers', () => {
    const out = collapseScoringDuplicates([
      live({ type: 'TOUCHDOWN', stat: 'rushing_touchdowns', delta: 1, value: 1, sport: 'NFL' }),
    ])

    expect(out).toHaveLength(1)
  })
})

describe('sport namespaces stop unrelated ids colliding', () => {
  it('does not let an NBA game id suppress an NFL play', () => {
    // Providers reuse short ids across sports; `gameId` alone is not unique.
    const out = collapseScoringDuplicates([
      live({ sport: 'NFL', stat: 'rushing_yards', delta: 30 }),
      live({ sport: 'NBA', type: 'TOUCHDOWN', stat: 'rushing_touchdowns', delta: 1, value: 1 }),
    ])

    expect(out).toHaveLength(2)
  })

  it('still collapses within one sport', () => {
    const out = collapseScoringDuplicates([
      live({ sport: 'NFL', stat: 'rushing_yards', delta: 30 }),
      live({ sport: 'NFL', type: 'TOUCHDOWN', stat: 'rushing_touchdowns', delta: 1, value: 1 }),
    ])

    expect(out).toHaveLength(1)
  })

  it('treats an unknown sport as its own namespace, never as NFL', () => {
    const out = collapseScoringDuplicates([
      live({ sport: undefined, stat: 'rushing_yards', delta: 30 }),
      live({ sport: 'NFL', type: 'TOUCHDOWN', stat: 'rushing_touchdowns', delta: 1, value: 1 }),
    ])

    expect(out).toHaveLength(2)
  })
})

describe('a 20+ yard touchdown is one alert', () => {
  it('drops the yardage event when the same player scored on the same stat family', () => {
    const out = collapseScoringDuplicates([
      live(),
      live({ type: 'TOUCHDOWN', stat: 'rushing_touchdowns', delta: 1, value: 1 }),
    ])

    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('TOUCHDOWN')
  })

  it('keeps a receiving gain when the touchdown was a RUSH', () => {
    // Keying the collapse on the player alone would delete a real 30-yard catch.
    const out = collapseScoringDuplicates([
      live({ stat: 'receiving_yards', delta: 30 }),
      live({ type: 'TOUCHDOWN', stat: 'rushing_touchdowns', delta: 1, value: 1 }),
    ])

    expect(out).toHaveLength(2)
  })

  it('keeps a gain by a DIFFERENT player in the same game', () => {
    const out = collapseScoringDuplicates([
      live({ playerId: '202', playerName: 'Drake London', stat: 'receiving_yards' }),
      live({ type: 'TOUCHDOWN', stat: 'rushing_touchdowns', delta: 1, value: 1 }),
    ])

    expect(out).toHaveLength(2)
  })

  it('keeps a gain in a different game', () => {
    const out = collapseScoringDuplicates([
      live({ gameId: 'other-game' }),
      live({ type: 'TOUCHDOWN', stat: 'rushing_touchdowns', delta: 1, value: 1 }),
    ])

    expect(out).toHaveLength(2)
  })

  it('is a no-op when nothing scored', () => {
    const events = [live(), live({ playerId: '202' })]
    expect(collapseScoringDuplicates(events)).toHaveLength(2)
  })

  it('never drops a scoring event', () => {
    const out = collapseScoringDuplicates([
      live({ type: 'TOUCHDOWN', stat: 'receiving_touchdowns', delta: 1, value: 1 }),
      live({ type: 'TOUCHDOWN', stat: 'rushing_touchdowns', delta: 1, value: 2 }),
    ])

    expect(out).toHaveLength(2)
  })
})
