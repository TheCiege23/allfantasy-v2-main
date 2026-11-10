/**
 * Isolated PostgreSQL acceptance test for 128 managers by default or 101 with
 * --qualification. Add --staggered for draft overrides, or --reports with
 * --staggered to verify report revisions and chat delivery on PostgreSQL.
 * Add --recovery to exercise owner review, short fields, score delays and protected drafts.
 * Start a disposable PostgreSQL
 * instance, apply schema with prisma db push, then set all three database URLs
 * to the local database described in assertIsolatedConnection. No provider calls.
 */
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { prisma } from '@/lib/prisma'
import { disconnect } from '@/lib/domain/db'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { buildSeasonBlueprint, defaultSeasonBlueprint, defaultSeasonCompetition } from '@/lib/tournament/seasonBlueprint'
import { loadSeasonLiveCut } from '@/lib/tournament/seasonLiveCut'
import { loadSeasonIntegrity, updateSeasonIntegrity } from '@/lib/tournament/seasonIntegrity'
import { loadSeasonRecovery, resolveSeasonRecovery } from '@/lib/tournament/seasonRecovery'
import { settleRedraftTradeAssets } from '@/lib/redraft/tradeSettlement'
import { readSeasonTradePolicy, seasonTradeOfferExpiry } from '@/lib/tournament/seasonTradePolicy'
import { loadSeasonBlueprint, saveSeasonBlueprint, setBlueprintStaff, removeBlueprintStaff } from '@/lib/tournament/seasonBlueprintStore'
import { seasonContractHash } from '@/lib/tournament/seasonCalendarVerification'
import { loadSeasonDraftContext } from '@/lib/tournament/seasonDraftRuntime'
import { loadSeasonStage } from '@/lib/tournament/seasonRounds'
import { seasonScoringId } from '@/lib/tournament/seasonDraftHandoff'
import { releaseSeasonOpeningDraft } from '@/lib/tournament/seasonDraftRelease'
import {
  captureSeasonOpeningLineup, captureSeasonOpeningMatchups, finalizeSeasonOpeningWeek, ingestSeasonOpeningScores,
  readSeasonLiveScores, reviewSeasonOpeningWeek, type SeasonScoreBatch,
} from '@/lib/tournament/seasonScoreLedger'
import type { SeasonStageManifest } from '@/lib/tournament/seasonNativeContract'
import { defaultSeasonRules, resolveSeasonDraftWindow } from '@/lib/tournament/seasonRules'
import { runSeasonTournament, type SeasonTournamentDeps } from '@/lib/tournament/seasonTournamentAutomation'
import { openSeasonRegistration, joinSeasonTournament, freezeSeasonOpeningField, loadSeasonEntry } from '@/lib/tournament/seasonRegistration'
import { getSeasonReport, getSeasonReportAccess, listSeasonReportVersions } from '@/lib/tournament/seasonReportAccess'
import { deliverPendingSeasonReports, deliverSeasonReport, SEASON_REPORT_CHAT_RECEIPT } from '@/lib/tournament/seasonReportChat'
import { seasonReportCsv, type SeasonReport } from '@/lib/tournament/seasonReportFormat'
import { SEASON_REPORT_PUBLISHED } from '@/lib/tournament/seasonReportPublication'
import { verifyOpeningRecovery, verifyScoringDelay, verifyCorrectionBeforeIssue, verifyIssuedRoomRecovery } from './season-recovery-fixture'
import type { HistoricalContribution } from '@/lib/tournament/seasonProviderScores'

const owner = 'native-p0-owner'
const operator = 'native-p0-operator'
const tenant = 'af-tournament-audit'
const qualificationFixture = process.argv.includes('--qualification')
const staggered = process.argv.includes('--staggered')
const verifyReports = process.argv.includes('--reports')
const verifyRecovery = process.argv.includes('--recovery')
const managers = Array.from({ length: qualificationFixture ? 101 : 128 }, (_, i) => 'native-p0-' + String(i + 1).padStart(3, '0'))
const reserves = [1, 2].map(offset => 'native-p0-' + String(managers.length + offset).padStart(3, '0')) as [string, string]
const hour = 3_600_000

function assertIsolatedConnection() {
  for (const value of [process.env.DATABASE_URL, process.env.DIRECT_URL, process.env.COMMISH_APP_URL]) {
    const url = new URL(value ?? '')
    assert.equal(url.protocol, 'postgresql:')
    assert.equal(url.hostname, '127.0.0.1')
    assert.equal(url.port, '55489')
    assert.equal(url.username, 'af_tournament_audit')
    assert.equal(url.password, '')
    assert.equal(url.pathname, '/tournament_prod_port')
    assert.equal(url.searchParams.get('schema'), 'public')
    assert([...url.searchParams.keys()].every(key => ['schema', 'connection_limit', 'pool_timeout'].includes(key)))
  }
  assert.equal(process.env.COMMISH_TENANT_ID, tenant)
}

