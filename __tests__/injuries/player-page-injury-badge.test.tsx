/**
 * Player page header + player outlook: an injury badge / "Currently X" sentence must come from the
 * LIVE injury feed, never from `PlayerIdentityMap.status` (a Rolling Insights roster code — "ACT" put
 * "⚠ ACT" on every healthy player's header) nor from `PlayerAnalyticsSnapshot.status` (a one-off CSV
 * import matched by name only).
 */
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  identityFindFirst: vi.fn(),
  injuryFindMany: vi.fn(),
  newsFindMany: vi.fn(),
  getPlayerAnalytics: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: { findFirst: mocks.identityFindFirst },
    sportsInjury: { findMany: mocks.injuryFindMany },
    sportsNews: { findMany: mocks.newsFindMany },
  },
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/app/player/[playerId]/PlayerProfileClient', () => ({ PlayerProfileClient: () => null }))
vi.mock('@/lib/enrichment-cache', () => ({ readCache: vi.fn(async () => null), writeCache: vi.fn(async () => {}) }))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: vi.fn(async () => []) }))
vi.mock('@/lib/fantasycalc', () => ({ findPlayerByName: vi.fn(() => null) }))
vi.mock('@/lib/player-analytics', () => ({ getPlayerAnalytics: mocks.getPlayerAnalytics }))

import PlayerProfilePage from '@/app/player/[playerId]/page'
import { PlayerHeaderCard } from '@/app/player/[playerId]/components/PlayerHeaderCard'
import { getPlayerOutlook } from '@/lib/player-outlook/player-outlook-service'

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000)

function injuryRow(over: Record<string, unknown> = {}) {
  return {
    playerName: 'Justin Jefferson',
    status: 'Questionable',
    type: 'Hamstring',
    description: null,
    date: hoursAgo(2),
    week: 6,
    source: 'rolling_insights',
    fetchedAt: hoursAgo(1),
    team: 'Minnesota Vikings',
    position: null,
    ...over,
  }
}

const identity = {
  id: 'pid-1',
  canonicalName: 'Justin Jefferson',
  position: 'WR',
  currentTeam: 'MIN',
  sport: 'NFL',
  sleeperId: '6794',
  status: 'ACT',
}

async function pagePlayer() {
  const el = (await PlayerProfilePage({ params: Promise.resolve({ playerId: 'pid-1' }) })) as React.ReactElement<{
    player: Record<string, unknown>
  }>
  return el.props.player
}

describe('player page — header injury status comes from the live feed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.identityFindFirst.mockResolvedValue(identity)
  })

  it('no live row: injuryStatus is null even though identity.status is the roster code "ACT"', async () => {
    mocks.injuryFindMany.mockResolvedValue([])
    const player = await pagePlayer()
    expect(player.status).toBe('ACT')
    expect(player.injuryStatus).toBeNull()
  })

  it('a live "Active" row is not a designation', async () => {
    mocks.injuryFindMany.mockResolvedValue([injuryRow({ status: 'Active' })])
    expect((await pagePlayer()).injuryStatus).toBeNull()
  })

  it('a live designation reaches the header', async () => {
    mocks.injuryFindMany.mockResolvedValue([injuryRow()])
    expect((await pagePlayer()).injuryStatus).toBe('Questionable')
  })

  it('a namesake on another team is refused, not borrowed', async () => {
    mocks.injuryFindMany.mockResolvedValue([injuryRow({ team: 'Cleveland Browns', status: 'Out' })])
    expect((await pagePlayer()).injuryStatus).toBeNull()
  })
})

describe('PlayerHeaderCard — never renders the roster code', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => null })))
  })

  const base = {
    id: 'pid-1',
    name: 'Justin Jefferson',
    position: 'WR',
    team: 'MIN',
    sport: 'NFL',
    sleeperId: null,
    status: 'ACT',
  }

  it('status "ACT" with no live designation shows no badge', () => {
    render(<PlayerHeaderCard player={{ ...base, injuryStatus: null }} headshotUrl={null} />)
    expect(screen.queryByText(/ACT/)).toBeNull()
  })

  it('status "INACT" with no live designation shows no badge', () => {
    render(<PlayerHeaderCard player={{ ...base, status: 'INACT', injuryStatus: null }} headshotUrl={null} />)
    expect(screen.queryByText(/INACT/)).toBeNull()
  })

  it('a live designation is shown', () => {
    render(<PlayerHeaderCard player={{ ...base, injuryStatus: 'Questionable' }} headshotUrl={null} />)
    expect(screen.getByText(/Questionable/)).toBeTruthy()
  })
})

describe('player outlook — "Currently X" is never stated from the analytics snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.newsFindMany.mockResolvedValue([])
    mocks.getPlayerAnalytics.mockResolvedValue({
      name: 'Justin Jefferson',
      position: 'WR',
      status: 'Out',
      currentTeam: 'MIN',
      rawData: null,
      fantasyPointsPerGame: null,
      weeklyVolatility: null,
    })
  })

  it('snapshot says Out, live feed has nothing: no injury sentence, no injury risk flag', async () => {
    mocks.injuryFindMany.mockResolvedValue([])
    const outlook = await getPlayerOutlook({ playerName: 'Justin Jefferson', sport: 'NFL' })
    expect(outlook.bearishCase).not.toMatch(/Currently Out/)
    expect(outlook.riskFlags).not.toContain('injury_concern')
  })

  it('live feed says Questionable: that is what is stated', async () => {
    mocks.injuryFindMany.mockResolvedValue([injuryRow()])
    const outlook = await getPlayerOutlook({ playerName: 'Justin Jefferson', sport: 'NFL' })
    expect(outlook.bearishCase).toMatch(/Currently Questionable/)
    expect(outlook.bearishCase).not.toMatch(/Currently Out/)
    expect(outlook.riskFlags).toContain('injury_concern')
  })

  it('a stale live claim is not stated as current', async () => {
    mocks.injuryFindMany.mockResolvedValue([injuryRow({ date: hoursAgo(24 * 30), fetchedAt: hoursAgo(24 * 30) })])
    const outlook = await getPlayerOutlook({ playerName: 'Justin Jefferson', sport: 'NFL' })
    expect(outlook.bearishCase).not.toMatch(/Currently/)
  })
})
