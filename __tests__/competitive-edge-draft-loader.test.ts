// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The draft Competitive Edge loader (lib/competitive-edge/draftEdgeLoader.ts): DB-first reads of the
 * Sleeper import's draft picks, attributed by the owner recorded on each pick, and withheld from a
 * viewer whose plan does not include it.
 */

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
  draftFact: { findMany: vi.fn() },
  sportsPlayer: { findMany: vi.fn() },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { loadDraftEdge, loadDraftEdgeForScreen } from '@/lib/competitive-edge/draftEdgeLoader'

const fact = (season: number, round: number, playerId: string, ownerSleeperId?: string) => ({
  season,
  round,
  playerId,
  metadata: ownerSleeperId ? { ownerSleeperId, other: 'kept' } : null,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.league.findUnique.mockResolvedValue({ platform: 'sleeper', platformLeagueId: 'SL1', sport: 'NFL' })
  db.leagueTeam.findMany.mockResolvedValue([
    { externalId: '1', ownerName: 'You', teamName: 'Mine', platformUserId: 'sl-you', claimedByUserId: 'u-you' },
    { externalId: '2', ownerName: 'Tasha', teamName: 'T', platformUserId: ' sl-tasha ', claimedByUserId: null },
    { externalId: '3', ownerName: null, teamName: 'Mike’s Team', platformUserId: 'sl-mike', claimedByUserId: null },
    // No Sleeper id to match a person on — never a rival.
    { externalId: '4', ownerName: 'Ghost', teamName: 'G', platformUserId: null, claimedByUserId: null },
  ])
  db.draftFact.findMany.mockResolvedValue([
    fact(2024, 1, 'p-rb', 'sl-tasha'),
    fact(2024, 2, 'p-qb', 'sl-tasha'),
    fact(2025, 1, 'p-wr', 'sl-tasha'),
    fact(2025, 2, 'p-rb', 'sl-mike'),
    fact(2025, 1, 'p-rb', 'sl-you'),
    // Imported before the owner was recorded: left out, and its season named.
    fact(2023, 1, 'p-qb'),
    fact(2025, 3, 'p-wr'),
  ])
  db.sportsPlayer.findMany.mockResolvedValue([
    { sleeperId: 'p-rb', position: 'RB' },
    { sleeperId: 'p-qb', position: 'QB' },
    { sleeperId: 'p-wr', position: 'WR' },
  ])
})

const load = () => loadDraftEdge({ leagueId: 'lg-1', userId: 'u-you' })

describe('loadDraftEdge', () => {
  it('reads this league’s picks and positions from the database, in the league’s own sport', async () => {
    await load()
    expect(db.draftFact.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'lg-1' } }))
    expect(db.sportsPlayer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sleeperId: { in: ['p-rb', 'p-qb', 'p-wr'] }, sport: 'NFL' } }),
    )
  })

  it('🛑 attributes each pick by the owner recorded on it, and leaves out picks with none', async () => {
    const res = await load()
    if (!res.available) throw new Error(res.reason)
    const tasha = res.data.rivals.find((r) => r.manager.teamExternalId === '2')!
    const mike = res.data.rivals.find((r) => r.manager.teamExternalId === '3')!
    expect(tasha).toMatchObject({ picks: 3, drafts: 2, sufficient: true })
    expect(mike).toMatchObject({ picks: 1, drafts: 1, sufficient: false })
    expect(res.data.coverage.seasons).toEqual([2024, 2025])
    // 2023 had no owned pick at all; 2025 is only PARTLY matched, and still named.
    expect(res.data.coverage.unattributedSeasons).toEqual([2023, 2025])
  })

  it('leaves you out, and anyone without a Sleeper id to match on', async () => {
    const res = await load()
    if (!res.available) throw new Error(res.reason)
    expect(res.data.rivals.map((r) => r.manager.teamExternalId).sort()).toEqual(['2', '3'])
    expect(res.data.rivals.find((r) => r.manager.teamExternalId === '3')!.manager.name).toBe('Mike’s Team')
  })

  it('other platforms get an honest "not connected yet", and nothing is read', async () => {
    db.league.findUnique.mockResolvedValue({ platform: 'espn', platformLeagueId: 'E1', sport: 'NFL' })
    const res = await load()
    expect(res).toEqual({ available: false, reason: expect.stringContaining("ESPN leagues aren't connected yet") })
    expect(db.draftFact.findMany).not.toHaveBeenCalled()
  })

  it('a league with no owned picks yet reads no players', async () => {
    db.draftFact.findMany.mockResolvedValue([fact(2023, 1, 'p-qb')])
    const res = await load()
    if (!res.available) throw new Error(res.reason)
    expect(db.sportsPlayer.findMany).not.toHaveBeenCalled()
    expect(res.data.coverage).toMatchObject({ seasons: [], unattributedSeasons: [2023] })
  })
})

describe('🛑 loadDraftEdgeForScreen — the server withholds', () => {
  const access = (unlocked: boolean) =>
    ({ depth: 'competitive_edge', unlocked, preLaunchFree: false, startsAt: '2026-10-15T04:00:00.000Z', planName: 'AF Pro', label: 'Competitive Edge', upgradePath: '/pro' }) as never

  it('a locked viewer gets nothing — no rival’s picks leave the server', async () => {
    await expect(loadDraftEdgeForScreen({ leagueId: 'lg-1', access: access(false), userId: 'u-you' })).resolves.toBeNull()
    await expect(loadDraftEdgeForScreen({ leagueId: 'lg-1', access: null, userId: 'u-you' })).resolves.toBeNull()
    expect(db.draftFact.findMany).not.toHaveBeenCalled()
  })

  it('no league, nothing read', async () => {
    await expect(loadDraftEdgeForScreen({ leagueId: null, access: access(true), userId: 'u-you' })).resolves.toBeNull()
    expect(db.league.findUnique).not.toHaveBeenCalled()
  })

  it('an unlocked viewer gets the edge', async () => {
    const res = await loadDraftEdgeForScreen({ leagueId: 'lg-1', access: access(true), userId: 'u-you' })
    expect(res?.available).toBe(true)
  })

  it('a read failure is a sentence, not a crash', async () => {
    db.league.findUnique.mockRejectedValue(new Error('db down'))
    await expect(loadDraftEdgeForScreen({ leagueId: 'lg-1', access: access(true), userId: 'u-you' })).resolves.toEqual({
      available: false,
      reason: 'Competitive Edge could not be read right now.',
    })
  })
})

describe('🛑 the /core page wires it through the gate', () => {
  const page = readFileSync(resolve(__dirname, '..', 'app/core/[[...screen]]/page.tsx'), 'utf8')

  it('resolves the paywall on Draft HQ, loads the edge only through the gate, and hands both to the screen', () => {
    const paywallRead = page.slice(page.indexOf('const corePaywallRead ='), page.indexOf('resolveCorePaywall(userId'))
    expect(paywallRead).toContain("activeKey === 'draft-hq'")
    expect(page).toContain("const draftEdgeAccess = activeKey === 'draft-hq' ? (corePaywall?.competitive_edge ?? null) : null")
    expect(page).toMatch(/await loadDraftEdgeForScreen\(\{\s*leagueId: draftHq \? selectedLeagueId : null,\s*access: draftEdgeAccess,/)
    expect(page).toContain('<DraftHq data={draftHq} edge={draftEdge} edgeAccess={draftEdgeAccess} />')
    // Never the ungated loader straight from the page.
    expect(page).not.toMatch(/\bloadDraftEdge\(/)
  })
})
