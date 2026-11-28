import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { computeKeeperEligibility } from './eligibilityEngine'
import { isWaiverCostLabel, placeTeamKeepers, placedKeeperLabel, readWaiverStack, resolveKeeperRules } from './keeperRules'
import { chooseBestValueKeepers, readMissedDeadlineRule, type BestValueCandidate } from './missedDeadline'
import { loadKeeperMarketRanks, type KeeperMarketRankOptions, type MarketRankLookup } from './keeperMarketValues'

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
 * Fails safe to "no keepers": a lapsed plan, a league whose market values cannot be read (no
 * FantasyCalc chart for an NFL league; no buildable value board for NBA · MLB · NHL · NCAAB · SOCCER),
 * or a board on which none of the silent teams' players is ranked each leave the old behaviour in
 * place, and say why in the audit log. AF never keeps a player it cannot price.
 *
 * 🛑 THE RANKS ARE LOADED BEFORE THE KEEPER LOCK'S TRANSACTION, NEVER INSIDE IT (owner 2026-11-28).
 * A board sport is ranked on the league's own value board — the same `loadKeeperMarketRanks(…,
 * { includeBoardSports: true })` the player card and the Keepers tab read, so AF keeps exactly the
 * players those surfaces call the best value. Building that board can take seconds, and doing it
 * inside `withKeeperSessionLock` would hold the advisory lock and the transaction open for all of it.
 * So `lockKeeperSelections` calls `preloadMissedDeadlineRanks` first and passes the result in; called
 * with a transaction client and nothing preloaded, this does NOT load — it skips, and says so.
 */

export type MissedDeadlineOutcome = {
  rule: 'auto_no_keepers' | 'auto_best_value'
  applied: Array<{ rosterId: string; keepers: Array<{ playerId: string; name: string; costLabel: string }> }>
  skippedReason: null | 'not_entitled' | 'no_market_values' | 'no_ranked_players' | 'no_silent_teams'
}

/** Market ranks loaded OUTSIDE the keeper lock's transaction. `rankOf: null` = none could be read. */
export type MissedDeadlinePreload = { rankOf: MarketRankLookup | null }

type PreloadOptions = Pick<KeeperMarketRankOptions, 'boardDeps'>

function ranksFor(league: Parameters<typeof loadKeeperMarketRanks>[0], rosterCount: number, options: PreloadOptions = {}) {
  return loadKeeperMarketRanks(league, rosterCount, { includeBoardSports: true, ...options }).catch(() => null)
}

/**
 * The ranks the missed-deadline rule keeps by, read with the plain client — call it BEFORE opening the
 * keeper lock's transaction. A league whose rule is "keep nobody" loads nothing. Never throws.
 */
export async function preloadMissedDeadlineRanks(leagueId: string, seasonId: string, options: PreloadOptions = {}): Promise<MissedDeadlinePreload> {
  try {
    const league = await prisma.league.findFirst({ where: { id: leagueId } })
    if (!league || readMissedDeadlineRule(league.keeperMissedDeadlineRule) !== 'auto_best_value') return { rankOf: null }
    const rosterCount = league.leagueSize ?? (await prisma.redraftRoster.count({ where: { leagueId, seasonId } }))
    return { rankOf: await ranksFor(league, rosterCount, options) }
  } catch (e) {
    console.warn('[keeper] missed-deadline rank preload failed', e instanceof Error ? e.message : e)
    return { rankOf: null }
  }
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

export async function applyMissedDeadlineRule(
  leagueId: string,
  seasonId: string,
  db: Prisma.TransactionClient = prisma,
  preloaded?: MissedDeadlinePreload,
): Promise<MissedDeadlineOutcome> {
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
  const source = sport === 'NFL' ? 'fantasycalc' : 'league_value_board'
  // Outside a transaction (the plain client) it is safe to load here; inside one, only preloaded ranks count.
  const notPreloaded = !preloaded && db !== prisma
  const rankOf = preloaded ? preloaded.rankOf : notPreloaded ? null : await ranksFor(league, rosters.length)
  if (!rankOf) {
    await audit(db, leagueId, null, 'keeper_missed_deadline_skipped', {
      reason: 'no_market_values', sport, source, ...(notPreloaded ? { detail: 'ranks_not_preloaded' } : {}), rosterIds: silent.map((r) => r.id),
    })
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
  let anyRanked = false
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
          waiver: isWaiverCostLabel(e.projectedCost),
        }
      })
    if (candidates.some((c) => c.marketRank != null)) anyRanked = true
    const chosen = chooseBestValueKeepers({ candidates, maxKeepers, teams, rules, totalRounds, waiverStack: readWaiverStack(league.settings) })
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
  if (!anyRanked) {
    // A board (or chart) that prices none of these teams' players is not a reason to guess.
    await audit(db, leagueId, null, 'keeper_missed_deadline_skipped', { reason: 'no_ranked_players', sport, source, rosterIds: silent.map((r) => r.id) })
    return { rule, applied: [], skippedReason: 'no_ranked_players' }
  }
  await audit(db, leagueId, null, 'keeper_missed_deadline_applied', { rule, sport, source, applied })
  return { rule, applied, skippedReason: null }
}
