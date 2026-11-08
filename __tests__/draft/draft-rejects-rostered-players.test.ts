/**
 * A draft that runs while season rosters already exist (a dynasty rookie draft, a supplemental draft) must
 * refuse a player another team already holds. Pick validation only checked the draft's own board, so the
 * dynasty season simulation drafted a rostered veteran in the rookie draft and finalization put him on a
 * second season roster — one player scoring for two teams.
 *
 * Runs the real `submitPick` and the real draft finalization against the schema-driven in-memory Prisma.
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
vi.mock('@/lib/draft/draftLock', async (load) => ({
  ...(await load<typeof import('@/lib/draft/draftLock')>()),
  withPickLock: async (_leagueId: string, fn: () => Promise<unknown>) => ({ acquired: true, value: await fn(), backend: 'passthrough' }),
}))
vi.mock('@/lib/draft-notifications', async (load) =>
  Object.fromEntries(Object.keys(await load<Record<string, unknown>>()).map((key) => [key, vi.fn(async () => undefined)])),
)
vi.mock('@/lib/draft-room/postDraftPickChatEvent', () => ({ postDraftPickChatEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/achievement-system', () => ({ awardAchievement: vi.fn(async () => undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordEngineTelemetrySample: vi.fn(), recordProductEvent: vi.fn() }))
vi.mock('@/lib/events', async (load) => ({
  ...(await load<typeof import('@/lib/events')>()),
  getPlatformEvents: () => new Proxy({}, { get: () => vi.fn(async () => ({ eventId: 'evt', ok: true })) }),
}))

import { createInMemoryPrisma, rowsOf } from '../redraft-season-simulation/inMemoryPrisma'
import { syncCompletedDraftToRedraftSeason } from '@/lib/redraft/finalizeDraftToRedraftSeason'
import { submitPick } from '@/lib/live-draft-engine/PickSubmissionService'
import { DRAFT_PICK_DUPLICATE_PLAYER } from '@/lib/live-draft-engine/pickAuthorityCodes'
import { loadLeagueRosteredPlayers, rosteredHolder } from '@/lib/live-draft-engine/rosteredPlayerGuard'

const LEAGUE = 'league-rostered'
const TEAMS = [
  { rosterId: 'roster-a', userId: 'user-a' },
  { rosterId: 'roster-b', userId: 'user-b' },
]
const STARTUP_PICKS = [
  { overall: 1, round: 1, rosterId: 'roster-a', playerId: 'p-qb-1', playerName: 'Alex Archer', position: 'QB' },
  { overall: 2, round: 1, rosterId: 'roster-b', playerId: 'p-rb-1', playerName: 'Blake Brooks', position: 'RB' },
  { overall: 3, round: 2, rosterId: 'roster-b', playerId: 'p-wr-1', playerName: 'Cam Calloway', position: 'WR' },
  { overall: 4, round: 2, rosterId: 'roster-a', playerId: 'p-te-1', playerName: 'Dion Dunmore', position: 'TE' },
]
const slotOrder = TEAMS.map((t, i) => ({ slot: i + 1, rosterId: t.rosterId, userId: t.userId, displayName: t.userId }))

/** A dynasty league whose startup draft finalized into season rosters, then a rookie draft opened on top. */
async function seedLeagueWithOpenRookieDraft() {
  const db = holder.db
  for (const t of TEAMS) await db.appUser.create({ data: { id: t.userId, email: `${t.userId}@test.allfantasy`, username: t.userId } })
  await db.league.create({
    data: { id: LEAGUE, userId: 'user-a', name: 'Rostered League', sport: 'NFL', platform: 'manual', platformLeagueId: LEAGUE, leagueType: 'dynasty', isDynasty: true, leagueSize: 2, season: 2026, settings: {} },
  })
  for (const t of TEAMS) await db.roster.create({ data: { id: t.rosterId, leagueId: LEAGUE, platformUserId: t.userId, playerData: {} } })
  const startup = await db.draftSession.create({
    data: { leagueId: LEAGUE, status: 'completed', draftType: 'snake', rounds: 2, teamCount: 2, sportType: 'NFL', slotOrder, createdAt: new Date('2026-08-01T00:00:00Z') },
  })
  for (const p of STARTUP_PICKS) {
    await db.draftPick.create({ data: { sessionId: startup.id, overall: p.overall, round: p.round, slot: ((p.overall - 1) % 2) + 1, rosterId: p.rosterId, playerId: p.playerId, playerName: p.playerName, position: p.position, team: 'KC' } })
  }
  const summary = await syncCompletedDraftToRedraftSeason(LEAGUE)
  expect(summary.skipped, JSON.stringify(summary)).toBe(false)

  await db.draftSession.create({
    data: {
      leagueId: LEAGUE,
      status: 'in_progress',
      draftType: 'snake',
      draftModeLabel: 'rookie',
      rounds: 1,
      teamCount: 2,
      sportType: 'NFL',
      slotOrder,
      createdAt: new Date('2027-05-01T00:00:00Z'),
    },
  })
}

