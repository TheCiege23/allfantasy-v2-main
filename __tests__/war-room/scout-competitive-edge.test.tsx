/**
 * Scout's Competitive Edge section (owner's decision 2026-10-02: on Scout, behind the gate).
 *
 * The properties that make it safe to sell, each written to be able to fail:
 *   1. THE SERVER WITHHOLDS. A locked viewer's read returns null and touches no table — a lock card
 *      drawn over data that was sent anyway is a client-only gate.
 *   2. A PLAN IS NOT A MEMBERSHIP. The league id comes from the URL; a paying non-member gets nothing.
 *   3. ONE RULE. Trade counts come from `buildTradeEdge`, so Scout and the Trade Center agree.
 *   4. HONEST GAPS. A cold trade cache and a non-Sleeper league say so in words, never as zeros.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  teamFindMany: vi.fn(),
  cacheFindUnique: vi.fn(),
  waiverSettings: vi.fn(),
  membership: vi.fn(),
  loadWaiverEdge: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique },
    leagueTeam: { findMany: h.teamFindMany },
    sportsDataCache: { findUnique: h.cacheFindUnique },
    leagueWaiverSettings: { findUnique: h.waiverSettings },
  },
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: h.membership }))
vi.mock('@/lib/competitive-edge/waiverEdgeLoader', () => ({ loadWaiverEdge: h.loadWaiverEdge }))
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ TRADE_GRADES_CACHE_PREFIX: 'trade-grades:v2:' }))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: unknown }) => <a href={href}>{children as never}</a>,
}))

import { loadScoutEdge, loadScoutEdgeForScreen, type ScoutEdge } from '@/lib/competitive-edge/scoutEdgeLoader'
import { buildTradeEdge } from '@/lib/competitive-edge/tradeEdge'
import { Scout } from '@/components/core-app/screens/Scout'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { ScoutData } from '@/lib/core-app/scout'

const ME = 'user-1'
const NOW = new Date('2026-10-02T16:00:00Z')

const access = (unlocked: boolean): CoreDepthAccess => ({
  depth: 'competitive_edge',
  unlocked,
  hasPlan: unlocked,
  preLaunchFree: false,
  startsAt: '2026-10-15T00:00:00.000Z',
  planName: 'AF Pro',
  label: 'Competitive Edge',
  upgradePath: '/upgrade?plan=pro',
})

const side = (ownerId: string) => ({ ownerId, playersIn: [{ position: 'WR' }], playersOut: [{ position: 'RB' }], picksIn: [], picksOut: [] })
const TRADES = [
  { id: 't1', season: '2025', week: 6, createdIso: '2025-10-12T15:00:00.000Z', sides: [side('su-rival'), side('su-third')] },
  { id: 't2', season: '2026', week: 2, createdIso: '2026-09-15T15:00:00.000Z', sides: [side('su-rival'), side('su-me')] },
  { id: 't3', season: '2026', week: 3, createdIso: '2026-09-21T15:00:00.000Z', sides: [side('su-rival'), side('su-third')] },
]

beforeEach(() => {
  vi.resetAllMocks()
  h.membership.mockResolvedValue({ ok: true, access: { leagueId: 'lg1' } })
  h.leagueFindUnique.mockResolvedValue({ platform: 'sleeper', platformLeagueId: 'sl-1' })
  h.teamFindMany.mockResolvedValue([
    { externalId: '1', platformUserId: 'su-me', ownerName: 'Me', teamName: 'Mine', claimedByUserId: ME },
    { externalId: '2', platformUserId: 'su-rival', ownerName: 'Rival', teamName: 'Rivals', claimedByUserId: null },
    { externalId: '3', platformUserId: 'su-third', ownerName: 'Third', teamName: 'Thirds', claimedByUserId: null },
  ])
  h.cacheFindUnique.mockResolvedValue({
    data: { version: 2, fetchedAt: '2026-10-02T10:00:00.000Z', staleAsOf: null, seasonsScanned: ['2025', '2026'], trades: TRADES, missing: [] },
    expiresAt: new Date('2026-10-03T00:00:00Z'),
  })
  h.waiverSettings.mockResolvedValue({ waiverType: 'faab' })
  h.loadWaiverEdge.mockResolvedValue({
    available: true,
    data: {
      season: 2026,
      usesFaab: true,
      viewer: { teamExternalId: '1', faabRemaining: 80 },
      leagueFacts: [],
      rivals: [
        { manager: { name: 'Rival', teamExternalId: '2' }, faabRemaining: 64, claims: 7, sufficient: true, facts: [] },
        { manager: { name: 'Third', teamExternalId: '3' }, faabRemaining: 100, claims: 0, sufficient: false, facts: [] },
      ],
      coverage: { source: 'sleeper_waiver_history', season: 2026, claims: 7, asOf: '2026-10-02T08:00:00.000Z', stale: false },
    },
  })
})

describe('the server withholds from a locked viewer', () => {
  it('returns null and reads nothing', async () => {
    const out = await loadScoutEdgeForScreen({ leagueId: 'lg1', access: access(false), userId: ME, now: NOW })
    expect(out).toBeNull()
    expect(h.membership).not.toHaveBeenCalled()
    expect(h.teamFindMany).not.toHaveBeenCalled()
    expect(h.cacheFindUnique).not.toHaveBeenCalled()
    expect(h.loadWaiverEdge).not.toHaveBeenCalled()
  })

  it('reads for an unlocked viewer (the control)', async () => {
    const out = await loadScoutEdgeForScreen({ leagueId: 'lg1', access: access(true), userId: ME, now: NOW })
    expect(out?.available).toBe(true)
  })
})

describe('a plan is not a membership', () => {
  it('a paying non-member gets no manager’s record', async () => {
    h.membership.mockResolvedValue({ ok: false, reason: 'not_member', status: 403 })
    const out = await loadScoutEdge({ leagueId: 'lg1', userId: ME, now: NOW })
    expect(out.available).toBe(false)
    expect(h.teamFindMany).not.toHaveBeenCalled()
    expect(JSON.stringify(out)).not.toContain('Rival')
  })
})

describe('the counts are buildTradeEdge’s and loadWaiverEdge’s', () => {
  it('counts each manager’s completed trades, last trade, claims and FAAB', async () => {
    const out = await loadScoutEdge({ leagueId: 'lg1', userId: ME, now: NOW })
    if (!out.available) throw new Error(out.reason)
    expect(out.data.byManager['2']).toEqual({ trades: 3, lastTradeAt: '2026-09-21T15:00:00.000Z', waiverClaims: 7, faabRemaining: 64 })
    expect(out.data.byManager['3']).toEqual({ trades: 2, lastTradeAt: '2026-09-21T15:00:00.000Z', waiverClaims: 0, faabRemaining: 100 })
  })

  it('agrees with buildTradeEdge called the Trade Center’s way', async () => {
    const out = await loadScoutEdge({ leagueId: 'lg1', userId: ME, now: NOW })
    if (!out.available) throw new Error(out.reason)
    const direct = buildTradeEdge({
      trades: TRADES,
      managerOwnerId: 'su-rival',
      managerName: 'Rival',
      teamExternalId: '2',
      viewerOwnerId: 'su-me',
      deal: { theyGet: [{ kind: 'player', position: 'WR' }], theySend: [] },
      seasonsScanned: ['2025', '2026'],
      historyGaps: [],
      asOf: '2026-10-02T10:00:00.000Z',
      stale: false,
    })
    expect(out.data.byManager['2']?.trades).toBe(direct.coverage.trades)
  })

  it('leaves your own team out', async () => {
    const out = await loadScoutEdge({ leagueId: 'lg1', userId: ME, now: NOW })
    if (!out.available) throw new Error(out.reason)
    expect(Object.keys(out.data.byManager).sort()).toEqual(['2', '3'])
  })

  it('reads FAAB only when the ingested rule says FAAB', async () => {
    h.waiverSettings.mockResolvedValue({ waiverType: 'rolling' })
    await loadScoutEdge({ leagueId: 'lg1', userId: ME, now: NOW })
    expect(h.loadWaiverEdge).toHaveBeenCalledWith(expect.objectContaining({ usesFaab: false }))
  })
})

describe('gaps are said in words, never as zeros', () => {
  it('a cold trade cache reads as "not read yet", with trade counts null rather than 0', async () => {
    h.cacheFindUnique.mockResolvedValue(null)
    const out = await loadScoutEdge({ leagueId: 'lg1', userId: ME, now: NOW })
    if (!out.available) throw new Error(out.reason)
    expect(out.data.trades.available).toBe(false)
    expect(out.data.byManager['2']?.trades).toBeNull()
  })

  it('a non-Sleeper league names its platform', async () => {
    h.leagueFindUnique.mockResolvedValue({ platform: 'espn', platformLeagueId: 'e-1' })
    const out = await loadScoutEdge({ leagueId: 'lg1', userId: ME, now: NOW })
    expect(out.available).toBe(false)
    if (!out.available) expect(out.reason).toMatch(/ESPN/i)
  })
})

/* ── On screen ─────────────────────────────────────────────────────────── */

