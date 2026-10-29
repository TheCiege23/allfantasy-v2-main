/**
 * Guilly chop alerts (lib/guillotine/chopAlerts.ts): the chop-zone warning in the day before the week's
 * last game — again only for a team that slips further — and the chop itself: who is told what, once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  events: [] as Array<{ leagueId: string; eventType: string; metadata: Record<string, unknown> }>,
  rosters: [] as Array<{ id: string; platformUserId: string | null }>,
  /** The throttle lock: key → expiry, on the test's own clock. */
  locks: new Map<string, number>(),
  clock: 0,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    guillotineEventLog: {
      findMany: vi.fn(async ({ where }: { where: { leagueId: string; eventType: string; metadata: { equals: string } } }) =>
        db.events.filter((e) => e.leagueId === where.leagueId && e.eventType === where.eventType && e.metadata.key === where.metadata.equals)),
      create: vi.fn(async ({ data }: { data: (typeof db.events)[number] }) => { db.events.push(data); return data }),
    },
    roster: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => db.rosters.filter((r) => where.id.in.includes(r.id))) },
    league: { findUnique: vi.fn(async () => ({ name: 'Ciege NBA Guilly' })) },
    redraftSeason: { findUnique: vi.fn(async () => ({ leagueId: 'lg1', sport: 'NBA', season: 2026 })) },
  },
}))
// A real TTL lock: held until it expires, whoever asks.
vi.mock('@/lib/automation/locks', () => ({
  acquireAutomationLock: vi.fn(async (key: string, { ttlMs }: { ttlMs: number }) => {
    if ((db.locks.get(key) ?? 0) > db.clock) return { ok: false, reason: 'held' }
    db.locks.set(key, db.clock + ttlMs)
    return { ok: true }
  }),
  releaseAutomationLock: vi.fn(async () => undefined),
}))
// Platform ids are already our user ids here: "p-x" -> "u-x"; "sleeper-only" has no account.
vi.mock('@/lib/notifications/resolveAppUserIds', () => ({
  resolveRecipients: vi.fn(async (ids: string[]) => ({
    userIds: ids.filter((id) => id !== 'sleeper-only').map((id) => id.replace('p-', 'u-')),
    unresolved: ids.filter((id) => id === 'sleeper-only'),
  })),
}))
vi.mock('@/lib/redraft/weekFinalizer', () => ({ readWeekSlate: vi.fn(), DATE_WINDOWED_SPORTS: ['NBA'] }))
vi.mock('@/lib/season-week/deriveDailySportSeasonStart', () => ({ ensureDailySportSeasonStart: vi.fn() }))
vi.mock('@/lib/guillotine/chopPreviewLoad', () => ({ loadChopPreview: vi.fn() }))

import { sendChopResultAlerts, sendChopZoneWarnings, sendChopZoneWarningsForSeason, CHOP_ZONE_RECHECK_MS, CHOP_ZONE_WARNING_LEAD_MS } from '@/lib/guillotine/chopAlerts'
import { chopResultAlert, chopZoneWarning } from '@/lib/guillotine/chopAlertCopy'
import type { ChopPreview, ChopPreviewRow } from '@/lib/guillotine/chopPreview'

const LAST_GAME = new Date('2026-11-02T00:00:00Z')
const row = (rosterId: string, points: number, status: ChopPreviewRow['status'], margin: number | null): ChopPreviewRow =>
  ({ rosterId, name: rosterId, points, status, margin, faabChange: null })

function preview(overrides: Partial<ChopPreview> = {}): ChopPreview {
  return {
    week: 5, weekState: 'live', outcome: 'chop', headline: '', chopCount: 1, chopLine: 80, tiebreak: null,
    faab: null, release: null, announcement: null, notes: [], blockers: [],
    rows: [row('r-top', 140, 'safe', 60), row('r-mid', 100, 'safe', 20), row('r-close', 85, 'danger', 5), row('r-last', 80, 'chopped', 0)],
    ...overrides,
  }
}