function configFor(sport: 'NFL' | 'NBA') {
  const base = defaultSeasonBlueprint(sport)
  const rules = defaultSeasonRules(sport, base.scoring)
  rules.starters = (sport === 'NFL' ? ['QB', 'RB', 'WR', 'TE', 'FLEX'] : ['PG', 'SG', 'SF', 'PF', 'C'])
    .map(position => ({ position, count: 1 }))
  rules.bench = 0
  rules.weights = [{ statKey: sport === 'NFL' ? 'passing_yards' : 'points', points: 1 }]
  const firstCutWeek = verifyReports ? 2 : 1
  const secondCutWeek = firstCutWeek * 2
  const finalWeek = secondCutWeek + 5
  const epoch = Date.now() + 120 * hour
  const iso = (hours: number) => new Date(epoch + hours * hour).toISOString()
  rules.calendar = {
    timezone: 'America/New_York', seasonLabel: 'Isolated postseason lifecycle fixture',
    sourceUrl: 'https://example.invalid/schedule', scheduleReviewed: true,
    regularSeasonStartsAt: iso(0), regularSeasonEndsAt: iso(192 * finalWeek),
    periods: Array.from({ length: finalWeek }, (_, i) => ({ number: i + 1, startsAt: iso(i * 192), endsAt: iso(i * 192 + 144), finalizesAt: iso(i * 192 + 168) })),
    drafts: [
      { stage: 1, startsAt: iso(-48), completeBy: iso(-24) },
      { stage: 2, startsAt: iso(firstCutWeek * 192 - 23), completeBy: iso(firstCutWeek * 192 - 12) },
      { stage: 3, startsAt: iso(secondCutWeek * 192 - 23), completeBy: iso(secondCutWeek * 192 - 12) },
    ],
    ...(staggered ? { draftOverrides: [
      { stage: 1, scope: 'division' as const, target: 'North', startsAt: iso(-46), completeBy: iso(-25) },
      { stage: 1, scope: 'league' as const, target: 'stage-1-league-1', startsAt: iso(-50), completeBy: iso(-26) },
      { stage: 2, scope: 'league' as const, target: 'stage-2-league-1', startsAt: iso(firstCutWeek * 192 - 22), completeBy: iso(firstCutWeek * 192 - 13) },
    ] } : {}),
  }
  const competition = qualificationFixture ? {
    ...defaultSeasonCompetition(), firstCut: { advance: 50, automaticPerLeague: 3 },
    secondCut: { advance: 25, automaticPerLeague: 3 }, draftOrder: 'best_seed_last' as const,
  } : undefined
  return { ...base, name: sport + ' isolated lifecycle', participants: managers.length, competition, divisions: staggered ? ['North', 'South'] : [],
    tiebreakers: qualificationFixture ? (['best_week', 'previous_seed'] as const).slice() : base.tiebreakers,
    firstCutWeek, secondCutWeek, finalWeek, trades: true, rosterSize: 5, redraftBufferHours: 12, rules,
  }
}

