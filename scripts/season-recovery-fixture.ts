import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { loadSeasonStage } from '@/lib/tournament/seasonRounds'
import { freezeSeasonOpeningField, joinSeasonTournament, loadSeasonEntry, loadSeasonRegistration, openSeasonRegistration } from '@/lib/tournament/seasonRegistration'
import { loadSeasonRecovery, proposeSeasonCorrection, requestSeasonWithdrawal, resolveSeasonRecovery } from '@/lib/tournament/seasonRecovery'
import { SEASON_CUT_FINALIZED, SEASON_REPORT_PUBLISHED, type SeasonCutDecision } from '@/lib/tournament/seasonReportPublication'
import { newestSeasonEvent, RECOVERY_RESOLVED, SCORE_DELAYED, SCORE_RECOVERED } from '@/lib/tournament/seasonRecoveryState'
import { controlSeasonDraft } from '@/lib/tournament/seasonDraftControls'
import { validateSeasonDraftPlayer } from '@/lib/tournament/seasonDraftRuntime'
import { completeSeasonDraft } from '@/lib/tournament/seasonDraftCompletion'
import type { SeasonReportSnapshot } from '@/lib/tournament/seasonReportFormat'
import type { SeasonTournamentDeps } from '@/lib/tournament/seasonTournamentAutomation'

const reason = 'Isolated recovery fixture'
export const inviteToken = (path: string) => new URLSearchParams(path.split('?')[1]).get('invite')!

export async function verifyOpeningRecovery(input: {
  tournamentId: string; owner: string; publicationId: string; hash: string; token: string; freezeId: string
  exiting: [string, string]; reserves: [string, string]
}) {
  const { tournamentId, owner, publicationId, hash, token, freezeId, exiting, reserves } = input
  const first = await requestSeasonWithdrawal(exiting[0], tournamentId, reason)
  assert.equal((await requestSeasonWithdrawal(exiting[0], tournamentId, reason)).caseId, first.caseId)
  assert.equal((await loadSeasonRecovery(owner, tournamentId)).cases[0]?.impact.canReopen, true)
  await assert.rejects(resolveSeasonRecovery(exiting[0], tournamentId, first.caseId, 'reopen', reason), { status: 404 })
  await resolveSeasonRecovery(owner, tournamentId, first.caseId, 'reopen', reason)
  assert.equal(await loadSeasonStage(tournamentId, 1), null)
  assert.equal((await loadSeasonRegistration(owner, tournamentId))?.fullField, false)
  await assert.rejects(freezeSeasonOpeningField(owner, tournamentId, publicationId), { status: 409 })
  await assert.rejects(joinSeasonTournament(reserves[0], tournamentId, token, publicationId, hash), { status: 404 })
  const signup = await openSeasonRegistration(owner, tournamentId, publicationId, new Date(Date.now() + 3_600_000).toISOString(), 4)
  const replacementToken = inviteToken(signup.invitePath)
  assert.equal((await joinSeasonTournament(reserves[0], tournamentId, replacementToken, publicationId, hash)).status, 'registered')
  assert.equal((await joinSeasonTournament(reserves[1], tournamentId, replacementToken, publicationId, hash)).status, 'waitlisted')
  const second = await freezeSeasonOpeningField(owner, tournamentId, publicationId)
  assert.notEqual(second.freezeId, freezeId)
  const before = (await loadSeasonStage(tournamentId, 1))!
  const vacancy = before.manifest.leagues.find(pool => pool.members.some(member => member.userId === exiting[1]))!
  const slot = vacancy.members.find(member => member.userId === exiting[1])!.draftSlot
  const secondCase = await requestSeasonWithdrawal(exiting[1], tournamentId, reason)
  const approved = await Promise.all([
    resolveSeasonRecovery(owner, tournamentId, secondCase.caseId, 'apply', reason),
    resolveSeasonRecovery(owner, tournamentId, secondCase.caseId, 'apply', reason),
  ])
  assert.equal(approved.filter(result => !result.reused).length, 1)
  const after = (await loadSeasonStage(tournamentId, 1))!
  assert.notEqual(after.id, second.freezeId)
  const nextPool = after.manifest.leagues.find(pool => pool.key === vacancy.key)!
  assert.equal(nextPool.members.find(member => member.userId === reserves[1])?.draftSlot, slot)
  for (const pool of before.manifest.leagues.filter(pool => pool.key !== vacancy.key)) {
    assert.deepEqual(after.manifest.leagues.find(other => other.key === pool.key), pool)
  }
  assert.equal((await loadSeasonEntry(exiting[1], tournamentId))?.status, 'withdrawn')
  assert.equal((await requestSeasonWithdrawal(exiting[1], tournamentId, reason)).caseId, secondCase.caseId)
  assert.equal((await freezeSeasonOpeningField(owner, tournamentId, publicationId)).freezeId, after.id)
  return { freezeId: after.id }
}

