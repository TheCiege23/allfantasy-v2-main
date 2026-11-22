// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({ campusDb: null as any, now: null as Date | null, teamId: '' }))
vi.mock('@/lib/draft-room/postDraftPickChatEvent', () => ({ postDraftPickChatEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordEngineTelemetrySample: vi.fn(), recordProductEvent: vi.fn() }))
vi.mock('@/lib/player-trend/signal-integration', () => ({ resolveTrendPlayerIds: vi.fn(async () => []), recordTrendSignalByPlayerId: vi.fn(async () => undefined) }))
vi.mock('@/lib/draft/draftLock', async load => ({ ...(await load<typeof import('@/lib/draft/draftLock')>()), withPickLock: async (_leagueId: string, fn: () => Promise<unknown>) => ({ acquired: true, value: await fn(), backend: 'passthrough' }) }))
vi.mock('@/lib/draft-notifications', () => ({ notifyDraftLifecycle: vi.fn(async () => undefined) }))
vi.mock('@/lib/live-draft-engine/postDraftFinalizeArtifacts', () => ({ runPostDraftFinalizationArtifacts: vi.fn(async () => undefined) }))
vi.mock('@/lib/survivor-guillotine/operations', () => ({ bootstrapSGAfterDraft: vi.fn(async () => undefined) }))
vi.mock('@/lib/survivor/SurvivorDraftBootstrapService', () => ({ runSurvivorPostDraftBootstrap: vi.fn(async () => undefined) }))
vi.mock('@/lib/achievement-system', () => ({ awardAchievement: vi.fn(async () => undefined) }))
vi.mock('@/lib/events', async load => ({ ...(await load<typeof import('@/lib/events')>()), getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }) }))
vi.mock('@/lib/sports-data/riSeasonSchedule', async load => ({ ...(await load<typeof import('@/lib/sports-data/riSeasonSchedule')>()), readRiScheduleWindow: async () => [{ gameId: 'nba-synthetic', status: 'completed', seasonType: 'regular', startTime: '2026-11-01T18:00:00Z' }] }))
const game = { gameId: 'ri-pilot', day: '2026-11-01', startTime: '2026-11-01T18:00:00Z', status: 'completed', seasonType: 'regular', eventName: null, replacedBy: null, homeTeamId: '1', awayTeamId: '2' }
vi.mock('@/lib/sports-data/riScheduleCache', async (load) => ({ ...(await load<typeof import('@/lib/sports-data/riScheduleCache')>()), readRiScheduleWindow: async () => [game] }))
vi.mock('@/lib/redraft/ncaabCampusTeamBridge', () => ({ bridgeNcaabCampusTeams: async () => ({ resolved: new Map([[harness.teamId, '1']]), unresolved: [] }) }))
vi.mock('@/lib/c2c/nbaCampusMatchupScoring', async (load) => {
  const actual = await load<typeof import('@/lib/c2c/nbaCampusMatchupScoring')>()
  return { ...actual, nbaCampusPointsForMatchup: (db: any, input: any) => actual.nbaCampusPointsForMatchup(harness.campusDb ?? db, { ...input, now: harness.now ?? input.now }) }
})

import { prisma } from '@/lib/prisma'
import { submitPick } from '@/lib/live-draft-engine/PickSubmissionService'
import { currentNcaabSeasonYear, ESPN_NCAAB_ROSTER_KEY_PREFIX } from '@/lib/espn/ncaabRosterSnapshot'
import { buildNbaCampusWeekSnapshot } from '@/lib/c2c/nbaCampusWeekSnapshot'
import { nbaCampusWeekCacheKey, persistNbaCampusWeekSnapshot } from '@/lib/c2c/storeNbaCampusWeekSnapshot'
import { nbaCampusGameMappingKey } from '@/lib/c2c/refreshNbaCampusWeek'
import { nbaCampusPointsForMatchup } from '@/lib/c2c/nbaCampusMatchupScoring'
import { refreshEspnCollegeGameBoxes } from '@/lib/espn/refreshNcaabCollegeGameBoxes'
import { finalizeRosterAssignments, mergeNbaCollegeDraftPlayers } from '@/lib/live-draft-engine/RosterAssignmentService'
import { buildLeagueStatScorer, scoreRosterForWeek, updateMatchupScores } from '@/lib/redraft/scoringEngine'
import { scoreActivePlayoffRound } from '@/lib/playoff-runtime/playoffRoundScoring'
import { generateNflRedraftPlayoffRuntimeBracket, advanceNflRedraftPlayoffRuntimeRound, finalizeNflRedraftPlayoffRuntimeSeason } from '@/lib/playoff-runtime/resolveNflRedraftPlayoffRuntime'
import { finalizeWeekWithRefresh } from '@/lib/redraft/weekFinalizer'