async function run(sport: 'NFL' | 'NBA', missDeadline = false) {
  const config = configFor(sport)
  const plan = buildSeasonBlueprint(config)
  assert.deepEqual(plan.stages.map(stage => stage.leagueCount), qualificationFixture ? [9, 5, 2] : [16, 8, 4])
  const tournamentId = await saveSeasonBlueprint(owner, config)
  const revision = await prisma.tournamentAuditLog.findFirstOrThrow({ where: { tournamentId, action: 'season_blueprint_created' } })
  const contract = revision.data
  const evidence = {
    provider: 'rolling_insights', season: new Date(config.rules.calendar.regularSeasonStartsAt).getUTCFullYear(),
    regularGames: sport === 'NBA' ? 1230 : 272, pendingGames: 0, excludedGames: [], assignments: [], ready: true,
    periods: config.rules.calendar.periods.map(period => ({ number: period.number, games: 1 })), blockers: [],
  }
  const calendar = { ...evidence, checkedAt: new Date().toISOString(), digest: seasonContractHash({ config: contract, evidence }) }
  const hash = seasonContractHash({ config: contract, calendarDigest: calendar.digest, acceptExcludedGames: false, acceptPendingGames: false })
  const publication = await prisma.$transaction(async tx => {
    await tx.tournamentShell.update({ where: { id: tournamentId }, data: { status: 'rules_published' } })
    return tx.tournamentAuditLog.create({ data: {
      tournamentId, actorType: 'user', actorId: owner, action: 'season_rules_published',
      targetType: 'tournament', targetId: tournamentId,
      data: { version: 1, config: contract!, hash, sourceRevision: revision.id, calendar, acceptExcludedGames: false, acceptPendingGames: false },
    } })
  })
  if (staggered) {
    await assert.rejects(openSeasonRegistration(owner, tournamentId, publication.id, config.rules.calendar.drafts[0]!.startsAt, 0), { status: 409 })
  }
  await setBlueprintStaff(owner, tournamentId, operator, 'co_commissioner')
  await assert.rejects(loadSeasonRecovery(operator, tournamentId), { status: 404 })
  await setBlueprintStaff(owner, tournamentId, operator, 'live_co_commissioner')
  assert.equal((await loadSeasonBlueprint(tournamentId, operator))?.canReviewRecovery, true)
  assert.equal((await getSeasonReportAccess(tournamentId, operator))?.canPost, true)
  await assert.rejects(resolveSeasonRecovery(operator, tournamentId, 'foreign-case', 'retain', 'Owner permission required'), { status: 404 })
  const signup = await openSeasonRegistration(owner, tournamentId, publication.id, new Date(Date.now() + hour).toISOString(), 0)
  const token = new URL(signup.invitePath, 'https://example.invalid').searchParams.get('invite')!
  for (const manager of managers) await joinSeasonTournament(manager, tournamentId, token, publication.id, hash)
  const original = await freezeSeasonOpeningField(owner, tournamentId, publication.id)
  assert.deepEqual(await freezeSeasonOpeningField(owner, tournamentId, publication.id), original)
  const frozen = verifyRecovery ? await verifyOpeningRecovery({
    tournamentId, owner, publicationId: publication.id, hash, token, freezeId: original.freezeId,
    exiting: [managers.at(-1)!, managers.at(-2)!], reserves,
  }) : original
  const blockedRoom = seasonResourceId(frozen.freezeId, 'stage-1-league-1')
  let missingPool = true, missingStats = false, corrected = false
  const rosterOwners = new Map<string, string>()
  const positions = sport === 'NFL' ? ['QB', 'RB', 'WR', 'TE', 'RB'] : ['PG', 'SG', 'SF', 'PF', 'C']
  const playerPoolWidth = Math.max(...plan.stages.flatMap(stage => stage.sizes))
  const players = positions.flatMap((position, round) => Array.from({ length: playerPoolWidth }, (_, i) => ({
    playerId: sport + '-' + round + '-' + i, playerName: sport + ' player ' + round + '-' + i,
    position, team: sport === 'NFL' ? 'NYJ' : 'BOS', adp: round * playerPoolWidth + i + 1,
  })))
  const reminders = new Map<string, string[]>()
  let failFirstReminder = true
  const deps: SeasonTournamentDeps = {
    dispatchDraftReminder: async ({ userIds, dedupePrefix, leagueId }) => {
      const draft = await loadSeasonDraftContext(leagueId!)
      assert.deepEqual(userIds, draft?.pool.members.map(member => member.userId))
      assert(dedupePrefix)
      if (failFirstReminder) {
        failFirstReminder = false
        return { requested: userIds.length, suppressed: 0, delivered: 0, failed: 1 }
      }
      assert(!reminders.has(dedupePrefix), 'A recorded reminder must not dispatch twice')
      reminders.set(dedupePrefix, userIds)
      return { requested: userIds.length, suppressed: 0, delivered: userIds.length, failed: 0 }
    },
    refreshDraft: async leagueId => {
      if (leagueId === blockedRoom && missingPool) return { ready: false, refreshed: false, players: 0, blockers: ['Synthetic provider outage'] }
      const draft = (await loadSeasonDraftContext(leagueId))!
      await prisma.tournamentAuditLog.upsert({
        where: { id: seasonResourceId(leagueId, 'fixture-pool') }, update: {},
        create: { id: seasonResourceId(leagueId, 'fixture-pool'), tournamentId, actorType: 'system',
          action: 'season_draft_pool_checked', targetType: 'league', targetId: leagueId,
          data: { version: 1, ready: true, manifestHash: draft.manifestHash, expiresAt: '2099-01-01T00:00:00Z', players },
        },
      })
      return { ready: true, refreshed: true, players: players.length, blockers: [] }
    },
    progressDraft: async () => { throw new Error('The acceptance fixture supplies draft picks before clocks expire.') },
    refreshNfl: async () => new Map(),
    readStats: async (_db, input) => {
      const starters = input.frozenTournament!.players
      const missed = missingStats && input.leagueId === blockedRoom
      const contributions = [...new Set(starters.map(player => player.rosterId))].map((id): HistoricalContribution => {
        const player = starters.find(starter => starter.rosterId === id)!
        const seed = Number(rosterOwners.get(id)!.slice(-3))
        const tiedSeed = qualificationFixture ? 7 : 65
        const inTieWindow = qualificationFixture ? input.week <= config.firstCutWeek : input.week === 1
        const base = 200 - (inTieWindow && seed === tiedSeed ? tiedSeed - 1 : seed)
        const points = base + ((!qualificationFixture || verifyReports) && input.week === 1 && seed === 64 && corrected ? 0.5 : 0)
        return { player, gameId: 'test-game:' + input.week,
          gameStartsAt: input.frozenTournament!.startsAt.getTime() + 3600_000,
          stats: sport === 'NFL' ? { pass_yds: points } : { pts: points },
        }
      })
      return { contributions, eligible: starters, missingPlayerIds: missed ? [starters[0]!.playerId] : [],
        slateFinal: !missed, correctionsReady: !missed, end: input.frozenTournament!.endsAt,
      }
    },
  }
  const release = (freezeId: string, key: string) => releaseSeasonOpeningDraft(owner, tournamentId, freezeId, key, {
    reviewSchedule: async () => ({ currentCoverageReady: true, changes: [], checkedAt: new Date().toISOString(), pendingGames: 0 }),
    refreshPool: deps.refreshDraft,
  })
  const tick = async (now: Date) => {
    const result = await runSeasonTournament(tournamentId, now, deps)
    assert.deepEqual(result.errors, [])
    return result
  }
  const groups: number[] = []
  let appliedCorrection: Awaited<ReturnType<typeof verifyCorrectionBeforeIssue>> | undefined
  let protectedDraftVerified = false
  for (const draft of config.rules.calendar.drafts) {
    const field = await loadSeasonStage(tournamentId, draft.stage)
    assert(field)
    const ids = field.manifest.leagues.map(pool => seasonResourceId(field.id, pool.key))
    groups.push(ids.length)
    const stage = plan.stages[draft.stage - 1]!
    const firstWeek = stage.startWeek
    assert.equal(ids.length, stage.leagueCount)
    if (qualificationFixture && draft.stage > 1) {
      for (const pool of field.manifest.leagues) {
        const seeds = pool.members.map(member => member.previousSeed!)
        assert.deepEqual(seeds, [...seeds].sort((a, b) => b - a))
      }
    }
    const windows = new Map(field.manifest.leagues.map((pool, i) => [ids[i]!, resolveSeasonDraftWindow(config.rules.calendar, draft.stage, pool)!]))
    const starts = [...new Set([...windows.values()].map(window => Date.parse(window.startsAt)))].sort((a, b) => a - b)
    assert.equal(starts.length, staggered ? [3, 2, 1][draft.stage - 1] : 1)
    const reminderAt = new Date(starts[0]! - 1000)
    await tick(reminderAt)
    if (draft.stage === 1) {
      assert.equal(await prisma.draftSession.count({ where: { leagueId: { in: ids }, status: 'tournament_setup_blocked' } }), ids.length)
      await tick(new Date(starts[0]!))
      assert.equal(await prisma.draftSession.count({ where: { leagueId: { in: ids }, status: 'in_progress' } }), 0)
      for (const [index, pool] of field.manifest.leagues.entries()) {
        if (ids[index] === blockedRoom) await assert.rejects(release(field.id, pool.key), /player pool is not ready/)
        else assert.equal((await release(field.id, pool.key)).released, true)
      }
      const expected = [...windows.values()].filter(window => Date.parse(window.startsAt) === starts[0]).length
      const releasedDue = expected - Number(Date.parse(windows.get(blockedRoom)!.startsAt) === starts[0])
      await tick(reminderAt)
      assert.equal(reminders.size, Math.max(0, releasedDue - 1))
      await tick(reminderAt)
      await tick(reminderAt)
      assert.equal(reminders.size, releasedDue)
    }
    const countDrafts = (status: string) => prisma.draftSession.count({ where: { leagueId: { in: ids }, status } })
    assert.equal(await countDrafts('tournament_setup_blocked') + await countDrafts('pre_draft'), ids.length)
    const scores = ids.map(seasonScoringId)
    if (staggered) {
      const bindings = await prisma.tournamentLeague.findMany({ where: { tournamentId, leagueId: { in: ids } }, include: { conference: true } })
      const settings = await prisma.leagueSettings.findMany({ where: { leagueId: { in: ids } } })
      assert.equal(bindings.length, ids.length)
      assert.equal(settings.length, ids.length)
      for (const binding of bindings) {
        const pool: SeasonStageManifest['leagues'][number] = field.manifest.leagues.find(room => room.key === binding.slug)!
        const window = windows.get(binding.leagueId!)!
        assert.equal(binding.conference?.name ?? null, pool.division)
        assert.equal(binding.draftScheduledAt?.getTime(), Date.parse(window.startsAt))
        assert.equal(settings.find(row => row.leagueId === binding.leagueId)?.draftDateUtc?.getTime(), Date.parse(window.startsAt))
        const entrant = await loadSeasonEntry(pool.members[0]!.userId, tournamentId)
        assert.equal(entrant?.assignment?.startsAt, window.startsAt)
        assert.equal(entrant?.assignment?.completeBy, window.completeBy)
      }
      if (draft.stage === 1) {
        assert.equal(await prisma.tournamentConference.count({ where: { tournamentId } }), 2)
        assert.equal(await prisma.tournamentParticipant.count({ where: { tournamentId, currentConferenceId: { not: null }, originalConferenceId: { not: null } } }), managers.length)
      } else {
        assert.equal(await prisma.tournamentParticipant.count({ where: { tournamentId, currentRoundNumber: draft.stage, currentConferenceId: null, originalConferenceId: { not: null } } }), stage.participants)
      }
    }
    let future = ids.length
    for (const start of starts) {
      const due = ids.filter(id => Date.parse(windows.get(id)!.startsAt) === start)
      const date = new Date(start)
      const outage = missingPool && due.includes(blockedRoom)
      const waitForDrafts = async (status: string, expected: number, now: Date) => {
        for (let retry = 0; retry < 5 && await countDrafts(status) < expected; retry++) await tick(now)
        assert.equal(await countDrafts(status), expected)
      }
      if (outage) {
        await tick(date)
        await waitForDrafts('in_progress', due.length - 1, date)
        missingPool = false
        const pool: SeasonStageManifest['leagues'][number] = field.manifest.leagues.find((_, index) => ids[index] === blockedRoom)!
        assert.equal((await release(field.id, pool.key)).released, true)
        assert.equal((await release(field.id, pool.key)).repeated, true)
      }
      await waitForDrafts('in_progress', due.length, date)
      future -= due.length
      assert.equal(await countDrafts('tournament_setup_blocked') + await countDrafts('pre_draft'), future)
      const sessions = await prisma.draftSession.findMany({ where: { leagueId: { in: due } } })
      const late = missDeadline && future === 0 ? sessions[0] : undefined
      const completedAt = new Date(start + 1000)
      for (const session of sessions) {
        assert.equal(session.startedAt?.getTime(), start)
        const order = session.slotOrder as { slot: number; rosterId: string }[]
        const pickedAt = session.id === late?.id ? new Date(Date.parse(windows.get(session.leagueId)!.completeBy) + 1000) : completedAt
        const picks = positions.flatMap((position, round) => Array.from({ length: session.teamCount }, (_, i) => {
          const player = players[round * playerPoolWidth + i]!, slot = round % 2 ? session.teamCount - i : i + 1
          return { sessionId: session.id, overall: round * session.teamCount + i + 1, round: round + 1, slot,
            rosterId: order.find(entry => entry.slot === slot)!.rosterId, playerId: player.playerId,
            playerName: player.playerName, position, team: player.team, pickedAt,
          }
        }))
        let existingPicks = 0
        if (verifyRecovery && draft.stage === 2 && !protectedDraftVerified) {
          assert(appliedCorrection)
          const pick = picks[0]!
          await prisma.draftPick.create({ data: pick })
          existingPicks = 1
          await verifyIssuedRoomRecovery({
            tournamentId, owner, score: appliedCorrection, leagueId: session.leagueId, sessionId: session.id,
            rosterId: pick.rosterId, player: pick, now: completedAt, refresh: deps.refreshDraft!, tick,
          })
          protectedDraftVerified = true
        }
        assert.equal((await prisma.draftPick.createMany({ data: picks, skipDuplicates: true })).count, session.teamCount * positions.length - existingPicks)
        assert.equal((await prisma.draftPick.createMany({ data: picks, skipDuplicates: true })).count, 0)
      }
      await Promise.all([tick(completedAt), tick(completedAt)])
      await waitForDrafts('completed', ids.length - future - Number(!!late), completedAt)
      assert.equal(await prisma.redraftSeason.count({ where: { id: { in: scores }, status: 'active' } }), 0)
      if (late) {
        const commonLock = new Date(config.rules.calendar.periods[firstWeek - 1]!.startsAt)
        assert.equal((await tick(commonLock)).advanced, false)
        assert.equal((await tick(commonLock)).advanced, false)
        assert.equal(await prisma.tournamentAuditLog.count({ where: { tournamentId, action: 'season_draft_deadline_missed', targetId: late.leagueId } }), 1)
        const planWithMissedDrafts = await loadSeasonBlueprint(tournamentId, owner)
        assert.deepEqual(planWithMissedDrafts?.missedDrafts, [{
          stage: 1, key: field.manifest.leagues[ids.indexOf(late.leagueId)]!.key, completeBy: windows.get(late.leagueId)!.completeBy,
        }])
        assert.equal(await prisma.redraftSeason.count({ where: { id: { in: scores }, status: 'active' } }), 0)
        assert.equal(await prisma.tournamentAuditLog.count({ where: { tournamentId, action: 'season_cut_finalized' } }), 0)
        return { sport, managers: managers.length, missedDeadline: 'held stage once across retries' }
      }
    }
    assert.equal(await prisma.tournamentAuditLog.count({ where: { tournamentId, action: 'season_draft_started', targetId: { in: ids } } }), ids.length)
    assert.equal(await prisma.tournamentAuditLog.count({ where: { tournamentId, action: 'season_draft_board_completed', targetId: { in: ids } } }), ids.length)
    const rosters = await prisma.redraftRoster.findMany({ where: { seasonId: { in: scores } }, include: { players: true } })
    assert.equal(rosters.length, stage.participants)
    assert(rosters.every(roster => roster.players.length === 5 && new Set(roster.players.map(p => p.slotType)).size === 5))
    for (const roster of rosters) rosterOwners.set(roster.id, roster.ownerId)
    assert.equal(await prisma.redraftSeason.count({ where: { id: { in: scores }, status: 'setup' } }), ids.length)

    console.error(sport + ' stage ' + draft.stage + ': completed ' + ids.length + ' drafts and materialized ' + rosters.length + ' rosters')
    let reviewedOpening: { leagueId: string; key: string; period: number; scores: SeasonScoreBatch['scores'] } | undefined
    if (verifyReports && draft.stage === 1) {
      const leagueId = ids[1]!, pool = field.manifest.leagues[1]!, period = config.rules.calendar.periods[stage.endWeek - 1]!
      const gameId = seasonResourceId(leagueId, 'fixture-reviewed-opening-game')
      const startsAt = new Date(Date.parse(period.startsAt) + hour).toISOString()
      const generic = await prisma.roster.findMany({ where: { leagueId }, select: { id: true, redraftRosterId: true, playerData: true } })
      const genericIds = new Map(generic.map(row => [row.redraftRosterId, row.id]))
      const games = await prisma.redraftMatchup.findMany({ where: { leagueId, week: period.number } })
      await captureSeasonOpeningMatchups(leagueId, { period: period.number, source: 'isolated-fixture', pairs: games.map(game => ({
        homeRosterId: genericIds.get(game.homeRosterId)!, awayRosterId: genericIds.get(game.awayRosterId)!,
      })) })
      const scores = generic.flatMap(row => {
        const seed = Number(rosterOwners.get(row.redraftRosterId!)!.slice(-3))
        const { starters } = row.playerData as { starters: string[] }
        return starters.map((playerId, index) => ({ gameId, playerId, revision: 1, status: 'final' as const, points: index === 0 ? 200 - seed : 0 }))
      })
      await captureSeasonOpeningLineup(leagueId, { gameId, startsAt, playerIds: scores.map(row => row.playerId) })
      for (const [offset, state] of [[-60_000, 'not_started'], [60_000, 'in_progress']] as const) {
        const observedAt = new Date(Date.parse(startsAt) + offset).toISOString()
        const payload = { version: 1, manifestHash: field.manifest.manifestHash, rulesHash: field.manifest.rulesHash,
          providerGameId: gameId, sport, state, observedAt, scheduledAt: startsAt, rawDigest: seasonContractHash({ gameId, state, observedAt }) }
        await prisma.tournamentAuditLog.create({ data: {
          tournamentId, action: 'season_game_start_observed', actorType: 'system', targetType: 'game', targetId: gameId,
          data: { ...payload, digest: seasonContractHash(payload) }, createdAt: new Date(observedAt),
        } })
      }
      reviewedOpening = { leagueId, key: pool.key, period: period.number, scores }
    }
    const scoring = config.rules.calendar.periods[firstWeek - 1]!
    assert.equal((await tick(new Date(scoring.startsAt))).advanced, true)
    const periods = config.rules.calendar.periods.filter(period => period.number >= firstWeek && period.number <= stage.endWeek)
    if (draft.stage === 1) {
      const liveAt = new Date(Date.parse(scoring.startsAt) + 2 * hour)
      await tick(liveAt)
      const live = await loadSeasonLiveCut(tournamentId, { staff: true, entrantId: null }, liveAt)
      assert.equal(live?.through, firstWeek)
      if (!live?.pending) assert.equal(live?.rows.length, managers.length)
      const member = field.manifest.leagues[0]!.members[0]!
      const own = await loadSeasonLiveCut(tournamentId, { staff: false, entrantId: member.id }, liveAt)
      if (!own?.pending) assert.equal(own?.rows.length, field.manifest.leagues[0]!.slots)
      assert.equal(await loadSeasonLiveCut(tournamentId, { staff: false, entrantId: 'outside' }, liveAt), null)
      const policy = await readSeasonTradePolicy(prisma, ids[0]!)
      assert(policy)
      const cutoff = new Date(policy.acceptanceDeadline)
      assert.equal(seasonTradeOfferExpiry(policy, new Date(policy.cutAt), new Date(cutoff.getTime() - 1)).getTime(), cutoff.getTime())
      assert.throws(() => seasonTradeOfferExpiry(policy, new Date(policy.cutAt), cutoff), /trade deadline/)
      const [a, b] = rosters.filter(roster => roster.leagueId === ids[0])
      assert(a && b)
      const first = a.players[0]!
      const second = b.players.find(player => player.position === first.position)!
      const traded = await prisma.$transaction(async tx => settleRedraftTradeAssets(tx, {
        proposerRosterId: a.id, receiverRosterId: b.id, seasonTrade: await readSeasonTradePolicy(tx, a.leagueId, true),
        assets: [
          { fromRosterId: a.id, toRosterId: b.id, assetType: 'player', playerId: first.playerId },
          { fromRosterId: b.id, toRosterId: a.id, assetType: 'player', playerId: second.playerId },
        ],
      }))
      assert.equal(traded.playersMoved, 2)
      assert.equal((await prisma.redraftRosterPlayer.findUniqueOrThrow({ where: { id: first.id } })).rosterId, b.id)
      const flag = { action: 'flag', leagueId: rosters[0]!.leagueId, rosterId: rosters[0]!.id, type: 'roster_dumping', reason: 'Synthetic repeated drops to review' }
      await Promise.all([updateSeasonIntegrity(tournamentId, operator, flag), updateSeasonIntegrity(tournamentId, operator, flag)])
      const signals = await loadSeasonIntegrity(tournamentId, owner)
      assert.equal(signals.flags.length, 1)
      const review = { action: 'review', flagId: signals.flags[0]!.id, reason: 'Synthetic owner review completed' }
      await assert.rejects(updateSeasonIntegrity(tournamentId, operator, review), { status: 404 })
      await updateSeasonIntegrity(tournamentId, owner, review)
      assert.equal((await loadSeasonIntegrity(tournamentId, owner)).flags[0]?.status, 'reviewed')
      await removeBlueprintStaff(owner, tournamentId, operator)
      await assert.rejects(loadSeasonIntegrity(tournamentId, operator), { status: 404 })
    }
    for (const period of periods) {
      if (period.number === 1) {
        assert.equal((await tick(new Date(period.endsAt))).advanced, false)
        assert.equal(await prisma.redraftMatchup.count({ where: { seasonId: { in: scores }, week: 1, status: 'final' } }), 0)
        corrected = true
        if (verifyReports) {
          const correctionAt = new Date(Date.parse(period.endsAt) + 1000)
          await tick(correctionAt)
          await tick(correctionAt)
          await verifyProvisionalReports(tournamentId, correctionAt)
        }
        missingStats = true
        assert.equal((await tick(new Date(period.finalizesAt))).advanced, false)
        assert.equal(await prisma.redraftMatchup.count({ where: { leagueId: blockedRoom, week: 1, status: 'final' } }), 0)
        if (verifyRecovery) {
          await verifyScoringDelay(tournamentId, owner, blockedRoom, false)
          await tick(new Date(period.finalizesAt))
          await verifyScoringDelay(tournamentId, owner, blockedRoom, false)
        }
        missingStats = false
      }
      const closing = new Date(period.finalizesAt)
      if (reviewedOpening?.period === period.number) {
        await tick(closing)
        assert.equal(await prisma.redraftMatchup.count({ where: { leagueId: reviewedOpening.leagueId, week: period.number, status: 'final' } }), 0)
        const clock = mock.method(Date, 'now', () => closing.getTime())
        try {
          const batch = { requestId: 'isolated-fixture', expectedRevision: 0, period: period.number, source: 'isolated-fixture',
            observedAt: closing.toISOString(), coverage: 'complete' as const, scores: reviewedOpening.scores }
          assert.equal((await ingestSeasonOpeningScores(reviewedOpening.leagueId, batch)).revision, 1)
          assert.equal((await ingestSeasonOpeningScores(reviewedOpening.leagueId, batch)).repeated, true)
          const review = await reviewSeasonOpeningWeek(owner, tournamentId, field.id, reviewedOpening.key, period.number)
          assert(review.canFinalize && review.reviewToken)
          assert.equal((await finalizeSeasonOpeningWeek(owner, tournamentId, field.id, reviewedOpening.key, period.number, review.revision, review.reviewToken)).finalized, true)
        } finally {
          clock.mock.restore()
        }
      }
      const attempts = await Promise.all([tick(closing), tick(closing)])
      const advances = draft.stage === 3 || period.number === stage.endWeek ? 1 : 0
      const finalCount = stage.sizes.reduce((sum, size) => sum + Math.ceil(size / 2), 0)
      for (let retry = 0; retry < 5; retry++) {
        const settled = await prisma.redraftMatchup.count({ where: { seasonId: { in: scores }, week: period.number, status: 'final' } })
        if (settled === finalCount && attempts.filter(attempt => attempt.advanced).length === advances) break
        attempts.push(await tick(closing))
      }
      assert.equal(attempts.filter(attempt => attempt.advanced).length, advances)
      // A sweep after the cut can provision the next stage. Open the recovery review first.
      if (!verifyRecovery || period.number !== 1) assert.equal((await tick(closing)).advanced, false)
      assert.equal(await prisma.redraftMatchup.count({ where: { seasonId: { in: scores }, week: period.number, status: 'final' } }), finalCount)
      const official: Awaited<ReturnType<typeof readSeasonLiveScores>> = await prisma.$transaction(tx => readSeasonLiveScores(tx, ids, [period.number], field.manifest.manifestHash, draft.stage))
      assert.equal(official.size, ids.length, 'Every final league period is backed by the production score ledger.')
      if (reviewedOpening?.period === period.number) {
        assert.equal(official.get(reviewedOpening.leagueId + ':' + period.number)?.proof.source, 'reviewed_opening')
      }
      assert.equal([...official.values()].reduce((sum, receipt) => sum + receipt.scores.length, 0), stage.participants)
      if (verifyRecovery && period.number === 1) {
        await verifyScoringDelay(tournamentId, owner, blockedRoom, true)
        appliedCorrection = await verifyCorrectionBeforeIssue(tournamentId, owner, closing, tick)
      }
    }
  }
  if (verifyRecovery) assert(protectedDraftVerified)
  const champion = await prisma.tournamentParticipant.findFirstOrThrow({ where: { tournamentId, status: 'champion' } })
  assert.equal(champion.userId, managers[0])
  assert.equal(await prisma.tournamentParticipant.count({ where: { tournamentId, status: 'eliminated' } }), managers.length - (verifyRecovery ? 2 : 1))
  const cutEvents = await prisma.tournamentAuditLog.findMany({ where: { tournamentId, action: 'season_cut_finalized' }, orderBy: { createdAt: 'asc' } })
  assert.equal(cutEvents.length, verifyRecovery ? 3 : 2)
  const cuts = [...new Map(cutEvents.map(event => [(event.data as { stage: number }).stage, event])).values()]
  assert.equal(cuts.length, 2)
  for (const [i, cut] of cuts.entries()) {
    const data = cut.data as {
      advancing: { seed: number; path?: string }[]
      standings: { id: string; pointsFor: number; rank: number }[]
      finalTieOrder?: string[]
    }
    const stage = plan.stages[i]!
    assert.equal(data.advancing.length, plan.stages[i + 1]!.participants)
    assert.deepEqual(data.advancing.map(entry => entry.seed), Array.from({ length: data.advancing.length }, (_, index) => index + 1))
    if (stage.qualification) {
      assert.equal(data.advancing.filter(entry => entry.path === 'automatic').length, stage.qualification.automaticPerLeague * stage.leagueCount)
      assert.equal(data.advancing.filter(entry => entry.path === 'wildcard').length, stage.qualification.wildcards)
      assert.equal(new Set(data.finalTieOrder).size, stage.participants)
      if (i === 0) {
        const tied = data.standings.filter(row => row.pointsFor === 194 * config.firstCutWeek)
        assert.equal(tied.length, 2)
        assert.equal(tied[1]!.rank - tied[0]!.rank, 1)
        assert(data.finalTieOrder!.indexOf(tied[0]!.id) < data.finalTieOrder!.indexOf(tied[1]!.id))
      }
    }
  }
  const bracket = await prisma.tournamentAuditLog.findMany({ where: { tournamentId, action: 'season_bracket_period_finalized' }, orderBy: { createdAt: 'asc' } })
  assert.equal(bracket.length, plan.bracketWeeks)
  const firstRound = bracket[0]!.data as { matches: { a: string | null; b: string | null; winner: string }[] }
  const byes = firstRound.matches.filter(match => match.a === null || match.b === null)
  assert.equal(byes.length, plan.byes)
  assert(byes.every(match => match.winner === (match.a ?? match.b)))
  assert.equal(await prisma.tournamentAuditLog.count({ where: { tournamentId, action: 'season_champion_crowned' } }), 1)
  assert.equal((await prisma.tournamentShell.findUniqueOrThrow({ where: { id: tournamentId } })).status, 'complete')
  const reports = verifyReports ? await verifyFinalReports(tournamentId, config.finalWeek, new Date(config.rules.calendar.periods.at(-1)!.finalizesAt)) : undefined
  return { sport, managers: managers.length, groups, staggered, ...(reports ? { reports } : {}),
    ...(verifyRecovery ? { recovery: ['short opening field', 'waitlist replacement', 'qualifier replacement', 'scoring outage and retry', 'approved score correction and reseed', 'issued-room hold and pick preservation'] } : {}),
    draftPicks: plan.stages.reduce((sum, stage) => sum + stage.participants * config.rosterSize, 0),
    cuts: cuts.map(cut => (cut.data as { advancing: unknown[] }).advancing.length), bracketRounds: bracket.length, bracketByes: byes.length, champion: champion.userId, retries: ['pool outage', 'missing scores', 'duplicate picks', 'concurrent completion and transitions'],
  }
}

