/** Orphan team auction — opening, sealed bids, closing and the hourly run (lib/orphan-auction/orphanAuctionService.ts). */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type RosterRow = { id: string; platformUserId: string; settings: Record<string, unknown> | null }

const m = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  rosters: [] as Array<{ id: string; platformUserId: string; settings: Record<string, unknown> | null }>,
  teams: [] as Array<{ id: string; teamName: string; ownerName: string; faabBalance: number; waiverPriority: number }>,
  commissioners: new Set<string>(),
  plan: true,
  platform: 'manual',
  dynasty: true,
  pool: [] as unknown[],
  applied: { playersMoved: 0, playersDropped: 0, picksMoved: 0, missing: [] as string[] },
  prisma: {} as Record<string, any>,
}))

const raw = (strings: TemplateStringsArray) => strings.join('?')

// Filled in place: vi.mock's factory captured this object when the imports below were hoisted.
Object.assign(m.prisma, {
  league: {
    findUnique: vi.fn(async () => ({ id: 'L', name: 'Dynasty One', userId: 'owner', platform: m.platform, isDynasty: m.dynasty, leagueVariant: 'dynasty', settings: structuredClone(m.settings) })),
  },
  roster: { findMany: vi.fn(async () => structuredClone(m.rosters)) },
  redraftRoster: {
    findMany: vi.fn(async () => structuredClone(m.teams)),
    update: vi.fn(async ({ where, data }: any) => {
      const t = m.teams.find((x) => x.id === where.id)!
      t.faabBalance -= data.faabBalance.decrement
      return t
    }),
  },
  appUser: { findUnique: vi.fn(async ({ where }: any) => ({ id: where.id, email: null, username: null })) },
  userProfile: { findUnique: vi.fn(async () => null) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(m.prisma)),
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = raw(strings)
    if (sql.includes('SELECT settings FROM leagues')) return [{ settings: structuredClone(m.settings) }]
    if (sql.includes('SELECT id FROM leagues')) {
      const a = m.settings.orphan_auction as any
      return a?.status === 'open' && Date.parse(a.closesAt) <= (values[2] as Date).getTime() ? [{ id: 'L' }] : []
    }
    throw new Error(`unexpected query: ${sql}`)
  }),
  $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = raw(strings)
    const [key, json, id] = values as [string, string, string]
    if (sql.includes('UPDATE leagues')) m.settings[key] = JSON.parse(json)
    else if (sql.includes('UPDATE rosters')) {
      const r = m.rosters.find((x) => x.id === id)!
      r.settings = { ...(r.settings ?? {}), [key]: JSON.parse(json) }
    } else throw new Error(`unexpected write: ${sql}`)
    return 1
  }),
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: vi.fn(async (_l: string, u: string) => m.commissioners.has(u)) }))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({ hasAfCommissionerPlan: vi.fn(async () => m.plan) }))
vi.mock('@/lib/leagues/renewalPolicy', () => ({
  renewalKindFromSelection: vi.fn((a: { isDynasty: boolean }) => (a.isDynasty ? 'dynasty_family' : 'redraft')),
  resolveLeagueVariantKey: vi.fn(() => 'dynasty'),
}))
vi.mock('@/lib/orphan-ai-manager/orphanRosterResolver', () => ({ isOrphanPlatformUserId: (id: string) => id.startsWith('orphan') }))
vi.mock('@/lib/league/faabMirror', () => ({ copyRedraftFaabToGeneric: vi.fn(async () => undefined) }))
vi.mock('@/lib/dispersal-draft/nativeDispersal', () => ({
  seasonTeamsByRoster: vi.fn(async () => new Map(m.rosters.map((r) => [r.id, `t-${r.id}`]))),
  buildNativeAssetPool: vi.fn(async () => m.pool),
  applyNativeDispersal: vi.fn(async () => m.applied),
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn(async () => undefined) }))

import { applyNativeDispersal } from '@/lib/dispersal-draft/nativeDispersal'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import {
  cancelOrphanAuction,
  closeOrphanAuction,
  openOrphanAuction,
  readOrphanAuctionTasks,
  readOrphanAuctionView,
  readOrphanAuctionForChimmy,
  runOrphanAuctionClose,
  saveOrphanAuctionBids,
} from '@/lib/orphan-auction/orphanAuctionService'

