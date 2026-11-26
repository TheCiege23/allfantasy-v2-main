/**
 * Live danger alerts (lib/guillotine/survivalAlertRules.ts, survivalAlerts.ts): when one is due, what it says,
 * and that it goes out once. The event log and the lock are in-memory stand-ins; the rules, the odds and the
 * sender are the real ones.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  events: [] as Array<{ eventType: string; metadata: Record<string, unknown> }>,
  locks: new Map<string, number>(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    guillotineEventLog: {
      findMany: vi.fn(async ({ where }: { where: { eventType: string; metadata?: { equals?: string } } }) =>
        db.events.filter((e) => e.eventType === where.eventType && (!where.metadata?.equals || e.metadata.key === where.metadata.equals)),
      ),
      create: vi.fn(async ({ data }: { data: { eventType: string; metadata: Record<string, unknown> } }) => {
        db.events.push({ eventType: data.eventType, metadata: data.metadata })
        return {}
      }),
    },
    redraftSeason: { findUnique: vi.fn(async () => ({ leagueId: 'L', sport: 'NFL', season: 2026 })) },
  },
}))
vi.mock('@/lib/automation/locks', () => ({
  acquireAutomationLock: vi.fn(async (key: string, opts: { ttlMs: number; owner: string }) => {
    const at = Number(opts.owner.split(':').pop())
    const until = db.locks.get(key)
    if (until != null && until > at) return { ok: false, reason: 'held' }
    db.locks.set(key, at + opts.ttlMs)
    return { ok: true, backend: 'postgres' }
  }),
}))
vi.mock('@/lib/guillotine/chopAlerts', () => ({
  CHOP_ZONE_WARNING_LEAD_MS: 24 * 3600_000,
  chopAlertUsersByRoster: vi.fn(async (_leagueId: string, ids: string[]) => new Map(ids.map((id) => [id, `user-${id}`]))),
  chopAlertLeagueName: vi.fn(async () => 'Last Team Standing'),
  lastGameStartOfWeek: vi.fn(async () => null),
  leagueSetsItsOwnLineups: vi.fn(async () => false),
}))
vi.mock('@/lib/guillotine/chopPreviewLoad', () => ({ loadChopPreview: vi.fn() }))
vi.mock('@/lib/guillotine/survivalOutlookLoad', () => ({ loadSurvivalOutlook: vi.fn() }))

import { AT_RISK_AT_OR_BELOW_PCT, RECOVERED_AT_OR_ABOVE_PCT, survivalAlertCopy, survivalAlertsDue } from '@/lib/guillotine/survivalAlertRules'
import { SURVIVAL_ALERT_EVENT, sendSurvivalOddsAlerts, sendSurvivalOddsAlertsForSeason } from '@/lib/guillotine/survivalAlerts'

beforeEach(() => {
  db.events.length = 0
  db.locks.clear()
})

describe('when an alert is due', () => {
  const odds = (o: Record<string, number>) => new Map(Object.entries(o))
  const none = new Map<string, never[]>()

  it('a team at or below the line is told it is at risk; one above it is not', () => {
    expect(survivalAlertsDue(odds({ a: AT_RISK_AT_OR_BELOW_PCT, b: AT_RISK_AT_OR_BELOW_PCT + 1, c: 12 }), none)).toEqual([
      { rosterId: 'c', level: 'at_risk', safePct: 12 },
      { rosterId: 'a', level: 'at_risk', safePct: 35 },
    ])
  })

  it('it is told once: still at risk, or worse, is not news', () => {
    expect(survivalAlertsDue(odds({ a: 20 }), new Map([['a', ['at_risk'] as const]]))).toEqual([])
    expect(survivalAlertsDue(odds({ a: 3 }), new Map([['a', ['at_risk'] as const]]))).toEqual([])
  })

  it('a team that was told it was at risk is told when it climbs back above the higher line', () => {
    const told = new Map([['a', ['at_risk'] as const]])
    expect(survivalAlertsDue(odds({ a: RECOVERED_AT_OR_ABOVE_PCT - 1 }), told)).toEqual([])
    expect(survivalAlertsDue(odds({ a: RECOVERED_AT_OR_ABOVE_PCT }), told)).toEqual([{ rosterId: 'a', level: 'recovered', safePct: 65 }])
  })

  it('🛑 a team hovering between the two lines hears nothing: that gap is what stops an afternoon of pings', () => {
    const told = new Map([['a', ['at_risk'] as const]])
    for (const pct of [36, 45, 50, 64]) expect(survivalAlertsDue(odds({ a: pct }), told)).toEqual([])
  })

  it('a team that was never at risk is not told it is safe', () => {
    expect(survivalAlertsDue(odds({ a: 99 }), none)).toEqual([])
  })

  it('two a week at most: after recovering, a second fall is not told', () => {
    const both = new Map([['a', ['at_risk', 'recovered'] as const]])
    expect(survivalAlertsDue(odds({ a: 5 }), both)).toEqual([])
    expect(survivalAlertsDue(odds({ a: 90 }), both)).toEqual([])
  })
})

describe('what it says', () => {
  const base = { leagueName: 'Last Team Standing', week: 7 }

  it('at risk: the chance, how many starters are left, and what to do', () => {
    expect(survivalAlertCopy({ ...base, level: 'at_risk', safePct: 28, startersLeft: 3 })).toEqual({
      title: 'You are in danger in Last Team Standing',
      body: 'Your chance of surviving week 7 is down to 28%. 3 of your starters still have a game to play. Check your lineup while there is time.',
      severity: 'medium',
    })
  })

  it('one starter left reads as one', () => {
    expect(survivalAlertCopy({ ...base, level: 'at_risk', safePct: 28, startersLeft: 1 }).body).toContain('1 of your starters still has a game to play.')
  })

  it('gives no lineup advice when there is no lineup to change: nobody left to play, or best ball', () => {
    expect(survivalAlertCopy({ ...base, level: 'at_risk', safePct: 9, startersLeft: 0 }).body).toBe('Your chance of surviving week 7 is down to 9%. None of your starters has a game left.')
    expect(survivalAlertCopy({ ...base, level: 'at_risk', safePct: 28, startersLeft: 3, bestBall: true }).body).not.toContain('Check your lineup')
  })

  it('recovered: quieter, and the same number the page shows', () => {
    expect(survivalAlertCopy({ ...base, level: 'recovered', safePct: 71, startersLeft: 2 })).toEqual({
      title: 'Back out of danger in Last Team Standing',
      body: 'Your chance of surviving week 7 is back up to 71%. 2 of your starters still have a game to play.',
      severity: 'low',
    })
  })

  it('never severe enough to break through quiet hours or send a text', () => {
    // lib/notifications: only `high` does either.
    for (const level of ['at_risk', 'recovered'] as const) expect(survivalAlertCopy({ ...base, level, safePct: 1, startersLeft: 0 }).severity).not.toBe('high')
  })
})

describe('sending', () => {
  const LAST_GAME = new Date('2026-10-20T00:15:00Z') // Monday night
  const SUNDAY_MORNING = new Date('2026-10-18T14:00:00Z') // more than a day before it
  const input = { leagueId: 'L', seasonId: 'S', sport: 'NFL', season: 2026, week: 7 }
  /** Four teams, one chop. `d` has scored least and has nobody left: it cannot catch up. */
  const preview = (over: Record<string, unknown> = {}) => ({
    week: 7,
    outcome: 'chop',
    chopCount: 1,
    blockers: [],
    rows: [
      { rosterId: 'a', name: 'A', points: 120, status: 'safe', margin: 60, faabChange: null },
      { rosterId: 'b', name: 'B', points: 110, status: 'safe', margin: 50, faabChange: null },
      { rosterId: 'c', name: 'C', points: 100, status: 'danger', margin: 40, faabChange: null },
      { rosterId: 'd', name: 'D', points: 60, status: 'chopped', margin: 0, faabChange: null },
    ],
    ...over,
  })
  const outlook = (dLeft = 0) => ({
    a: { playersLeft: 0, starters: 9, gamesLeft: 0, remainingProjection: 0, partial: false },
    b: { playersLeft: 0, starters: 9, gamesLeft: 0, remainingProjection: 0, partial: false },
    c: { playersLeft: 0, starters: 9, gamesLeft: 0, remainingProjection: 0, partial: false },
    d: { playersLeft: dLeft > 0 ? 3 : 0, starters: 9, gamesLeft: dLeft > 0 ? 3 : 0, remainingProjection: dLeft, partial: false },
  })
  const run = (over: { now?: Date; preview?: unknown; outlook?: unknown; dispatch?: ReturnType<typeof vi.fn> } = {}) => {
    const dispatch = over.dispatch ?? vi.fn(async () => ({}))
    return {
      dispatch,
      result: sendSurvivalOddsAlerts(input, {
        now: () => over.now ?? SUNDAY_MORNING,
        lastGameStart: async () => LAST_GAME,
        loadPreview: async () => (over.preview ?? preview()) as never,
        loadOutlook: async () => (over.outlook === undefined ? outlook() : over.outlook) as never,
        dispatch: dispatch as never,
      }),
    }
  }

  it('the team that cannot catch up is told, through the dispatcher, with the page’s number', async () => {
    const { dispatch, result } = run()
    expect(await result).toEqual({ outcome: 'sent', sent: 1 })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      userIds: ['user-d'],
      category: 'matchup_results',
      type: 'guillotine_survival_at_risk',
      title: 'You are in danger in Last Team Standing',
      severity: 'medium',
      leagueId: 'L',
      actionHref: '/league/L',
      actionLabel: 'Set lineup',
      dedupePrefix: 'guillotine-survival:L:2026:w7:at_risk',
      meta: { guillotineWeek: 7, leagueId: 'L', pushTag: 'guillotine-survival-L' },
    })
    expect(dispatch.mock.calls[0]![0].body).toMatch(/^Your chance of surviving week 7 is down to \d+%\. None of your starters has a game left\.$/)
  })

  it('🛑 it is recorded before it is sent, so a crash mid-send cannot send it twice', async () => {
    const dispatch = vi.fn(async () => {
      // At the moment of sending, the league event naming this alert is already written.
      expect(db.events.filter((e) => e.eventType === SURVIVAL_ALERT_EVENT)).toHaveLength(1)
      throw new Error('push provider down')
    })
    expect(await run({ dispatch }).result).toEqual({ outcome: 'sent', sent: 0 })
    expect(db.events[0]!.metadata).toMatchObject({ key: '2026:w7', week: 7, sent: { d: 'at_risk' } })
    // Half an hour later the lock is free again; the alert is on record, so it is not sent a second time.
    const later = run({ now: new Date(SUNDAY_MORNING.getTime() + 31 * 60_000) })
    expect(await later.result).toEqual({ outcome: 'no_change' })
    expect(later.dispatch).not.toHaveBeenCalled()
  })

  it('looks once per half hour, however often score-sync ticks', async () => {
    await run().result
    const fiveMinutesOn = run({ now: new Date(SUNDAY_MORNING.getTime() + 5 * 60_000) })
    expect(await fiveMinutesOn.result).toEqual({ outcome: 'throttled' })
    expect(fiveMinutesOn.dispatch).not.toHaveBeenCalled()
  })

  it('tells a team when it climbs back, and the team it climbed past that it is now the one at risk', async () => {
    await run().result
    // D's last three starters go off: 60 scored, 90 still projected. D is likely to pass C, who is finished on 100.
    const back = run({ now: new Date(SUNDAY_MORNING.getTime() + 40 * 60_000), outlook: outlook(90) })
    expect(await back.result).toEqual({ outcome: 'sent', sent: 2 })
    expect(back.dispatch.mock.calls.map((c) => [c[0].userIds[0], c[0].type, c[0].actionLabel])).toEqual([
      ['user-c', 'guillotine_survival_at_risk', 'Set lineup'],
      ['user-d', 'guillotine_survival_recovered', 'Open league'],
    ])
  })

  it('two a week at most for any team: a second fall after recovering is not told', async () => {
    await run().result
    await run({ now: new Date(SUNDAY_MORNING.getTime() + 40 * 60_000), outlook: outlook(90) }).result
    // D's projection is gone again: D is back where it started, and C is safe again.
    const again = run({ now: new Date(SUNDAY_MORNING.getTime() + 80 * 60_000), outlook: outlook(0) })
    expect(await again.result).toEqual({ outcome: 'sent', sent: 1 })
    // C hears that it recovered. D, already told both things this week, hears nothing.
    expect(again.dispatch.mock.calls.map((c) => [c[0].userIds[0], c[0].type])).toEqual([['user-c', 'guillotine_survival_recovered']])
    const oncemore = run({ now: new Date(SUNDAY_MORNING.getTime() + 120 * 60_000), outlook: outlook(90) })
    expect(await oncemore.result).toEqual({ outcome: 'no_change' })
    expect(oncemore.dispatch).not.toHaveBeenCalled()
  })

  it('🛑 hands over to the standings warning for the last day: no team hears both about the same afternoon', async () => {
    const sundayNight = new Date(LAST_GAME.getTime() - 23 * 3600_000)
    const { dispatch, result } = run({ now: sundayNight })
    expect(await result).toEqual({ outcome: 'final_day' })
    expect(dispatch).not.toHaveBeenCalled()
    // And it does not even take the lock, so the half hour is not spent for nothing.
    expect(db.locks.size).toBe(0)
  })

  it.each([
    ['no chop this week', { preview: preview({ outcome: 'no_chop_week' }) }, 'no_chop_this_week'],
    ['the preview is for another week', { preview: preview({ week: 8 }) }, 'week_mismatch'],
    ['the real chop would refuse to run', { preview: preview({ blockers: ['a team the engine cannot place'] }) }, 'blocked'],
    ['no outlook could be read', { outlook: null }, 'no_outlook'],
    ['a team has no projection for games it still has', { outlook: { ...outlook(), c: { playersLeft: 2, starters: 9, gamesLeft: 2, remainingProjection: null, partial: true } } }, 'no_odds'],
  ])('says nothing when %s', async (_name, over, outcome) => {
    const { dispatch, result } = run(over as never)
    expect(await result).toEqual({ outcome })
    expect(dispatch).not.toHaveBeenCalled()
    expect(db.events).toHaveLength(0)
  })

  it('says nothing when the week’s schedule cannot be read', async () => {
    const dispatch = vi.fn()
    expect(await sendSurvivalOddsAlerts(input, { now: () => SUNDAY_MORNING, lastGameStart: async () => null, dispatch: dispatch as never })).toEqual({ outcome: 'schedule_unknown' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('an immune team is never told it is at risk', async () => {
    const immune = preview({ rows: preview().rows.map((r) => (r.rosterId === 'd' ? { ...r, status: 'immune' } : r)) })
    const { dispatch, result } = run({ preview: immune })
    await result
    expect(dispatch.mock.calls.map((c) => c[0].userIds[0])).not.toContain('user-d')
  })

  it('score-sync’s entry reads the season row for the league, sport and year', async () => {
    expect(await sendSurvivalOddsAlertsForSeason({ seasonId: 'S', week: 7 }, { now: () => SUNDAY_MORNING, lastGameStart: async () => null })).toEqual({ outcome: 'schedule_unknown' })
  })
})
