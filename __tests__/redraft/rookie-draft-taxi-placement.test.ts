/**
 * Rookies a dynasty league just drafted go onto the taxi squad while it has room.
 *
 * Found on the dynasty offseason walkthrough (2026-11-18): every rookie landed on the bench and the
 * taxi squad stayed empty. Runs the real finalization against the schema-driven in-memory Prisma.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as any }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return holder.db
  },
  get default() {
    return holder.db
  },
}))
vi.mock('@/lib/events', async (load) => ({
  ...(await load<typeof import('@/lib/events')>()),
  getPlatformEvents: () => new Proxy({}, { get: () => vi.fn(async () => ({ eventId: 'evt' })) }),
}))

import { createInMemoryPrisma, rowsOf } from '../redraft-season-simulation/inMemoryPrisma'
import { syncCompletedDraftToRedraftSeason } from '@/lib/redraft/finalizeDraftToRedraftSeason'
import { planRookieTaxiPlacement } from '@/lib/redraft/offseason/placeDraftedRookiesOnTaxi'

const LEAGUE = 'league-rookie-taxi'
// Team A drafts three rookies, team B one.
const PICKS = [
  { overall: 1, rosterId: 'roster-a', playerId: 'r1', playerName: 'Ari Abbot' },
  { overall: 2, rosterId: 'roster-b', playerId: 'r2', playerName: 'Bo Barlow' },
  { overall: 3, rosterId: 'roster-a', playerId: 'r3', playerName: 'Cy Corbin' },
  { overall: 4, rosterId: 'roster-a', playerId: 'r4', playerName: 'Dax Dolan' },
]

async function seed(opts: { taxiSlots?: number; playerPool?: string; dynasty?: boolean } = {}) {
  const db = holder.db
  const dynasty = opts.dynasty ?? true
  for (const id of ['user-a', 'user-b']) await db.appUser.create({ data: { id, email: `${id}@test.allfantasy`, username: id } })
  await db.league.create({
    data: {
      id: LEAGUE, userId: 'user-a', name: 'Rookie Taxi', sport: 'NFL', platform: 'manual', platformLeagueId: LEAGUE,
      leagueType: dynasty ? 'dynasty' : 'redraft', isDynasty: dynasty, leagueSize: 2, season: 2027, settings: {},
      taxiSlots: opts.taxiSlots ?? 2,
    },
  })
  for (const [rosterId, user, teamName] of [['roster-a', 'user-a', 'Aces'], ['roster-b', 'user-b', 'Bears']] as const) {
    await db.roster.create({ data: { id: rosterId, leagueId: LEAGUE, platformUserId: user, playerData: {} } })
    await db.leagueTeam.create({ data: { leagueId: LEAGUE, externalId: rosterId, teamName, ownerName: user, claimedByUserId: user } })
  }
  const session = await db.draftSession.create({
    data: {
      leagueId: LEAGUE, status: 'completed', draftType: 'linear', rounds: 2, teamCount: 2, sportType: 'NFL',
      playerPool: opts.playerPool ?? 'rookies_only',
      slotOrder: [{ slot: 1, rosterId: 'roster-a', userId: 'user-a', displayName: 'Aces' }, { slot: 2, rosterId: 'roster-b', userId: 'user-b', displayName: 'Bears' }],
    },
  })
  for (const p of PICKS) {
    await db.draftPick.create({ data: { sessionId: session.id, overall: p.overall, round: Math.ceil(p.overall / 2), slot: ((p.overall - 1) % 2) + 1, rosterId: p.rosterId, playerId: p.playerId, playerName: p.playerName, position: 'WR', team: 'KC' } })
  }
}

const slots = () =>
  Object.fromEntries(rowsOf(holder.db, 'RedraftRosterPlayer').map((p: any) => [p.playerId, p.slotType]))

beforeEach(() => {
  holder.db = createInMemoryPrisma()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('a dynasty league’s rookie draft finishing', () => {
  it('puts the rookies on the taxi squad; with more rookies than spots the earliest pick stays on the bench', async () => {
    await seed({ taxiSlots: 2 })
    const summary = await syncCompletedDraftToRedraftSeason(LEAGUE)
    expect(summary.skipped, JSON.stringify(summary)).toBe(false)
    expect(slots()).toEqual({ r1: 'bench', r2: 'taxi', r3: 'taxi', r4: 'taxi' })
  })

  it('🛑 a rookie his manager promoted is not sent back when finalization runs again', async () => {
    await seed({ taxiSlots: 2 })
    await syncCompletedDraftToRedraftSeason(LEAGUE)
    const promoted = rowsOf(holder.db, 'RedraftRosterPlayer').find((p: any) => p.playerId === 'r3')
    await holder.db.redraftRosterPlayer.update({ where: { id: promoted.id }, data: { slotType: 'bench' } })
    await syncCompletedDraftToRedraftSeason(LEAGUE)
    expect(slots()).toEqual({ r1: 'bench', r2: 'taxi', r3: 'bench', r4: 'taxi' })
  })

  it('[control] no taxi squad, a startup draft, or a redraft league: everyone stays on the bench', async () => {
    const allBench = { r1: 'bench', r2: 'bench', r3: 'bench', r4: 'bench' }
    await seed({ taxiSlots: 0 })
    await syncCompletedDraftToRedraftSeason(LEAGUE)
    expect(slots()).toEqual(allBench)

    holder.db = createInMemoryPrisma()
    await seed({ playerPool: 'all' })
    await syncCompletedDraftToRedraftSeason(LEAGUE)
    expect(slots()).toEqual(allBench)

    holder.db = createInMemoryPrisma()
    await seed({ dynasty: false })
    await syncCompletedDraftToRedraftSeason(LEAGUE)
    expect(slots()).toEqual(allBench)
  })
})

describe('planRookieTaxiPlacement', () => {
  const drafted = [
    { rowId: 'a1', rosterId: 'A' }, { rowId: 'b1', rosterId: 'B' }, { rowId: 'a2', rosterId: 'A' }, { rowId: 'b2', rosterId: 'B' },
  ]
  it('counts players already on the squad, team by team', () => {
    // A has one of two spots taken: only its later pick fits. B's squad is full.
    expect(planRookieTaxiPlacement({ taxiSlots: 2, taxiCountByRoster: new Map([['A', 1], ['B', 2]]), drafted })).toEqual(['a2'])
    expect(planRookieTaxiPlacement({ taxiSlots: 2, taxiCountByRoster: new Map(), drafted })).toEqual(['a1', 'b1', 'a2', 'b2'])
    expect(planRookieTaxiPlacement({ taxiSlots: 0, taxiCountByRoster: new Map(), drafted })).toEqual([])
  })
})