const T0 = new Date('2026-10-27T12:00:00Z')
const AFTER = new Date('2026-10-29T13:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  m.settings = { inviteCode: 'KEEP-ME' }
  m.rosters = [
    { id: 'rA', platformUserId: 'userA', settings: { aiQueue: true } },
    { id: 'rB', platformUserId: 'userB', settings: null },
    { id: 'rC', platformUserId: 'userC', settings: null },
    { id: 'rO', platformUserId: 'orphan-1', settings: null },
  ] satisfies RosterRow[]
  m.teams = [
    { id: 't-rA', teamName: 'Alpha', ownerName: 'a', faabBalance: 100, waiverPriority: 3 },
    { id: 't-rB', teamName: 'Bravo', ownerName: 'b', faabBalance: 80, waiverPriority: 1 },
    { id: 't-rC', teamName: 'Charlie', ownerName: 'c', faabBalance: 50, waiverPriority: 2 },
    { id: 't-rO', teamName: 'Ghost FC', ownerName: 'gone', faabBalance: 60, waiverPriority: 4 },
  ]
  m.commissioners = new Set(['comm'])
  m.plan = true
  m.platform = 'manual'
  m.dynasty = true
  m.pool = [
    { id: 'x1', assetType: 'player', sourceRosterId: 'rO', playerId: 'P1', playerName: 'Star', playerPosition: 'WR', playerTeam: 'KC', isAvailable: true },
    { id: 'x2', assetType: 'player', sourceRosterId: 'rO', playerId: 'P2', playerName: 'Depth', isAvailable: true },
    { id: 'x3', assetType: 'draft_pick', sourceRosterId: 'rO', pickId: 'fdp:2027:1:rO', pickLabel: '2027 1st round', pickRound: 1, pickYear: 2027, isAvailable: true },
    { id: 'x4', assetType: 'faab', sourceRosterId: 'rO', faabAmount: 60, isAvailable: true },
  ]
  m.applied = { playersMoved: 0, playersDropped: 0, picksMoved: 0, missing: [] }
})

const open = (over: Record<string, unknown> = {}) => openOrphanAuction('L', 'comm', { sourceRosterIds: ['rO'], closeAfterHours: 48, minBid: 1, ...over }, T0)
const auction = () => m.settings.orphan_auction as any

describe('opening', () => {
  it('auctions the orphan team’s players and picks, not its FAAB, and tells every bidding team', async () => {
    const r = await open()
    expect(r.ok).toBe(true)
    expect(auction()).toMatchObject({ status: 'open', sourceRosterIds: ['rO'], sourceTeamNames: ['Ghost FC'], minBid: 1, closesAt: '2026-10-29T12:00:00.000Z' })
    expect(auction().assets.map((a: any) => a.id)).toEqual(['p:rO:P1', 'p:rO:P2', 'k:fdp:2027:1:rO'])
    expect(m.settings.inviteCode).toBe('KEEP-ME')
    const told = vi.mocked(dispatchNotification).mock.calls.map((c) => c[0].userIds[0])
    expect(told.sort()).toEqual(['userA', 'userB', 'userC'])
  })

  it('refuses without the plan, outside a native dynasty league, a second time, and for a team that is not an orphan', async () => {
    m.plan = false
    expect(await open()).toMatchObject({ ok: false, status: 403 })
    m.plan = true
    m.platform = 'sleeper'
    expect(await open()).toMatchObject({ ok: false, status: 400 })
    m.platform = 'manual'
    m.dynasty = false
    expect(await open()).toMatchObject({ ok: false, status: 400 })
    m.dynasty = true
    expect(await open({ sourceRosterIds: ['rA'] })).toMatchObject({ ok: false, status: 400 })
    expect(await open({ closeAfterHours: 5 })).toMatchObject({ ok: false, status: 400 })
    expect(await open({ minBid: 1.5 })).toMatchObject({ ok: false, status: 400 })
    expect(auction()).toBeUndefined()
    expect((await open()).ok).toBe(true)
    expect(await open()).toMatchObject({ ok: false, status: 409 })
  })

  it('is the commissioner’s alone', async () => {
    expect(await openOrphanAuction('L', 'userA', { sourceRosterIds: ['rO'] }, T0)).toMatchObject({ ok: false, status: 403 })
  })
})

