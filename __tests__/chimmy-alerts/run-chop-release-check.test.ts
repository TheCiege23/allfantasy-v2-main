import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
// The runner's defaults reach prisma; every test injects its own deps instead.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn() }))
vi.mock('@/lib/user-settings', () => ({ getSettingsProfile: vi.fn() }))
vi.mock('@/lib/chimmy-alerts/ChimmyAlertPreferencesService', () => ({ loadChimmyAlertPreferences: vi.fn() }))

import type { FaabBidPlan } from '@/lib/chimmy/tools/faabBidTool'
import type { ChopLeagueRows, ChopRosterSnapshot } from '@/lib/chimmy-alerts/chopRelease'
import { guillotineOnly, runChopReleaseCheck, type ChopReleaseDeps } from '@/lib/chimmy-alerts/runChopReleaseCheck'
import { getDefaultNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'
import type { NotificationPreferences } from '@/lib/notification-settings/types'

/**
 * The chop-release runner: OFF does nothing at all; the first look only seeds; a chop messages each
 * surviving claimed member once a week with their own plan; the snapshot moves only when a league is
 * finished for real. Every name is synthetic.
 */

const TUESDAY = new Date('2026-10-06T15:00:00Z')

const team = (externalId: string, claimedByUserId: string | null, teamName: string) => ({
  externalId,
  platformUserId: `sl-${externalId}`,
  claimedByUserId,
  teamName,
  ownerName: `owner${externalId}`,
})
const roster = (externalId: string, players: string[]) => ({
  platformUserId: `sl-${externalId}`,
  playerData: { source_team_id: externalId, players, starters: players.length ? players.slice(0, 1) : ['0', '0'] },
})

// Team 1 (Gamma Squad, claimed by u-gone) is chopped; 2 and 3 survive and are claimed; 4 survives unclaimed.
const BEFORE: ChopLeagueRows = {
  teams: [team('1', 'u-gone', 'Gamma Squad'), team('2', 'u-a', 'Alpha'), team('3', 'u-b', 'Bravo'), team('4', null, 'Delta')],
  rosters: [roster('1', ['p1', 'p2', 'p3']), roster('2', ['a1']), roster('3', ['b1']), roster('4', ['d1'])],
}
const AFTER: ChopLeagueRows = { ...BEFORE, rosters: [roster('1', []), roster('2', ['a1']), roster('3', ['b1']), roster('4', ['d1'])] }

const bidPlan = (userId: string): FaabBidPlan => ({
  status: 'ok',
  outcome: 'bid',
  leagueName: 'Test Chop League',
  platform: 'sleeper',
  platformLeagueId: 's-L1',
  concept: 'guillotine',
  elimination: true,
  valuesSource: 'test',
  valuesAsOf: '2026-10-06',
  remaining: 60,
  seasonBudget: 100,
  seatsLabel: 'FLEX ×2',
  horizonBasis: null,
  allocReason: null,
  rosteredCount: 40,
  pricedCount: 3,
  upgrades: [
    { id: 'p2', name: 'Ashton Vale', position: 'WR', ceiling: userId === 'u-a' ? 12 : 9, shareOfSupply: 0.5, marginalValue: 300, displacedName: 'Rory Penn' },
  ],
  nonUpgrades: 0,
})

function prefsWith(mutate?: (p: NotificationPreferences) => void): NotificationPreferences {
  const p = getDefaultNotificationPreferences()
  p.globalEnabled = true
  p.categories = { ...p.categories, lineup_reminders: { enabled: true, inApp: true, email: true, sms: false } }
  mutate?.(p)
  return p
}

let deps: ChopReleaseDeps
let claimed: Set<string>
let snapshots: Map<string, ChopRosterSnapshot>
let rows: ChopLeagueRows

beforeEach(() => {
  claimed = new Set()
  snapshots = new Map()
  rows = BEFORE
  deps = {
    now: () => TUESDAY,
    enabled: () => true,
    loadLeagues: vi.fn(async () => [{ id: 'L1', name: 'Test Chop League', platformLeagueId: 's-L1' }]),
    readRows: vi.fn(async () => rows),
    loadSnapshot: vi.fn(async (id: string) => snapshots.get(id) ?? null),
    saveSnapshot: vi.fn(async (id: string, s: ChopRosterSnapshot) => {
      snapshots.set(id, s)
    }),
    resolveWeek: vi.fn(async () => ({ seasonYear: 2026, week: 5 })),
    computePlan: vi.fn(async (_l: string, u: string) => bidPlan(u)),
    loadSettings: vi.fn(async () => ({ notifications: prefsWith(), chimmy: null })),
    alreadySent: vi.fn(async (key: string) => claimed.has(key)),
    claim: vi.fn(async (key: string) => {
      if (claimed.has(key)) return false
      claimed.add(key)
      return true
    }),
    dispatch: vi.fn(async () => {}),
    baseUrl: () => 'https://example.test',
  }
})

/** Seed with BEFORE, then switch the league to AFTER — the state right after a chop. */
async function seedThenChop() {
  await runChopReleaseCheck({}, deps)
  rows = AFTER
}

describe('runChopReleaseCheck', () => {
  it('🛑 flag OFF: nothing is read, written or sent — even with a chop sitting there', async () => {
    await seedThenChop()
    vi.clearAllMocks()
    deps.enabled = () => false
    expect(await runChopReleaseCheck({}, deps)).toEqual({ ran: false, reason: 'disabled' })
    expect(deps.loadLeagues).not.toHaveBeenCalled()
    expect(deps.readRows).not.toHaveBeenCalled()
    expect(deps.saveSnapshot).not.toHaveBeenCalled()
    expect(deps.computePlan).not.toHaveBeenCalled()
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('the default flag reads the environment, and is off when unset', async () => {
    const { enabled: _drop, ...rest } = deps
    vi.stubEnv('CHOP_RELEASE_ALERTS_ENABLED', '')
    expect(await runChopReleaseCheck({}, rest)).toEqual({ ran: false, reason: 'disabled' })
    expect(deps.loadLeagues).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('the first look only seeds — a roster already empty is not announced', async () => {
    rows = AFTER
    expect(await runChopReleaseCheck({}, deps)).toMatchObject({ ran: false, reason: 'no_chop', leagues: 1, seeded: 1 })
    expect(deps.saveSnapshot).toHaveBeenCalledTimes(1)
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('a chop sends ONE message to each surviving claimed member — not the chopped owner, not an unclaimed team', async () => {
    await seedThenChop()
    const run = await runChopReleaseCheck({}, deps)
    expect(run).toMatchObject({
      ran: true,
      outcomes: { sent: 2 },
      chops: [{ leagueId: 'L1', season: 2026, week: 5, teams: ['Gamma Squad'], released: 3 }],
    })
    expect(vi.mocked(deps.computePlan).mock.calls.map((c) => c[1]).sort()).toEqual(['u-a', 'u-b'])
    const calls = vi.mocked(deps.dispatch).mock.calls.map((c) => c[0])
    expect(calls.map((c) => c.userIds[0]).sort()).toEqual(['u-a', 'u-b'])
    const toA = calls.find((c) => c.userIds[0] === 'u-a')!
    expect(toA).toMatchObject({
      category: 'lineup_reminders',
      type: 'chimmy_chop_release',
      leagueId: 'L1',
      dedupePrefix: 'chop-release:L1:2026-w5',
      title: "Chop in Test Chop League: Chimmy's bid plan",
      body: 'Gamma Squad was chopped — 3 players hit waivers. Your plan: bid up to $12 on Ashton Vale (benches Rory Penn).',
      skipChannels: { sms: true, email: false, push: false },
      meta: { class: 'waiver', alertType: 'chop_release', week: 5, released: 3, kind: 'bid' },
    })
    // Each member's own plan: u-b's figure is u-b's.
    expect(calls.find((c) => c.userIds[0] === 'u-b')!.body).toContain('bid up to $9 on Ashton Vale')
    expect(claimed).toEqual(new Set(['chop-release:L1:2026-w5:u-a', 'chop-release:L1:2026-w5:u-b']))
  })

  it('never twice: the next run sees no new chop, and a replayed chop is stopped by the weekly claim', async () => {
    await seedThenChop()
    await runChopReleaseCheck({}, deps)
    expect(await runChopReleaseCheck({}, deps)).toMatchObject({ ran: false, reason: 'no_chop' })
    // Replay the same chop (e.g. a second replica read the old snapshot): claims hold.
    snapshots.clear()
    rows = BEFORE
    await runChopReleaseCheck({}, deps)
    rows = AFTER
    expect(await runChopReleaseCheck({}, deps)).toMatchObject({ ran: true, outcomes: { already_sent: 2 } })
    expect(deps.dispatch).toHaveBeenCalledTimes(2)
  })

  it('a dry run previews and writes nothing — no claim, no dispatch, no snapshot move', async () => {
    await seedThenChop()
    vi.mocked(deps.saveSnapshot).mockClear()
    const run = await runChopReleaseCheck({ dryRun: true }, deps)
    expect(run).toMatchObject({ ran: true, dryRun: true, outcomes: { would_send: 2 } })
    expect(deps.dispatch).not.toHaveBeenCalled()
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.saveSnapshot).not.toHaveBeenCalled()
    // The chop is still there for the real run.
    expect(await runChopReleaseCheck({}, deps)).toMatchObject({ ran: true, outcomes: { sent: 2 } })
  })

  it('a single-user run reaches only that user and leaves the chop for everyone else', async () => {
    await seedThenChop()
    vi.mocked(deps.saveSnapshot).mockClear()
    expect(await runChopReleaseCheck({ userId: 'u-b' }, deps)).toMatchObject({ ran: true, outcomes: { sent: 1 } })
    expect(deps.saveSnapshot).not.toHaveBeenCalled()
    expect(await runChopReleaseCheck({}, deps)).toMatchObject({ ran: true, outcomes: { sent: 1, already_sent: 1 } })
  })

  it("respects the settings: the category switch, the league's mute, Chimmy's Waivers mute", async () => {
    await seedThenChop()
    vi.mocked(deps.loadSettings).mockImplementation(async (userId: string) =>
      userId === 'u-a'
        ? { notifications: prefsWith((p) => (p.categories!.lineup_reminders!.enabled = false)), chimmy: null }
        : { notifications: prefsWith(), chimmy: { mutedClasses: ['waiver'] } as never },
    )
    expect(await runChopReleaseCheck({}, deps)).toMatchObject({ ran: true, outcomes: { category_off: 1, muted: 1 } })
    expect(deps.computePlan).not.toHaveBeenCalled()
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('a refused plan sends nothing for that member', async () => {
    await seedThenChop()
    vi.mocked(deps.computePlan).mockResolvedValue({ status: 'refused', line: 'no values' })
    expect(await runChopReleaseCheck({}, deps)).toMatchObject({ ran: true, outcomes: { no_plan: 2 } })
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('no league week: noted, not announced, and not retried', async () => {
    await seedThenChop()
    vi.mocked(deps.resolveWeek).mockResolvedValue(null)
    expect(await runChopReleaseCheck({}, deps)).toMatchObject({ ran: true, noWeek: 1, outcomes: {} })
    expect(deps.dispatch).not.toHaveBeenCalled()
    expect(await runChopReleaseCheck({}, deps)).toMatchObject({ ran: false, reason: 'no_chop' })
  })

  it('out of budget mid-league: the snapshot stays put, so the next run reaches the rest', async () => {
    await seedThenChop()
    vi.mocked(deps.saveSnapshot).mockClear()
    // A clock that reading the league's rosters pushes past the budget, so it trips at the first member.
    let clock = 0
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    vi.mocked(deps.readRows).mockImplementationOnce(async () => {
      clock += 1_000
      return rows
    })
    try {
      expect(await runChopReleaseCheck({ budgetMs: 500 }, deps)).toMatchObject({ ran: true, budgetStopped: true, outcomes: {} })
    } finally {
      spy.mockRestore()
    }
    expect(deps.saveSnapshot).not.toHaveBeenCalled()
    expect(deps.dispatch).not.toHaveBeenCalled()
    expect(await runChopReleaseCheck({}, deps)).toMatchObject({ ran: true, outcomes: { sent: 2 } })
  })

  it('a mass emptying is a reset: re-seeded, never announced', async () => {
    await runChopReleaseCheck({}, deps)
    rows = { ...BEFORE, rosters: [roster('1', []), roster('2', []), roster('3', []), roster('4', ['d1'])] }
    expect(await runChopReleaseCheck({}, deps)).toMatchObject({ ran: false, reason: 'no_chop', resets: 1 })
    expect(deps.dispatch).not.toHaveBeenCalled()
  })
})

describe('guillotineOnly', () => {
  const base = { leagueVariant: null, isDynasty: false, settings: null }
  it('keeps guillotine leagues by format rules and drops the rest — never by name', () => {
    const kept = guillotineOnly([
      { id: 'g', name: 'Friendly League', leagueType: 'guillotine', ...base },
      { id: 'r', name: 'Guillotine Chop Masters', leagueType: 'redraft', ...base },
      { id: 'd', name: 'Dyn', leagueType: 'dynasty', ...base, isDynasty: true },
    ])
    expect(kept.map((l) => l.id)).toEqual(['g'])
  })
})
