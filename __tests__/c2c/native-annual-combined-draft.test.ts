// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInMemoryPrisma } from '../redraft-season-simulation/inMemoryPrisma'
import { ANNUAL_C2C_DRAFT, annualC2CDraftSeason } from '@/lib/live-draft-engine/annualC2CDraft'
import { ESPN_NCAAB_ROSTER_KEY_PREFIX, currentNcaabSeasonYear } from '@/lib/espn/ncaabRosterSnapshot'

const h = vi.hoisted(() => ({ db: null as any, pool: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ get prisma() { return h.db }, get default() { return h.db } }))
vi.mock('@/lib/draft-room/ensureDraftPoolReady', async load => ({
  ...await load<typeof import('@/lib/draft-room/ensureDraftPoolReady')>(),
  getWarmDraftPoolSnapshotFast: h.pool,
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', async load => ({
  ...await load<typeof import('@/lib/live-draft-engine/DraftSessionService')>(),
  buildSlotOrderForLeague: async () => [
    { slot: 1, rosterId: 'home', displayName: 'Home' },
    { slot: 2, rosterId: 'guest', displayName: 'Guest' },
  ],
}))
vi.mock('@/lib/draft/draftLock', async load => ({
  ...await load<typeof import('@/lib/draft/draftLock')>(),
  withPickLock: async (_leagueId: string, fn: () => Promise<unknown>) => ({ acquired: true, value: await fn(), backend: 'passthrough' }),
}))
vi.mock('@/lib/league/league-roster-draft-gate', () => ({ isLeagueRosterDraftReady: async () => true }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', async load => ({
  ...await load<typeof import('@/lib/live-draft-engine/RosterFitValidation')>(),
  validateRosterFitForDraftPick: async () => ({ valid: true }),
}))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', async load => ({
  ...await load<typeof import('@/lib/draft-defaults/DraftUISettingsResolver')>(),
  getDraftUISettingsForLeague: async () => ({}),
}))
vi.mock('@/lib/draft-room/postDraftPickChatEvent', () => ({ postDraftPickChatEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordEngineTelemetrySample: vi.fn(), recordProductEvent: vi.fn() }))
vi.mock('@/lib/player-trend/signal-integration', () => ({ resolveTrendPlayerIds: vi.fn(async () => []), recordTrendSignalByPlayerId: vi.fn(async () => undefined) }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn(async () => undefined) }))
vi.mock('@/lib/rookie-order/liveRookieOrderService', async load => ({
  ...await load<typeof import('@/lib/rookie-order/liveRookieOrderService')>(),
  resolveLiveRookieDraftSlots: async () => null,
}))

const season = 2027

beforeEach(() => {
  h.db = createInMemoryPrisma()
  h.pool.mockReset()
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network disabled for combined draft tests') }))
})
afterEach(() => vi.unstubAllGlobals())

async function seed(sport: 'NFL' | 'NBA', draftType = 'snake', pickRound = 1) {
  const db = h.db
  await db.league.create({ data: { id: 'league', platform: 'manual', platformLeagueId: 'league', userId: 'manager-home', sport, leagueType: 'dynasty', isDynasty: true, leagueVariant: 'c2c', leagueSize: 2, lifecycleState: 'offseason', status: 'in_season', season: season - 1, settings: {} } })
  await db.c2CLeagueConfig.create({ data: { leagueId: 'league', mergedRookieCollegeDraft: true, rookieDraftRounds: 2, collegeDraftRounds: 3, rookieDraftType: draftType, standingsModel: 'unified' } })
  await db.redraftSeason.create({ data: { id: 'incoming', leagueId: 'league', sport, season, status: 'setup', totalWeeks: 18, playoffStartWeek: 19 } })
  for (const id of ['home', 'guest']) {
    await db.roster.create({ data: { id, leagueId: 'league', platformUserId: 'manager-' + id, playerData: {} } })
    await db.redraftRoster.create({ data: { id: 'season-' + id, leagueId: 'league', seasonId: 'incoming', ownerId: 'manager-' + id, ownerName: id } })
  }
  await db.draftSession.create({ data: { id: 'startup', leagueId: 'league', sportType: sport, status: 'completed', draftModeLabel: 'startup', draftType: 'linear', rounds: 15, teamCount: 2, createdAt: new Date('2026-01-01') } })
  await db.futureDraftPick.create({ data: { id: 'canton-right', leagueId: 'league', pickSeason: season, round: pickRound, originalRosterId: 'home', currentOwnerId: 'guest', traded: true, status: 'active' } })
}

