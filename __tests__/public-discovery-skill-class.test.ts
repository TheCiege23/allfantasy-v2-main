import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Discovery uses the join gate's basis (2026-10-01): a fantasy league whose members are rated in
 * its sport, viewed by a manager rated there, is matched on SKILL class; everything else keeps the
 * level tier. If discovery and the gate disagreed, a league could show as joinable and then refuse
 * the join — or hide a league the manager is allowed into.
 */

const db = vi.hoisted(() => ({
  leagues: [] as Array<{ id: string; userId: string; sport: string }>,
  members: [] as Array<{ leagueId: string; userId: string }>,
}))
const board = vi.hoisted(() => ({ value: null as unknown }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] }; userId?: string } }) =>
        where.id ? db.leagues.filter((l) => where.id!.in.includes(l.id)) : [],
      ),
    },
    redraftLeagueMember: {
      findMany: vi.fn(async ({ where }: { where: { leagueId: { in: string[] } } }) =>
        db.members.filter((m) => where.leagueId.in.includes(m.leagueId)),
      ),
    },
    bracketLeague: { findMany: vi.fn(async () => []) },
    creatorLeague: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/rank/skillRating/skillRatingStore', () => ({ readSkillBoard: vi.fn(async () => board.value) }))

import { applyTierPolicy } from '@/lib/public-discovery/PublicDiscoveryService'
import type { DiscoveryCard } from '@/lib/public-discovery/types'

function card(id: string, over: Partial<DiscoveryCard> = {}): DiscoveryCard {
  return {
    source: 'fantasy', id, name: id, description: null, sport: 'NFL', memberCount: 4, maxMembers: 12,
    joinUrl: '#', detailUrl: '#', ownerName: null, ownerAvatar: null, creatorSlug: null, creatorName: null,
    tournamentName: null, season: 2026, scoringMode: null, isPaid: false, isPrivate: false,
    createdAt: new Date().toISOString(), fillPct: 33, leagueType: 'fantasy', draftType: null, teamCount: 12,
    draftDate: null, commissionerName: null, aiFeatures: [], leagueTier: 5, ...over,
  }
}

function rated(rows: Array<[string, number]>) {
  return {
    date: '2026-10-01', computedAt: '', sources: { facts: 0, weeks: 0, native: 0 },
    sports: { NFL: { games: 0, periods: 0, latestPeriod: 0, rated: rows.length, percentiles: [], rows: rows.map(([u, r]) => ({ u, r, rd: 60, v: 0.06, g: 30, w: 0, l: 0, t: 0, lp: 0 })) } },
  }
}

describe('discovery on the skill basis', () => {
  beforeEach(() => {
    db.leagues = [
      { id: 'near', userId: 'c1', sport: 'NFL' },
      { id: 'far', userId: 'c2', sport: 'NFL' },
      { id: 'unrated', userId: 'c3', sport: 'NFL' },
    ]
    db.members = [{ leagueId: 'near', userId: 'm1' }]
    // viewer 1600 -> Class 15. near: c1 1550 (14), m1 1650 (15) -> median 14. far: c2 2000 -> Class 23.
    board.value = rated([['viewer', 1600], ['c1', 1550], ['m1', 1650], ['c2', 2000]])
  })

  it('shows a league within two skill classes and hides one far above — even with matching level tiers', async () => {
    const out = await applyTierPolicy([card('near'), card('far')], { viewerTier: 5, viewerUserId: 'viewer' })
    expect(out.cards.map((c) => c.id)).toEqual(['near'])
    expect(out.cards[0]).toMatchObject({ classBasis: 'skill', skillClass: 14, canJoinByRanking: true, rankingTierDelta: 1 })
    expect(out.hiddenCount).toBe(1)
  })

  it('keeps the level tier for a league with no rated member', async () => {
    const out = await applyTierPolicy([card('unrated', { leagueTier: 5 })], { viewerTier: 5, viewerUserId: 'viewer' })
    expect(out.cards[0]).toMatchObject({ classBasis: 'level', skillClass: null, canJoinByRanking: true })
  })

  it('keeps the level tier for a viewer who is not rated', async () => {
    const out = await applyTierPolicy([card('far', { leagueTier: 5 })], { viewerTier: 5, viewerUserId: 'stranger' })
    expect(out.cards[0]).toMatchObject({ classBasis: 'level', canJoinByRanking: true })
  })

  it('never reads skill for a signed-out viewer or for non-fantasy cards', async () => {
    const out = await applyTierPolicy([card('near'), card('b1', { source: 'bracket', leagueType: 'bracket' })], { viewerTier: 5 })
    expect(out.cards.every((c) => c.classBasis === 'level')).toBe(true)
  })
})
