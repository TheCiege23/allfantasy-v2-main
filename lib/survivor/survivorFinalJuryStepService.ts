import 'server-only'

import { prisma } from '@/lib/prisma'
import { readSurvivorLateSeasonSettings } from './lateSeasonSettings'
import { finaleCopyLang, readSurvivorFinaleSettings } from './survivorFinaleSettings'
import { CHALLENGE_BUILDER_TYPE, readChallengeBuilderConfig, readSubmission } from './survivorChallengeBuilderModel'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'
import { afterCastawayEliminated, eliminateCastawayInTransaction, type EliminationOutcome } from './survivorEliminationService'
import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'
import { voidPendingRedraftTradesForRoster } from '@/lib/redraft/voidPendingTradesForElimination'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { createSurvivorChatMessage } from './survivorChatBridge'
import { finalJuryStepAnnouncement, finalJuryStepSkipsCouncil, planFinalJuryStep, type FinalJuryStepChallenge, type FinalJuryStepPlan } from './survivorFinalJuryStep'

/**
 * The final jury step, server half (rules in survivorFinalJuryStep.ts). Called by the season runner
 * every tick of the finale week, and by the commissioner route's `final_jury_step` action. Idempotent:
 * the `final_jury_step_applied` audit entry is the gate, re-checked inside the setup lock.
 *
 * DB only. The target comes from the settled challenge's own result (which read SportsGame or took
 * the commissioner's number); nothing here calls a provider.
 */

export const FINAL_JURY_STEP_AUDIT_ACTION = 'final_jury_step_applied'
const PRE_MERGE = new Set(['pre_merge', 'post_swap'])

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** The latest settled individual closest-without-going-over challenge of this week, with its entries. */
async function loadFinalImmunityChallenge(leagueId: string, week: number): Promise<FinalJuryStepChallenge | null> {
  const rows = await prisma.survivorChallenge.findMany({
    where: { leagueId, week, challengeType: CHALLENGE_BUILDER_TYPE, status: 'complete' },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, configJson: true, resultJson: true },
  })
  for (const row of rows) {
    const config = readChallengeBuilderConfig(row.configJson)
    if (!config || config.kind !== 'closest_without_going_over' || config.scope !== 'individual') continue
    const result = rec(row.resultJson)
    if (result.outcome !== 'settled') continue
    const truth = rec(result.truth)
    const target = typeof truth.value === 'number' && Number.isFinite(truth.value) ? truth.value : null
    const subs = await prisma.survivorChallengeSubmission.findMany({ where: { challengeId: row.id }, select: { rosterId: true, submission: true, submittedAt: true } })
    const entries = subs.flatMap((s) => {
      const answer = readSubmission(s.submission)?.answer
      return s.rosterId && answer && 'value' in answer ? [{ userId: s.rosterId, guess: answer.value, submittedAt: s.submittedAt }] : []
    })
    const immunity = Array.isArray(result.immunityRosterIds) ? result.immunityRosterIds.filter((id): id is string => typeof id === 'string') : []
    return { challengeId: row.id, target, immunityRosterIds: immunity, entries, allOverRule: config.allOverRule }
  }
  return null
}

async function loadStepFacts(leagueId: string) {
  const [league, game, active, applied] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, survivorFinal3: true, language: true, platform: true } }),
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true } }),
    prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true, displayName: true, redraftRosterId: true } }),
    prisma.survivorAuditEntry.findFirst({ where: { leagueId, action: FINAL_JURY_STEP_AUDIT_ACTION }, select: { id: true } }),
  ])
  const finale = readSurvivorFinaleSettings(league?.settings)
  // No jury in this league (or not hosted here, so no roster to release): the step does not apply.
  const juryEnabled = normalizeSurvivorFoundationSettings((league?.settings && typeof league.settings === 'object' ? league.settings : {}) as Record<string, unknown>).juryEnabled
  const settings = juryEnabled && isNativePlatform(league?.platform) ? finale : { ...finale, finalJuryStepEnabled: false }
  const { finalistCount } = readSurvivorLateSeasonSettings(league?.settings, { survivorFinal3: league?.survivorFinal3 })
  return { league, settings, finalistCount, merged: Boolean(game && !PRE_MERGE.has(game.phase)), phase: game?.phase ?? null, active, applied: Boolean(applied) }
}

/** For the runner's elimination branch: should this planned council be skipped for the jury step? */
export async function finalJuryStepHoldsCouncil(leagueId: string): Promise<boolean> {
  const f = await loadStepFacts(leagueId)
  return finalJuryStepSkipsCouncil(f.settings, { finalistCount: f.finalistCount, activeCount: f.active.length, merged: f.merged, applied: f.applied })
}

export type FinalJuryStepOutcome = FinalJuryStepPlan['status'] | 'applied'