let dispatch: ReturnType<typeof vi.fn>
const input = { leagueId: 'lg1', seasonId: 's1', sport: 'NBA', season: 2026, week: 5 }
const at = (ms: number) => { db.clock = ms; return new Date(ms) }
const deps = (over: Record<string, unknown> = {}) => ({
  now: () => at(LAST_GAME.getTime() - 3 * 60 * 60 * 1000),
  dispatch,
  loadPreview: vi.fn(async () => preview()),
  lastGameStart: vi.fn(async () => LAST_GAME),
  ...over,
})

beforeEach(() => {
  db.events = []
  db.locks = new Map()
  db.clock = 0
  db.rosters = [
    { id: 'r-top', platformUserId: 'p-top' },
    { id: 'r-mid', platformUserId: 'p-mid' },
    { id: 'r-close', platformUserId: 'p-close' },
    { id: 'r-last', platformUserId: 'p-last' },
    { id: 'r-gone', platformUserId: 'p-gone' },
  ]
  dispatch = vi.fn(async () => ({}))
})

describe('the chop-zone warning', () => {
  it('tells only the chop-zone and danger-zone teams, each in their own words', async () => {
    const d = deps()
    expect(await sendChopZoneWarnings(input, d)).toEqual({ outcome: 'sent', warned: 2 })
    const sent = dispatch.mock.calls.map(([p]) => p)
    expect(sent.map((p) => [p.userIds, p.type, p.category])).toEqual([
      [['u-close'], 'guillotine_danger_zone', 'matchup_results'],
      [['u-last'], 'guillotine_chop_zone', 'matchup_results'],
    ])
    expect(sent[1].title).toBe("🪓 You're in the chop zone — Ciege NBA Guilly")
    expect(sent[0].body).toContain('Only 5 points above the chop line.')
    expect(sent[0].dedupePrefix).toBe('guillotine-chop-zone:lg1:2026:w5:danger')
    expect(sent[1].dedupePrefix).toBe('guillotine-chop-zone:lg1:2026:w5:chopped')
  })

  it('looks again at most once per half hour, and does not score every team on every tick', async () => {
    const start = LAST_GAME.getTime() - 3 * 60 * 60 * 1000
    const d = deps({ now: () => at(start) })
    await sendChopZoneWarnings(input, d)
    for (const minutes of [5, 10, 29]) {
      expect(await sendChopZoneWarnings(input, deps({ now: () => at(start + minutes * 60_000), loadPreview: d.loadPreview }))).toEqual({ outcome: 'throttled' })
    }
    expect(d.loadPreview).toHaveBeenCalledTimes(1)
    // Half an hour later it looks again; nothing got worse, so nobody hears anything.
    dispatch.mockClear()
    expect(await sendChopZoneWarnings(input, deps({ now: () => at(start + CHOP_ZONE_RECHECK_MS), loadPreview: d.loadPreview }))).toEqual({ outcome: 'no_change' })
    expect(d.loadPreview).toHaveBeenCalledTimes(2)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('🛑 the late drop: a team safe at the first look that slips later is warned then, in words that say so', async () => {
    const start = LAST_GAME.getTime() - 6 * 60 * 60 * 1000
    await sendChopZoneWarnings(input, deps({ now: () => at(start) }))
    dispatch.mockClear()
    // An hour later r-mid's players sat and two others scored: r-mid is now the one the chop takes.
    const later = preview({ rows: [row('r-top', 150, 'safe', 60), row('r-close', 110, 'safe', 20), row('r-last', 95, 'danger', 5), row('r-mid', 90, 'chopped', 0)] })
    expect(await sendChopZoneWarnings(input, deps({ now: () => at(start + 60 * 60_000), loadPreview: async () => later }))).toEqual({ outcome: 'sent', warned: 1 })
    const [p] = dispatch.mock.calls.map(([x]) => x)
    expect(p).toMatchObject({ userIds: ['u-mid'], type: 'guillotine_chop_zone', severity: 'high', meta: expect.objectContaining({ late: true }) })
    expect(p.title).toBe("🪓 You've dropped into the chop zone — Ciege NBA Guilly")
    expect(p.body).toBe('Other scores have passed yours. If week 5 ended now, your team would be chopped. Check your lineup before the last games.')
    // r-close climbed out and r-last fell from the chop zone to danger: neither is told anything.
  })

  it('🛑 at most two a week: danger, then the chop zone; never the same level twice, never back down', async () => {
    const start = LAST_GAME.getTime() - 6 * 60 * 60 * 1000
    await sendChopZoneWarnings(input, deps({ now: () => at(start) }))
    dispatch.mockClear()
    // r-close goes from danger to the chop zone: one more warning, at the new level, its own dedupe key.
    const worse = preview({ rows: [row('r-top', 150, 'safe', 60), row('r-mid', 120, 'safe', 30), row('r-last', 91, 'danger', 1), row('r-close', 90, 'chopped', 0)] })
    expect(await sendChopZoneWarnings(input, deps({ now: () => at(start + CHOP_ZONE_RECHECK_MS), loadPreview: async () => worse }))).toEqual({ outcome: 'sent', warned: 1 })
    expect(dispatch.mock.calls[0][0]).toMatchObject({ userIds: ['u-close'], type: 'guillotine_chop_zone', dedupePrefix: 'guillotine-chop-zone:lg1:2026:w5:chopped' })
    // The same picture again: everyone is at or below what they were told.
    dispatch.mockClear()
    expect(await sendChopZoneWarnings(input, deps({ now: () => at(start + 2 * CHOP_ZONE_RECHECK_MS), loadPreview: async () => worse }))).toEqual({ outcome: 'no_change' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('after the first look the schedule is not read again: the last game start rides on the record', async () => {
    const start = LAST_GAME.getTime() - 3 * 60 * 60 * 1000
    const first = deps({ now: () => at(start) })
    await sendChopZoneWarnings(input, first)
    expect(first.lastGameStart).toHaveBeenCalledTimes(1)
    const later = deps({ now: () => at(LAST_GAME.getTime() + 60_000) })
    expect(await sendChopZoneWarnings(input, later)).toEqual({ outcome: 'too_late' })
    expect(later.lastGameStart).not.toHaveBeenCalled()
  })

  it('a record from the first version (rosters, no levels) counts as already warned at the worst level', async () => {
    db.events.push({ leagueId: 'lg1', eventType: 'chop_zone_warning', metadata: { key: '2026:w5', rosterIds: ['r-close', 'r-last'] } })
    expect(await sendChopZoneWarnings(input, deps())).toEqual({ outcome: 'no_change' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('waits until the last day, and stays quiet once the last game has started', async () => {
    const early = deps({ now: () => at(LAST_GAME.getTime() - CHOP_ZONE_WARNING_LEAD_MS - 60_000) })
    expect(await sendChopZoneWarnings(input, early)).toEqual({ outcome: 'too_early' })
    expect(early.loadPreview).not.toHaveBeenCalled()
    const late = deps({ now: () => at(LAST_GAME.getTime()) })
    expect(await sendChopZoneWarnings(input, late)).toEqual({ outcome: 'too_late' })
    expect(await sendChopZoneWarnings(input, deps({ lastGameStart: async () => null }))).toEqual({ outcome: 'schedule_unknown' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(db.events).toHaveLength(0)
  })

  it('says nothing when no chop is coming, the chop would refuse, the week differs, or nobody has scored', async () => {
    let t = LAST_GAME.getTime() - 20 * 60 * 60 * 1000
    for (const [p, outcome] of [
      [preview({ outcome: 'no_chop_week' }), 'no_chop_this_week'],
      [preview({ blockers: ['A team cannot be matched'] }), 'blocked'],
      [preview({ week: 6 }), 'week_mismatch'],
      [preview({ rows: [row('r-a', 0, 'safe', 0), row('r-b', 0, 'chopped', 0)] }), 'no_scores'],
    ] as const) {
      const now = t
      expect(await sendChopZoneWarnings(input, deps({ now: () => at(now), loadPreview: async () => p }))).toEqual({ outcome })
      t += CHOP_ZONE_RECHECK_MS
    }
    expect(await sendChopZoneWarnings(input, deps({ now: () => at(t), loadPreview: async () => ({ error: 'x' }) }))).toEqual({ outcome: 'no_chop_this_week' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(db.events).toHaveLength(0)
  })

  it('records a level before sending it, so a send that fails is not retried into a second warning', async () => {
    const start = LAST_GAME.getTime() - 3 * 60 * 60 * 1000
    dispatch.mockRejectedValueOnce(new Error('push down'))
    expect(await sendChopZoneWarnings(input, deps({ now: () => at(start) }))).toEqual({ outcome: 'sent', warned: 1 })
    expect(db.events).toHaveLength(1)
    expect(await sendChopZoneWarnings(input, deps({ now: () => at(start + CHOP_ZONE_RECHECK_MS) }))).toEqual({ outcome: 'no_change' })
  })

  it('a manager with no AllFantasy account is skipped, not an error', async () => {
    db.rosters.find((r) => r.id === 'r-last')!.platformUserId = 'sleeper-only'
    expect(await sendChopZoneWarnings(input, deps())).toEqual({ outcome: 'sent', warned: 1 })
  })

  it('score-sync\'s entry reads the league, sport and year off the season', async () => {
    const d = deps()
    expect(await sendChopZoneWarningsForSeason({ seasonId: 's1', week: 5 }, d)).toEqual({ outcome: 'sent', warned: 2 })
    expect(d.lastGameStart).toHaveBeenCalledWith(expect.objectContaining({ sport: 'NBA', season: 2026, week: 5 }))
  })
})

describe('the chop', () => {
  const chop = {
    leagueId: 'lg1', season: 2026, week: 5,
    choppedRosterIds: ['r-last'],
    aliveRosterIds: ['r-top', 'r-mid', 'r-close', 'r-last'],
    displayNames: { 'r-last': 'Bricklayers' },
    rosterReleaseTiming: 'next_waiver_run',
  }

  it('tells the chopped team it is out and this week\'s survivors who went — not teams chopped earlier', async () => {
    expect(await sendChopResultAlerts(chop, { dispatch })).toEqual({ chopped: 1, survived: 3 })
    const [out, survived] = dispatch.mock.calls.map(([p]) => p)
    expect(out).toMatchObject({ userIds: ['u-last'], type: 'guillotine_chopped', severity: 'high', title: "🪓 You've been chopped — Ciege NBA Guilly" })
    expect(survived.userIds).toEqual(['u-top', 'u-mid', 'u-close'])
    expect(survived.title).toBe('You survived week 5 — Ciege NBA Guilly')
    expect(survived.body).toBe('Bricklayers was chopped. Their players hit waivers at the next waiver run.')
    expect(survived.userIds).not.toContain('u-gone')
    expect(out.dedupePrefix).toBe('guillotine-chop:lg1:2026:w5:guillotine_chopped')
    expect(survived.dedupePrefix).toBe('guillotine-chop:lg1:2026:w5:guillotine_survived')
  })

  it('a manager chopped with one team and alive with another is told about the chop only', async () => {
    db.rosters.find((r) => r.id === 'r-top')!.platformUserId = 'p-last'
    await sendChopResultAlerts(chop, { dispatch })
    expect(dispatch.mock.calls[1][0].userIds).toEqual(['u-mid', 'u-close'])
  })
})

describe('the words', () => {
  it('a double chop names both teams; an immediate release says they are free agents now', () => {
    expect(chopResultAlert({ leagueName: 'L', week: 3, choppedNames: ['A', 'B'], youWereChopped: false, rosterReleaseTiming: 'immediate' }).body)
      .toBe('A and B were chopped. Their players are free agents now.')
  })
  it('the late danger warning says the team is now close', () => {
    expect(chopZoneWarning({ leagueName: 'L', week: 3, status: 'danger', margin: 2, late: true })).toMatchObject({
      title: "⚠️ You've slipped into the danger zone — L",
      body: 'Your team is now close to the chop in week 3. Only 2 points above the chop line. Check your lineup before the last games.',
    })
  })
  it('a danger-zone team tied on the line is not told it is "0 points above"', () => {
    expect(chopZoneWarning({ leagueName: 'L', week: 3, status: 'danger', margin: 0 }).body).not.toContain('above the chop line')
  })
})
