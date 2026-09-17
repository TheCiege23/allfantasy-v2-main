// @vitest-environment node
/**
 * The league Overview's commissioner card names the same inactive managers the Commissioner Hub
 * does.
 *
 * 🛑 WHAT WAS WRONG. The card judged activity by `Roster.updatedAt` (`getLeagueManagerHealth`). On
 * an imported league the sync rewrites every roster row on each pass, so every manager read active,
 * while a leftover roster row with no team behind it was counted as the league's one inactive
 * manager. A manager who made no moves at all was never named.
 *
 * Driven through `getLeagueHomeData`, with a permissive Prisma double. The two activity reads and
 * the roster-clock read are mocked: the roster-clock mock returns what that read really returns on
 * an imported league (every team active, plus a leftover row), which is what the old card showed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ answers: {} as Record<string, (args: unknown) => unknown> }))
const reads = vi.hoisted(() => ({
  managerHealth: vi.fn(),
  managerActivity: vi.fn(),
  activityWindow: vi.fn(),
}))

vi.mock('@/lib/prisma', () => {
  const fallback = (method: string) =>
    method === 'count' ? 0 : method === 'findMany' || method.startsWith('$query') ? [] : null
  const modelProxy = (model: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          vi.fn(async (args: unknown) => {
            const answer = db.answers[`${model}.${method}`]
            return answer ? answer(args) : fallback(method)
          }),
      },
    )
  const prisma = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key.startsWith('$query') || key.startsWith('$execute')) return vi.fn(async () => [])
        if (key === '$transaction') return vi.fn(async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : null))
        if (key === 'then') return undefined
        return modelProxy(key)
      },
    },
  )
  return { prisma, default: prisma }
})

vi.mock('@/lib/commissioner-hub/managerHealth', () => ({ getLeagueManagerHealth: reads.managerHealth }))
vi.mock('@/lib/league-history/leagueWarehouseReads', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readManagerActivity: reads.managerActivity,
  readActivityWindow: reads.activityWindow,
}))

import { getLeagueHomeData } from '@/lib/core-app/leagueHome'

const L = 'league-1'
const U = 'user-1'
const DAY = 86_400_000

type Card =
  | {
      available: true
      data: {
        inactiveCount: number
        atRiskCount: number | null
        totalManagers: number
        inactiveNames: string[]
        basis: string
        href: string
      }
    }
  | { available: false; reason: string; href?: string }

const team = (teamName: string, extra: Record<string, unknown> = {}) => ({
  externalId: teamName,
  teamName,
  ownerName: `${teamName}-owner`,
  claimedByUserId: null,
  platformUserId: `p-${teamName}`,
  isOrphan: false,
  isCommissioner: false,
  isCoCommissioner: false,
  wins: 0,
  losses: 0,
  ties: 0,
  pointsFor: 0,
  currentRank: 1,
  ...extra,
})

function load(opts: { platform: string; lastSyncedAt: Date | null }): Promise<Card> {
  db.answers['leagueTeam.findMany'] = () => [
    team('Ada', { claimedByUserId: U, isCoCommissioner: true }),
    team('Bea'),
    team('Cy'),
    // An empty seat is not a quiet manager.
    team('Empty Seat', { platformUserId: null, isOrphan: true }),
  ]
  const ctx = {
    leagueId: L,
    userId: U,
    league: vi.fn(async () => ({
      id: L,
      name: 'Kings',
      platform: opts.platform,
      platformLeagueId: 'pl-1',
      sport: 'NFL',
      season: 2026,
      status: 'in_season',
      settings: {},
      leagueSize: 4,
      lastSyncedAt: opts.lastSyncedAt,
    })),
    claimedTeam: vi.fn(async () => ({ externalId: 'Ada', teamName: 'Ada' })),
    claimedTeams: vi.fn(async () => [{ externalId: 'Ada' }]),
  }
  return getLeagueHomeData(L, U, null, ctx as never).then((d) => (d as unknown as { commissioner: Card }).commissioner)
}

beforeEach(() => {
  db.answers = {}
  vi.clearAllMocks()
  // What the roster clock says on an imported league: every team fresh, one leftover row idle.
  reads.managerHealth.mockResolvedValue({
    leagueId: L,
    totalManagers: 4,
    inactiveCount: 1,
    atRiskCount: 0,
    rows: [
      { rosterId: 'r1', teamName: 'Ada', managerName: 'Ada-owner', status: 'active', lastActionAt: new Date().toISOString() },
      { rosterId: 'r2', teamName: 'Bea', managerName: 'Bea-owner', status: 'active', lastActionAt: new Date().toISOString() },
      { rosterId: 'r3', teamName: 'Cy', managerName: 'Cy-owner', status: 'active', lastActionAt: new Date().toISOString() },
      { rosterId: 'r9', teamName: null, managerName: null, status: 'inactive', lastActionAt: '2025-01-01T00:00:00.000Z' },
    ],
  })
  reads.managerActivity.mockResolvedValue([
    { managerName: 'Ada', currentCount: 3, priorCount: 0 },
    { managerName: 'Bea', currentCount: 1, priorCount: 2 },
  ])
  reads.activityWindow.mockResolvedValue({ lastActivityAt: new Date(Date.now() - DAY), tradeCount: 1, waiverCount: 3, eventCount: 40 })
})

describe('an imported league’s commissioner card', () => {
  it('names the manager with no moves, and not the leftover roster row', { timeout: 60_000 }, async () => {
    const card = await load({ platform: 'sleeper', lastSyncedAt: new Date(Date.now() - 60 * 60 * 1000) })

    expect(card.available).toBe(true)
    if (!card.available) return
    expect(card.data.inactiveNames).toEqual(['Cy'])
    expect(card.data.inactiveCount).toBe(1)
    // Three managers: the empty seat and the leftover roster row are not managers.
    expect(card.data.totalManagers).toBe(3)
    // At-risk is not a state moves can measure: absent, not zero.
    expect(card.data.atRiskCount).toBeNull()
    expect(card.data.basis).toContain('waiver claims')
    expect(card.data.href).toBe('/core/commissioner?league=league-1')
    expect(reads.managerHealth).not.toHaveBeenCalled()
  })

  it('does not judge a league whose sync has stopped, and still links to the hub', { timeout: 60_000 }, async () => {
    const card = await load({ platform: 'sleeper', lastSyncedAt: new Date(Date.now() - 3 * DAY) })

    expect(card).toEqual({
      available: false,
      reason: expect.stringContaining('last read this league 3 days ago'),
      href: '/core/commissioner?league=league-1',
    })
    expect(reads.managerActivity).not.toHaveBeenCalled()
  })

  it('says why instead of showing zeroes when no move maps to a manager', { timeout: 60_000 }, async () => {
    reads.managerActivity.mockResolvedValue([])

    const card = await load({ platform: 'sleeper', lastSyncedAt: new Date() })

    expect(card).toEqual({
      available: false,
      reason: expect.stringContaining('couldn’t be matched to its managers'),
      href: '/core/commissioner?league=league-1',
    })
  })

  it('says why when the activity read fails', { timeout: 60_000 }, async () => {
    reads.activityWindow.mockRejectedValue(new Error('db down'))

    const card = await load({ platform: 'sleeper', lastSyncedAt: new Date() })

    expect(card.available).toBe(false)
    if (card.available) return
    expect(card.reason).toBe('League activity couldn’t be read just now.')
  })
})

describe('a league AllFantasy runs', () => {
  it('keeps the roster clock, without the leftover row, and counts at-risk', { timeout: 60_000 }, async () => {
    reads.managerHealth.mockResolvedValue({
      leagueId: L,
      totalManagers: 4,
      inactiveCount: 2,
      atRiskCount: 1,
      rows: [
        { rosterId: 'r1', teamName: 'Ada', managerName: 'a', status: 'active', lastActionAt: new Date().toISOString() },
        { rosterId: 'r2', teamName: 'Bea', managerName: 'b', status: 'at_risk', lastActionAt: new Date(Date.now() - 9 * DAY).toISOString() },
        { rosterId: 'r3', teamName: 'Cy', managerName: 'c', status: 'inactive', lastActionAt: new Date(Date.now() - 20 * DAY).toISOString() },
        { rosterId: 'r9', teamName: null, managerName: null, status: 'inactive', lastActionAt: null },
      ],
    })

    // A native league long past its "sync" is still judged: its roster clock is its managers'.
    const card = await load({ platform: 'manual', lastSyncedAt: new Date(Date.now() - 30 * DAY) })

    expect(card.available).toBe(true)
    if (!card.available) return
    expect(card.data.inactiveNames).toEqual(['Cy'])
    expect(card.data.inactiveCount).toBe(1)
    expect(card.data.atRiskCount).toBe(1)
    expect(card.data.totalManagers).toBe(3)
    expect(reads.managerActivity).not.toHaveBeenCalled()
  })
})