export async function verifyScoringDelay(tournamentId: string, owner: string, leagueId: string, recovered: boolean) {
  const id = seasonResourceId(leagueId, 'score-delay:1')
  const dashboard = await loadSeasonRecovery(owner, tournamentId)
  assert.equal(dashboard.delays.some(delay => delay.id === id), !recovered)
  assert.equal(await prisma.tournamentAuditLog.count({ where: { id, action: SCORE_DELAYED } }), 1)
  if (recovered) assert.equal(await prisma.tournamentAuditLog.count({ where: { tournamentId, targetId: id, action: SCORE_RECOVERED } }), 1)
}

export async function verifyCorrectionBeforeIssue(tournamentId: string, owner: string, closing: Date, tick: (now: Date) => Promise<{ processed: number }>) {
  const sourceRound = await prisma.tournamentRound.findUniqueOrThrow({ where: { tournamentId_roundNumber: { tournamentId, roundNumber: 1 } } })
  const cut = await prisma.tournamentAuditLog.findFirstOrThrow({
    where: { tournamentId, action: SEASON_CUT_FINALIZED, targetId: sourceRound.id }, orderBy: newestSeasonEvent,
  })
  const recorded = cut.data as SeasonCutDecision
  const eliminated = await prisma.tournamentParticipant.findUniqueOrThrow({ where: { id: recorded.eliminated.at(-1)! } })
  const source = await prisma.tournamentLeague.findMany({ where: { tournamentId, round: { roundNumber: 1 } }, select: { leagueId: true } })
  const match = await prisma.redraftMatchup.findFirstOrThrow({
    where: { status: 'final', week: 1, leagueId: { in: source.flatMap(row => row.leagueId ? [row.leagueId] : []) }, OR: [
      { homeRoster: { ownerId: eliminated.userId } }, { awayRoster: { ownerId: eliminated.userId } },
    ] }, include: { homeRoster: { select: { ownerId: true } } },
  })
  const beforeField = (await loadSeasonStage(tournamentId, 2))!
  const finalReport = await prisma.tournamentAuditLog.findFirstOrThrow({
    where: { tournamentId, action: SEASON_REPORT_PUBLISHED, targetId: cut.targetId, data: { path: ['status'], equals: 'final' } },
  })
  const boosted = match.homeRoster.ownerId === eliminated.userId
  const score = { matchupId: match.id, homeScore: boosted ? 187.1234 : match.homeScore, awayScore: boosted ? match.awayScore : 187.1234 }
  const opened = new Date(closing.getTime() + 1000)
  await assert.rejects(proposeSeasonCorrection(eliminated.userId, tournamentId, score, reason, opened), { status: 404 })
  const review = await proposeSeasonCorrection(owner, tournamentId, score, reason, opened)
  const dashboard = await loadSeasonRecovery(owner, tournamentId, 1, 1)
  const impact = dashboard.cases.find(item => item.id === review.caseId)?.impact
  assert(impact?.eligible && impact.entrantsIn?.includes(eliminated.displayName) && impact.changedSeeds, JSON.stringify(impact))
  assert(dashboard.matchups.some(item => item.id === match.id))
  assert.equal((await tick(new Date(closing.getTime() + 2000))).processed, 0)
  assert.equal(await prisma.tournamentLeague.count({ where: { tournamentId, round: { roundNumber: 2 } } }), 0)
  await resolveSeasonRecovery(owner, tournamentId, review.caseId, 'apply', reason, new Date(closing.getTime() + 3000))
  assert.equal((await resolveSeasonRecovery(owner, tournamentId, review.caseId, 'apply', reason)).reused, true)
  assert.equal((await proposeSeasonCorrection(owner, tournamentId, score, reason)).caseId, review.caseId)
  const after = (await loadSeasonStage(tournamentId, 2))!
  assert.notEqual(after.id, beforeField.id)
  assert(after.manifest.leagues.some(pool => pool.members.some(member => member.id === eliminated.id)))
  assert.equal((await loadSeasonEntry(eliminated.userId, tournamentId))?.assignment, undefined)
  assert.deepEqual((await prisma.tournamentAuditLog.findUniqueOrThrow({ where: { id: cut.id } })).data, cut.data)
  const revision = await prisma.tournamentAuditLog.findFirstOrThrow({
    where: { tournamentId, action: SEASON_REPORT_PUBLISHED, targetId: cut.targetId, data: { path: ['official'], equals: true } },
  })
  const snapshot = revision.data as SeasonReportSnapshot
  assert.equal(snapshot.status, 'corrected')
  assert.equal(snapshot.previousId, finalReport.id)
  assert(snapshot.rows.some(row => row.entrantId === eliminated.id && row.standing === 'Advanced'))
  assert.deepEqual((await prisma.tournamentAuditLog.findUniqueOrThrow({ where: { id: finalReport.id } })).data, finalReport.data)
  const members = after.manifest.leagues.flatMap(pool => pool.members)
  const outgoing = [...members].sort((a, b) => b.previousSeed! - a.previousSeed!)[0]!
  const pool = after.manifest.leagues.find(league => league.members.some(member => member.id === outgoing.id))!
  const withdrawal = await requestSeasonWithdrawal(outgoing.userId, tournamentId, reason, undefined, new Date(closing.getTime() + 4000))
  const proposal = (await loadSeasonRecovery(owner, tournamentId)).cases.find(item => item.id === withdrawal.caseId)
  assert(proposal?.kind === 'withdrawal' && proposal.impact.eligible && proposal.replacement)
  await resolveSeasonRecovery(owner, tournamentId, withdrawal.caseId, 'apply', reason, new Date(closing.getTime() + 5000))
  const replacementField = (await loadSeasonStage(tournamentId, 2))!
  const replacement = replacementField.manifest.leagues.find(row => row.key === pool.key)?.members.find(row => row.draftSlot === outgoing.draftSlot)
  assert.notEqual(replacement?.id, outgoing.id)
  assert.equal(replacement?.previousSeed, outgoing.previousSeed)
  assert.equal(replacement?.displayName, proposal.replacement)
  return score
}