async function verifyProvisionalReports(tournamentId: string, now: Date) {
  const staff = await getSeasonReportAccess(tournamentId, owner)
  const manager = await getSeasonReportAccess(tournamentId, managers[0]!)
  assert(staff?.canPost && manager && !manager.canPost)
  assert.equal(await getSeasonReportAccess(tournamentId, 'outside-the-tournament'), null)
  const versions = await listSeasonReportVersions(tournamentId, staff)
  assert.deepEqual(versions.map(report => [report.revision, report.status]), [[2, 'corrected'], [1, 'provisional']])
  assert.equal(versions[0]!.previousId, versions[1]!.id)
  const first = (await getSeasonReport(tournamentId, versions[1]!.id, staff))!
  const corrected = (await getSeasonReport(tournamentId, versions[0]!.id, staff))!
  const oldScore = first.rows.find(row => row.manager === managers[63])?.weekPoints
  const newScore = corrected.rows.find(row => row.manager === managers[63])?.weekPoints
  assert.equal(oldScore, 136)
  assert.equal(newScore, 136.5)
  const scoped = (await getSeasonReport(tournamentId, first.report.id, manager))!
  assert.equal(scoped.leagues.length, 1)
  assert(scoped.rows.length < first.rows.length)
  const outside = first.leagues.find(league => league.id !== scoped.leagues[0]!.id)!
  assert.equal(await getSeasonReport(tournamentId, first.report.id, manager, outside.id), null)
  assert(seasonReportCsv(first.report, scoped.rows).includes(first.report.id))
  assert(!seasonReportCsv(first.report, scoped.rows).includes(outside.name))
  assert.equal((await deliverSeasonReport(tournamentId, first.report.id, { scope: 'stage' }, now, managers[0])).ok, false)
  const north = first.leagues.filter(league => league.division === 'North')
  const audience = { scope: 'division', target: 'North' } as const
  const where = { messageSubtype: 'season_report', metadata: { path: ['reportId'], equals: first.report.id } }
  // Force the receipt write to fail after the chat insert on the isolated fixture database.
  const receiptId = seasonResourceId(first.report.id, 'league-chat-receipt:' + north[0]!.id)
  assert.match(receiptId, /^[a-f0-9-]+$/)
  await prisma.$executeRawUnsafe("ALTER TABLE tournament_shell_audit_logs ADD CONSTRAINT af_report_fixture_reject CHECK (id <> '" + receiptId + "') NOT VALID")
  try {
    await assert.rejects(deliverSeasonReport(tournamentId, first.report.id, audience, now, owner), /af_report_fixture_reject/)
    assert.equal(await prisma.leagueChatMessage.count({ where }), 0)
    assert.equal(await prisma.tournamentAuditLog.count({ where: { tournamentId, action: SEASON_REPORT_CHAT_RECEIPT, targetId: first.report.id } }), 0)
  } finally {
    await prisma.$executeRaw`ALTER TABLE tournament_shell_audit_logs DROP CONSTRAINT af_report_fixture_reject`
  }
  const retries = await Promise.all([
    deliverSeasonReport(tournamentId, first.report.id, audience, now, owner),
    deliverSeasonReport(tournamentId, first.report.id, { scope: 'league', target: north[0]!.id }, now, owner),
  ])
  assert(retries.every(result => result.ok))
  assert.equal(retries.reduce((count, result) => count + (result.ok ? result.posted : 0), 0), north.length)
  const delivered = await prisma.leagueChatMessage.findMany({ where })
  assert.deepEqual(delivered.map(message => message.leagueId).sort(), north.map(league => league.id).sort())
  assert(delivered.every(message => message.message.includes(first.report.id)))
}