describe('native annual combined draft', () => {
  it.each([['NFL', 'snake', 'WR', 'NCAAF', 'college-nfl'], ['NBA', 'linear', 'G', 'NCAAB', 'espn:ncaab:3333']] as const)(
    'creates the %s board, seats Canton ownership, and validates the two player pools',
    { timeout: 180_000 },
    async (sport, draftType, position, collegeSport, collegeId) => {
      await seed(sport, draftType)
      const db = h.db
      const { createNextLeagueDraft } = await import('@/lib/live-draft-engine/createNextLeagueDraft')
      const { submitPick } = await import('@/lib/live-draft-engine/PickSubmissionService')
      const { getCurrentC2CDraftPhase } = await import('@/lib/merged-devy-c2c/draft/C2CDraftOrchestration')
      const { applyDraftModePoolFilters } = await import('@/lib/draft-room/getResolvedDraftPoolForLeague')
      const { appendPickToRosterDraftSnapshot, finalizeRosterAssignments } = await import('@/lib/live-draft-engine/RosterAssignmentService')
      const { draftPickGradeAsset } = await import('@/lib/live-draft-engine/draftPickTradeGrade')

      const created = await createNextLeagueDraft('league', 'manager-home')
      expect(created).toMatchObject({ ok: true, rounds: 5, tradedPicksApplied: 1, season })
      if (!created.ok) throw new Error(created.message)
      const stored = await db.draftSession.findUnique({ where: { id: created.sessionId } })
      expect(stored).toMatchObject({
        draftModeLabel: ANNUAL_C2C_DRAFT, draftType, rounds: 5,
        tradedPicks: [expect.objectContaining({ round: 1, originalRosterId: 'home', newRosterId: 'guest' })],
      })
      expect(annualC2CDraftSeason(stored)).toBe(season)
      expect(await db.league.findUnique({ where: { id: 'league' } })).toMatchObject({ season, lifecycleState: 'pre_draft' })
      expect(await getCurrentC2CDraftPhase('league')).toMatchObject({ phase: ANNUAL_C2C_DRAFT, phaseInfo: { rounds: 5, draftType } })
      expect(await db.futureDraftPick.findUnique({ where: { id: 'canton-right' } })).toMatchObject({
        round: 1, originalRosterId: 'home', currentOwnerId: 'guest', usedInDraftSessionId: created.sessionId, status: 'used',
      })
      expect(draftPickGradeAsset({ season: annualC2CDraftSeason(stored)!, round: 1, overall: 1, slot: 1, teamCount: 2, combined: true }))
        .toMatchObject({ draftSide: 'combined', year: season, overall: 1 })

      const source = sport === 'NBA' ? 'espn_ncaab_roster' : 'cfbd'
      await db.devyPlayer.create({ data: { id: collegeId, name: 'College Player', normalizedName: 'college player', position, school: 'College', sport: collegeSport, source, devyEligible: true } })
      if (sport === 'NBA') {
        const now = new Date()
        const year = currentNcaabSeasonYear(now)
        await db.sportsDataCache.create({ data: {
          cacheKey: `${ESPN_NCAAB_ROSTER_KEY_PREFIX}${year}:5000`,
          expiresAt: new Date(now.getTime() + 86400000),
          data: { seasonYear: year, teamId: '5000', school: 'College', observedAt: now.toISOString(), athletes: [{ id: '3333', fullName: 'College Player', position }] },
        } })
      }
      const entries = [
        { playerId: collegeId, name: 'College Player', position, poolType: 'college' },
        { playerId: 'rookie', name: 'Pro Rookie', position, poolType: 'pro', rookieVerdict: 'rookie' },
        { playerId: 'veteran', name: 'Veteran', position, poolType: 'pro', rookieVerdict: 'not_rookie' },
        { playerId: 'unknown', name: 'Unknown Pro', position, poolType: 'pro', rookieVerdict: 'unknown' },
      ] as Parameters<typeof applyDraftModePoolFilters>[0]
      const board = applyDraftModePoolFilters(entries, stored, [])
      expect(board.map(player => player.playerId)).toEqual([collegeId, 'rookie'])
      h.pool.mockResolvedValue({ warm: true, payload: { entries: board, poolType: ANNUAL_C2C_DRAFT } })
      await db.draftSession.update({ where: { id: created.sessionId }, data: { status: 'in_progress' } })

      const base = { leagueId: 'league', position, rosterId: 'guest', expectedOverall: 1 }
      expect(await submitPick({ ...base, playerId: 'veteran', playerName: 'Veteran', assetType: 'c2c_college', pickMetadata: { isRookie: true } })).toMatchObject({ success: false })
      expect(await submitPick({ ...base, playerId: 'unknown', playerName: 'Unknown Pro' })).toMatchObject({ success: false })
      expect(await submitPick({ ...base, rosterId: 'home', playerId: collegeId, playerName: 'College Player' })).toMatchObject({ success: false })
      expect(await submitPick({ ...base, playerId: 'rookie', playerName: 'College Player' })).toMatchObject({ success: false })
      await db.devyRights.create({ data: { id: 'already-owned', leagueId: 'league', rosterId: 'home', devyPlayerId: collegeId, state: 'COLLEGE_ACTIVE' } })
      expect(await submitPick({ ...base, playerId: collegeId, playerName: 'College Player' })).toMatchObject({ success: false, error: expect.stringContaining('already has rights') })
      expect(await db.draftPick.count({ where: { sessionId: created.sessionId } })).toBe(0)
      await db.devyRights.delete({ where: { id: 'already-owned' } })
      expect(await submitPick({ ...base, playerId: collegeId, playerName: 'College Player', source: 'auto' })).toMatchObject({ success: true })
      expect(await db.draftPick.findFirst({ where: { sessionId: created.sessionId, overall: 1 } })).toMatchObject({
        rosterId: 'guest', originalRosterId: 'home', playerId: collegeId, assetType: 'c2c_college',
      })
      await appendPickToRosterDraftSnapshot('league', 'guest', { playerId: collegeId, playerName: 'College Player', position, team: 'College', byeWeek: null })
      expect(await db.devyRights.findFirst({ where: { leagueId: 'league', devyPlayerId: collegeId } })).toMatchObject({
        rosterId: 'guest', seasonYear: season, state: 'COLLEGE_ACTIVE',
      })
      expect(await submitPick({ ...base, expectedOverall: 2, playerId: 'rookie', playerName: 'Pro Rookie', source: 'user' })).toMatchObject({ success: true })
      expect(await db.draftPick.findFirst({ where: { sessionId: created.sessionId, overall: 2 } })).toMatchObject({ playerId: 'rookie', assetType: 'player' })

      await db.draftSession.update({ where: { id: created.sessionId }, data: { status: 'completed' } })
      expect(await createNextLeagueDraft('league', 'manager-home')).toMatchObject({ ok: false, code: 'SEASON_IN_PROGRESS' })
      await finalizeRosterAssignments('league', created.sessionId)
      expect((await db.roster.findUnique({ where: { id: 'guest' } })).playerData).toMatchObject({
        draftPicks: expect.arrayContaining([expect.objectContaining({ playerId: collegeId, assetType: 'c2c_college' })]),
        lineup_sections: { devy: [expect.objectContaining({ id: collegeId })] },
      })
    },
  )

  it('refuses to consume Canton ownership when the combined board cannot seat it', async () => {
    await seed('NFL', 'snake', 6)
    const { createNextLeagueDraft } = await import('@/lib/live-draft-engine/createNextLeagueDraft')
    expect(await createNextLeagueDraft('league', 'manager-home')).toMatchObject({ ok: false, code: 'COMBINED_DRAFT_PICKS_UNRESOLVED' })
    expect(await h.db.futureDraftPick.findUnique({ where: { id: 'canton-right' } })).toMatchObject({ status: 'active', currentOwnerId: 'guest', usedInDraftSessionId: null })
    expect(await h.db.draftSession.count({ where: { leagueId: 'league' } })).toBe(1)
  })

  it('carries a Canton forfeiture onto the combined board and skips it without a player', async () => {
    await seed('NFL')
    const { createNextLeagueDraft } = await import('@/lib/live-draft-engine/createNextLeagueDraft')
    const { submitPick } = await import('@/lib/live-draft-engine/PickSubmissionService')
    const { skipForfeitedPicksOnClock } = await import('@/lib/live-draft-engine/forfeitedPickSkips')
    await h.db.futureDraftPick.update({ where: { id: 'canton-right' }, data: { status: 'forfeited' } })
    const created = await createNextLeagueDraft('league', 'manager-home')
    expect(created).toMatchObject({ ok: true, tradedPicksApplied: 0 })
    if (!created.ok) throw new Error(created.message)
    expect(await h.db.futureDraftPick.findUnique({ where: { id: 'canton-right' } })).toMatchObject({ status: 'forfeited', usedInDraftSessionId: created.sessionId })
    await h.db.draftSession.update({ where: { id: created.sessionId }, data: { status: 'in_progress' } })
    expect(await skipForfeitedPicksOnClock('league', submitPick)).toBe(1)
    expect(await h.db.draftPick.findFirst({ where: { sessionId: created.sessionId } })).toMatchObject({ overall: 1, position: 'SKIP', originalRosterId: 'home' })
    expect(await h.db.devyRights.count({ where: { leagueId: 'league' } })).toBe(0)
  }, 180_000)

  it('refuses an annual auction before consuming Canton ownership', async () => {
    await seed('NBA', 'auction')
    const { createNextLeagueDraft } = await import('@/lib/live-draft-engine/createNextLeagueDraft')
    expect(await createNextLeagueDraft('league', 'manager-home')).toMatchObject({ ok: false, code: 'COMBINED_DRAFT_UNAVAILABLE' })
    expect(await h.db.draftSession.count({ where: { leagueId: 'league' } })).toBe(1)
  })
})