const scout: ScoutData = {
  league: { id: 'lg1', name: 'The Gauntlet', sport: 'NFL' },
  you: { managerId: '1', teamName: 'Mine', standing: null },
  week: null,
  opponent: null,
  managers: {
    available: true,
    data: [
      { managerId: '2', teamName: 'Rivals', ownerName: 'Rival', avatarUrl: null, isYou: false, isNextOpponent: false, standing: null },
      { managerId: '1', teamName: 'Mine', ownerName: 'Me', avatarUrl: null, isYou: true, isNextOpponent: false, standing: null },
    ],
  },
  basis: { available: false, reason: 'no table' },
}

const edge: ScoutEdge = {
  byManager: { '2': { trades: 3, lastTradeAt: '2026-09-21T15:00:00.000Z', waiverClaims: 7, faabRemaining: 64 }, '1': { trades: 9, lastTradeAt: null, waiverClaims: 9, faabRemaining: 1 } },
  trades: { available: true, data: { seasons: ['2025', '2026'], asOf: '2026-10-02T10:00:00.000Z', stale: false, gaps: [] } },
  waivers: { available: true, data: { season: 2026, usesFaab: true, asOf: null, stale: false } },
}

const render = (props: { edge?: { available: true; data: ScoutEdge } | null; edgeAccess?: CoreDepthAccess | null }) =>
  renderToStaticMarkup(<Scout data={scout} gamePlanHref="/p" matchupHref="/m" tradesHref="/t" {...props} />)

describe('Scout draws the section', () => {
  it('shows a plan holder each rival’s counts, and never on your own card', () => {
    const html = render({ edge: { available: true, data: edge }, edgeAccess: access(true) })
    expect(html).toContain('3 trades · last Sep 21, 2026 · 7 waiver claims won · $64 FAAB left')
    expect(html).not.toContain('9 trades')
    expect(html).toContain('completed trades across 2025–2026')
  })

  it('shows a locked viewer the lock and no counts', () => {
    const html = render({ edge: null, edgeAccess: access(false) })
    expect(html).toContain('core-lock-competitive_edge')
    expect(html).not.toContain('waiver claims won')
  })
})