const pilot = process.env.NBA_CAMPUS_POSTGRES_PILOT === '1' ? describe : describe.skip
pilot('NBA C2C draft and scoring rehearsal on isolated Postgres', () => {
  it('completes a draft, seals scoring, handles corrections, and crowns a playoff champion', async () => {
    const target = new URL(process.env.DATABASE_URL!)
    expect(target.hostname).toBe('ep-silent-field-adsog3jo-pooler.c-2.us-east-1.aws.neon.tech')
    expect(target.pathname).toBe('/neondb')
    const id = `campus-pilot-${randomUUID()}`
    const ownerId = `${id}-owner`, homeId = `${id}-home`, awayId = `${id}-away`, proId = `${id}-pro`, awayProId = `${id}-away-pro`
    const homeRoster = `${id}-home-roster`, awayRoster = `${id}-away-roster`
    const espnId = String(BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`))
    const secondEspnId = String(BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`)), teamId = String(BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`))
    const secondPlayerId = `espn:ncaab:${secondEspnId}`, rosterCacheKey = `${ESPN_NCAAB_ROSTER_KEY_PREFIX}${currentNcaabSeasonYear(new Date())}:${teamId}`
    const playerId = `espn:ncaab:${espnId}`, eventId = String(BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`))
    const boxKey = `espn:ncaab:box:${eventId}`, mappingKey = nbaCampusGameMappingKey(2026, 2)
    const savedAt = new Date('2026-10-31T12:00:00Z'), now = new Date('2026-11-05T12:00:00Z')
    const drafted = mergeNbaCollegeDraftPlayers({}, [{ playerId, playerName: 'Synthetic College Player', position: 'G', team: 'School', assetType: 'c2c_college' }])
    expect(drafted.lineup_sections).toMatchObject({ devy: [expect.objectContaining({ id: playerId })] })
    const playerData = { ...drafted, lineup_sections: { ...(drafted.lineup_sections as Record<string, unknown>), campus: [playerId] } }
    const evidence = [{ id: playerId, espnId, teamId, name: 'Synthetic College Player', school: 'Synthetic School', position: 'G', jersey: null, observedAt: savedAt }]
    const built = buildNbaCampusWeekSnapshot({ playerData, season: 2026, week: 2, now: savedAt, evidence })
    expect(built.snapshot).not.toBeNull()
    // These global cache names are remapped to test-only keys; no copied production cache is modified.
    const localMappingKey = `${id}-mapping`, localBoxKey = `${id}-box`
    const rewrite = (key: string) => key === mappingKey ? localMappingKey : key === boxKey ? localBoxKey : key
    const db = {
      roster: prisma.roster,
      afRosterLineupAssignment: prisma.afRosterLineupAssignment,
      teamProviderIdentity: prisma.teamProviderIdentity,
      sportsDataCache: {
        upsert: (args: any) => prisma.sportsDataCache.upsert({ ...args, where: { cacheKey: rewrite(args.where.cacheKey) }, create: { ...args.create, cacheKey: rewrite(args.create.cacheKey) } }),
        findMany: async (args: any) => {
          const keys: string[] = args.where.cacheKey.in
          const rows = await prisma.sportsDataCache.findMany({ ...args, where: { ...args.where, cacheKey: { in: keys.map(rewrite) } } })
          const restored = rows.map(row => ({ ...row, cacheKey: row.cacheKey === localMappingKey ? mappingKey : row.cacheKey === localBoxKey ? boxKey : row.cacheKey }))
          return keys.includes('NCAAB:rischedule:2026:meta')
            ? [...restored.filter(row => row.cacheKey !== 'NCAAB:rischedule:2026:meta'), { cacheKey: 'NCAAB:rischedule:2026:meta', data: { firstDay: '2026-11-01', lastDay: '2027-03-07' } }]
            : restored
        },
      },
    }
    const input = { leagueId: id, season: 2026, week: 2, homeRosterId: homeId, awayRosterId: awayId, now, scorer: (s: Record<string, number>) => (s.pts ?? 0) + (s.reb ?? 0) }
    const box = (points: number) => ({ eventId, status: 'final' as const, complete: true, rejected: 0, players: [{ espnId, teamId, didNotPlay: false, stats: { pts: points, reb: 5, ast: 0, to: 0, stl: 0, blk: 0, threes: 0 } }] })
    const refresh = (points: number, observedAt: Date) => refreshEspnCollegeGameBoxes(db as never, {
      games: [game], espnForRi: new Map([['1', teamId], ['2', '20']]), now: observedAt, deadlineAt: Date.now() + 30000, maxEvents: 1,
      fetchScoreboard: async () => ({ games: [{ id: eventId, day: game.day, homeTeamId: teamId, awayTeamId: '20', startTime: game.startTime, status: 'final' as const }], rejected: 0 }),
      fetchBox: async () => box(points),
    })
    let cleanupSeasonId = ''
    try {
      await prisma.appUser.create({ data: { id: ownerId, email: `${id}@example.invalid`, username: id } })
      await prisma.league.create({ data: { id, userId: ownerId, platform: 'manual', platformLeagueId: id, leagueType: 'dynasty', leagueVariant: 'c2c', sport: 'NBA', isDynasty: true, leagueSize: 2, playoffTeams: 2, playoffStartWeek: 2, playoffWeeksPerRound: 1, settings: {} } })
      await prisma.c2CLeagueConfig.create({ data: { leagueId: id, collegeScoringSystem: 'points', bestBallPro: false, bestBallCollege: false, standingsModel: 'unified' } })
      const season = await prisma.redraftSeason.create({ data: { leagueId: id, sport: 'NBA', season: 2026, status: 'active', totalWeeks: 18, playoffStartWeek: 19 } })
      cleanupSeasonId = season.id
      await prisma.redraftRoster.createMany({ data: [{ id: homeId, leagueId: id, seasonId: season.id, ownerId: homeId, ownerName: 'Home' }, { id: awayId, leagueId: id, seasonId: season.id, ownerId: awayId, ownerName: 'Away' }] })
      await prisma.roster.createMany({ data: [{ id: homeRoster, leagueId: id, platformUserId: homeId, redraftRosterId: homeId, playerData: {} }, { id: awayRoster, leagueId: id, platformUserId: awayId, redraftRosterId: awayId, playerData: {} }] })
      harness.teamId = teamId
      await prisma.devyPlayer.createMany({ data: [
        { id: playerId, name: 'Synthetic College Player', normalizedName: 'synthetic college player', position: 'G', school: 'Synthetic School', sport: 'NCAAB', source: 'espn_ncaab_roster', devyEligible: true },
        { id: secondPlayerId, name: 'Synthetic Away College', normalizedName: 'synthetic away college', position: 'G', school: 'Synthetic School', sport: 'NCAAB', source: 'espn_ncaab_roster', devyEligible: true },
      ] })
      const draftNow = new Date()
      await prisma.sportsDataCache.create({ data: { cacheKey: rosterCacheKey, expiresAt: new Date(draftNow.getTime() + 86400000), data: { seasonYear: currentNcaabSeasonYear(draftNow), teamId, school: 'Synthetic School', observedAt: draftNow.toISOString(), athletes: [{ id: espnId, fullName: 'Synthetic College Player', position: 'G' }, { id: secondEspnId, fullName: 'Synthetic Away College', position: 'G' }] } } })
      const draft = await prisma.draftSession.create({ data: { leagueId: id, status: 'in_progress', draftModeLabel: 'startup', draftType: 'snake', rounds: 1, teamCount: 2, c2cConfig: { enabled: true, collegeRounds: [1] }, slotOrder: [{ slot: 1, rosterId: homeRoster, displayName: 'Home' }, { slot: 2, rosterId: awayRoster, displayName: 'Away' }] } })
      expect(await submitPick({ leagueId: id, playerId, playerName: 'Synthetic College Player', position: 'G', rosterId: homeRoster, source: 'user', expectedOverall: 1 })).toMatchObject({ success: true })
      expect(await submitPick({ leagueId: id, playerId: secondPlayerId, playerName: 'Synthetic Away College', position: 'G', rosterId: awayRoster, source: 'user', expectedOverall: 2 })).toMatchObject({ success: true })
      expect((await prisma.draftSession.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('completed')
      expect(await finalizeRosterAssignments(id, draft.id)).toMatchObject({ teamsSynced: 2, playersSynced: 2 })
      const assigned = (await prisma.roster.findUniqueOrThrow({ where: { id: homeRoster } })).playerData as Record<string, unknown>
      expect(assigned.lineup_sections).toMatchObject({ devy: [expect.objectContaining({ id: playerId })] })
      const lineup = { ...assigned, lineup_sections: { ...(assigned.lineup_sections as Record<string, unknown>), campus: [playerId] } }
      expect(buildNbaCampusWeekSnapshot({ playerData: lineup, season: 2026, week: 2, now: savedAt, evidence })).toEqual(built)
      await prisma.roster.update({ where: { id: homeRoster }, data: { playerData: lineup } })
      await prisma.redraftRosterPlayer.create({ data: { rosterId: homeId, playerId: proId, playerName: 'Synthetic Pro Player', position: 'PG', sport: 'NBA', slotType: 'PG', addedAt: new Date('2026-10-20T00:00:00Z') } })
      await prisma.redraftRosterPlayer.create({ data: { rosterId: awayId, playerId: awayProId, playerName: 'Synthetic Away Player', position: 'PG', sport: 'NBA', slotType: 'PG', addedAt: new Date('2026-10-20T00:00:00Z') } })
      await prisma.playerWeeklyScore.create({ data: { playerId: proId, sport: 'NBA', week: 2, season: 2026, stats: { pts: 10 }, isFinalized: false } })
      await prisma.playerWeeklyScore.create({ data: { playerId: awayProId, sport: 'NBA', week: 2, season: 2026, stats: { pts: 10 }, isFinalized: false } })
      const matchup = await prisma.redraftMatchup.create({ data: { leagueId: id, seasonId: season.id, week: 2, homeRosterId: homeId, awayRosterId: awayId } })
      await prisma.$transaction(async tx => {
        await tx.afRosterLineupAssignment.create({ data: { leagueId: id, rosterId: homeRoster, season: 2026, week: 2, section: 'campus', playerId } })
        await persistNbaCampusWeekSnapshot(tx, { leagueId: id, rosterId: homeRoster, snapshot: built.snapshot!, now: savedAt })
        await persistNbaCampusWeekSnapshot(tx, { leagueId: id, rosterId: awayRoster, snapshot: { season: 2026, week: 2, savedAt: savedAt.toISOString(), players: [] }, now: savedAt })
      })
      await prisma.sportsDataCache.create({ data: { cacheKey: localMappingKey, expiresAt: new Date('2028-01-01'), data: { season: 2026, week: 2, mappings: [{ gameId: game.gameId, eventId, day: game.day, homeTeamId: '1', awayTeamId: '2' }] } } })
      expect((await nbaCampusPointsForMatchup(db as never, input))?.home).toMatchObject({ missingPlayerIds: [playerId], allFinal: false })
      harness.campusDb = db
      harness.now = now
      // Seal the pro week through the real finalizer. Missing campus evidence must still
      // keep the combined matchup open even after the pro rows are final.
      const sealed = await finalizeWeekWithRefresh({ seasonId: season.id, week: 2 }, { prisma, now: () => now, recalculateMatchups: async () => { await updateMatchupScores(matchup.id); return [] as never }, enqueueTankingScan: async () => {}, notifyResults: async () => {}, resolvePredictions: async () => {} })
      expect(sealed).toMatchObject({ finalized: true, refusal: null, rowsFinalized: 2 })
      expect(await prisma.playerWeeklyScore.count({ where: { playerId: { in: [proId, awayProId] }, sport: 'NBA', season: 2026, week: 2, isFinalized: true } })).toBe(2)
      expect(await prisma.redraftMatchup.findUniqueOrThrow({ where: { id: matchup.id } })).toMatchObject({ status: 'active' })
      expect(await refresh(20, now)).toMatchObject({ stored: 1, unresolved: [] })
      expect((await nbaCampusPointsForMatchup(db as never, input))?.home).toEqual({ points: 25, missingPlayerIds: [], allFinal: true })
      await updateMatchupScores(matchup.id)
      const finalBeforeCorrection = await prisma.redraftMatchup.findUniqueOrThrow({ where: { id: matchup.id } })
      expect(finalBeforeCorrection.status).toBe('final')
      const correctedAt = new Date(now.getTime() + 13 * 60 * 60 * 1000)
      expect(await refresh(22, correctedAt)).toMatchObject({ stored: 1, unresolved: [] })
      expect((await nbaCampusPointsForMatchup(db as never, { ...input, now: correctedAt }))?.home).toEqual({ points: 27, missingPlayerIds: [], allFinal: true })
      harness.campusDb = db
      harness.now = correctedAt
      await updateMatchupScores(matchup.id)
      const finalAfterCorrection = await prisma.redraftMatchup.findUniqueOrThrow({ where: { id: matchup.id } })
      expect(finalAfterCorrection.status).toBe('final')
      expect(finalAfterCorrection.homeScore).toBeGreaterThan(finalBeforeCorrection.homeScore)
      const playoffScore = await scoreRosterForWeek({ leagueId: id, rosterId: homeId, seasonYear: 2026, week: 2 })
      const proScorer = buildLeagueStatScorer({ sport: 'NBA', settings: {} })!
      const collegeScorer = buildLeagueStatScorer({ sport: 'NCAAB', settings: null })!
      const expected = proScorer({ pts: 10 }, 'PG') + collegeScorer({ pts: 22, reb: 5, ast: 0, to: 0, stl: 0, blk: 0, threes: 0 }, 'G')
      expect(playoffScore.points).toBe(Math.round(expected * 100) / 100)
      expect(playoffScore.allFinal).toBe(true)
      expect(playoffScore.missingPlayerIds).toEqual([])
      await prisma.sportsDataCache.deleteMany({ where: { cacheKey: localBoxKey } })
      const pendingPlayoff = await scoreRosterForWeek({ leagueId: id, rosterId: homeId, seasonYear: 2026, week: 2 })
      expect(pendingPlayoff.allFinal).toBe(false)
      expect(pendingPlayoff.missingPlayerIds).toContain(playerId)
      await prisma.redraftSeason.update({ where: { id: season.id }, data: { status: 'active', playoffStartWeek: 2, currentWeek: 2 } })
      await prisma.redraftRoster.update({ where: { id: homeId }, data: { wins: 1 } })
      const generated = await generateNflRedraftPlayoffRuntimeBracket({ seasonId: season.id, playoffTeams: 2, actorUserId: ownerId, lockBracket: true })
      expect(generated.rounds.length).toBeGreaterThan(0)
      const playoff = await prisma.redraftPlayoffMatchup.findFirstOrThrow({ where: { seasonId: season.id, homeRosterId: { not: null }, awayRosterId: { not: null } } })
      const playoffId = playoff.id
      // Assume the separate week-sealing gate has passed; the real playoff scorer must still
      // withhold its result while this roster's campus box is missing.
      const playoffDeps = { prisma, now: () => correctedAt, finalizeWeek: vi.fn(async () => ({ finalized: true, alreadyFinal: false })) as never }
      expect((await scoreActivePlayoffRound({ seasonId: season.id, calendarWeek: 2 }, playoffDeps)).outcome).toBe('live')
      expect((await prisma.redraftPlayoffMatchup.findUniqueOrThrow({ where: { id: playoffId } })).status).not.toBe('final')
      await updateMatchupScores(matchup.id)
      expect(await prisma.redraftMatchup.findUniqueOrThrow({ where: { id: matchup.id } })).toMatchObject({ status: 'active' })
      expect(await refresh(22, correctedAt)).toMatchObject({ stored: 1 })
      await updateMatchupScores(matchup.id)
      expect(await prisma.redraftMatchup.findUniqueOrThrow({ where: { id: matchup.id } })).toMatchObject({ status: 'final', homeScore: finalAfterCorrection.homeScore })
      // Exercise the real playoff week gate after the regular matchup has actually finalized.
      // This covers its already-final path, not the initial slate sealing path.
      const realGate = vi.fn(finalizeWeekWithRefresh)
      expect((await scoreActivePlayoffRound({ seasonId: season.id, calendarWeek: 2 }, { prisma, now: () => correctedAt, finalizeWeek: realGate })).outcome).toBe('scored')
      expect(realGate).toHaveReturned()
      expect(await realGate.mock.results[0].value).toMatchObject({ alreadyFinal: true })
      expect(await prisma.redraftPlayoffMatchup.findUniqueOrThrow({ where: { id: playoffId } })).toMatchObject({ status: 'final', homeScore: finalAfterCorrection.homeScore })
      const advanced = await advanceNflRedraftPlayoffRuntimeRound({ seasonId: season.id, week: 2, actorUserId: ownerId })
      expect(advanced).toMatchObject({ ok: true, status: 'championship_ready' })
      const completed = await finalizeNflRedraftPlayoffRuntimeSeason({ seasonId: season.id, actorUserId: ownerId })
      expect(completed).toMatchObject({ ok: true, championRosterId: homeId })
      expect(await prisma.redraftSeason.findUniqueOrThrow({ where: { id: season.id } })).toMatchObject({ status: 'complete' })
      harness.campusDb = null
      harness.now = null
      await persistNbaCampusWeekSnapshot(prisma, { leagueId: id, rosterId: homeRoster, snapshot: { ...built.snapshot!, players: built.snapshot!.players.map(player => ({ ...player, selectedAt: '2026-11-01T19:00:00.000Z' })) }, now: savedAt })
      expect((await nbaCampusPointsForMatchup(db as never, input))?.home).toMatchObject({ missingPlayerIds: [playerId], allFinal: false })

      // A published regular-season schedule cannot establish an empty postseason week.
      await prisma.$transaction(async tx => {
        await tx.afRosterLineupAssignment.create({ data: { leagueId: id, rosterId: homeRoster, season: 2026, week: 21, section: 'campus', playerId } })
        await persistNbaCampusWeekSnapshot(tx, { leagueId: id, rosterId: homeRoster, snapshot: { ...built.snapshot!, week: 21 }, now: savedAt })
        await persistNbaCampusWeekSnapshot(tx, { leagueId: id, rosterId: awayRoster, snapshot: { season: 2026, week: 21, savedAt: savedAt.toISOString(), players: [] }, now: savedAt })
      })
      expect((await nbaCampusPointsForMatchup(db as never, { ...input, week: 21, now: new Date('2027-03-18T12:00:00Z') }))?.home).toMatchObject({ missingPlayerIds: [playerId], allFinal: false })
    } finally {
      harness.campusDb = null
      harness.now = null
      await prisma.playerWeeklyScore.deleteMany({ where: { playerId: { in: [proId, awayProId] }, sport: 'NBA', season: 2026, week: 2 } })
      await prisma.sportsDataCache.deleteMany({ where: { cacheKey: { in: [localMappingKey, localBoxKey, ...[2, 21].flatMap(week => [nbaCampusWeekCacheKey(id, homeRoster, 2026, week), nbaCampusWeekCacheKey(id, awayRoster, 2026, week)])] } } })
      if (cleanupSeasonId) await prisma.adminAuditLog.deleteMany({ where: { targetType: 'redraft_season', targetId: cleanupSeasonId } })
      await prisma.sportsDataCache.deleteMany({ where: { cacheKey: rosterCacheKey } })
      await prisma.league.deleteMany({ where: { id } })
      await prisma.devyPlayer.deleteMany({ where: { id: { in: [playerId, secondPlayerId] } } })
      await prisma.appUser.deleteMany({ where: { id: ownerId } })
    }
  }, 90000)
})
