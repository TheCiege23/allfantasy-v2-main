/**
 * The commissioner's opt-in auto-handover (phase 10, 2026-10-29): off unless switched on; a team whose
 * owner has done nothing of their own for N days is handed to AllFantasy (or Chimmy); idle time never
 * starts before the rule was switched on; AllFantasy's own saves never count as the owner's activity.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => {
  const state = { settings: {} as Record<string, unknown>, entitled: true }
  const tx = {
    $queryRaw: vi.fn(async () => []),
    league: {
      findUnique: vi.fn(async () => ({ settings: state.settings })),
      update: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => { state.settings = data.settings; return {} }),
    },
  }
  return {
    state,
    saves: [] as Array<{ rosterId: string; actorUserId: string | null; _max: { createdAt: Date | null } }>,
    claims: [] as Array<{ rosterId: string; _max: { createdAt: Date | null } }>,
    prisma: {
      $queryRaw: vi.fn(async () => [{ id: 'L' }]),
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      league: { findUnique: vi.fn(async () => ({ settings: state.settings, platform: 'allfantasy', userId: 'league-owner', name: 'Dyn' })) },
      roster: { findMany: vi.fn(async () => [{ id: 'r-away', platformUserId: 'away' }, { id: 'r-here', platformUserId: 'here' }, { id: 'r-orphan', platformUserId: 'orphan-1' }]) },
      afRosterMoveHistory: { groupBy: vi.fn(async () => m.saves) },
      waiverClaim: { groupBy: vi.fn(async () => m.claims) },
    },
    elevated: vi.fn(async () => true),
    log: vi.fn(async () => ({ id: 'a' })),
    notify: vi.fn(async () => ({})),
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: m.elevated }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.log }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.notify }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({ EntitlementResolver: class { resolveForUser = async () => ({ hasAccess: m.state.entitled }) } }))

import { parseAutoHandover, readAutoHandover, teamsToHandOver } from '@/lib/inactive-manager/autoHandover'
import { readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import { runAutoHandovers, setAutoHandover } from '@/lib/inactive-manager/inactiveManagerService'

const DAY = 86_400_000
const NOW = new Date('2026-11-20T12:00:00Z')
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)

beforeEach(() => {
  vi.clearAllMocks()
  m.state.settings = { other: 1, inactive_auto_handover: { days: 14, to: 'lineups', since: ago(30).toISOString(), byUserId: 'commish' } }
  m.state.entitled = true
  // r-away last saved a lineup 20 days ago; r-here saved 2 days ago; r-orphan never.
  m.saves = [
    { rosterId: 'r-away', actorUserId: 'away', _max: { createdAt: ago(20) } },
    { rosterId: 'r-here', actorUserId: 'here', _max: { createdAt: ago(2) } },
    // A save on r-away by someone else (the commissioner) is not the owner's activity.
    { rosterId: 'r-away', actorUserId: 'commish', _max: { createdAt: ago(1) } },
  ]
  m.claims = []
})

describe('the rule', () => {
  it('reads only a complete rule, and stamps when and by whom it was switched on', () => {
    expect(readAutoHandover({})).toBeNull()
    expect(readAutoHandover({ inactive_auto_handover: { days: 10, to: 'lineups', since: 'x', byUserId: 'c' } })).toBeNull()
    expect(parseAutoHandover({ days: 7, to: 'autopilot' }, 'c', NOW)).toEqual({ ok: true, value: { days: 7, to: 'autopilot', since: NOW.toISOString(), byUserId: 'c' } })
    expect(parseAutoHandover(null, 'c')).toEqual({ ok: true, value: null })
    expect(parseAutoHandover({ days: 3, to: 'lineups' }, 'c').ok).toBe(false)
  })

  it('idle time starts at the later of the owner’s last action and the rule being switched on', () => {
    const rule = { days: 14 as const, to: 'lineups' as const, since: ago(5).toISOString(), byUserId: 'c' }
    // Idle 60 days, but the rule is 5 days old: not yet.
    expect(teamsToHandOver({ rule, now: NOW, managed: {}, candidates: [{ rosterId: 'a', lastOwnActionAt: ago(60) }] })).toEqual([])
    const old = { ...rule, since: ago(40).toISOString() }
    expect(teamsToHandOver({ rule: old, now: NOW, managed: {}, candidates: [{ rosterId: 'a', lastOwnActionAt: ago(15) }, { rosterId: 'b', lastOwnActionAt: ago(13) }, { rosterId: 'c', lastOwnActionAt: null }] })).toEqual(['a', 'c'])
    // Already managed: left alone.
    expect(teamsToHandOver({ rule: old, now: NOW, managed: { a: { since: 's', byUserId: 'c' } }, candidates: [{ rosterId: 'a', lastOwnActionAt: null }] })).toEqual([])
  })
})

describe('the hourly run', () => {
  it('hands over the idle team and the orphan, not the active one; logs and tells the commissioner and the owner', async () => {
    const r = await runAutoHandovers({ now: NOW })
    expect(r).toMatchObject({ leagues: 1, handedOver: 2, failures: [] })
    const managed = readManagedLineups(m.state.settings)
    expect(Object.keys(managed).sort()).toEqual(['r-away', 'r-orphan'])
    expect(managed['r-away']).toMatchObject({ byUserId: 'commish', ownerUserId: 'away' })
    expect(managed['r-away']!.autopilot).toBeUndefined()
    expect(m.state.settings.other).toBe(1)
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['commish', 'league-owner'], type: 'inactive_auto_handover' }))
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['away'], type: 'inactive_auto_handover_owner' }))
    // An orphan team has no owner to tell.
    expect(m.notify).not.toHaveBeenCalledWith(expect.objectContaining({ userIds: ['orphan-1'] }))
  })

  it('a recent waiver claim counts as the owner being active', async () => {
    m.claims = [{ rosterId: 'r-away', _max: { createdAt: ago(3) } }]
    await runAutoHandovers({ now: NOW })
    expect(Object.keys(readManagedLineups(m.state.settings))).toEqual(['r-orphan'])
  })

  it('hands to Chimmy autopilot when chosen and the plan allows; lineups only when it has lapsed', async () => {
    m.state.settings = { inactive_auto_handover: { days: 14, to: 'autopilot', since: ago(30).toISOString(), byUserId: 'commish' } }
    await runAutoHandovers({ now: NOW })
    expect(readManagedLineups(m.state.settings)['r-away']!.autopilot).toMatchObject({ style: 'dynasty_owner' })
    m.state.settings = { inactive_auto_handover: { days: 14, to: 'autopilot', since: ago(30).toISOString(), byUserId: 'commish' } }
    m.state.entitled = false
    await runAutoHandovers({ now: NOW })
    expect(readManagedLineups(m.state.settings)['r-away']!.autopilot).toBeUndefined()
  })
})

describe('the commissioner switch', () => {
  it('saves the rule, refuses autopilot without the plan, and turns off with null', async () => {
    m.state.settings = { other: 1 }
    expect(await setAutoHandover('L', 'commish', { days: 7, to: 'lineups' })).toMatchObject({ ok: true, rule: { days: 7, to: 'lineups', byUserId: 'commish' } })
    expect(readAutoHandover(m.state.settings)).toMatchObject({ days: 7 })
    m.state.entitled = false
    expect(await setAutoHandover('L', 'commish', { days: 7, to: 'autopilot' })).toMatchObject({ ok: false, status: 402 })
    expect(await setAutoHandover('L', 'commish', null)).toEqual({ ok: true, rule: null })
    expect(m.state.settings).toEqual({ other: 1 })
  })

  it('is the commissioner’s only', async () => {
    m.elevated.mockResolvedValueOnce(false)
    expect(await setAutoHandover('L', 'member', { days: 7, to: 'lineups' })).toMatchObject({ ok: false, status: 403 })
  })
})
