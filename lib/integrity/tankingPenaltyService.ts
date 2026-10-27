import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { logAction } from '@/server/services/auditService'
import { loadNativeFuturePicks } from '@/lib/league-trade-engine/nativeFuturePicks'
import { getEffectiveLeagueWaiverSettings } from '@/lib/waiver-wire/settings-service'
import {
  choosePickToForfeit,
  describePenalty,
  describePick,
  faabPenaltyAmount,
  readLotteryOddsPenalties,
  readTankingPenaltyPolicy,
  tankingStepForStrike,
  TANKING_LOTTERY_PENALTIES_KEY,
  type TankingPenaltyPolicy,
  type TankingStep,
} from './tankingPenalties'

/**
 * Anti-tanking penalties (./tankingPenalties.ts): the warning a manager gets when a tanking flag is
 * opened against them, and the strike — and, at the commissioner's threshold, the lost pick — when
 * the commissioner confirms one. Every step is written to the league log and told to the manager.
 */

export const TANKING_WARNING_ACTION = 'integrity.tanking_warning'
export const TANKING_STRIKE_ACTION = 'integrity.tanking_strike'
export const TANKING_PICK_FORFEITED_ACTION = 'integrity.tanking_pick_forfeited'
export const TANKING_LOTTERY_ODDS_ACTION = 'integrity.tanking_lottery_odds_cut'
export const TANKING_FAAB_ACTION = 'integrity.tanking_faab_taken'

/**
 * Penalties are for leagues run on AllFantasy. An imported league's draft picks and its managers live
 * on the source platform: a confirmed tanking flag there is a finding for the commissioner, never a
 * forfeited AllFantasy pick row or a warning that promises one (lib/integrity/scanImportedTanking.ts).
 */
function penaltiesApply(platform: string | null): boolean {
  return resolveWriteAuthority(platform) === 'NATIVE'
}

/** The manager of a roster, when the seat belongs to a person (an abandoned team's `orphan-…` seat does not). */
async function managerUserId(rosterId: string): Promise<string | null> {
  const roster = await prisma.roster.findUnique({ where: { id: rosterId }, select: { platformUserId: true } })
  const id = roster?.platformUserId ?? ''
  if (!id || id.startsWith('orphan-') || id.startsWith('ai-manager-')) return null
  const user = await prisma.appUser.findUnique({ where: { id }, select: { id: true } }).catch(() => null)
  return user?.id ?? null
}

async function tellManager(leagueId: string, rosterId: string, title: string, body: string): Promise<void> {
  const userId = await managerUserId(rosterId)
  if (!userId) return
  await dispatchNotification({
    userIds: [userId],
    category: 'league_announcements',
    type: 'integrity_tanking_notice',
    title,
    body,
    severity: 'high',
    leagueId,
    actionHref: `/league/${leagueId}`,
    actionLabel: 'Open league',
    meta: { leagueId, rosterId },
  }).catch((err) => console.error('[tankingPenalty] notify manager failed', err))
}

/**
 * A tanking flag was opened: the manager hears about it privately, with what the next confirmed case
 * would cost. Nothing is taken. Best-effort — a failure never touches the flag.
 */
export async function onTankingFlagOpened(flagId: string): Promise<void> {
  const flag = await prisma.integrityFlag.findUnique({
    where: { id: flagId },
    select: { leagueId: true, flagType: true, affectedRosterIds: true, league: { select: { settings: true, platform: true } } },
  })
  if (!flag || flag.flagType !== 'tanking') return
  if (!penaltiesApply(flag.league.platform)) return
  const policy = readTankingPenaltyPolicy(flag.league.settings)
  if (!policy.enabled) return
  for (const rosterId of flag.affectedRosterIds) {
    const confirmed = await countConfirmedStrikes(flag.leagueId, rosterId)
    const left = Math.max(1, policy.pickAtStrike - confirmed)
    await tellManager(
      flag.leagueId,
      rosterId,
      'Your lineup was flagged for review',
      `The league's integrity monitor flagged your lineup as possible tanking: starters who could not play, or a much stronger bench. Your commissioner will review it. ${
        left <= 1 ? `If it is confirmed, your team loses ${describePenalty(policy)}.` : `Confirmed cases count as strikes; ${left} more costs your team ${describePenalty(policy)}.`
      }`,
    )
    await logAction({ leagueId: flag.leagueId, userId: null, actionType: TANKING_WARNING_ACTION, entityType: 'roster', entityId: rosterId, metadata: { flagId, confirmedStrikes: confirmed } })
  }
}

