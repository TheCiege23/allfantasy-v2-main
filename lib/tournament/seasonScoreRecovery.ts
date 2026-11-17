import 'server-only'
import { persistSeasonLiveScore } from './seasonScoreLedger'
import type { Prisma } from '@prisma/client'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { BlueprintOperationError } from './seasonBlueprintStore'
import { calculateSeasonQualifierCut, commitSeasonQualifierCut, frozenTieOrder, loadSeasonStage } from './seasonRounds'
import { SEASON_BRACKET_PERIOD_FINALIZED, SEASON_CUT_FINALIZED, publishSeasonStageReports, type SeasonCutDecision } from './seasonReportPublication'
import { readFinalSeasonStageScores } from './seasonStageScores'
import { resolveSeasonDraftWindow } from './seasonRules'
import { newestSeasonEvent } from './seasonRecoveryState'
import { rebuildSeasonLeagueStandings } from './seasonScoring'
import { seasonScoringId } from './seasonDraftHandoff'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import type { RecoveryImpact, ScoreCorrection } from './seasonRecoveryContract'

const conflict = (message: string) => new BlueprintOperationError(message, 409)
type Field = NonNullable<Awaited<ReturnType<typeof loadSeasonStage>>>

export function firstSeasonStageDraft(field: Field) {
  const stage = field.manifest.stage ?? 1
  const calendar = field.manifest.config.rules!.calendar
  return Math.min(...field.manifest.leagues.map(pool => Date.parse(resolveSeasonDraftWindow(calendar, stage, pool)!.startsAt)))
}

export async function inspectSeasonStageRooms(tx: Prisma.TransactionClient, tournamentId: string, stage: number) {
  const rooms = await tx.tournamentLeague.findMany({
    where: { tournamentId, round: { roundNumber: stage } },
    select: { draftSessionId: true },
  })
  const sessions = await tx.draftSession.findMany({
    where: { id: { in: rooms.flatMap(room => room.draftSessionId ? [room.draftSessionId] : []) } },
    select: { id: true, startedAt: true, status: true, _count: { select: { picks: true } } },
  })
  return {
    rooms: rooms.length,
    started: sessions.filter(session => session.startedAt || session.status !== 'tournament_setup_blocked').length,
    picks: sessions.reduce((sum, session) => sum + session._count.picks, 0),
  }
}