async function verifyFinalReports(tournamentId: string, finalWeek: number, now: Date) {
  const ownerAccess = (await getSeasonReportAccess(tournamentId, owner))!
  const versions = await listSeasonReportVersions(tournamentId, ownerAccess)
  const finals = versions.filter(report => report.status === 'final')
  assert.deepEqual(finals.map(report => report.period), Array.from({ length: finalWeek }, (_, index) => finalWeek - index))
  const reports = await prisma.tournamentAuditLog.findMany({ where: { tournamentId, action: SEASON_REPORT_PUBLISHED } })
  const snapshots = reports.map(event => ({ ...(event.data as object), id: event.id }) as SeasonReport)
  const weekly = snapshots.find(report => report.status === 'final' && report.period === 1)!
  assert.equal(weekly.decisionId, null)
  assert(weekly.rows.some(row => row.standing === 'In'))
  assert(weekly.rows.some(row => row.standing === 'Bubble'))
  const cut = snapshots.find(report => report.status === 'final' && report.stage === 1 && report.decisionId)!
  assert.equal(cut.rows.filter(row => row.standing === 'Advanced').length, qualificationFixture ? 50 : 64)
  const champion = snapshots.find(report => report.status === 'final' && report.period === finalWeek)!
  assert(champion.decisionId)
  assert.equal(champion.rows.find(row => row.standing === 'Champion')?.manager, managers[0])
  const expected = snapshots.reduce((count, report) => count + report.leagues.length, 0)
  for (let retry = 0; retry < 20; retry++) {
    const delivery = await deliverPendingSeasonReports(now)
    assert.deepEqual(delivery.errors, [])
    if (!delivery.posted) break
  }
  const receipts = await prisma.tournamentAuditLog.findMany({ where: { tournamentId, action: SEASON_REPORT_CHAT_RECEIPT } })
  assert.equal(receipts.length, expected)
  const messages = await prisma.leagueChatMessage.findMany({
    where: { id: { in: receipts.map(receipt => (receipt.data as { messageId: string }).messageId) } },
  })
  assert.equal(messages.length, expected)
  assert.equal(new Set(messages.map(message => JSON.stringify([(message.metadata as { reportId: string }).reportId, message.leagueId]))).size, expected)
  assert.equal((await deliverPendingSeasonReports(now)).posted, 0)
  return { versions: versions.length, finals: finals.length, chatPosts: expected, retries: ['rolled-back receipt write', 'overlapping division and league', 'outbox after championship'] }
}

