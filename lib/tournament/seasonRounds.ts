import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createSeasonTournamentLeague, ensureSeasonConference, seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { createActorContext } from '@/lib/domain/actorContext'
import { withTenant } from '@/lib/domain/db'
import { resolveDeploymentTenantId } from '@/lib/domain/deploymentTenant'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { buildSeasonBlueprint, buildSeededBracket } from './seasonBlueprint'
import { seasonContractHash } from './seasonCalendarVerification'
import { seasonScoringId } from './seasonDraftHandoff'
import { buildSeasonLeagueLayout } from './seasonLeagueLayout'
import { resolveSeasonDraftWindow } from './seasonRules'
import { readSeasonStageManifest, type SeasonStageManifest } from './seasonNativeContract'
import { computeSeasonTournamentStandings, previewSeasonTournamentCut } from './seasonTournamentStandings'
import { readFinalSeasonStageScores, type SeasonStageScore } from './seasonStageScores'
import { currentSeasonOpeningField, newestSeasonEvent, seasonRecoveryHeld } from './seasonRecoveryState'
import { publishSeasonStageReports, SEASON_BRACKET_PERIOD_FINALIZED, SEASON_CUT_FINALIZED, type SeasonBracketMatch } from './seasonReportPublication'

const stageFieldId = (id: string, stage: number) => seasonResourceId(id, 'season-field:' + stage)

export function frozenTieOrder(manifest: SeasonStageManifest) {
  if (manifest.config.competition?.finalTiebreaker !== 'frozen_draw') return undefined
  return manifest.leagues.flatMap(league => league.members.map(({ id }) => ({
    id, draw: seasonContractHash([manifest.manifestHash, id]),
  }))).sort((a, b) => a.draw.localeCompare(b.draw) || a.id.localeCompare(b.id)).map(entry => entry.id)
}

export async function loadSeasonStage(
  tournamentId: string, stage: number,
  db: Pick<Prisma.TransactionClient, 'tournamentAuditLog'> = prisma,
): Promise<{ id: string; manifest: SeasonStageManifest } | null> {
  const event = stage === 1 ? await currentSeasonOpeningField(db, tournamentId) : await db.tournamentAuditLog.findFirst({
    where: { tournamentId, action: 'season_stage_field_frozen', targetId: String(stage) }, orderBy: newestSeasonEvent,
  })
  if (!event) return null
  const { manifestHash, ...payload } = event.data as Record<string, unknown>
  if (seasonContractHash(payload) !== manifestHash) throw new Error('Tournament field checksum does not match.')
  const manifest = readSeasonStageManifest(event.data)
  if ((manifest.stage ?? 1) !== stage) throw new Error('Tournament stage binding does not match its field.')
  return { id: event.id, manifest }
}

