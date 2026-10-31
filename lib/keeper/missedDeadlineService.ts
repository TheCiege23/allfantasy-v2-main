import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { computeKeeperEligibility } from './eligibilityEngine'
import { placeTeamKeepers, placedKeeperLabel, resolveKeeperRules } from './keeperRules'
import { chooseBestValueKeepers, readMissedDeadlineRule, type BestValueCandidate } from './missedDeadline'
import { loadKeeperMarketRanks } from './keeperMarketValues'

/**
 * Apply the league's missed-deadline rule (./missedDeadline) as keepers lock: every team with no
 * keeper record for the incoming season gets AF's best-value picks written as `pending` records,
 * which the lock that follows turns `locked` exactly as if the manager had submitted them.
 *
 * ⚠ IT ONLY EVER ADDS FOR A TEAM THAT SAID NOTHING. A team with even one keeper record is left
 * alone, and so is a team that submitted an EMPTY list on purpose — that writes no keeper record,
 * so `submitKeeperSelections` leaves a `keeper_submitted_none` audit marker this reads. This is a
 * default for silence, never a second opinion on a choice.
 *
 * Fails safe to "no keepers": a lapsed plan, a sport without market values (FantasyCalc is NFL),
 * or an unreadable chart each leave the old behaviour in place, and say why in the audit log.
 */

export type MissedDeadlineOutcome = {
  rule: 'auto_no_keepers' | 'auto_best_value'
  applied: Array<{ rosterId: string; keepers: Array<{ playerId: string; name: string; costLabel: string }> }>
  skippedReason: null | 'not_entitled' | 'no_market_values' | 'no_silent_teams'
}

/** Audit action a deliberate "no keepers" submission leaves (entityId = the incoming season). */
export const KEEPER_SUBMITTED_NONE = 'keeper_submitted_none'

async function audit(db: Prisma.TransactionClient, leagueId: string, userId: string | null, actionType: string, metadata: Record<string, unknown>) {
  try {
    await db.leagueAuditLog.create({ data: { leagueId, userId, actionType, entityType: 'keeper_session', metadata: metadata as object } })
  } catch (e) {
    console.warn('[keeper] missed-deadline audit write failed', e instanceof Error ? e.message : e)
  }
}

export async function applyMissedDeadlineRule(leagueId: string, seasonId: string, db: Prisma.TransactionClient = prisma): Promise<MissedDeadlineOutcome> {
  const league = await db.league.findFirst({ where: { id: leagueId } })
  if (!league) return { rule: 'auto_no_keepers', applied: [], skippedReason: null }
  const rule = readMissedDeadlineRule(league.keeperMissedDeadlineRule)
  if (rule === 'auto_no_keepers') return { rule, applied: [], skippedReason: null }

  const [rosters, records, emptySubmissions] = await Promise.all([
    db.redraftRoster.findMany({ where: { leagueId, seasonId }, include: { players: true } }),
    db.keeperRecord.findMany({ where: { leagueId, seasonId }, select: { rosterId: true } }),
    db.leagueAuditLog.findMany({ where: { leagueId, actionType: KEEPER_SUBMITTED_NONE, entityId: seasonId }, select: { metadata: true } }),
  ])
  const answered = new Set(records.map((r) => r.rosterId))
  for (const e of emptySubmissions) {
    const rosterId = (e.metadata as { rosterId?: unknown } | null)?.rosterId
    if (typeof rosterId === 'string') answered.add(rosterId)
  }
  const silent = rosters.filter((r) => !answered.has(r.id))
  if (!silent.length) return { rule, applied: [], skippedReason: 'no_silent_teams' }

  // The rule is AF Commissioner; a lapsed plan falls back to no keepers rather than surprising anyone.
  const access = league.userId
    ? await new FeatureGateService().evaluateUserFeatureAccess(league.userId, 'commissioner_automation').catch(() => null)
    : null
  if (!access?.allowed) {
    await audit(db, leagueId, null, 'keeper_missed_deadline_skipped', { reason: 'not_entitled', rosterIds: silent.map((r) => r.id) })
    return { rule, applied: [], skippedReason: 'not_entitled' }
  }

  const sport = String(league.sport ?? 'NFL').toUpperCase()
  const teams = league.leagueSize ?? rosters.length
  const rankOf = await loadKeeperMarketRanks(league, rosters.length)
  if (!rankOf) {
    await audit(db, leagueId, null, 'keeper_missed_deadline_skipped', { reason: 'no_market_values', sport, rosterIds: silent.map((r) => r.id) })
    return { rule, applied: [], skippedReason: 'no_market_values' }
  }

  let eligibility = await db.keeperEligibility.findMany({ where: { leagueId, seasonId } })
  if (!eligibility.length) {
    await computeKeeperEligibility(leagueId, seasonId)
    eligibility = await db.keeperEligibility.findMany({ where: { leagueId, seasonId } })
  }
  const rules = resolveKeeperRules(league)
  const latestDraft = await db.draftSession.findFirst({ where: { leagueId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { rounds: true } })
  const totalRounds = latestDraft?.rounds ?? 15
  const maxKeepers = league.keeperCount ?? 3

  const applied: MissedDeadlineOutcome['applied'] = []
  for (const roster of silent) {
    const live = roster.players.filter((p) => !p.droppedAt)
    const byId = new Map(live.map((p) => [p.playerId, p]))
    const candidates: BestValueCandidate[] = eligibility
      .filter((e) => e.rosterId === roster.id && e.isEligible && byId.has(e.playerId))
      .map((e) => {
        const p = byId.get(e.playerId)!
        return {
          playerId: e.playerId,
          name: p.playerName,
          costRound: e.projectedCostRound,
          marketRank: rankOf({ playerId: e.playerId, name: p.playerName, position: p.position }),
        }
      })
    const chosen = chooseBestValueKeepers({ candidates, maxKeepers, teams, rules, totalRounds })
    if (!chosen.length) continue
    const placement = placeTeamKeepers(rules, chosen.map((c) => ({ playerId: c.playerId, costRound: c.costRound })), { totalRounds })
    const spotById = new Map(placement.placed.map((s) => [s.playerId, s]))
    const kept: MissedDeadlineOutcome['applied'][number]['keepers'] = []
    for (const c of chosen) {
      const spot = spotById.get(c.playerId)
      if (!spot) continue
      const p = byId.get(c.playerId)!
      const costLabel = `${placedKeeperLabel(spot)} · kept by AF (deadline missed)`
      // Called under the session transaction lock by the deadline runner. Any failed write
      // must roll back all defaults through its savepoint, never leave a partial team.
      await db.keeperRecord.create({
        data: {
          leagueId, seasonId, rosterId: roster.id, playerId: c.playerId,
          playerName: p.playerName, position: p.position, team: p.team, sport: p.sport,
          originalDraftYear: new Date().getFullYear(), yearsKept: 1,
          costRound: spot.round, costLabel, status: 'pending', acquisitionType: p.acquisitionType,
        },
      })
      kept.push({ playerId: c.playerId, name: p.playerName, costLabel })
    }
    if (kept.length) applied.push({ rosterId: roster.id, keepers: kept })
  }
  await audit(db, leagueId, null, 'keeper_missed_deadline_applied', { rule, applied })
  return { rule, applied, skippedReason: null }
}