/** Confirmed (escalated) tanking flags against a roster in the league's current season. */
export async function countConfirmedStrikes(leagueId: string, rosterId: string): Promise<number> {
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { season: 'desc' }, select: { createdAt: true } })
  return prisma.integrityFlag.count({
    where: {
      leagueId,
      flagType: 'tanking',
      status: 'escalated',
      affectedRosterIds: { has: rosterId },
      ...(season ? { createdAt: { gte: season.createdAt } } : {}),
    },
  })
}

export type TankingConfirmationResult = {
  rosterId: string
  step: TankingStep
  /** `forfeit_pick`: the pick taken, or null when the team holds none. */
  forfeited?: { season: number; round: number; label: string } | null
  /** `lottery_odds` / `faab`: what was taken, in words, or null when there was nothing to take. */
  penalty?: { label: string } | null
}

/**
 * The commissioner confirmed a tanking flag: each team on it takes a strike, and at the league's
 * threshold pays the league's penalty — a pick, lottery odds or FAAB (the commissioner is told when
 * there is nothing to take).
 */
export async function onTankingFlagConfirmed(flagId: string, commissionerUserId: string): Promise<TankingConfirmationResult[]> {
  const flag = await prisma.integrityFlag.findUnique({
    where: { id: flagId },
    select: { leagueId: true, flagType: true, status: true, affectedRosterIds: true, league: { select: { settings: true, platform: true } } },
  })
  if (!flag || flag.flagType !== 'tanking' || flag.status !== 'escalated') return []
  if (!penaltiesApply(flag.league.platform)) return []
  const policy = readTankingPenaltyPolicy(flag.league.settings)
  const out: TankingConfirmationResult[] = []
  for (const rosterId of flag.affectedRosterIds) {
    const strikes = await countConfirmedStrikes(flag.leagueId, rosterId)
    const step = tankingStepForStrike(policy, strikes)
    if (step.kind === 'none') {
      out.push({ rosterId, step })
      continue
    }
    await logAction({ leagueId: flag.leagueId, userId: commissionerUserId, actionType: TANKING_STRIKE_ACTION, entityType: 'roster', entityId: rosterId, metadata: { flagId, strike: strikes } })
    if (step.kind === 'warning') {
      await tellManager(
        flag.leagueId,
        rosterId,
        'Official warning: tanking',
        `Your commissioner confirmed the tanking flag on your team. This is strike ${strikes}. ${
          step.strikesLeft === 1 ? 'The next confirmed case costs your team a draft pick.' : `${step.strikesLeft} more confirmed cases cost your team a draft pick.`
        }`,
      )
      out.push({ rosterId, step })
      continue
    }
    if (step.kind === 'lottery_odds' || step.kind === 'faab') {
      const taken =
        step.kind === 'lottery_odds'
          ? await cutLotteryOddsForTanking(flag.leagueId, rosterId, policy, flagId, commissionerUserId)
          : await takeFaabForTanking(flag.leagueId, rosterId, policy, flagId, commissionerUserId)
      await tellManager(
        flag.leagueId,
        rosterId,
        taken ? 'Tanking penalty applied' : 'Tanking strike confirmed',
        taken
          ? `Your commissioner confirmed another tanking case (strike ${strikes}). Your team loses ${taken.label}.`
          : `Your commissioner confirmed another tanking case (strike ${strikes}). There is no FAAB to take from your team, so the commissioner will decide the penalty.`,
      )
      out.push({ rosterId, step, penalty: taken })
      continue
    }
    const forfeited = await forfeitPickForTanking(flag.leagueId, rosterId, policy.pickRound, flagId, commissionerUserId)
    await tellManager(
      flag.leagueId,
      rosterId,
      forfeited ? 'Draft pick forfeited for tanking' : 'Tanking strike confirmed',
      forfeited
        ? `Your commissioner confirmed another tanking case (strike ${strikes}). Your team loses its ${forfeited.label}.`
        : `Your commissioner confirmed another tanking case (strike ${strikes}). Your team holds no pick to forfeit, so the commissioner will decide the penalty.`,
    )
    out.push({ rosterId, step, forfeited })
  }
  return out
}