const pick = (over: Partial<Parameters<typeof submitPick>[0]>) =>
  submitPick({ leagueId: LEAGUE, rosterId: 'roster-a', madeByUserId: 'user-a', source: 'user', position: 'RB', team: 'NYJ', playerName: '', ...over })

const rookieDraftPicks = () => {
  const open = rowsOf(holder.db, 'DraftSession').find((s: any) => s.status === 'in_progress')
  return rowsOf(holder.db, 'DraftPick').filter((p: any) => p.sessionId === open?.id)
}

beforeEach(() => {
  holder.db = createInMemoryPrisma()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('a draft refuses a player already on a league roster', () => {
  it('refuses a rostered player by id, and writes no pick', async () => {
    await seedLeagueWithOpenRookieDraft()
    const res = await pick({ playerId: 'p-rb-1', playerName: 'Blake Brooks' })
    expect(res.success, JSON.stringify(res)).toBe(false)
    expect(res.code).toBe(DRAFT_PICK_DUPLICATE_PLAYER)
    expect(rookieDraftPicks()).toHaveLength(0)
  })

  it('refuses a name-only pick (an offline board typed in) of a rostered player', async () => {
    await seedLeagueWithOpenRookieDraft()
    const res = await pick({ playerId: null, playerName: '  cam   CALLOWAY ' })
    expect(res.code, JSON.stringify(res)).toBe(DRAFT_PICK_DUPLICATE_PLAYER)
  })

  it('accepts an unrostered rookie', async () => {
    await seedLeagueWithOpenRookieDraft()
    const res = await pick({ playerId: 'p-rookie-1', playerName: 'Eli Ellsworth' })
    expect(res.success, JSON.stringify(res)).toBe(true)
    expect(rookieDraftPicks()).toHaveLength(1)
  })

  it('does not let a shared name override a different player id', async () => {
    await seedLeagueWithOpenRookieDraft()
    const res = await pick({ playerId: 'p-rookie-2', playerName: 'Blake Brooks' })
    expect(res.success, JSON.stringify(res)).toBe(true)
  })

  it('accepts a player his team has since dropped', async () => {
    await seedLeagueWithOpenRookieDraft()
    const row = rowsOf(holder.db, 'RedraftRosterPlayer').find((r: any) => r.playerId === 'p-rb-1')
    await holder.db.redraftRosterPlayer.update({ where: { id: row.id }, data: { droppedAt: new Date() } })
    const res = await pick({ playerId: 'p-rb-1', playerName: 'Blake Brooks' })
    expect(res.success, JSON.stringify(res)).toBe(true)
  })
})

describe('rosteredPlayerGuard', () => {
  it('is a no-op for a league with no season yet (a startup draft)', async () => {
    const rostered = await loadLeagueRosteredPlayers('league-without-season')
    expect(rosteredHolder(rostered, { playerId: 'p-any', playerName: 'Anyone' })).toBeNull()
  })

  it('reports the season roster that holds the player', async () => {
    await seedLeagueWithOpenRookieDraft()
    const rostered = await loadLeagueRosteredPlayers(LEAGUE)
    const holderRoster = rostered.byId.get('p-qb-1')
    const seasonRoster = rowsOf(holder.db, 'RedraftRoster').find((r: any) => r.id === holderRoster)
    expect(seasonRoster?.ownerId).toBe('user-a')
    expect(rosteredHolder(rostered, { playerName: 'alex archer' })).toBe(holderRoster)
  })
})