describe('bids', () => {
  beforeEach(async () => {
    await open()
  })

  it("stores a team's bids on its own row, beside its other settings", async () => {
    const r = await saveOrphanAuctionBids('L', 'userA', { 'p:rO:P1': 40, 'p:rO:P2': '' }, T0)
    expect(r.ok).toBe(true)
    const row = m.rosters.find((x) => x.id === 'rA')!
    expect(row.settings).toMatchObject({ aiQueue: true, orphan_auction_bids: { auctionId: auction().id, bids: { 'p:rO:P1': 40 } } })
  })

  it('refuses bids over the team’s FAAB, from the orphan team, from outside the league, and after the close', async () => {
    expect(await saveOrphanAuctionBids('L', 'userC', { 'p:rO:P1': 30, 'p:rO:P2': 21 }, T0)).toMatchObject({ ok: false, code: 'OVER_BUDGET' })
    expect(await saveOrphanAuctionBids('L', 'orphan-1', { 'p:rO:P1': 1 }, T0)).toMatchObject({ ok: false, status: 403 })
    expect(await saveOrphanAuctionBids('L', 'stranger', { 'p:rO:P1': 1 }, T0)).toMatchObject({ ok: false, status: 403 })
    expect(await saveOrphanAuctionBids('L', 'userA', { 'p:rO:P1': 1 }, AFTER)).toMatchObject({ ok: false, code: 'AUCTION_CLOSED' })
    expect(m.prisma.$executeRaw).toHaveBeenCalledTimes(1) // only the open
  })

  it('never shows another team’s amounts while the auction is open', async () => {
    await saveOrphanAuctionBids('L', 'userA', { 'p:rO:P1': 40 }, T0)
    await saveOrphanAuctionBids('L', 'userB', { 'p:rO:P1': 45 }, T0)
    const asB = await readOrphanAuctionView('L', 'userB')
    const asComm = await readOrphanAuctionView('L', 'comm')
    expect(asB.ok && asB.view.supported && asB.view.mine).toEqual({ rosterId: 'rB', teamName: 'Bravo', budget: 80, bids: { 'p:rO:P1': 45 } })
    // A search for the NUMBER, not the text: the auction's id is a random UUID that can contain "40".
    const holds = (x: unknown, n: number): boolean => x === n || (typeof x === 'object' && x !== null && Object.values(x).some((y) => holds(y, n)))
    for (const v of [asB, asComm]) {
      expect(holds(v, 40)).toBe(false)
      expect(v.ok && v.view.supported && v.view.auction).toMatchObject({ biddingTeams: 2, eligibleTeams: 3, results: null })
    }
  })
})