export async function verifyIssuedRoomRecovery(input: {
  tournamentId: string; owner: string; score: Awaited<ReturnType<typeof verifyCorrectionBeforeIssue>>
  leagueId: string; sessionId: string; rosterId: string; player: { playerId: string; playerName: string; position: string }
  now: Date; refresh: NonNullable<SeasonTournamentDeps['refreshDraft']>; tick: (now: Date) => Promise<{ processed: number }>
}) {
  const { tournamentId, owner, score, sessionId, leagueId, now } = input
  const field = (await loadSeasonStage(tournamentId, 2))!
  const oldMatch = await prisma.redraftMatchup.findUniqueOrThrow({ where: { id: score.matchupId } })
  const picks = await prisma.draftPick.findMany({ where: { sessionId } })
  assert.equal(picks.length, 1)
  const correction = { ...score, homeScore: score.homeScore + 0.321 }
  const review = await proposeSeasonCorrection(owner, tournamentId, correction, reason, now)
  const view = (await loadSeasonRecovery(owner, tournamentId)).cases[0]!
  assert.equal(view.impact.eligible, false)
  assert(view.impact.rooms > 0 && view.impact.started > 0 && view.impact.picks > 0)
  const session = await prisma.draftSession.findUniqueOrThrow({ where: { id: sessionId } })
  assert.equal(session.status, 'paused')
  assert(session.pausedRemainingSeconds !== null && session.timerEndAt === null)
  assert.match((await validateSeasonDraftPlayer(leagueId, input.rosterId, [], input.player)) ?? '', /owner review/)
  assert.equal(await completeSeasonDraft(leagueId, now), false)
  assert.equal((await input.tick(now)).processed, 0)
  await assert.rejects(resolveSeasonRecovery(owner, tournamentId, review.caseId, 'apply', reason, now), { status: 409 })
  await resolveSeasonRecovery(owner, tournamentId, review.caseId, 'retain', reason, now)
  assert.deepEqual(await prisma.draftPick.findMany({ where: { sessionId } }), picks)
  assert.equal((await loadSeasonStage(tournamentId, 2))?.id, field.id)
  assert.deepEqual(await prisma.redraftMatchup.findUniqueOrThrow({ where: { id: score.matchupId } }), oldMatch)
  const downstream = await prisma.tournamentLeague.findMany({ where: { tournamentId, round: { roundNumber: 2 } }, select: { draftSessionId: true } })
  const paused = await prisma.draftSession.findMany({
    where: { status: 'paused', id: { in: downstream.flatMap(row => row.draftSessionId ? [row.draftSessionId] : []) } }, select: { leagueId: true },
  })
  for (const row of paused) assert.equal(await controlSeasonDraft(row.leagueId, 'resume', owner, input.refresh), true)
  assert.equal(await prisma.tournamentAuditLog.count({ where: { tournamentId, action: RECOVERY_RESOLVED, targetId: review.caseId } }), 1)
}
