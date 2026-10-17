import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
// The runner's defaults reach prisma and the sections; every test injects its own instead.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/core-app/waiversBoard', () => ({ getWaiversBoard: vi.fn(), getWaiverSportSections: vi.fn() }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn() }))
vi.mock('@/lib/user-settings', () => ({ getSettingsProfile: vi.fn() }))
vi.mock('@/lib/chimmy-alerts/ChimmyAlertPreferencesService', () => ({ loadChimmyAlertPreferences: vi.fn() }))

import type { WaiverBoardRow, WaiverPlayer, WaiverSportSection } from '@/lib/core-app/waiversBoard'
import { getDefaultNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'
import type { NotificationPreferences } from '@/lib/notification-settings/types'
import { runSportWaiverCheck, type SportWaiverCheckDeps } from '@/lib/chimmy-alerts/runSportWaiverCheck'
import { SPORT_WAIVER_ALERT_RULES } from '@/lib/chimmy-alerts/waiverAlertRules'

/**
 * The other-sport waiver check's runner: only inside a sport's window, only in its season, only for
 * people who have not switched it off, only about this season's leagues of an OPEN sport — and at
 * most one message per user per Eastern day, never repeating a pick it named in the last few days.
 */

// Tuesday 10 Nov 2026, 11:00 Eastern: NBA (opener 20 Oct) and NHL (opener 29 Sep) in season, NCAAB
// (opener 2 Nov) in season, NCAAF on its Tuesday, MLB with no recorded opener.
const MORNING = new Date('2026-11-10T16:00:00Z')
const TONIGHT = new Date('2026-11-11T00:30:00Z')
const SATURDAY = new Date('2026-11-14T17:00:00Z')

const player = (id: string, name: string, projected: number): WaiverPlayer => ({
  playerId: id,
  name,
  position: 'C',
  team: 'BOS',
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
  add: player(`a-${leagueId}`, `Add ${leagueId}`, 20 + netGain),
  drop: player(`d-${leagueId}`, `Drop ${leagueId}`, 20),
  faabRemaining: null,
  runsAt: null,
  href: '',
  reasoning: '',
  ...over,
})

const section = (sport: string, rows: WaiverBoardRow[], over: Partial<WaiverSportSection> = {}): WaiverSportSection => ({
  sport,
  state: 'ok',
  reason: null,
  basis: sport === 'NCAAF' ? 'season_per_game_league' : 'season_per_game_af_default',
  basisLabel: null,
  season: 2026,
  rows: rows.map((r) => ({ ...r, sport })),
  considered: rows.length,
  withheld: { noRoster: 0, idSpace: 0, noScoring: 0, noCandidate: 0, noUpgrade: 0 },
  ...over,
})

const league = (id: string, sport: string) => ({ id, name: `League ${id}`, leagueVariant: null, bestBallMode: null, sport })

function prefsWith(mutate?: (p: NotificationPreferences) => void): NotificationPreferences {
  const p = getDefaultNotificationPreferences()
  mutate?.(p)
  return p
}

/** Games per sport: NBA and NCAAB tonight, NHL none today, NCAAF on Saturday. */
const schedule: Record<string, Date[]> = { NBA: [TONIGHT], NCAAB: [TONIGHT], NHL: [], NCAAF: [SATURDAY], MLB: [TONIGHT] }

let deps: SportWaiverCheckDeps
let claims: Map<string, string[]>

beforeEach(() => {
  claims = new Map()
  deps = {
    now: () => MORNING,
    rules: SPORT_WAIVER_ALERT_RULES,
    loadGames: vi.fn(async (sport: string) => (schedule[sport] ?? []).map((startTime) => ({ homeTeam: 'H', awayTeam: 'A', startTime }))),
    loadAudience: vi.fn(async () => new Map([['u1', [league('N1', 'NBA')]]])),
    loadSettings: vi.fn(async () => ({ notifications: prefsWith(), chimmy: null })),
    sections: vi.fn(async () => [section('NBA', [row('N1', 5)])]),
    alreadySent: vi.fn(async (key: string) => claims.has(key)),
    claim: vi.fn(async (key: string, _at: Date, named: string[]) => {
      if (claims.has(key)) return false
      claims.set(key, named)
      return true
    }),
    recentlyNamed: vi.fn(async (keys: string[]) => new Set(keys.flatMap((k) => claims.get(k) ?? []))),
    dispatch: vi.fn(async () => {}),
    baseUrl: () => 'https://allfantasy.ai',
  }
})

describe('runSportWaiverCheck', () => {
  it('reports every sport and reads no audience when nothing is open', async () => {
    deps.now = () => new Date('2026-11-10T13:00:00Z') // 8:00 Eastern
    expect(await runSportWaiverCheck({}, deps)).toEqual({
      ran: false,
      reason: 'closed',
      day: '2026-11-10',
      sports: { NCAAF: 'early', NBA: 'early', NCAAB: 'early', NHL: 'no_games', MLB: 'out_of_season' },
    })
    expect(deps.loadAudience).not.toHaveBeenCalled()
    expect(deps.sections).not.toHaveBeenCalled()
  })

  it('🛑 an out-of-season or disabled sport reads nothing at all', async () => {
    deps.rules = SPORT_WAIVER_ALERT_RULES.map((r) => (r.sport === 'NBA' ? { ...r, enabled: false } : r))
    const run = await runSportWaiverCheck({}, deps)
    expect(run.sports).toMatchObject({ NBA: 'disabled', MLB: 'out_of_season' })
    const read = vi.mocked(deps.loadGames).mock.calls.map((c) => c[0])
    expect(read).not.toContain('NBA')
    expect(read).not.toContain('MLB')
  })

  it('asks for the audience of the OPEN sports, each in its own season', async () => {
    const run = await runSportWaiverCheck({}, deps)
    expect(run).toMatchObject({ ran: true, openSports: ['NCAAF', 'NBA', 'NCAAB'] })
    expect(deps.loadAudience).toHaveBeenCalledWith(
      [
        { sport: 'NCAAF', season: 2026 },
        { sport: 'NBA', season: 2026 },
        { sport: 'NCAAB', season: 2026 },
      ],
      null,
    )
    // NCAAF reads regular-season games in the week ahead; a daily sport reads around today.
    const ncaaf = vi.mocked(deps.loadGames).mock.calls.find((c) => c[0] === 'NCAAF')!
    expect(ncaaf.slice(1)).toEqual([MORNING, new Date(MORNING.getTime() + 7 * 86_400_000), true])
    const nba = vi.mocked(deps.loadGames).mock.calls.find((c) => c[0] === 'NBA')!
    expect(nba[3]).toBe(false)
  })

  it('sends once a day, under the weekly-checks category, per game — never twice in a day', async () => {
    const first = await runSportWaiverCheck({}, deps)
    expect(first).toMatchObject({ ran: true, day: '2026-11-10', outcomes: { sent: 1 }, notReached: 0, picks: 1 })
    const sent = vi.mocked(deps.dispatch).mock.calls[0]![0]
    expect(sent).toMatchObject({
      userIds: ['u1'],
      category: 'lineup_reminders',
      type: 'chimmy_waiver_check',
      title: "Chimmy's NBA waiver pick for League N1: Add N1 (+5.0 pts/game)",
      actionLabel: 'Ask Chimmy',
      leagueId: 'N1',
      dedupePrefix: 'chimmy-waiver-check:sports:2026-11-10',
      skipChannels: { sms: true, email: false, push: false },
      meta: { class: 'waiver', alertType: 'waiver_check', basis: 'per_game', sports: ['NBA'], leagueIds: ['N1'], picks: 1 },
    })
    expect(sent.emailOverride?.subject).toBe(sent.title)
    expect(deps.claim).toHaveBeenCalledWith('chimmy-waiver-check:sports:2026-11-10:u1', expect.any(Date), ['NBA:N1:a-N1:d-N1'])

    // Later the same morning: already sent, and the sections are not even read.
    deps.now = () => new Date('2026-11-10T17:00:00Z')
    expect(await runSportWaiverCheck({}, deps)).toMatchObject({ outcomes: { already_sent: 1 } })
    expect(deps.dispatch).toHaveBeenCalledTimes(1)
    expect(deps.sections).toHaveBeenCalledTimes(1)
  })

  it('🛑 several sports on one day are ONE message, not one each', async () => {
    deps.loadAudience = vi.fn(async () => new Map([['u1', [league('N1', 'NBA'), league('C1', 'NCAAB'), league('F1', 'NCAAF')]]]))
    deps.sections = vi.fn(async () => [
      section('NCAAF', [row('F1', 3)]),
      section('NBA', [row('N1', 5)]),
      section('NCAAB', [row('C1', 7)]),
    ])
    const run = await runSportWaiverCheck({}, deps)
    expect(run).toMatchObject({ outcomes: { sent: 1 }, picks: 3 })
    expect(deps.dispatch).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(deps.dispatch).mock.calls[0]![0]
    expect(sent.title).toBe("Chimmy's waiver picks: 3 upgrades across your college football, NBA and college basketball leagues")
    expect(sent.leagueId).toBeNull()
    expect(sent.meta).toMatchObject({ sports: ['NCAAF', 'NBA', 'NCAAB'], leagueIds: ['F1', 'N1', 'C1'] })
  })

  it('each sport on its own per-game bar', async () => {
    deps.loadAudience = vi.fn(async () => new Map([['u1', [league('N1', 'NBA'), league('C1', 'NCAAB'), league('F1', 'NCAAF')]]]))
    // Just under NBA 4, NCAAB 5, NCAAF 3.
    deps.sections = vi.fn(async () => [
      section('NBA', [row('N1', 3.9)]),
      section('NCAAB', [row('C1', 4.9)]),
      section('NCAAF', [row('F1', 2.9)]),
    ])
    expect(await runSportWaiverCheck({}, deps)).toMatchObject({ outcomes: { no_picks: 1 }, picks: 0 })
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('🛑 never messages a sport whose window is not open, even with rows on its section', async () => {
    // NHL has no game today; its league and section are there, and still say nothing.
    deps.loadAudience = vi.fn(async () => new Map([['u1', [league('H1', 'NHL')]]]))
    deps.sections = vi.fn(async () => [section('NHL', [row('H1', 9)])])
    expect(await runSportWaiverCheck({}, deps)).toMatchObject({ ran: true, outcomes: { no_leagues: 1 } })
    deps.loadAudience = vi.fn(async () => new Map([['u1', [league('N1', 'NBA'), league('H1', 'NHL')]]]))
    deps.sections = vi.fn(async () => [section('NHL', [row('H1', 9)]), section('NBA', [row('N1', 5)])])
    await runSportWaiverCheck({}, deps)
    expect(vi.mocked(deps.dispatch).mock.calls[0]![0].meta).toMatchObject({ sports: ['NBA'], leagueIds: ['N1'] })
  })

  it('🛑 no producer, no projections: nothing to say', async () => {
    deps.sections = vi.fn(async () => [
      section('NBA', [row('N1', 9)], { state: 'no_projections' }),
      section('SOCCER', [row('S1', 9)], { state: 'no_producer', basis: null }),
    ])
    deps.loadAudience = vi.fn(async () => new Map([['u1', [league('N1', 'NBA'), league('S1', 'SOCCER')]]]))
    expect(await runSportWaiverCheck({}, deps)).toMatchObject({ outcomes: { no_picks: 1 } })
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('does not repeat a pick it named in the last three days — and names a new one', async () => {
    await runSportWaiverCheck({}, deps)
    expect(deps.dispatch).toHaveBeenCalledTimes(1)

    // Next morning, same wire: the same pick is not news.
    deps.now = () => new Date('2026-11-11T16:00:00Z')
    schedule.NBA = [new Date('2026-11-12T00:30:00Z')]
    try {
      expect(await runSportWaiverCheck({}, deps)).toMatchObject({ outcomes: { repeat_only: 1 } })
      expect(deps.recentlyNamed).toHaveBeenLastCalledWith([
        'chimmy-waiver-check:sports:2026-11-10:u1',
        'chimmy-waiver-check:sports:2026-11-09:u1',
        'chimmy-waiver-check:sports:2026-11-08:u1',
      ])
      expect(deps.dispatch).toHaveBeenCalledTimes(1)

      // A different drop is a different move.
      deps.sections = vi.fn(async () => [section('NBA', [row('N1', 5, { drop: player('d-other', 'Other', 18) })])])
      expect(await runSportWaiverCheck({}, deps)).toMatchObject({ outcomes: { sent: 1 } })
    } finally {
      schedule.NBA = [TONIGHT]
    }
  })

  it('reads the switches before computing any section — the same ones that silence the NFL check', async () => {
    deps.loadSettings = vi.fn(async () => ({
      notifications: prefsWith((p) => {
        p.categories!.lineup_reminders = { enabled: false, inApp: true, email: true, sms: false }
      }),
      chimmy: null,
    }))
    expect(await runSportWaiverCheck({}, deps)).toMatchObject({ outcomes: { category_off: 1 } })

    deps.loadSettings = vi.fn(async () => ({ notifications: prefsWith(), chimmy: { mutedClasses: ['waiver' as const] } }))
    expect(await runSportWaiverCheck({}, deps)).toMatchObject({ outcomes: { muted: 1 } })

    deps.loadSettings = vi.fn(async () => ({ notifications: prefsWith(), chimmy: { mutedTypes: ['waiver_check'] } }))
    expect(await runSportWaiverCheck({}, deps)).toMatchObject({ outcomes: { muted: 1 } })

    deps.loadSettings = vi.fn(async () => null)
    expect(await runSportWaiverCheck({}, deps)).toMatchObject({ outcomes: { no_profile: 1 } })

    expect(deps.sections).not.toHaveBeenCalled()
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('names no league muted either way', async () => {
    deps.loadAudience = vi.fn(
      async () => new Map([['u1', [league('N1', 'NBA'), league('MUTED_NOTIF', 'NBA'), league('MUTED_CHIMMY', 'NBA')]]]),
    )
    deps.loadSettings = vi.fn(async () => ({
      notifications: prefsWith((p) => (p.leagues = { MUTED_NOTIF: { mutedCategories: ['lineup_reminders'] } })),
      chimmy: { leaguePrefs: [{ leagueId: 'MUTED_CHIMMY', disabled: true }] },
    }))
    // LAST_SEASON is on the section (it reads every claimed team) but not in this season's audience.
    deps.sections = vi.fn(async () => [
      section('NBA', [row('LAST_SEASON', 12), row('MUTED_NOTIF', 11), row('MUTED_CHIMMY', 10), row('N1', 4)]),
    ])
    await runSportWaiverCheck({}, deps)
    expect(vi.mocked(deps.dispatch).mock.calls[0]![0].meta).toMatchObject({ leagueIds: ['N1'] })
  })

  it('honours Chimmy channel switches and never texts', async () => {
    deps.loadSettings = vi.fn(async () => ({
      notifications: prefsWith(),
      chimmy: { channelPreferences: { disableEmail: true, disablePush: false } },
    }))
    await runSportWaiverCheck({}, deps)
    expect(vi.mocked(deps.dispatch).mock.calls[0]![0].skipChannels).toEqual({ sms: true, email: true, push: false })
  })

  it('sends nothing when another run claimed the day first', async () => {
    deps.claim = vi.fn(async () => false)
    expect(await runSportWaiverCheck({}, deps)).toMatchObject({ outcomes: { already_sent: 1 } })
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('a dry run previews and claims nothing; force opens in-season sports, never out-of-season ones', async () => {
    const run = await runSportWaiverCheck({ dryRun: true }, deps)
    expect(run).toMatchObject({ ran: true, dryRun: true, outcomes: { would_send: 1 }, picks: 1 })
    if (run.ran) expect(run.previews[0]).toMatchObject({ userId: 'u1', title: expect.stringContaining('pts/game') })
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.dispatch).not.toHaveBeenCalled()

    deps.now = () => new Date('2026-11-10T13:00:00Z') // 8:00 Eastern, nothing open
    const forced = await runSportWaiverCheck({ force: true, dryRun: true }, deps)
    expect(forced).toMatchObject({ ran: true, outcomes: { would_send: 1 } })
    if (forced.ran) expect(forced.openSports).toEqual(['NCAAF', 'NBA', 'NCAAB', 'NHL'])
  })

  it('stops starting new users past its budget and says how many it did not reach', async () => {
    deps.loadAudience = vi.fn(async () => new Map([['u1', [league('N1', 'NBA')]], ['u2', [league('N2', 'NBA')]]]))
    expect(await runSportWaiverCheck({ budgetMs: 0 }, deps)).toMatchObject({ ran: true, users: 2, notReached: 2 })
    expect(deps.sections).not.toHaveBeenCalled()
  })

  it('reports a failing user and carries on with the rest', async () => {
    deps.loadAudience = vi.fn(async () => new Map([['u1', [league('N1', 'NBA')]], ['u2', [league('N1', 'NBA')]]]))
    deps.sections = vi.fn(async (userId: string) => {
      if (userId === 'u1') throw new Error('section read failed')
      return [section('NBA', [row('N1', 5)])]
    })
    const run = await runSportWaiverCheck({}, deps)
    expect(run).toMatchObject({ outcomes: { error: 1, sent: 1 }, notReached: 0 })
    if (run.ran) expect(run.errors).toEqual([{ userId: 'u1', error: 'section read failed' }])
  })
})
