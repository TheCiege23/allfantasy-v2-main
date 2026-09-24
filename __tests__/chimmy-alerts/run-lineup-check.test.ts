import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  games: [] as Array<{ homeTeam: string; awayTeam: string; startTime: Date | null; season: number; week: number; seasonType: string | null }>,
}))

vi.mock('server-only', () => ({}))
/*
 * The runner's defaults reach prisma and the optimizer; every test injects its own instead —
 * except the schedule read, whose filter is load-bearing and is exercised against a fake that
 * APPLIES its `where` (see the last test).
 */
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        h.games.filter(
          (g) =>
            g.season === where.season &&
            g.week === where.week &&
            (where.seasonType === undefined || g.seasonType === where.seasonType) &&
            g.startTime != null,
        ),
    },
  },
}))
vi.mock('@/lib/chimmy/lineupOptimizerGrounding', () => ({ buildLineupOptimization: vi.fn() }))
vi.mock('@/lib/core-app/playerProjections', () => ({ latestProjectionWeek: vi.fn() }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn() }))
vi.mock('@/lib/user-settings', () => ({ getSettingsProfile: vi.fn() }))
vi.mock('@/lib/chimmy-alerts/ChimmyAlertPreferencesService', () => ({ loadChimmyAlertPreferences: vi.fn() }))

import type { LineupOptimization, OptimizerPlayer } from '@/lib/chimmy/lineupOptimizerGrounding'
import { getDefaultNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'
import type { NotificationPreferences } from '@/lib/notification-settings/types'
import { runLineupCheck, type LineupCheckDeps } from '@/lib/chimmy-alerts/runLineupCheck'

/**
 * The lineup check's runner: once per user per week, only inside the window, only for people who
 * have not switched it off — and the switches are read before any lineup is computed.
 */

const MAIN = new Date('2026-09-27T17:00:00Z')
const IN_WINDOW = new Date('2026-09-27T13:00:00Z')
const TUESDAY = new Date('2026-09-22T15:00:00Z')

const player = (id: string, name: string, over: Partial<OptimizerPlayer> = {}): OptimizerPlayer => ({
  playerId: id,
  name,
  position: 'WR',
  team: 'BUF',
  injury: null,
  points: 10,
  ...over,
})

/** A lineup worth a message: start Tank Dell over Rashid Shaheed for +6 points. */
const NEEDS_A_SWAP: LineupOptimization = {
  status: 'ready',
  week: { season: '2026', week: 3 },
  best: { points: 106, slots: [] },
  current: { starters: [], points: 100, emptySlots: 0, known: true },
  startInstead: [player('3', 'Tank Dell')],
  benchInstead: [player('4', 'Rashid Shaheed')],
  gain: 6,
  unpricedStarters: [],
  injuredStarters: [],
  bench: [],
  unpricedActive: 0,
  unfilledSlots: [],
}
const ALREADY_RIGHT: LineupOptimization = { ...NEEDS_A_SWAP, startInstead: [], benchInstead: [], gain: 0 }

const league = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `League ${id}`,
  leagueVariant: null,
  bestBallMode: null,
  ...over,
})

function prefsWith(mutate?: (p: NotificationPreferences) => void): NotificationPreferences {
  const p = getDefaultNotificationPreferences()
  mutate?.(p)
  return p
}

let deps: LineupCheckDeps
let claimed: Set<string>

beforeEach(() => {
  claimed = new Set()
  deps = {
    now: () => IN_WINDOW,
    latestWeek: vi.fn(async () => ({ season: '2026', week: 3 })),
    loadGames: vi.fn(async () => [
      { homeTeam: 'BUF', awayTeam: 'MIA', startTime: MAIN },
      { homeTeam: 'CHI', awayTeam: 'DET', startTime: MAIN },
      { homeTeam: 'GB', awayTeam: 'DAL', startTime: new Date('2026-09-25T00:15:00Z') },
    ]),
    loadAudience: vi.fn(async () => new Map([['u1', [league('L1')]]])),
    loadSettings: vi.fn(async () => ({ notifications: prefsWith(), chimmy: null })),
    optimize: vi.fn(async () => NEEDS_A_SWAP),
    alreadySent: vi.fn(async (key: string) => claimed.has(key)),
    claim: vi.fn(async (key: string) => {
      if (claimed.has(key)) return false
      claimed.add(key)
      return true
    }),
    dispatch: vi.fn(async () => {}),
    baseUrl: () => 'https://allfantasy.ai',
  }
})

