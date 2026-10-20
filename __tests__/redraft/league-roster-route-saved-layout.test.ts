/**
 * GET /api/league/roster for an NFL / NCAAF redraft-core league renders the league's OWN saved starter
 * layout. It used to replace it with the default contract's lineup, so once the defaults carry FLEX and
 * K a league saved with QB, RB, WR, WR, TE, DEF would render empty FLEX / K slots. Defaults apply only to
 * a league with no saved layout (owner, 2026-10-20).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { leagueFindFirst, rosterFindFirst } = vi.hoisted(() => ({
  leagueFindFirst: vi.fn(),
  rosterFindFirst: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: leagueFindFirst },
    roster: { findFirst: rosterFindFirst },
    devyRights: { findMany: vi.fn().mockResolvedValue([]) },
    devyPlayer: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))
vi.mock('@/lib/live-draft-engine/postDraftFinalizeArtifacts', () => ({
  syncPostDraftArtifactsIfCompletedThrottled: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({
  getRosterTemplateForLeague: vi.fn().mockRejectedValue(new Error('no template in this test')),
}))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({
  resolveFullLineupLockContext: vi.fn().mockResolvedValue({
    locked: false,
    reason: null,
    policy: null,
    lockedPlayerIds: [],
    perPlayerReasons: {},
  }),
}))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({
  getNormalizedPlayerData: vi.fn().mockRejectedValue(new Error('not needed')),
}))

import { GET } from '@/app/api/league/roster/route'

function league(sport: 'NFL' | 'NCAAF', settings: Record<string, unknown>) {
  return {
    id: 'league-1',
    userId: 'user-1',
    platform: 'manual',
    platformLeagueId: null,
    settings,
    sport,
    leagueVariant: null,
    season: 2026,
    lifecycleState: null,
    leagueType: 'redraft',
    isDynasty: false,
    bestBallMode: false,
    guillotineMode: false,
    keeperPhaseActive: false,
    lockAllMoves: false,
  }
}

async function starterLabels(sport: 'NFL' | 'NCAAF', settings: Record<string, unknown>) {
  leagueFindFirst.mockResolvedValue(league(sport, settings))
  const res = await GET(new NextRequest('http://localhost/api/league/roster?leagueId=league-1'))
  expect(res.status).toBe(200)
  const body = await res.json()
  return {
    labels: (body.starterSlots as Array<{ label: string }>).map((slot) => slot.label),
    slotLimits: body.slotLimits as Record<string, number>,
  }
}

describe('GET /api/league/roster — football redraft starter layout', () => {
  beforeEach(() => {
    rosterFindFirst.mockResolvedValue({ id: 'roster-1', playerData: {}, faabRemaining: 100, waiverPriority: 1 })
  })

  it('renders a saved cut lineup as saved: no FLEX, no K, one RB', async () => {
    for (const sport of ['NFL', 'NCAAF'] as const) {
      const { labels, slotLimits } = await starterLabels(sport, {
        starter_slots: { QB: 1, RB: 1, WR: 2, TE: 1, DEF: 1 },
        bench_slots: 6,
        ir_slots: 1,
      })
      expect(labels).toEqual(['QB', 'RB', 'WR1', 'WR2', 'TE', 'DEF'])
      expect(slotLimits).toMatchObject({ starters: 6, bench: 6, ir: 1 })
    }
  })

  it('renders a FLEX / DST spelled custom lineup without a duplicate flex or defense', async () => {
    const { labels } = await starterLabels('NFL', {
      starter_slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DST: 1 },
    })
    expect(labels).toEqual(['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'WR3', 'TE', 'FLEX', 'K', 'DEF'])
  })

  it('gives a league with no saved layout the full default lineup', async () => {
    const nfl = await starterLabels('NFL', {})
    expect(nfl.labels).toEqual(['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'K', 'DEF'])
    const ncaaf = await starterLabels('NCAAF', {})
    expect(ncaaf.labels).toEqual(['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'K'])
  })
})