export async function lockSeasonShell(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM tournament_shells WHERE id = ${id} FOR UPDATE`
  return tx.tournamentShell.findUnique({ where: { id } })
}

export async function provisionSeasonStage(tournamentId: string, stage: number, now: Date) {
  const field = await loadSeasonStage(tournamentId, stage)
  if (!field) return null
  const { manifest, id: freezeId } = field
  const calendar = manifest.config.rules!.calendar
  const known = await prisma.tournamentLeague.findMany({
    where: { tournamentId, round: { roundNumber: stage } }, select: { slug: true, conferenceId: true },
  })
  const existing = new Map(known.map(league => [league.slug, league]))
  const missing = manifest.leagues.filter(pool => !existing.has(pool.key) && now.getTime() < Date.parse(resolveSeasonDraftWindow(calendar, stage, pool)!.completeBy))
  const missingDivisions = manifest.leagues.filter(pool => pool.division && existing.get(pool.key)?.conferenceId === null)
  if (missing.length) {
    const tenant = resolveDeploymentTenantId()
    if (!tenant.ok) throw new Error('Tournament provisioning needs a configured tenant.')
    for (const pool of missing) {
      await withTenant(tenant.value, async tx => {
        const shell = await lockSeasonShell(tx, tournamentId)
        if (shell?.status !== 'rules_published' || Math.max(1, shell.currentRoundNumber) !== stage) return
        if (await seasonRecoveryHeld(tx, tournamentId) || (await loadSeasonStage(tournamentId, stage, tx))?.id !== freezeId) return
        if (await tx.tournamentLeague.findUnique({ where: { tournamentId_slug: { tournamentId, slug: pool.key } } })) return
        const actor = createActorContext({ userId: shell.commissionerId, actorLabel: shell.commissionerId, tenantId: tenant.value, leagueRole: 'COMMISSIONER' })
        if (!actor.ok) throw new Error('Tournament owner could not be resolved.')
        const result = await createSeasonTournamentLeague(tx, actor.value, tournamentId, freezeId, manifest, pool.key)
        await tx.tournamentAuditLog.create({ data: {
          id: seasonResourceId(result.leagueId, 'provisioned'), tournamentId, actorType: 'system',
          action: stage === 1 ? 'season_opening_league_provisioned' : 'season_stage_league_provisioned',
          targetType: 'opening_league', targetId: pool.key,
          data: { ...result, freezeId, tenantId: tenant.value },
        } })
      })
    }
  }
  await prisma.$transaction(async tx => {
    const shell = await lockSeasonShell(tx, tournamentId)
    if (shell?.status !== 'rules_published' || Math.max(1, shell.currentRoundNumber) !== stage) return
    if (await seasonRecoveryHeld(tx, tournamentId) || (await loadSeasonStage(tournamentId, stage, tx))?.id !== freezeId) return
    const round = await tx.tournamentRound.findUnique({
      where: { tournamentId_roundNumber: { tournamentId, roundNumber: stage } }, include: { leagues: true },
    })
    if (!round?.leagues.length) return
    for (const pool of missingDivisions) {
      const league = round.leagues.find(row => row.slug === pool.key && row.leagueId === seasonResourceId(freezeId, pool.key))
      if (!league || league.conferenceId) continue
      const conferenceId = await ensureSeasonConference(tx, tournamentId, manifest.config.divisions, pool.division!)
      await tx.tournamentLeague.update({ where: { id: league.id }, data: { conferenceId } })
      await tx.tournamentParticipant.updateMany({
        where: { tournamentId, currentLeagueId: league.id, id: { in: pool.members.map(member => member.id) } },
        data: { currentConferenceId: conferenceId, originalConferenceId: conferenceId },
      })
    }
    if (round.status !== 'setup_blocked' || !round.leagues.every(league => manifest.leagues.some(pool =>
      league.slug === pool.key && league.leagueId === seasonResourceId(freezeId, pool.key) && league.currentTeamCount === pool.slots))) return
    await tx.tournamentRound.update({ where: { id: round.id }, data: { status: 'drafting' } })
    if (!shell.currentRoundNumber) await tx.tournamentShell.update({ where: { id: tournamentId }, data: { currentRoundNumber: 1 } })
  }, { maxWait: 5_000, timeout: 15_000 })
  return field
}

export async function activateSeasonStage(tournamentId: string, stage: number, scoringStartsAt: Date, now: Date) {
  if (now < scoringStartsAt) return false
  return prisma.$transaction(async tx => {
    const shell = await lockSeasonShell(tx, tournamentId)
    if (shell?.status !== 'rules_published' || shell.currentRoundNumber !== stage) return false
    const round = await tx.tournamentRound.findUnique({
      where: { tournamentId_roundNumber: { tournamentId, roundNumber: stage } }, include: { leagues: true },
    })
    if (round?.status !== 'drafting' || await seasonRecoveryHeld(tx, tournamentId)) return false
    const field = await loadSeasonStage(tournamentId, stage, tx)
    if (!field || round.leagues.length !== field.manifest.leagues.length || field.manifest.leagues.some(pool => {
      const league = round.leagues.find(row => row.slug === pool.key && row.leagueId === seasonResourceId(field.id, pool.key))
      return league?.status !== 'draft_ready' || !league.draftCompletedAt || league.draftCompletedAt > scoringStartsAt
    })) return false
    const leagueIds = round.leagues.map(league => league.leagueId!)
    const active = await tx.redraftSeason.updateMany({
      where: { id: { in: leagueIds.map(seasonScoringId) }, status: 'setup' }, data: { status: 'active' },
    })
    if (active.count !== leagueIds.length) throw new Error('A tournament league has no scoring schedule.')
    await tx.league.updateMany({ where: { id: { in: leagueIds } }, data: { lifecycleState: 'in_season', status: 'active', locked: false } })
    await tx.tournamentLeague.updateMany({ where: { roundId: round.id }, data: { status: 'active' } })
    await tx.tournamentRound.update({ where: { id: round.id }, data: { status: 'active', roundStartedAt: scoringStartsAt } })
    return true
  }, { maxWait: 5_000, timeout: 20_000 })
}

async function finishRound(tx: Prisma.TransactionClient, roundId: string, ids: string[], now: Date) {
  await tx.redraftSeason.updateMany({ where: { id: { in: ids.map(seasonScoringId) } }, data: { status: 'complete' } })
  await tx.league.updateMany({ where: { id: { in: ids } }, data: { lifecycleState: 'completed', status: 'complete', locked: true } })
  await tx.tournamentLeague.updateMany({ where: { roundId }, data: { status: 'complete' } })
  await tx.tournamentRound.update({ where: { id: roundId }, data: { status: 'complete', roundCompletedAt: now } })
}

export async function advanceSeasonStage(tournamentId: string, stage: number, now: Date) {
  return prisma.$transaction(async tx => {
    const shell = await lockSeasonShell(tx, tournamentId)
    if (shell?.status !== 'rules_published' || shell.currentRoundNumber !== stage) return false
    const field = await loadSeasonStage(tournamentId, stage, tx)
    const round = await tx.tournamentRound.findUnique({
      where: { tournamentId_roundNumber: { tournamentId, roundNumber: stage } }, include: { leagues: true },
    })
    if (!field || round?.status !== 'active' || round.leagues.length !== field.manifest.leagues.length || await seasonRecoveryHeld(tx, tournamentId)) return false
    const { manifest } = field
    const periodRules = manifest.config.rules!.calendar.periods.filter(p => p.number >= round.weekStart && p.number <= round.weekEnd)
    const leagueIds = round.leagues.map(league => league.leagueId!)
    const finalTieOrder = frozenTieOrder(manifest)
    const advanced = stage === 3
      ? await advanceBracket(tx, tournamentId, round.id, leagueIds, manifest, periodRules, now, finalTieOrder)
      : await advanceQualifier(tx, tournamentId, stage, round.id, leagueIds, field, periodRules, now, finalTieOrder)
    await publishSeasonStageReports(tx, { tournamentId, roundId: round.id, freezeId: field.id, manifest, leagueIds, periodRules, finalTieOrder, now })
    return advanced
  }, { timeout: 25_000 })
}

async function advanceQualifier(
  tx: Prisma.TransactionClient, tournamentId: string, stage: number, roundId: string, leagueIds: string[],
  field: { id: string; manifest: SeasonStageManifest }, periodRules: { number: number; finalizesAt: string }[],
  now: Date, finalTieOrder?: string[],
) {
  const { manifest } = field
  if (periodRules.some(period => now.getTime() < Date.parse(period.finalizesAt))) return false
  const periods = periodRules.map(p => p.number)
  const results = await readFinalSeasonStageScores(tx, manifest, leagueIds, periods)
  if (!results) return false
  const decision = calculateSeasonQualifierCut(field, periods, results, finalTieOrder)
  if (!decision.cut.ok) return false
  await commitSeasonQualifierCut(tx, tournamentId, roundId, field, { ...decision, cut: decision.cut }, now)
  await tx.tournamentParticipant.updateMany({ where: { tournamentId, id: { in: decision.members.map(member => member.id) } }, data: { totalRoundsPlayed: stage } })
  await finishRound(tx, roundId, leagueIds, now)
  await tx.tournamentShell.update({ where: { id: tournamentId }, data: { currentRoundNumber: stage + 1 } })
  return true
}

export function calculateSeasonQualifierCut(
  field: { id: string; manifest: SeasonStageManifest }, periods: number[], results: SeasonStageScore[],
  finalTieOrder = frozenTieOrder(field.manifest), project = false,
) {
  const { manifest } = field
  const stage = manifest.stage ?? 1
  const members = manifest.leagues.flatMap(pool => pool.members.map(member => ({
    ...member, leagueId: seasonResourceId(field.id, pool.key), previousSeed: member.previousSeed ?? null,
  })))
  const qualification = buildSeasonBlueprint(manifest.config).stages[stage - 1]!.qualification
  const board = computeSeasonTournamentStandings({
    stageId: String(stage), entrants: members, periods, results, tiebreakers: manifest.config.tiebreakers,
    compareWinRate: !!qualification, finalTieOrder,
  })
  const cut = previewSeasonTournamentCut(project ? { ...board, scoresFinal: true } : board, qualification)
  return { members, qualification, finalTieOrder, board, cut, periods, results }
}

type QualifierDecision = ReturnType<typeof calculateSeasonQualifierCut>
export async function commitSeasonQualifierCut(
  tx: Prisma.TransactionClient, tournamentId: string, roundId: string, field: { id: string; manifest: SeasonStageManifest },
  decision: Omit<QualifierDecision, 'cut'> & { cut: Extract<QualifierDecision['cut'], { ok: true }> },
  now: Date, correction?: { id: string; priorCutId: string; priorFieldId: string; replaceField: boolean },
) {
  const { manifest } = field
  const stage = manifest.stage ?? 1
  const { members, cut, periods, results, board, qualification, finalTieOrder } = decision
  const next = stage + 1
  const layout = buildSeasonLeagueLayout(manifest.config)[stage]!.leagues
  const byId = new Map(members.map(member => [member.id, member]))
  const bySeed = new Map(cut.advancing.map(({ entrantId, seed }) => [seed, byId.get(entrantId)!]))
  const payload = {
    version: 1, algorithm: 'serpentine_v1', hashAlgorithm: 'canonical_sha256_v1',
    stage: next, publicationId: manifest.publicationId, rulesHash: manifest.rulesHash, config: manifest.config,
    leagues: layout.map(({ key, name, division, slots, seeds }) => ({ key, name, division, slots,
      members: seeds.map((seed, i) => {
        const { id, userId, displayName, avatarUrl } = bySeed.get(seed)!
        return { id, userId, displayName, avatarUrl, previousSeed: seed, draftSlot: i + 1, waiverPriority: slots - i }
      }),
    })),
  }
  const data = { ...payload, manifestHash: seasonContractHash(payload) }
  readSeasonStageManifest(data)
  await tx.tournamentAuditLog.createMany({ data: [
    { id: seasonResourceId(roundId, correction ? 'cut:' + correction.id : 'cut'), tournamentId, roundNumber: stage, actorType: 'system', action: SEASON_CUT_FINALIZED, targetType: 'round', targetId: roundId,
      createdAt: now, data: toPrismaJsonInput({ stage, periods, results, standings: board.rows, ...(qualification ? { qualification } : {}), ...(finalTieOrder ? { finalTieOrder } : {}), ...(correction ? { correctionId: correction.id, supersedes: correction.priorCutId, priorFieldId: correction.priorFieldId } : {}), ...cut }) },
    ...(!correction || correction.replaceField ? [{
      id: correction ? seasonResourceId(correction.id, 'revised-field') : stageFieldId(tournamentId, next),
      tournamentId, actorType: 'system', action: 'season_stage_field_frozen', targetType: 'round', targetId: String(next),
      createdAt: now, data: toPrismaJsonInput(data),
    }] : []),
  ] })
  const advanced = cut.advancing.map(item => item.entrantId)
  await tx.tournamentLeagueParticipant.updateMany({ where: { league: { roundId: roundId }, participantId: { in: advanced } }, data: { advancementStatus: 'advanced', completedAt: now } })
  await tx.tournamentLeagueParticipant.updateMany({ where: { league: { roundId: roundId }, participantId: { in: cut.eliminated } }, data: { advancementStatus: 'eliminated', completedAt: now } })
  await tx.tournamentParticipant.updateMany({ where: { tournamentId, id: { in: cut.eliminated } }, data: { status: 'eliminated' } })
  if (correction?.replaceField) await tx.tournamentParticipant.updateMany({
    where: { tournamentId, id: { in: advanced } }, data: { status: 'registered' },
  })
}

async function advanceBracket(tx: Prisma.TransactionClient, tournamentId: string, roundId: string, leagueIds: string[], manifest: SeasonStageManifest, periods: { number: number; finalizesAt: string }[], now: Date, finalTieOrder?: string[]) {
  const prior = await tx.tournamentAuditLog.findMany({
    where: { tournamentId, action: SEASON_BRACKET_PERIOD_FINALIZED, targetId: roundId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const completed = prior.map(event => event.data as { period: number; matches: SeasonBracketMatch[] }).sort((a, b) => a.period - b.period)
  if (completed.some((event, index) => event.period !== periods[index]?.number)) throw new Error('Tournament bracket period sequence is invalid.')
  const period = periods[completed.length]
  if (!period || now.getTime() < Date.parse(period.finalizesAt)) return false
  const results = await readFinalSeasonStageScores(tx, manifest, leagueIds, [period.number])
  if (!results) return false
  const previous = completed.map(event => event.matches)
  const members = manifest.leagues.flatMap(pool => pool.members).sort((a, b) => a.previousSeed! - b.previousSeed!)
  const seeds = new Map(members.map(m => [m.id, m.previousSeed!]))
  const winners = previous.at(-1)?.map(match => match.winner)
  const pairs = winners ? Array.from({ length: winners.length / 2 }, (_, i) => [winners[i * 2]!, winners[i * 2 + 1]!] as const)
    : buildSeededBracket(members.map(m => m.id)).map(pair => [pair.teamA, pair.teamB] as const)
  const scores = new Map(results.map(result => [result.entrantId, result.points]))
  const drawRank = new Map(finalTieOrder?.map((id, index) => [id, index]))
  const compare = (a: string, b: string) => {
    const best = (id: string) => Math.max(scores.get(id)!, ...previous.flat().flatMap(match => match.a === id && match.aScore !== null ? [match.aScore] : match.b === id && match.bScore !== null ? [match.bScore] : []))
    const wins = (id: string) => {
      const played = previous.flat().filter(match => match.a && match.b && (match.a === id || match.b === id))
      const wins = played.filter(match => match.winner === id).length
      // A bracket bye must not lose the wins tiebreak for a new-format tournament.
      return manifest.config.competition ? (played.length ? wins / played.length : 1) : wins
    }
    for (const tiebreaker of manifest.config.tiebreakers) {
      const difference = tiebreaker === 'best_week' ? best(a) - best(b) : tiebreaker === 'wins' ? wins(a) - wins(b) : seeds.get(b)! - seeds.get(a)!
      if (difference) return difference
    }
    return finalTieOrder ? drawRank.get(b)! - drawRank.get(a)! : 0
  }
  const matches: SeasonBracketMatch[] = []
  for (const [a, b] of pairs) {
    const aScore = a ? scores.get(a)! : null, bScore = b ? scores.get(b)! : null
    const difference = a && b ? aScore! - bScore! || compare(a, b) : a ? 1 : -1
    const winner = difference > 0 ? a : difference < 0 ? b : null
    if (!winner) return false
    matches.push({ a, b, aScore, bScore, winner })
  }
  const losers = matches.flatMap(match => [match.a, match.b].filter((id): id is string => id !== null && id !== match.winner))
  await tx.tournamentAuditLog.create({ data: {
    id: seasonResourceId(roundId, 'bracket:' + period.number), tournamentId, actorType: 'system',
    action: SEASON_BRACKET_PERIOD_FINALIZED, targetType: 'round', targetId: roundId,
    createdAt: now, data: toPrismaJsonInput({ period: period.number, matches, ...(finalTieOrder ? { finalTieOrder } : {}) }),
  } })
  await tx.tournamentParticipant.updateMany({ where: { tournamentId, id: { in: losers } }, data: { status: 'eliminated', totalRoundsPlayed: 3 } })
  await tx.tournamentLeagueParticipant.updateMany({ where: { league: { roundId }, participantId: { in: losers } }, data: { advancementStatus: 'eliminated', completedAt: now } })
  if (matches.length === 1) {
    const championId = matches[0]!.winner
    await tx.tournamentParticipant.update({ where: { id: championId }, data: { status: 'champion', totalRoundsPlayed: 3 } })
    await tx.tournamentLeagueParticipant.updateMany({ where: { league: { roundId }, participantId: championId }, data: { advancementStatus: 'champion', completedAt: now } })
    await tx.tournamentAuditLog.create({ data: {
      id: seasonResourceId(tournamentId, 'champion'), tournamentId, actorType: 'system',
      action: 'season_champion_crowned', targetType: 'participant', targetId: championId,
      createdAt: now, data: toPrismaJsonInput({ period: period.number, championId, final: matches[0] }),
    } })
    await finishRound(tx, roundId, leagueIds, now)
    await tx.tournamentShell.update({ where: { id: tournamentId }, data: { status: 'complete' } })
  }
  return true
}