export async function analyzeSeasonScoreCorrection(
  tx: Prisma.TransactionClient, tournamentId: string, currentStage: number, status: string, input: ScoreCorrection, now: Date,
) {
  const match = await tx.redraftMatchup.findUnique({
    where: { id: input.matchupId }, include: { homeRoster: { select: { ownerName: true } }, awayRoster: { select: { ownerName: true } } },
  })
  if (!match || match.status !== 'final' || match.isMedianMatchup || match.seasonId !== seasonScoringId(match.leagueId)) {
    throw conflict('Select a finalized native tournament matchup.')
  }
  const league = await tx.tournamentLeague.findFirst({ where: { leagueId: match.leagueId, tournamentId }, include: { round: true } })
  if (!league) throw conflict('Select a finalized matchup from this tournament.')
  const stage = league.round.roundNumber
  const field = await loadSeasonStage(tournamentId, stage, tx)
  const snapshots = match.lineupSnapshots as Record<string, unknown> | null
  const snapshot = snapshots?.seasonTournament as { manifestHash?: string; final?: boolean; week?: number; revision?: number } | undefined
  if (!field || snapshot?.manifestHash !== field.manifest.manifestHash || !snapshot.final || snapshot.week !== match.week) {
    throw conflict('The matchup does not match the finalized scoring ledger.')
  }
  if (!match.awayRosterId && input.awayScore !== 0) throw conflict('A bye has no opposing score.')
  if (match.homeScore === input.homeScore && match.awayScore === input.awayScore) throw conflict('Enter a changed score.')
  const periodRules = field.manifest.config.rules!.calendar.periods.filter(row => row.number >= league.round.weekStart && row.number <= league.round.weekEnd)
  const leagueIds = field.manifest.leagues.map(pool => seasonResourceId(field.id, pool.key))
  if (!leagueIds.includes(match.leagueId) || !periodRules.some(period => period.number === match.week)) throw conflict('The matchup is outside the frozen stage.')
  const finalTieOrder = frozenTieOrder(field.manifest)
  const decisionEvent = stage < 3 ? await tx.tournamentAuditLog.findFirst({
    where: { tournamentId, action: SEASON_CUT_FINALIZED, targetId: league.roundId }, orderBy: newestSeasonEvent,
  }) : null
  const bracketEvents = stage === 3 ? await tx.tournamentAuditLog.findMany({
    where: { tournamentId, action: SEASON_BRACKET_PERIOD_FINALIZED, targetId: league.roundId }, select: { data: true },
  }) : []
  const playedBracket = bracketEvents.some(event => ((event.data as { period?: number } | null)?.period ?? 0) >= match.week)
  const affectedStage = decisionEvent ? stage + 1 : stage
  const rooms = await inspectSeasonStageRooms(tx, tournamentId, affectedStage)
  const impact: RecoveryImpact = { ...rooms, affectedStage, eligible: false, explanation: '' }
  const prior = decisionEvent?.data as SeasonCutDecision | undefined
  const next = decisionEvent ? await loadSeasonStage(tournamentId, stage + 1, tx) : null
  let decision: ReturnType<typeof calculateSeasonQualifierCut> | undefined
  if (prior) {
    const periods = periodRules.map(period => period.number)
    const ledger = await readFinalSeasonStageScores(tx, field.manifest, leagueIds, periods)
    const entries = await tx.tournamentLeagueParticipant.findMany({ where: {
      tournamentLeagueId: league.id, redraftRosterId: { in: [match.homeRosterId, ...(match.awayRosterId ? [match.awayRosterId] : [])] },
    }, select: { participantId: true, redraftRosterId: true } })
    const home = entries.find(entry => entry.redraftRosterId === match.homeRosterId)?.participantId
    if (ledger && home && entries.length === (match.awayRosterId ? 2 : 1)) {
      const revised = ledger.map(score => {
        if (score.matchupId !== match.id) return score
        const points = score.entrantId === home ? input.homeScore : input.awayScore
        const against = score.entrantId === home ? input.awayScore : input.homeScore
        return { ...score, points, against, wins: (score.played ? points === against ? 0.5 : points > against ? 1 : 0 : 0) as 0 | 0.5 | 1,
          revision: score.revision + 1 }
      })
      decision = calculateSeasonQualifierCut(field, periods, revised, finalTieOrder)
      if (decision.cut.ok) {
        const before = new Map(prior.advancing.map(row => [row.entrantId, row.seed]))
        const after = new Map(decision.cut.advancing.map(row => [row.entrantId, row.seed]))
        const names = new Map(decision.members.map(member => [member.id, member.displayName]))
        impact.entrantsIn = [...after.keys()].filter(id => !before.has(id)).map(id => names.get(id) ?? id)
        impact.entrantsOut = [...before.keys()].filter(id => !after.has(id)).map(id => names.get(id) ?? id)
        impact.changedSeeds = [...after].filter(([id, seed]) => before.get(id) !== seed).length
      }
    }
  }

  if (status !== 'rules_published') impact.explanation = 'The championship is finalized. The published outcome requires a separate review.'
  else if (playedBracket) impact.explanation = 'This correction affects a bracket result that has already been issued.'
  else if (!decisionEvent && currentStage !== stage) impact.explanation = 'The tournament has already moved beyond this stage.'
  else if (!decisionEvent) {
    impact.eligible = true
    impact.explanation = 'Apply the score to the finalized ledger and republish the affected standings.'
  } else if (currentStage !== stage + 1 || rooms.rooms) {
    impact.explanation = 'Downstream assignments have been issued. This review preserves existing rooms and picks.'
  } else if (!next || now.getTime() >= firstSeasonStageDraft(next)) {
    impact.explanation = 'The published downstream draft window has started or its field is unavailable.'
  } else if (!decision?.cut.ok) {
    impact.explanation = decision && !decision.cut.ok ? decision.cut.reason : 'The full finalized qualifier ledger is unavailable.'
  } else if (!prior || !next.manifest.leagues.flatMap(pool => pool.members).every(member =>
    prior.advancing.some(entrant => entrant.entrantId === member.id && entrant.seed === member.previousSeed))) {
    impact.explanation = 'The downstream field includes an approved replacement. Replanning would overwrite that decision.'
  } else {
    impact.eligible = true
    impact.explanation = 'Apply the correction and recalculate the unissued downstream assignments.'
  }
  return { match, snapshot, snapshots, stage, league, field, next, periodRules, leagueIds, finalTieOrder, decision, decisionEvent, prior, impact }
}

