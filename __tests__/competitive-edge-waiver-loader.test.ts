// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The waiver Competitive Edge loader (lib/competitive-edge/waiverEdgeLoader.ts): DB-first reads of the
 * Sleeper import's waiver history and roster budgets, attributed to the right team, and withheld from
 * a viewer whose plan does not include it.
 */

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn(), findMany: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
  transactionFact: { findMany: vi.fn() },
  sportsPlayer: { findMany: vi.fn() },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { loadWaiverEdge, loadWaiverEdgeForScreen } from '@/lib/competitive-edge/waiverEdgeLoader'

const NOW = new Date('2026-09-25T18:00:00.000Z')
const SYNCED = new Date('2026-09-25T12:44:20.000Z')

const row = (id: string, managerId: string | null, rosterId: string | null, adds: string[], bid: number, extra: Record<string, unknown> = {}) => ({
  transactionId: id,
  managerId,
  rosterId,
  createdAt: SYNCED,
  payload: { adds, waiverBid: bid, status: 'complete', createdAt: '2026-09-23T17:00:00.000Z', ...extra },
})

beforeEach(() => {
  vi.clearAllMocks()
  db.league.findUnique.mockResolvedValue({ platform: 'sleeper', platformLeagueId: 'SL1', season: 2026, sport: 'NFL' })
  // A second importer's copy of the same Sleeper league.
  db.league.findMany.mockResolvedValue([{ id: 'lg-1' }, { id: 'lg-copy' }])
  db.leagueTeam.findMany.mockResolvedValue([
    { externalId: '1', ownerName: 'You', teamName: 'Mine', platformUserId: 'sl-you', claimedByUserId: 'u-you' },
    { externalId: '2', ownerName: 'Tasha', teamName: 'T', platformUserId: 'sl-tasha', claimedByUserId: null },
    { externalId: '3', ownerName: 'Mike', teamName: 'M', platformUserId: 'sl-mike', claimedByUserId: null },
  ])
  db.roster.findMany.mockResolvedValue([
    // Your own roster holds OUR user id, not Sleeper's — the join the Waivers screen already handles.
    { platformUserId: 'u-you', faabRemaining: 40 },
    { platformUserId: 'sl-tasha', faabRemaining: 72 },
    { platformUserId: 'sl-mike', faabRemaining: 12 },
  ])
  db.transactionFact.findMany.mockResolvedValue([
    row('tx1:2', '2', '2', ['p-rb'], 18),
    // The manager column is empty on about a third of Sleeper rows; the roster id carries it.
    row('tx2:2', null, '2', ['p-wr'], 6),
    row('tx3:3', '3', '3', ['p-rb'], 30),
    // Not a win.
    row('tx4:3', '3', '3', ['p-wr'], 50, { status: 'failed' }),
  ])
  db.sportsPlayer.findMany.mockResolvedValue([
    { sleeperId: 'p-rb', position: 'RB' },
    { sleeperId: 'p-wr', position: 'WR' },
  ])
})

const load = (usesFaab = true) => loadWaiverEdge({ leagueId: 'lg-1', userId: 'u-you', usesFaab, now: NOW })

