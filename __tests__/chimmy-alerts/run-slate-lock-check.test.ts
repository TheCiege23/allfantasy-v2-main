import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/chimmy/lineupOptimizerGrounding', () => ({ buildLineupOptimization: vi.fn() }))
vi.mock('@/lib/core-app/playerProjections', () => ({ latestProjectionWeek: vi.fn() }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn() }))
vi.mock('@/lib/user-settings', () => ({ getSettingsProfile: vi.fn() }))
vi.mock('@/lib/chimmy-alerts/ChimmyAlertPreferencesService', () => ({ loadChimmyAlertPreferences: vi.fn() }))

import type { LineupOptimization, OptimizerPlayer } from '@/lib/chimmy/lineupOptimizerGrounding'
import { getDefaultNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'
import { openSlate, playsInSlate, renderSlateLock, slateIssueLine, slateIssues, slateKickoffs } from '@/lib/chimmy-alerts/slateLockCheck'
import { runSlateLockCheck, type SlateLockDeps } from '@/lib/chimmy-alerts/runSlateLockCheck'

/**
 * The lock check before every slate that is not the main one: Thursday night, Sunday night, Monday.
 * Only what locks in THAT slate, once per user per slate, never the main slate, never best ball.
 */
const TNF = new Date('2026-10-09T00:15:00Z') // Thu 8:15 PM ET
const MAIN = new Date('2026-10-11T17:00:00Z') // Sun 1:00 PM ET
const SNF = new Date('2026-10-12T00:20:00Z')
const BEFORE_TNF = new Date(TNF.getTime() - 60 * 60_000)
const BEFORE_MAIN = new Date(MAIN.getTime() - 60 * 60_000)

const GAMES = [
  { homeTeam: 'GB', awayTeam: 'DAL', startTime: TNF },
  { homeTeam: 'BUF', awayTeam: 'MIA', startTime: MAIN },
  { homeTeam: 'CHI', awayTeam: 'DET', startTime: MAIN },
  { homeTeam: 'KC', awayTeam: 'LV', startTime: SNF },
]

const player = (id: string, name: string, team: string, over: Partial<OptimizerPlayer> = {}): OptimizerPlayer => ({
  playerId: id,
  name,
  position: 'WR',
  team,
  injury: null,
  points: 10,
  ...over,
})

/** Start Jayden Reed (GB, Thursday) over Khalil Shakir (BUF, Sunday) for +5. */
const TNF_SWAP: LineupOptimization = {
  status: 'ready',
  week: { season: '2026', week: 6 },
  best: { points: 105, slots: [] },
  current: { starters: [], points: 100, emptySlots: 0, known: true },
  startInstead: [player('1', 'Jayden Reed', 'GB')],
  benchInstead: [player('2', 'Khalil Shakir', 'BUF')],
  gain: 5,
  unpricedStarters: [],
  injuredStarters: [],
  bench: [],
  unpricedActive: 0,
  unfilledSlots: [],
}
const SUNDAY_ONLY_SWAP: LineupOptimization = {
  ...TNF_SWAP,
  startInstead: [player('3', 'Rome Odunze', 'CHI')],
  benchInstead: [player('2', 'Khalil Shakir', 'BUF')],
}

const league = (id: string, over: Record<string, unknown> = {}) => ({ id, name: `League ${id}`, leagueVariant: null, bestBallMode: null, ...over })

let deps: SlateLockDeps
let claimed: Set<string>

beforeEach(() => {
  claimed = new Set()
  deps = {
    now: () => BEFORE_TNF,
    latestWeek: vi.fn(async () => ({ season: '2026', week: 6 })),
    loadGames: vi.fn(async () => GAMES),
    loadAudience: vi.fn(async () => new Map([['u1', [league('L1')]]])),
    loadSettings: vi.fn(async () => ({ notifications: getDefaultNotificationPreferences(), chimmy: null })),
    optimize: vi.fn(async () => TNF_SWAP),
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

describe('slate lock check — the rules', () => {
  it('lists the week’s slates and opens only a non-main one, 90 to 20 minutes before it', () => {
    expect(slateKickoffs(GAMES).map((d) => d.toISOString())).toEqual([TNF, MAIN, SNF].map((d) => d.toISOString()))
    expect(openSlate(GAMES, BEFORE_TNF, MAIN)?.toISOString()).toBe(TNF.toISOString())
    expect(openSlate(GAMES, new Date(TNF.getTime() - 120 * 60_000), MAIN)).toBeNull() // too early
    expect(openSlate(GAMES, new Date(TNF.getTime() - 10 * 60_000), MAIN)).toBeNull() // too late to act
    expect(openSlate(GAMES, BEFORE_MAIN, MAIN)).toBeNull() // the weekly check owns the main slate
  })

  it('keeps only what locks in this slate, and leaves ruled-out starters to the injury sweep', () => {
    const kickoffs = new Map([['GB', TNF], ['DAL', TNF], ['BUF', MAIN]])
    const inTnf = playsInSlate(kickoffs, TNF)
    const issues = [
      { kind: 'empty_slots' as const, count: 1 },
      { kind: 'ruled_out' as const, player: player('9', 'Hurt Guy', 'GB', { injury: 'Out' }) },
      { kind: 'no_projection' as const, player: player('8', 'No Proj', 'GB') },
      { kind: 'no_projection' as const, player: player('7', 'Sunday Guy', 'BUF') },
    ]
    expect(slateIssues(issues, inTnf, { includeEmptySlots: true }).map((i) => i.kind)).toEqual(['empty_slots', 'no_projection'])
    expect(slateIssues(issues, inTnf, { includeEmptySlots: false }).map((i) => i.kind)).toEqual(['no_projection'])
  })
})

describe('slate lock check — only what locks now (2026-10-08)', () => {
  const kickoffs = new Map([['GB', TNF], ['DAL', TNF], ['BUF', MAIN], ['CHI', MAIN]])
  const inTnf = playsInSlate(kickoffs, TNF)

  it('names only the players in the locking game, and does not credit Sunday’s gain to Thursday', () => {
    const line = slateIssueLine(
      { kind: 'reshuffle', gain: 18.2, start: [player('1', 'Jayden Reed', 'GB'), player('3', 'Rome Odunze', 'CHI')], bench: [player('2', 'Khalil Shakir', 'BUF')] },
      inTnf,
    )
    expect(line).toBe('Start Jayden Reed (WR, GB) before kickoff; the rest of that swap can wait for later games.')
    expect(line).not.toContain('Odunze')
    expect(line).not.toContain('Shakir')
    expect(line).not.toContain('18.2')
  })

  it('a swap entirely inside the locking game keeps its projected gain', () => {
    const line = slateIssueLine(
      { kind: 'reshuffle', gain: 4.4, start: [player('1', 'Jayden Reed', 'GB')], bench: [player('9', 'CeeDee Lamb', 'DAL')] },
      inTnf,
    )
    expect(line).toBe('Start Jayden Reed (WR, GB) and bench CeeDee Lamb (WR, DAL) (+4.4 projected pts).')
  })

  it('a bench-only Thursday move reads as one', () => {
    const line = slateIssueLine(
      { kind: 'reshuffle', gain: 6.4, start: [player('3', 'Rome Odunze', 'CHI')], bench: [player('5', 'Kenneth Gainwell', 'DAL', { position: 'RB' })] },
      inTnf,
    )
    expect(line).toBe('Bench Kenneth Gainwell (RB, DAL) before kickoff; the rest of that swap can wait for later games.')
  })

  it('a league with nothing locking now drops out of the message and the count', () => {
    const m = renderSlateLock(
      [
        { leagueId: 'L1', leagueName: 'League L1', week: 6, issues: [{ kind: 'reshuffle', gain: 5, start: [player('1', 'Jayden Reed', 'GB')], bench: [player('2', 'Khalil Shakir', 'BUF')] }] },
        { leagueId: 'L2', leagueName: 'League L2', week: 6, issues: [{ kind: 'reshuffle', gain: 9, start: [player('3', 'Rome Odunze', 'CHI')], bench: [player('2', 'Khalil Shakir', 'BUF')] }] },
      ],
      TNF,
      BEFORE_TNF,
      inTnf,
    )!
    expect(m.title).toBe('Lineups lock in 60 min (8:15 PM ET): 1 fix in League L1')
    expect(m.body).not.toContain('League L2')
  })
})

describe('runSlateLockCheck', () => {
  it('sends one push before Thursday night locks, about the Thursday swap, never by email', async () => {
    const run = await runSlateLockCheck({}, deps)
    expect(run).toMatchObject({ ran: true, slate: TNF.toISOString(), outcomes: { sent: 1 } })
    const sent = vi.mocked(deps.dispatch).mock.calls[0]![0]
    expect(sent).toMatchObject({
      userIds: ['u1'],
      category: 'lineup_reminders',
      type: 'chimmy_slate_lock_check',
      severity: 'high',
      leagueId: 'L1',
      skipChannels: { sms: true, email: true, push: false },
    })
    expect(sent.title).toBe('Lineups lock in 60 min (8:15 PM ET): 1 fix in League L1')
    expect(sent.body).toContain('Jayden Reed')
    expect(await runSlateLockCheck({}, deps)).toMatchObject({ outcomes: { already_sent: 1 } })
    expect(deps.dispatch).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when the only fix is for a later slate', async () => {
    deps.optimize = vi.fn(async () => SUNDAY_ONLY_SWAP)
    expect(await runSlateLockCheck({}, deps)).toMatchObject({ outcomes: { clean: 1 } })
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('does not run in the main slate’s window — the weekly lineup check owns that one', async () => {
    deps.now = () => BEFORE_MAIN
    expect(await runSlateLockCheck({}, deps)).toMatchObject({ ran: false, reason: 'no_slate' })
    expect(deps.loadAudience).not.toHaveBeenCalled()
  })

  it('says an empty slot once a week, not before every slate', async () => {
    deps.optimize = vi.fn(async () => ({ ...SUNDAY_ONLY_SWAP, current: { ...TNF_SWAP.current, emptySlots: 1 } }))
    expect(await runSlateLockCheck({}, deps)).toMatchObject({ outcomes: { sent: 1 } })
    expect(claimed.has('chimmy-slate-lock-empty:2026-w6:L1')).toBe(true)
    // Sunday night: the same empty slot, already said this week.
    deps.now = () => new Date(SNF.getTime() - 60 * 60_000)
    expect(await runSlateLockCheck({}, deps)).toMatchObject({ slate: SNF.toISOString(), outcomes: { clean: 1 } })
  })

  it('skips an imported best ball league — no lineup to lock', async () => {
    deps.loadAudience = vi.fn(async () => new Map([['u1', [league('BB', { settings: { best_ball: 1 } })]]]))
    expect(await runSlateLockCheck({}, deps)).toMatchObject({ outcomes: { no_leagues: 1 } })
    expect(deps.optimize).not.toHaveBeenCalled()
  })

  it('honours the lineup_reminders switch before reading any lineup', async () => {
    deps.loadSettings = vi.fn(async () => {
      const p = getDefaultNotificationPreferences()
      p.categories.lineup_reminders = { ...p.categories.lineup_reminders!, enabled: false }
      return { notifications: p, chimmy: null }
    })
    expect(await runSlateLockCheck({}, deps)).toMatchObject({ outcomes: { category_off: 1 } })
    expect(deps.optimize).not.toHaveBeenCalled()
  })

  it('a dry run previews without claiming', async () => {
    expect(await runSlateLockCheck({ dryRun: true }, deps)).toMatchObject({ outcomes: { would_send: 1 } })
    expect(deps.claim).not.toHaveBeenCalled()
  })
})