/** Apply the step when it is due. Returns what happened; never throws past a failed write. */
export async function applyFinalJuryStepIfDue(leagueId: string, week: number, opts: { actorUserId?: string | null } = {}): Promise<FinalJuryStepOutcome> {
  const f = await loadStepFacts(leagueId)
  if (!f.settings.finalJuryStepEnabled) return 'off'
  if (f.applied) return 'done'
  const byRoster = new Map(f.active.filter((p) => p.redraftRosterId).map((p) => [p.redraftRosterId as string, p]))
  const challenge = await loadFinalImmunityChallenge(leagueId, week)
  const plan = planFinalJuryStep({ settings: f.settings, finalistCount: f.finalistCount, merged: f.merged, applied: f.applied, activeRosterIds: [...byRoster.keys()], challenge })
  if (plan.status !== 'apply') return plan.status
  if (!plan.cutRosterIds.length) return 'not_due'

  const phase = f.phase ?? 'merge'
  const lang = finaleCopyLang(f.league?.language)
  // Every cut castaway goes through the league's normal elimination outcome — the SAME code a Tribal
  // vote-out runs (eliminateCastawayInTransaction): roster released to waivers, or Exile Island when
  // it is on; cast state; the jury after the merge; chat membership; audit. All in one transaction
  // under the setup lock, so the step lands whole or not at all (a failure retries next tick).
  const committed = await withSurvivorSetupTransaction(leagueId, async (tx) => {
    // Re-checked under the lock: two ticks (or a tick and the commissioner) never both apply it.
    if (await tx.survivorAuditEntry.findFirst({ where: { leagueId, action: FINAL_JURY_STEP_AUDIT_ACTION }, select: { id: true } })) return null
    const names: string[] = []
    const results: EliminationOutcome[] = []
    for (const rosterId of plan.cutRosterIds) {
      const player = byRoster.get(rosterId)
      if (!player) continue
      const result = await eliminateCastawayInTransaction(tx, {
        leagueId, userId: player.userId, week, phase, settingsJson: f.league?.settings,
        relatedEntityId: `final_jury_step:${plan.challengeId}:${rosterId}`, relatedEntityType: 'final_jury_step', actorUserId: opts.actorUserId ?? null,
        notice: lang === 'es'
          ? { title: 'Una persona más al jurado', body: `Semana ${week}: tras la última inmunidad, un mánager se une al jurado.`, deepLinkPath: `/survivor/${leagueId}/jury` }
          : { title: 'One more to the jury', body: `Week ${week}: after the last immunity, a manager joins the jury.`, deepLinkPath: `/survivor/${leagueId}/jury` },
      })
      if (!result.ok) throw new Error(`final jury step: ${result.code}`)
      results.push(result)
      names.push(player.displayName)
    }
    await tx.survivorAuditEntry.create({ data: { leagueId, week, category: 'jury', action: FINAL_JURY_STEP_AUDIT_ACTION, actorUserId: opts.actorUserId ?? null,
      relatedEntityId: plan.challengeId, relatedEntityType: 'challenge',
      // The immune castaway is kept for the commissioner's audit only; the public line never names them.
      data: { cutRosterIds: plan.cutRosterIds, immuneRosterId: plan.immuneRosterId, ranking: plan.ranking }, isVisibleToCommissioner: true, isVisibleToPublic: false } })
    return { names, results }
  })
  if (!committed) return 'done'
  const joined = committed.names
  // After the commit, as after a Tribal: legacy tribe-chat rows, and every pending trade touching the
  // roster is voided (main roster and its season roster). Best-effort; never undoes the step.
  for (const result of committed.results) {
    await afterCastawayEliminated(leagueId, result).catch(() => {})
    const rosterId = result.ok ? result.eliminatedRosterId : null
    if (!rosterId) continue
    const seasonRosterId = (await prisma.roster.findFirst({ where: { leagueId, id: rosterId }, select: { redraftRosterId: true } }).catch(() => null))?.redraftRosterId ?? null
    for (const id of [rosterId, seasonRosterId].filter((x): x is string => Boolean(x))) {
      await voidPendingRedraftTradesForRoster(leagueId, id, { actorUserId: opts.actorUserId ?? null }).catch(() => {})
    }
  }
  // The announcement never holds up the step.
  await (async () => {
    const channel = await prisma.survivorChatChannel.findFirst({ where: { leagueId, channelType: 'league', isArchived: false }, select: { id: true } })
    if (!channel || !joined.length) return
    await createSurvivorChatMessage(prisma, { data: { leagueId, channelId: channel.id, channelType: 'league', senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true,
      contentType: 'host_announcement', content: finalJuryStepAnnouncement(joined, finaleCopyLang(f.league?.language)) } })
  })().catch((error) => console.warn('[survivor] final jury step announcement failed', error instanceof Error ? error.message : error))
  return 'applied'
}