describe('loadWaiverEdge', () => {
  it('reads this season’s waiver facts across every copy of the Sleeper league, DB-only', async () => {
    await load()
    expect(db.transactionFact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: { in: ['lg-1', 'lg-copy'] }, type: 'waiver', season: 2026 } }),
    )
    // Positions come from the league's own sport: a Sleeper id means nothing across sports.
    expect(db.sportsPlayer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sleeperId: { in: ['p-rb', 'p-wr'] }, sport: 'NFL' } }),
    )
  })

  it('🛑 attributes a claim with an empty manager column through its roster id, and skips a claim that was not won', async () => {
    const res = await load()
    if (!res.available) throw new Error(res.reason)
    const tasha = res.data.rivals.find((r) => r.manager.teamExternalId === '2')!
    const mike = res.data.rivals.find((r) => r.manager.teamExternalId === '3')!
    expect(tasha.claims).toBe(2)
    expect(mike.claims).toBe(1)
    expect(res.data.coverage.claims).toBe(3)
  })

  it('🛑 finds YOUR budget even when your roster row holds our user id, and leaves you out of the rivals', async () => {
    const res = await load()
    if (!res.available) throw new Error(res.reason)
    expect(res.data.viewer).toEqual({ teamExternalId: '1', faabRemaining: 40 })
    expect(res.data.rivals.map((r) => r.manager.name)).toEqual(['Tasha', 'Mike'])
    expect(res.data.leagueFacts[0]!.text).toBe('1 of the 2 other managers has more FAAB left than your $40.')
  })

  it('a non-FAAB league drops every bid and budget', async () => {
    const res = await load(false)
    if (!res.available) throw new Error(res.reason)
    expect(res.data.viewer.faabRemaining).toBeNull()
    expect(res.data.rivals.every((r) => r.faabRemaining === null)).toBe(true)
  })

  it('says when the history is older than its refresh window', async () => {
    const res = await loadWaiverEdge({ leagueId: 'lg-1', userId: 'u-you', usesFaab: true, now: new Date('2026-09-30T00:00:00.000Z') })
    if (!res.available) throw new Error(res.reason)
    expect(res.data.coverage).toMatchObject({ asOf: SYNCED.toISOString(), stale: true })
  })

  it('other platforms get an honest "not connected yet", and nothing is read', async () => {
    db.league.findUnique.mockResolvedValue({ platform: 'espn', platformLeagueId: 'E1', season: 2026, sport: 'NFL' })
    const res = await load()
    expect(res).toEqual({ available: false, reason: expect.stringContaining("ESPN leagues aren't connected yet") })
    expect(db.transactionFact.findMany).not.toHaveBeenCalled()
  })
})

describe('🛑 loadWaiverEdgeForScreen — the server withholds', () => {
  const waivers = {
    league: { id: 'lg-1', name: 'L', platform: 'sleeper', format: null },
    waiverType: { available: true as const, data: { kind: 'faab', label: 'FAAB', budget: 100 } },
  }
  const access = (unlocked: boolean) =>
    ({ depth: 'competitive_edge', unlocked, preLaunchFree: false, startsAt: '2026-10-15T04:00:00.000Z', planName: 'AF Pro', label: 'Competitive Edge', upgradePath: '/pro' }) as never

  it('a locked viewer gets nothing — no rivals’ budgets or claims leave the server', async () => {
    await expect(loadWaiverEdgeForScreen({ waivers, access: access(false), userId: 'u-you', now: NOW })).resolves.toBeNull()
    await expect(loadWaiverEdgeForScreen({ waivers, access: null, userId: 'u-you', now: NOW })).resolves.toBeNull()
    expect(db.transactionFact.findMany).not.toHaveBeenCalled()
    expect(db.roster.findMany).not.toHaveBeenCalled()
  })

  it('an unlocked viewer gets the edge, FAAB read from the screen’s own waiver type', async () => {
    const res = await loadWaiverEdgeForScreen({ waivers, access: access(true), userId: 'u-you', now: NOW })
    expect(res?.available).toBe(true)
    if (res?.available) expect(res.data.usesFaab).toBe(true)
  })

  it('a read failure is a sentence, not a crash', async () => {
    db.league.findUnique.mockRejectedValue(new Error('db down'))
    await expect(loadWaiverEdgeForScreen({ waivers, access: access(true), userId: 'u-you', now: NOW })).resolves.toEqual({
      available: false,
      reason: 'Competitive Edge could not be read right now.',
    })
  })
})

describe('🛑 the /core page wires it through the gate', () => {
  const page = readFileSync(resolve(__dirname, '..', 'app/core/(shell)/[[...screen]]/page.tsx'), 'utf8')

  it('resolves the paywall on Waivers, loads the edge only through the gate, and hands both to the screen', () => {
    const paywallRead = page.slice(page.indexOf('const corePaywallRead ='), page.indexOf('resolveCorePaywall(userId'))
    expect(paywallRead).toContain("activeKey === 'waivers'")
    expect(page).toContain('await loadWaiverEdgeForScreen({ waivers, access: waiverEdgeAccess, userId })')
    expect(page).toContain('<Waivers data={waivers} edge={waiverEdge} edgeAccess={waiverEdgeAccess} />')
    // Never the ungated loader straight from the page.
    expect(page).not.toMatch(/\bloadWaiverEdge\(/)
  })
})