describe('closing', () => {
  beforeEach(async () => {
    await open()
    await saveOrphanAuctionBids('L', 'userA', { 'p:rO:P1': 40, 'k:fdp:2027:1:rO': 5 }, T0)
    await saveOrphanAuctionBids('L', 'userB', { 'p:rO:P1': 45 }, T0)
    vi.mocked(dispatchNotification).mockClear()
  })

  it('waits for the closing time, even for the commissioner', async () => {
    expect(await closeOrphanAuction('L', { actorUserId: 'comm', now: T0 })).toMatchObject({ ok: false, status: 409 })
    expect(await closeOrphanAuction('L', { actorUserId: 'userA', now: AFTER })).toMatchObject({ ok: false, status: 403 })
    expect(applyNativeDispersal).not.toHaveBeenCalled()
  })

  it('moves every asset with the native writer, charges winners, zeroes the orphan FAAB and records the result', async () => {
    const r = await closeOrphanAuction('L', { actorUserId: 'comm', now: AFTER })
    expect(r.ok).toBe(true)
    const moves = vi.mocked(applyNativeDispersal).mock.calls[0]![1].assets
    expect(moves.map((a) => [a.assetType, a.playerId ?? a.pickId ?? null, a.claimedByRosterId ?? null])).toEqual([
      ['player', 'P1', 'rB'],
      ['player', 'P2', null],
      ['draft_pick', 'fdp:2027:1:rO', 'rA'],
      ['faab', null, null],
    ])
    expect(m.teams.find((t) => t.id === 't-rB')!.faabBalance).toBe(35)
    expect(m.teams.find((t) => t.id === 't-rA')!.faabBalance).toBe(95)
    expect(auction()).toMatchObject({ status: 'closed', result: { unsold: ['p:rO:P2'], missing: [] } })
    const titles = vi.mocked(dispatchNotification).mock.calls.map((c) => [c[0].userIds[0], c[0].title])
    expect(titles).toEqual([
      ['userA', 'You won 1 in the orphan auction'],
      ['userB', 'You won 1 in the orphan auction'],
    ])
    expect(await closeOrphanAuction('L', { actorUserId: null, now: AFTER })).toMatchObject({ ok: false, status: 409 })
  })

  it('charges nothing for a win that no longer left the orphan team', async () => {
    m.applied = { playersMoved: 0, playersDropped: 1, picksMoved: 1, missing: ['P1'] }
    await closeOrphanAuction('L', { actorUserId: null, now: AFTER })
    expect(m.teams.find((t) => t.id === 't-rB')!.faabBalance).toBe(80)
    expect(m.teams.find((t) => t.id === 't-rA')!.faabBalance).toBe(95)
    expect(auction().result.missing).toEqual(['p:rO:P1'])
    const view = await readOrphanAuctionView('L', 'comm')
    expect(view.ok && view.view.supported && view.view.auction?.results?.map((x) => x.assetId)).toEqual(['k:fdp:2027:1:rO'])
  })

  it('the hourly run closes only an auction whose time is up', async () => {
    expect(await runOrphanAuctionClose({ now: T0 })).toMatchObject({ leagues: 0, closed: 0 })
    expect(await runOrphanAuctionClose({ now: AFTER })).toMatchObject({ leagues: 1, closed: 1, failures: [] })
    expect(auction().status).toBe('closed')
  })

  it('a cancel moves nothing', async () => {
    expect((await cancelOrphanAuction('L', 'comm')).ok).toBe(true)
    expect(auction().status).toBe('cancelled')
    expect(applyNativeDispersal).not.toHaveBeenCalled()
    expect(await closeOrphanAuction('L', { actorUserId: null, now: AFTER })).toMatchObject({ ok: false, status: 409 })
  })
})

describe('Commish OS and Chimmy', () => {
  it('a task while open with who has bid, a high one once it is due, and nothing after', async () => {
    expect(await readOrphanAuctionTasks('L', T0)).toEqual([])
    await open()
    await saveOrphanAuctionBids('L', 'userA', { 'p:rO:P1': 40 }, T0)
    const [openTask] = await readOrphanAuctionTasks('L', T0)
    expect(openTask).toMatchObject({ title: 'Orphan auction open', priority: 'standard' })
    expect(openTask!.description).toContain('1 of 3 teams have bid')
    expect((await readOrphanAuctionTasks('L', AFTER))[0]).toMatchObject({ title: 'The orphan auction is ready to close', priority: 'high' })
    await closeOrphanAuction('L', { actorUserId: null, now: AFTER })
    expect(await readOrphanAuctionTasks('L', AFTER)).toEqual([])
  })

  it('Chimmy is told the auction and the rules, never a bid', async () => {
    expect(await readOrphanAuctionForChimmy('L', T0)).toBeNull()
    await open()
    await saveOrphanAuctionBids('L', 'userA', { 'p:rO:P1': 37 }, T0)
    const line = await readOrphanAuctionForChimmy('L', T0)
    expect(line).toContain('An orphan auction is open for Ghost FC: 2 players and 1 future picks')
    expect(line).not.toMatch(/\b37\b/)
  })
})