async function main() {
  assertIsolatedConnection()
  process.env.TOURNAMENT_DRAFT_RELEASE_ENABLED = 'true'
  assert(!verifyReports || staggered, '--reports requires --staggered for division targeting')
  assert(!verifyReports || !verifyRecovery, 'Run report and recovery scenarios separately.')
  const role = await prisma.$queryRaw<{ user: string; db: string }[]>`SELECT current_user AS "user", current_database() AS db`
  assert.deepEqual(role, [{ user: 'af_tournament_audit', db: 'tournament_prod_port' }])
  await prisma.tenant.upsert({ where: { id: tenant }, update: {}, create: { id: tenant, slug: tenant, name: 'Native P0 Audit' } })
  await prisma.appUser.createMany({ data: [owner, operator, ...managers, ...(verifyRecovery ? reserves : [])].map(id => ({ id, username: id, email: id + '@example.invalid' })), skipDuplicates: true })
  for (const sport of ['NFL', 'NBA'] as const) {
    console.error('Running ' + managers.length + '-manager ' + sport + ' lifecycle')
    console.log(JSON.stringify(await run(sport)))
  }
  if (staggered && !verifyReports && !verifyRecovery) console.log(JSON.stringify(await run('NFL', true)))
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  await Promise.all([prisma.$disconnect(), disconnect()])
})