/**
 * Take the pick: the row becomes `forfeited`, so the native pick inventory no longer lists it — it
 * cannot be traded, and the next draft skips it. Native dynasty leagues only (no inventory → null).
 */
export async function forfeitPickForTanking(
  leagueId: string,
  rosterId: string,
  round: number,
  flagId: string,
  commissionerUserId: string,
): Promise<{ season: number; round: number; label: string } | null> {
  const pick = await prisma.$transaction(async (tx) => {
    const inventory = await loadNativeFuturePicks(leagueId, tx as never)
    if (!inventory) return null
    const chosen = choosePickToForfeit(inventory.picks, rosterId, round)
    if (!chosen) return null
    const data = { status: 'forfeited' as const, currentOwnerId: rosterId, forfeitedAt: new Date(), forfeitReason: `tanking (integrity flag ${flagId})`.slice(0, 128) }
    await tx.futureDraftPick.upsert({
      where: { leagueId_pickSeason_round_originalRosterId: { leagueId, pickSeason: chosen.season, round: chosen.round, originalRosterId: chosen.originalTeamId } },
      create: { leagueId, pickSeason: chosen.season, round: chosen.round, originalRosterId: chosen.originalTeamId, traded: chosen.originalTeamId !== rosterId, ...data },
      update: data,
    })
    return chosen
  })
  if (!pick) return null
  await logAction({
    leagueId,
    userId: commissionerUserId,
    actionType: TANKING_PICK_FORFEITED_ACTION,
    entityType: 'roster',
    entityId: rosterId,
    metadata: { flagId, season: pick.season, round: pick.round, originalRosterId: pick.originalTeamId },
  })
  return { season: pick.season, round: pick.round, label: describePick(pick) }
}

/**
 * Cut the team's odds in the next rookie-draft lottery: the cut is recorded on the league and the
 * lottery engine applies it to the preview and the draw until that draft is complete
 * (`activeLotteryOddsPenalties`). Two cuts compound.
 */
export async function cutLotteryOddsForTanking(
  leagueId: string,
  rosterId: string,
  policy: TankingPenaltyPolicy,
  flagId: string,
  commissionerUserId: string,
): Promise<{ label: string }> {
  const at = new Date().toISOString()
  await prisma.$transaction(async (tx) => {
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    const settings = league?.settings && typeof league.settings === 'object' && !Array.isArray(league.settings) ? (league.settings as Record<string, unknown>) : {}
    const list = [...readLotteryOddsPenalties(settings), { rosterId, cutPct: policy.lotteryOddsCutPct, at, flagId }]
    await tx.league.update({ where: { id: leagueId }, data: { settings: { ...settings, [TANKING_LOTTERY_PENALTIES_KEY]: list } as never } })
  })
  await logAction({
    leagueId,
    userId: commissionerUserId,
    actionType: TANKING_LOTTERY_ODDS_ACTION,
    entityType: 'roster',
    entityId: rosterId,
    metadata: { flagId, cutPct: policy.lotteryOddsCutPct },
  })
  return { label: describePenalty(policy) }
}

/**
 * Take a share of the season FAAB budget from what the team has left (never below zero). Null when
 * the league does not use FAAB or the team has none left: the commissioner is told instead.
 */
export async function takeFaabForTanking(
  leagueId: string,
  rosterId: string,
  policy: TankingPenaltyPolicy,
  flagId: string,
  commissionerUserId: string,
): Promise<{ label: string } | null> {
  const waivers = await getEffectiveLeagueWaiverSettings(leagueId).catch(() => null)
  if (!waivers || waivers.normalizedWaiverType !== 'faab') return null
  const taken = await prisma.$transaction(async (tx) => {
    const roster = await tx.roster.findUnique({ where: { id: rosterId }, select: { faabRemaining: true } })
    const amount = faabPenaltyAmount(waivers.faabBudget, roster?.faabRemaining, policy.faabPercent)
    if (amount <= 0) return null
    await tx.roster.update({ where: { id: rosterId }, data: { faabRemaining: { decrement: amount } } })
    return { amount, before: roster!.faabRemaining! }
  })
  if (!taken) return null
  await logAction({
    leagueId,
    userId: commissionerUserId,
    actionType: TANKING_FAAB_ACTION,
    entityType: 'roster',
    entityId: rosterId,
    metadata: { flagId, amount: taken.amount, faabBefore: taken.before, faabAfter: taken.before - taken.amount },
  })
  return { label: `$${taken.amount} of FAAB` }
}
