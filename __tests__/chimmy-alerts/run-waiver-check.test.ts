import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
// The runner's defaults reach prisma and the board; every test injects its own instead.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/core-app/waiversBoard', () => ({ getWaiversBoard: vi.fn() }))
vi.mock('@/lib/core-app/playerProjections', () => ({ latestProjectionWeek: vi.fn() }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn() }))
vi.mock('@/lib/user-settings', () => ({ getSettingsProfile: vi.fn() }))
vi.mock('@/lib/chimmy-alerts/ChimmyAlertPreferencesService', () => ({ loadChimmyAlertPreferences: vi.fn() }))

import type { WaiverBoardRow, WaiverPlayer, WaiversBoardData } from '@/lib/core-app/waiversBoard'
import { getDefaultNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'
import type { NotificationPreferences } from '@/lib/notification-settings/types'
import { runWaiverCheck, type WaiverCheckDeps } from '@/lib/chimmy-alerts/runWaiverCheck'

/**
 * The waiver check's runner: once per user per week, only inside the Tuesday window, only for
 * people who have not switched it off, only about this season's leagues — and the switches are
 * read before the board is computed.
 */

const W4_TNF = new Date('2026-10-02T00:15:00Z')
const W3_MNF = new Date('2026-09-29T00:15:00Z')
const TUESDAY = new Date('2026-09-29T16:00:00Z')
const SATURDAY = new Date('2026-09-26T16:00:00Z')

const player = (id: string, name: string, projected: number): WaiverPlayer => ({
  playerId: id,
  name,
  position: 'RB',
  team: 'PIT',
  imageUrl: null,
  projected,
  ownPct: null,
  startPct: null,
})

const row = (leagueId: string, netGain: number, over: Partial<WaiverBoardRow> = {}): WaiverBoardRow => ({
  leagueId,
  leagueName: `League ${leagueId}`,
  platform: 'sleeper',
  platformLeagueId: `s-${leagueId}`,
  logoUrl: null,
  format: null,
  netGain,
  add: player(`a-${leagueId}`, 'Jaylen Warren', 10 + netGain),
  drop: player(`d-${leagueId}`, 'Rashid Shaheed', 10),
  faabRemaining: null,
  runsAt: null,
  href: '',
  reasoning: '',
  ...over,
})

const board = (rows: WaiverBoardRow[], at: WaiversBoardData['at'] = { season: '2026', week: 4 }): WaiversBoardData => ({
  rows,
  considered: rows.length,
  withheld: { noRoster: 0, idSpace: 0, noScoring: 0, noCandidate: 0 },
  marketLeagues: 0,
  at,
})

const league = (id: string) => ({ id, name: `League ${id}`, leagueVariant: null, bestBallMode: null })

function prefsWith(mutate?: (p: NotificationPreferences) => void): NotificationPreferences {
  const p = getDefaultNotificationPreferences()
  mutate?.(p)
  return p
}

let deps: WaiverCheckDeps
let claimed: Set<string>

beforeEach(() => {
  claimed = new Set()
  deps = {
    now: () => TUESDAY,
    latestWeek: vi.fn(async () => ({ season: '2026', week: 4 })),
    loadGames: vi.fn(async (_season: number, week: number) =>
      week === 4
        ? [{ homeTeam: 'GB', awayTeam: 'DAL', startTime: W4_TNF }]
        : [{ homeTeam: 'NYJ', awayTeam: 'MIA', startTime: W3_MNF }],
    ),
    loadAudience: vi.fn(async () => new Map([['u1', [league('L1')]]])),
    loadSettings: vi.fn(async () => ({ notifications: prefsWith(), chimmy: null })),
    board: vi.fn(async () => board([row('L1', 4.5)])),
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

describe('runWaiverCheck', () => {
  it('does nothing outside the Tuesday window — not even reading the audience', async () => {
    deps.now = () => SATURDAY
    expect(await runWaiverCheck({}, deps)).toMatchObject({ ran: false, reason: 'early', firstKickoff: W4_TNF.toISOString() })
    deps.now = () => new Date('2026-10-01T20:00:00Z')
    expect(await runWaiverCheck({}, deps)).toMatchObject({ ran: false, reason: 'closed' })
    expect(deps.loadAudience).not.toHaveBeenCalled()
    expect(deps.board).not.toHaveBeenCalled()
  })

  it('waits for last week to finish, reading the week before the feed week', async () => {
    deps.now = () => new Date('2026-09-29T01:00:00Z') // Monday night, 45 minutes into MNF
    expect(await runWaiverCheck({}, deps)).toMatchObject({ ran: false, reason: 'early' })
    expect(deps.loadGames).toHaveBeenCalledWith(2026, 4)
    expect(deps.loadGames).toHaveBeenCalledWith(2026, 3)
  })

  it('needs a feed week and a schedule', async () => {
    deps.loadGames = vi.fn(async () => [])
    expect(await runWaiverCheck({}, deps)).toMatchObject({ ran: false, reason: 'no_schedule' })
    deps.latestWeek = vi.fn(async () => null)
    expect(await runWaiverCheck({}, deps)).toMatchObject({ ran: false, reason: 'no_projection_week' })
  })

  it('sends once, under the weekly-checks category, opening Chimmy on the move — never twice in a week', async () => {
    const first = await runWaiverCheck({}, deps)
    expect(first).toMatchObject({ ran: true, outcomes: { sent: 1 }, notReached: 0, picks: 1 })
    const sent = vi.mocked(deps.dispatch).mock.calls[0]![0]
    expect(sent).toMatchObject({
      userIds: ['u1'],
      category: 'lineup_reminders',
      type: 'chimmy_waiver_check',
      title: "Chimmy's waiver pick for League L1: Jaylen Warren (+4.5 pts)",
      actionLabel: 'Ask Chimmy',
      leagueId: 'L1',
      dedupePrefix: 'chimmy-waiver-check:2026-w4',
      skipChannels: { sms: true, email: false, push: false },
      meta: { class: 'waiver', alertType: 'waiver_check', week: 4, leagueIds: ['L1'], picks: 1 },
    })
    const href = new URL(sent.actionHref!, 'https://x.test')
    expect(href.pathname).toBe('/chimmy/chat')
    expect(href.searchParams.get('from')).toBe('waiver_check')
    expect(sent.emailOverride?.subject).toBe(sent.title)
    expect(deps.claim).toHaveBeenCalledWith('chimmy-waiver-check:2026-w4:u1', expect.any(Date))

    expect(await runWaiverCheck({}, deps)).toMatchObject({ outcomes: { already_sent: 1 } })
    expect(deps.dispatch).toHaveBeenCalledTimes(1)
    expect(deps.board).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when another run claimed the week first', async () => {
    deps.alreadySent = vi.fn(async () => false)
    deps.claim = vi.fn(async () => false)
    expect(await runWaiverCheck({}, deps)).toMatchObject({ outcomes: { already_sent: 1 } })
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('stays quiet when no pickup is worth a claim', async () => {
    deps.board = vi.fn(async () => board([row('L1', 1.2), row('L1', 7, { drop: null })]))
    expect(await runWaiverCheck({}, deps)).toMatchObject({ outcomes: { no_picks: 1 }, picks: 0 })
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('reads the switches before computing any board', async () => {
    deps.loadSettings = vi.fn(async () => ({
      notifications: prefsWith((p) => {
        p.categories!.lineup_reminders = { enabled: false, inApp: true, email: true, sms: false }
      }),
      chimmy: null,
    }))
    expect(await runWaiverCheck({}, deps)).toMatchObject({ outcomes: { category_off: 1 } })

    deps.loadSettings = vi.fn(async () => ({ notifications: prefsWith(), chimmy: { mutedClasses: ['waiver' as const] } }))
    expect(await runWaiverCheck({}, deps)).toMatchObject({ outcomes: { muted: 1 } })

    deps.loadSettings = vi.fn(async () => null)
    expect(await runWaiverCheck({}, deps)).toMatchObject({ outcomes: { no_profile: 1 } })

    expect(deps.board).not.toHaveBeenCalled()
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('a muted LINEUP class does not silence the waiver check', async () => {
    deps.loadSettings = vi.fn(async () => ({ notifications: prefsWith(), chimmy: { mutedClasses: ['lineup' as const] } }))
    expect(await runWaiverCheck({}, deps)).toMatchObject({ outcomes: { sent: 1 } })
  })

  it("names only this season's leagues, and none muted either way", async () => {
    deps.loadAudience = vi.fn(async () => new Map([['u1', [league('L1'), league('MUTED_NOTIF'), league('MUTED_CHIMMY')]]]))
    deps.loadSettings = vi.fn(async () => ({
      notifications: prefsWith((p) => (p.leagues = { MUTED_NOTIF: { mutedCategories: ['lineup_reminders'] } })),
      chimmy: { leaguePrefs: [{ leagueId: 'MUTED_CHIMMY', disabled: true }] },
    }))
    // LAST_SEASON is on the board (it reads every claimed team) but not in this season's audience.
    deps.board = vi.fn(async () =>
      board([row('LAST_SEASON', 12), row('MUTED_NOTIF', 11), row('MUTED_CHIMMY', 10), row('L1', 3)]),
    )
    await runWaiverCheck({}, deps)
    expect(vi.mocked(deps.dispatch).mock.calls[0]![0].meta).toMatchObject({ leagueIds: ['L1'] })
  })

  it('has nothing to say to someone with no league left to talk about', async () => {
    deps.loadSettings = vi.fn(async () => ({
      notifications: prefsWith((p) => (p.leagues = { L1: { mutedCategories: ['lineup_reminders'] } })),
      chimmy: null,
    }))
    expect(await runWaiverCheck({}, deps)).toMatchObject({ outcomes: { no_leagues: 1 } })
    expect(deps.board).not.toHaveBeenCalled()
  })

  it('🛑 ignores a board priced for a different week than the run', async () => {
    deps.board = vi.fn(async () => board([row('L1', 9)], { season: '2026', week: 3 }))
    expect(await runWaiverCheck({}, deps)).toMatchObject({ outcomes: { no_picks: 1 } })
    deps.board = vi.fn(async () => board([row('L1', 9)], null))
    expect(await runWaiverCheck({}, deps)).toMatchObject({ outcomes: { no_picks: 1 } })
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('puts one league in the league slot, and several in the body', async () => {
    deps.loadAudience = vi.fn(async () => new Map([['u1', [league('L1'), league('L2')]]]))
    deps.board = vi.fn(async () => board([row('L1', 3), row('L2', 6)]))
    await runWaiverCheck({}, deps)
    const sent = vi.mocked(deps.dispatch).mock.calls[0]![0]
    expect(sent.leagueId).toBeNull()
    expect(sent.title).toBe("Chimmy's waiver picks: 2 upgrades across your leagues")
    expect(sent.meta).toMatchObject({ leagueIds: ['L2', 'L1'], picks: 2 })
  })

  it('honours Chimmy channel switches and never texts', async () => {
    deps.loadSettings = vi.fn(async () => ({
      notifications: prefsWith(),
      chimmy: { channelPreferences: { disableEmail: false, disablePush: true } },
    }))
    await runWaiverCheck({}, deps)
    expect(vi.mocked(deps.dispatch).mock.calls[0]![0].skipChannels).toEqual({ sms: true, email: false, push: true })
  })

  it('a dry run previews and claims nothing; force runs outside the window', async () => {
    const run = await runWaiverCheck({ dryRun: true }, deps)
    expect(run).toMatchObject({ ran: true, dryRun: true, outcomes: { would_send: 1 }, picks: 1 })
    if (run.ran) expect(run.previews[0]).toMatchObject({ userId: 'u1', title: expect.stringContaining('Jaylen Warren') })
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.dispatch).not.toHaveBeenCalled()

    deps.now = () => SATURDAY
    expect(await runWaiverCheck({ force: true, dryRun: true }, deps)).toMatchObject({ ran: true, outcomes: { would_send: 1 } })
  })

  it('stops starting new users past its budget and says how many it did not reach', async () => {
    deps.loadAudience = vi.fn(async () => new Map([['u1', [league('L1')]], ['u2', [league('L2')]]]))
    expect(await runWaiverCheck({ budgetMs: 0 }, deps)).toMatchObject({ ran: true, users: 2, notReached: 2 })
    expect(deps.board).not.toHaveBeenCalled()
  })

  it('reports a failing user and carries on with the rest', async () => {
    deps.loadAudience = vi.fn(async () => new Map([['u1', [league('L1')]], ['u2', [league('L1')]]]))
    deps.board = vi.fn(async (userId: string) => {
      if (userId === 'u1') throw new Error('board read failed')
      return board([row('L1', 5)])
    })
    const run = await runWaiverCheck({}, deps)
    expect(run).toMatchObject({ outcomes: { error: 1, sent: 1 }, notReached: 0 })
    if (run.ran) expect(run.errors).toEqual([{ userId: 'u1', error: 'board read failed' }])
  })
})