export async function applySeasonScoreCorrection(
  tx: Prisma.TransactionClient, tournamentId: string, caseId: string, input: ScoreCorrection,
  analysis: Awaited<ReturnType<typeof analyzeSeasonScoreCorrection>>, now: Date,
) {
  const { match, field, league, next, decision, decisionEvent, prior, impact } = analysis
  if (!impact.eligible) throw conflict(impact.explanation)
  await tx.$queryRaw`SELECT id FROM redraft_seasons WHERE id = ${match.seasonId} FOR UPDATE`
  const siblings = await tx.redraftMatchup.findMany({
    where: { seasonId: match.seasonId, week: match.week, status: 'final', isMedianMatchup: false },
  })
  const revised = siblings.map(game => ({ game, home: game.id === match.id ? input.homeScore : game.homeScore,
    away: game.id === match.id ? input.awayScore : game.awayScore }))
  const official = await persistSeasonLiveScore(tx, {
    tournamentId, leagueId: match.leagueId, stage: field.manifest.stage ?? 1, period: match.week,
    manifestHash: field.manifest.manifestHash, now, proof: { source: 'approved_correction', caseId },
    scores: revised.flatMap(({ game, home, away }) => [
      { rosterId: game.homeRosterId, points: home },
      ...(game.awayRosterId ? [{ rosterId: game.awayRosterId, points: away }] : []),
    ]),
  })
  for (const { game, home, away } of revised) {
    const saved = game.lineupSnapshots as Record<string, object>
    await tx.redraftMatchup.update({ where: { id: game.id }, data: {
      homeScore: home, awayScore: away,
      lineupSnapshots: toPrismaJsonInput({ ...saved, seasonTournament: {
        ...saved.seasonTournament, revision: official.revision, officialScoreId: official.id, correctionId: caseId,
      } }),
    } })
  }
  const rosters = await tx.redraftRoster.findMany({ where: { seasonId: match.seasonId }, select: { id: true } })
  await rebuildSeasonLeagueStandings(tx, match.leagueId, match.seasonId, rosters.map(roster => roster.id))
  if (decisionEvent && next && prior && decision?.cut.ok) {
    const cut = decision.cut
    const replaceField = cut.advancing.some((entrant, index) => entrant.entrantId !== prior.advancing[index]?.entrantId || entrant.seed !== prior.advancing[index]?.seed)
    await commitSeasonQualifierCut(tx, tournamentId, league.roundId, field, { ...decision, cut }, now, {
      id: caseId, priorCutId: decisionEvent.id, priorFieldId: next.id, replaceField,
    })
  }
  await publishSeasonStageReports(tx, {
    tournamentId, roundId: league.roundId, freezeId: field.id, manifest: field.manifest,
    leagueIds: analysis.leagueIds, periodRules: analysis.periodRules, finalTieOrder: analysis.finalTieOrder, now, reviseFrom: match.week,
  })
}