describe('runLineupCheck', () => {
  it('does nothing outside the window before the main slate — not even reading the audience', async () => {
    deps.now = () => TUESDAY
    const run = await runLineupCheck({}, deps)
    expect(run).toMatchObject({ ran: false, reason: 'early', mainSlate: MAIN.toISOString() })
    expect(deps.loadAudience).not.toHaveBeenCalled()
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('reads the schedule for the feed week, and needs one', async () => {
    await runLineupCheck({}, deps)
    expect(deps.loadGames).toHaveBeenCalledWith(2026, 3)
    deps.loadGames = vi.fn(async () => [])
    expect(await runLineupCheck({}, deps)).toMatchObject({ ran: false, reason: 'no_schedule' })
    deps.latestWeek = vi.fn(async () => null)
    expect(await runLineupCheck({}, deps)).toMatchObject({ ran: false, reason: 'no_projection_week' })
  })

  it('sends once, as a lineup reminder that opens Chimmy, and never twice in a week', async () => {
    const first = await runLineupCheck({}, deps)
    expect(first).toMatchObject({ ran: true, outcomes: { sent: 1 }, notReached: 0 })
    expect(deps.dispatch).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(deps.dispatch).mock.calls[0]![0]
    expect(sent).toMatchObject({
      userIds: ['u1'],
      category: 'lineup_reminders',
      type: 'chimmy_lineup_check',
      title: "Chimmy's lineup check: 1 fix for League L1",
      body: 'League L1: Start Tank Dell over Rashid Shaheed (+6.0 projected pts).',
      actionLabel: 'Ask Chimmy',
      leagueId: 'L1',
      dedupePrefix: 'chimmy-lineup-check:2026-w3',
      skipChannels: { sms: true, email: false, push: false },
    })
    expect(sent.actionHref).toMatch(/^\/chimmy\/chat\?prompt=/)
    expect(sent.emailOverride?.subject).toBe(sent.title)
    expect(deps.claim).toHaveBeenCalledWith('chimmy-lineup-check:2026-w3:u1', expect.any(Date))

    const second = await runLineupCheck({}, deps)
    expect(second).toMatchObject({ ran: true, outcomes: { already_sent: 1 } })
    expect(deps.dispatch).toHaveBeenCalledTimes(1)
    expect(deps.optimize).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when another run claimed the week first', async () => {
    deps.alreadySent = vi.fn(async () => false)
    deps.claim = vi.fn(async () => false)
    const run = await runLineupCheck({}, deps)
    expect(run).toMatchObject({ outcomes: { already_sent: 1 } })
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('stays quiet about a lineup that is already right', async () => {
    deps.optimize = vi.fn(async () => ALREADY_RIGHT)
    expect(await runLineupCheck({}, deps)).toMatchObject({ outcomes: { clean: 1 } })
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('reads the switches before computing any lineup', async () => {
    deps.loadSettings = vi.fn(async () => ({
      notifications: prefsWith((p) => {
        p.categories!.lineup_reminders = { enabled: false, inApp: true, email: true, sms: false }
      }),
      chimmy: null,
    }))
    expect(await runLineupCheck({}, deps)).toMatchObject({ outcomes: { category_off: 1 } })

    deps.loadSettings = vi.fn(async () => ({ notifications: prefsWith(), chimmy: { mutedClasses: ['lineup' as const] } }))
    expect(await runLineupCheck({}, deps)).toMatchObject({ outcomes: { muted: 1 } })

    deps.loadSettings = vi.fn(async () => ({ notifications: prefsWith((p) => (p.globalEnabled = false)), chimmy: null }))
    expect(await runLineupCheck({}, deps)).toMatchObject({ outcomes: { category_off: 1 } })

    expect(deps.optimize).not.toHaveBeenCalled()
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('leaves out best-ball leagues and leagues muted either way', async () => {
    deps.loadAudience = vi.fn(
      async () =>
        new Map([
          [
            'u1',
            [
              league('L1'),
              league('BB', { leagueVariant: 'best_ball' }),
              league('MUTED_NOTIF'),
              league('MUTED_CHIMMY'),
            ],
          ],
        ]),
    )
    deps.loadSettings = vi.fn(async () => ({
      notifications: prefsWith((p) => (p.leagues = { MUTED_NOTIF: { mutedCategories: ['lineup_reminders'] } })),
      chimmy: { leaguePrefs: [{ leagueId: 'MUTED_CHIMMY', disabled: true }] },
    }))
    await runLineupCheck({}, deps)
    expect(vi.mocked(deps.optimize).mock.calls.map((c) => c[0])).toEqual(['L1'])
  })

  it('honours Chimmy channel switches and never texts', async () => {
    deps.loadSettings = vi.fn(async () => ({
      notifications: prefsWith(),
      chimmy: { channelPreferences: { disableEmail: true, disablePush: false } },
    }))
    await runLineupCheck({}, deps)
    expect(vi.mocked(deps.dispatch).mock.calls[0]![0].skipChannels).toEqual({ sms: true, email: true, push: false })
  })

  it('a dry run previews and claims nothing', async () => {
    const run = await runLineupCheck({ dryRun: true }, deps)
    expect(run).toMatchObject({ ran: true, dryRun: true, outcomes: { would_send: 1 } })
    if (run.ran) expect(run.previews[0]).toMatchObject({ userId: 'u1', title: "Chimmy's lineup check: 1 fix for League L1" })
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('force runs outside the window, for a hand-run verification', async () => {
    deps.now = () => TUESDAY
    expect(await runLineupCheck({ force: true, dryRun: true }, deps)).toMatchObject({ ran: true, outcomes: { would_send: 1 } })
  })

  it('ignores an optimization priced for a different week than the run', async () => {
    deps.optimize = vi.fn(async () => ({ ...NEEDS_A_SWAP, week: { season: '2026', week: 4 } }))
    expect(await runLineupCheck({}, deps)).toMatchObject({ outcomes: { clean: 1 } })
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('puts one league per message in the league slot, and several in the body', async () => {
    deps.loadAudience = vi.fn(async () => new Map([['u1', [league('L1'), league('L2')]]]))
    await runLineupCheck({}, deps)
    const sent = vi.mocked(deps.dispatch).mock.calls[0]![0]
    expect(sent.leagueId).toBeNull()
    expect(sent.title).toBe("Chimmy's lineup check: 2 fixes across 2 leagues")
    expect(sent.meta).toMatchObject({ leagueIds: ['L1', 'L2'], week: 3, class: 'lineup' })
  })

  it('stops starting new users past its budget and says how many it did not reach', async () => {
    deps.loadAudience = vi.fn(async () => new Map([['u1', [league('L1')]], ['u2', [league('L2')]]]))
    const run = await runLineupCheck({ budgetMs: 0 }, deps)
    expect(run).toMatchObject({ ran: true, users: 2, notReached: 2 })
    expect(deps.optimize).not.toHaveBeenCalled()
  })

  it("reads only the REGULAR-season schedule — preseason rows filed under the same week number are not this week", async () => {
    // Production's real shape: two sources file August preseason games as week 3 with no seasonType.
    const august = new Date('2026-08-21T00:00:00Z')
    h.games = [
      ...['BUF', 'CHI', 'SF', 'NYJ', 'KC'].map((t) => ({ homeTeam: t, awayTeam: 'X', startTime: august, season: 2026, week: 3, seasonType: null })),
      { homeTeam: 'BUF', awayTeam: 'MIA', startTime: MAIN, season: 2026, week: 3, seasonType: 'regular' },
      { homeTeam: 'CHI', awayTeam: 'DET', startTime: MAIN, season: 2026, week: 3, seasonType: 'regular' },
    ]
    const { loadGames: _drop, ...withRealSchedule } = deps
    const run = await runLineupCheck({}, withRealSchedule)
    // Read with the preseason rows, the "main slate" is in August, the window is closed, and
    // every Buffalo player reads as locked since August.
    expect(run).toMatchObject({ ran: true, mainSlate: MAIN.toISOString(), outcomes: { sent: 1 } })
  })

  it('reports a failing user and carries on with the rest', async () => {
    deps.loadAudience = vi.fn(async () => new Map([['u1', [league('L1')]], ['u2', [league('L2')]]]))
    deps.loadSettings = vi.fn(async (userId: string) => {
      if (userId === 'u1') throw new Error('profile read failed')
      return { notifications: prefsWith(), chimmy: null }
    })
    const run = await runLineupCheck({}, deps)
    expect(run).toMatchObject({ outcomes: { error: 1, sent: 1 }, notReached: 0 })
    if (run.ran) expect(run.errors).toEqual([{ userId: 'u1', error: 'profile read failed' }])
  })
})
