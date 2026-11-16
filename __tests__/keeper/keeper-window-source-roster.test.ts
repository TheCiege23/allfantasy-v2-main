/**
 * The keeper window lives on NEXT season, whose rosters start empty; the players a manager keeps are on
 * their team in the season just played. Every read keyed on the window's ids found nothing, so the
 * Keepers tab showed an empty roster and every keeper was refused as `ineligible` (keeper simulation,
 * 2026-11-10: 27 of 27 leagues, 0 keepers carried). Real where-filtering, not canned answers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => {
  const { createInMemoryPrisma } = await import('../redraft-season-simulation/inMemoryPrisma')
  return { prisma: createInMemoryPrisma() }
})
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/keeper/keeperValueReport', () => ({ keeperValueReport: vi.fn(async () => ({ available: false, reason: 'no_market_values' })) }))

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveKeeperSourceRoster } from '@/lib/keeper/keeperSourceRoster'
import { submitKeeperSelections } from '@/lib/keeper/selectionEngine'
import { GET as eligibilityGET } from '@/app/api/keeper/eligibility/route'

const db = prisma as any
const player = (rosterId: string, playerId: string) => ({ rosterId, playerId, playerName: playerId.toUpperCase(), position: 'RB', team: 'X', sport: 'NFL', slotType: 'bench', acquisitionType: 'draft' })
const elig = (rosterId: string, playerId: string, round: number) => ({ leagueId: 'L', seasonId: 's2026', rosterId, playerId, isEligible: true, yearsKept: 0, projectedCost: `Round ${round}`, projectedCostRound: round, computedAt: new Date() })

beforeEach(async () => {
  for (const model of ['keeperRecord', 'keeperEligibility', 'keeperSelectionSession', 'redraftRosterPlayer', 'redraftRoster', 'redraftSeason', 'draftSession', 'league']) {
    await db[model].deleteMany({})
  }
  await db.league.create({ data: { id: 'L', platformLeagueId: 'L', platform: 'manual', userId: 'commish', name: 'Keepers', sport: 'NFL', leagueType: 'keeper', keeperCount: 3, keeperCostSystem: 'round_based', keeperConflictRule: 'player_chooses', settings: {} } })
  await db.redraftSeason.create({ data: { id: 's2026', leagueId: 'L', sport: 'NFL', totalWeeks: 17, playoffStartWeek: 15, season: 2026, status: 'complete', createdAt: new Date('2026-08-01') } })
  await db.redraftSeason.create({ data: { id: 's2027', leagueId: 'L', sport: 'NFL', totalWeeks: 17, playoffStartWeek: 15, season: 2027, status: 'setup', createdAt: new Date('2027-01-05') } })
  for (const [id, seasonId, ownerId] of [['r26', 's2026', 'u1'], ['r26b', 's2026', 'u2'], ['r27', 's2027', 'u1'], ['r27b', 's2027', 'u2'], ['r27new', 's2027', 'u3']]) {
    await db.redraftRoster.create({ data: { id, seasonId, leagueId: 'L', ownerId, ownerName: ownerId, teamName: `${ownerId} team` } })
  }
  await db.redraftRosterPlayer.createMany({ data: [player('r26', 'p1'), player('r26', 'p2'), player('r26b', 'p9')] })
  await db.keeperEligibility.createMany({ data: [elig('r26', 'p1', 5), elig('r26', 'p2', 9), elig('r26b', 'p9', 3)] })
  await db.keeperSelectionSession.create({ data: { leagueId: 'L', seasonId: 's2027', status: 'open', openedAt: new Date(), deadline: new Date(Date.now() + 86_400_000), totalTeams: 3 } })
  await db.draftSession.create({ data: { leagueId: 'L', rounds: 15, status: 'completed', createdAt: new Date('2026-08-20') } })
})

describe('resolveKeeperSourceRoster', () => {
  it("maps the window's roster to the same owner's team in the season just played", async () => {
    expect(await resolveKeeperSourceRoster({ leagueId: 'L', seasonId: 's2027', rosterId: 'r27' })).toEqual({ seasonId: 's2026', rosterId: 'r26', mapped: true })
    expect(await resolveKeeperSourceRoster({ leagueId: 'L', seasonId: 's2027', rosterId: 'r27b' })).toEqual({ seasonId: 's2026', rosterId: 'r26b', mapped: true })
  })

  it('a manager new this year has no team to keep from — never someone else’s', async () => {
    expect(await resolveKeeperSourceRoster({ leagueId: 'L', seasonId: 's2027', rosterId: 'r27new' })).toEqual({ seasonId: 's2026', rosterId: null, mapped: true })
  })

  it('ids that are not a keeper window come back unchanged', async () => {
    expect(await resolveKeeperSourceRoster({ leagueId: 'L', seasonId: 's2026', rosterId: 'r26' })).toEqual({ seasonId: 's2026', rosterId: 'r26', mapped: false })
  })
})

describe('submitting keepers with the ids the Keepers tab sends', () => {
  it("keeps last season's players, recorded on next season's roster where the lock and carryover read them", async () => {
    const result = await submitKeeperSelections('r27', 'L', 's2027', ['p1', 'p2'])
    expect(result.conflicted).toEqual([])
    expect(result.cost.map((c) => [c.playerId, c.costRound])).toEqual([['p1', 5], ['p2', 9]])
    const records = await db.keeperRecord.findMany({ where: { leagueId: 'L' } })
    expect(records.map((r: any) => [r.seasonId, r.rosterId, r.playerId, r.playerName, r.status]).sort()).toEqual([
      ['s2027', 'r27', 'p1', 'P1', 'pending'],
      ['s2027', 'r27', 'p2', 'P2', 'pending'],
    ])
  })

  it("refuses a player who was on another manager's team", async () => {
    const result = await submitKeeperSelections('r27', 'L', 's2027', ['p9'])
    expect(result.valid).toEqual([])
    expect(result.conflicted).toEqual([{ playerIds: ['p9'], reason: 'ineligible' }])
  })

  it('a manager new this year can keep nobody', async () => {
    const result = await submitKeeperSelections('r27new', 'L', 's2027', ['p1'])
    expect(result.valid).toEqual([])
  })
})

describe('GET /api/keeper/eligibility with the window ids', () => {
  it("returns the eligibility priced on the owner's team last season", async () => {
    const res = await eligibilityGET(new NextRequest('http://x/api/keeper/eligibility?leagueId=L&seasonId=s2027&rosterId=r27'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.eligible.map((e: any) => [e.playerId, e.costRound]).sort()).toEqual([['p1', 5], ['p2', 9]])
  })

  it('returns nothing, without recomputing the league, for a manager new this year', async () => {
    const res = await eligibilityGET(new NextRequest('http://x/api/keeper/eligibility?leagueId=L&seasonId=s2027&rosterId=r27new'))
    expect((await res.json()).raw).toEqual([])
  })
})
