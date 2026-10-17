import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/core-app/dash34', () => ({ getDash34Data: vi.fn() }))
vi.mock('@/lib/chimmy/lineupOptimizerGrounding', () => ({ buildLineupOptimization: vi.fn() }))
vi.mock('@/lib/core-app/playerProjections', () => ({ latestProjectionWeek: vi.fn() }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn() }))
vi.mock('@/lib/user-settings', () => ({ getSettingsProfile: vi.fn() }))
vi.mock('@/lib/chimmy-alerts/ChimmyAlertPreferencesService', () => ({ loadChimmyAlertPreferences: vi.fn() }))

import type { Dash34DepthAlert } from '@/lib/core-app/dash34'
import { getDefaultNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'
import {
  renderBestBallDepth,
  runBestBallDepthCheck,
  type BestBallDepthDeps,
} from '@/lib/chimmy-alerts/runBestBallDepthCheck'

/**
 * The best ball depth push: the home card's rule, red only, once per user per week, inside the
 * lineup check's window, and only for leagues that are actually best ball.
 */
const MAIN = new Date('2026-10-11T17:00:00Z')
const IN_WINDOW = new Date('2026-10-11T13:00:00Z')
const TUESDAY = new Date('2026-10-06T15:00:00Z')

const alert = (over: Partial<Dash34DepthAlert> = {}): Dash34DepthAlert => ({
  leagueId: 'BB1',
  leagueName: 'Dynasty BestBall League!',
  platform: 'sleeper',
  href: '/core/my-team?league=BB1',
  waiversHref: '/core/waivers?league=BB1',
  position: 'QB',
  rostered: 2,
  healthy: 0,
  out: 2,
  questionable: 0,
  needed: 1,
  tone: 'bad',
  flagged: [{ name: 'Joe Burrow', status: 'Out' }, { name: 'Jaxson Dart', status: 'IR' }],
  ...over,
})

const bestBall = (id: string) => ({ id, name: id, leagueVariant: null, bestBallMode: null, settings: { best_ball: 1 }, platform: 'sleeper', platformLeagueId: `p-${id}`, season: 2026 })
const lineupLeague = (id: string) => ({ id, name: id, leagueVariant: null, bestBallMode: null, settings: {}, platform: 'sleeper', platformLeagueId: `p-${id}`, season: 2026 })

let deps: BestBallDepthDeps
let claimed: Set<string>

beforeEach(() => {
  claimed = new Set()
  deps = {
    now: () => IN_WINDOW,
    latestWeek: vi.fn(async () => ({ season: '2026', week: 6 })),
    loadGames: vi.fn(async () => [{ homeTeam: 'BUF', awayTeam: 'MIA', startTime: MAIN }]),
    loadAudience: vi.fn(async () => new Map([['u1', [bestBall('BB1'), lineupLeague('R1')]]])),
    loadSettings: vi.fn(async () => ({ notifications: getDefaultNotificationPreferences(), chimmy: null })),
    depthAlerts: vi.fn(async () => [alert()]),
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

describe('runBestBallDepthCheck', () => {
  it('sends one push for a red position, linking to that league’s waivers, and never twice a week', async () => {
    const run = await runBestBallDepthCheck({}, deps)
    expect(run).toMatchObject({ ran: true, outcomes: { sent: 1 } })
    // Only the best ball league is checked — the lineup league goes to the lineup check.
    expect(deps.depthAlerts).toHaveBeenCalledWith('u1', ['BB1'], IN_WINDOW)
    expect(vi.mocked(deps.dispatch).mock.calls[0]![0]).toMatchObject({
      userIds: ['u1'],
      category: 'lineup_reminders',
      type: 'chimmy_best_ball_depth',
      title: 'Best ball: no healthy QB left in Dynasty BestBall League!',
      actionHref: '/core/waivers?league=BB1',
      leagueId: 'BB1',
      dedupePrefix: 'chimmy-bestball-depth:2026-w6',
    })
    expect(await runBestBallDepthCheck({}, deps)).toMatchObject({ outcomes: { already_sent: 1 } })
    expect(deps.dispatch).toHaveBeenCalledTimes(1)
  })

  it('stays quiet on a warn-only week — a glance on the home, not a buzz', async () => {
    deps.depthAlerts = vi.fn(async () => [alert({ tone: 'warn', healthy: 1, out: 1, questionable: 1, rostered: 3 })])
    expect(await runBestBallDepthCheck({}, deps)).toMatchObject({ outcomes: { clean: 1 } })
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('does nothing outside the window, and skips users with no best ball league without reading settings', async () => {
    deps.now = () => TUESDAY
    expect(await runBestBallDepthCheck({}, deps)).toMatchObject({ ran: false, reason: 'early' })
    deps.now = () => IN_WINDOW
    deps.loadAudience = vi.fn(async () => new Map([['u2', [lineupLeague('R1')]]]))
    expect(await runBestBallDepthCheck({}, deps)).toMatchObject({ ran: true, users: 0 })
    expect(deps.loadSettings).not.toHaveBeenCalled()
  })

  it('honours the lineup_reminders switch and the per-league mute', async () => {
    deps.loadSettings = vi.fn(async () => {
      const p = getDefaultNotificationPreferences()
      p.categories.lineup_reminders = { ...p.categories.lineup_reminders!, enabled: false }
      return { notifications: p, chimmy: null }
    })
    expect(await runBestBallDepthCheck({}, deps)).toMatchObject({ outcomes: { category_off: 1 } })
    expect(deps.depthAlerts).not.toHaveBeenCalled()
  })

  it('a dry run previews and claims nothing', async () => {
    const run = await runBestBallDepthCheck({ dryRun: true }, deps)
    expect(run).toMatchObject({ ran: true, outcomes: { would_send: 1 } })
    expect(deps.claim).not.toHaveBeenCalled()
  })
})

describe('renderBestBallDepth', () => {
  it('names each league and the room, red positions only', () => {
    const m = renderBestBallDepth([
      alert(),
      alert({ position: 'TE', healthy: 0, out: 1, questionable: 0, rostered: 1 }),
      alert({ leagueId: 'BB2', leagueName: 'BB Dynasty League 26!', position: 'RB', tone: 'warn' }),
    ])!
    expect(m.title).toBe('Best ball: 2 thin spots in Dynasty BestBall League!')
    expect(m.body).toContain('Dynasty BestBall League! — QB: 0 healthy of 2 (2 out); TE: 0 healthy of 1 (1 out)')
    expect(m.body).not.toContain('BB Dynasty League 26!')
    expect(renderBestBallDepth([alert({ tone: 'warn' })])).toBeNull()
  })
})
