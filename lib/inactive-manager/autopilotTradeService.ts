import 'server-only'

/**
 * CHIMMY AUTOPILOT — THE HOURLY RUN THAT ANSWERS TRADE OFFERS
 * (docs/chimmy-manager/IN_SEASON_MANAGER_PLAN.md, phase 3).
 *
 * For every pending two-team offer made TO a team Chimmy runs (trade mode `answer` or
 * `answer_and_send`), decide (./autopilotTrades.ts) and answer through the one accept/decline
 * implementation a manager's click uses (lib/redraft/tradeDecision.ts) — so the move lock, the trade
 * deadline, Survivor rules, the post-draft lock, integrity holds, the league's review mode and every
 * notice apply exactly as they do for a person. Chimmy has no accept path of its own.
 *
 * Starts from the pending offers, not from the leagues, so a quiet league costs nothing and the run
 * is bounded by how many offers are waiting. An accept the rules refuse (deadline passed, moves
 * locked) is left pending: the offer expires by itself, and the refusal is counted, not retried here.
 *
 * COUNTERS. An offer that is close but not enough is declined WITH a counter-offer (./autopilotTrades.ts
 * `planCounterOffer`): the same deal plus one bench player, or with one player kept back. The counter is
 * a new offer from the Chimmy team, made through the one offer-creation implementation
 * (lib/redraft/createTradeProposal.ts), so it is validated, valued and announced like any manager's.
 * Chimmy never counters another Chimmy team, sends at most `MAX_COUNTERS_PER_WEEK` a week per team, and
 * never while an offer of its own to that team is still waiting. If the counter cannot be made, the
 * offer is declined as it would have been.
 */
import { prisma } from '@/lib/prisma'
import { logAction } from '@/server/services/auditService'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { acceptRedraftTrade, rejectRedraftTrade, type PendingTradeProposal } from '@/lib/redraft/tradeDecision'
import { isMultiTeamTrade, tradeParticipantRosterIds } from '@/lib/redraft/tradeParticipants'
import type { TradeValueSnapshot } from '@/lib/trade-value/types'
import { AF_MANAGED_LINEUPS_KEY, autopilotTradeMode, managedForOwner } from './inactiveManagerMode'
import { readPlayableChimmyLineups } from './chimmyPlayable'
import { resolveManagerProfile } from './managerProfile'
import { TRADE_ANSWER_DELAY_MS, decideTradeOffer, planCounterOffer, type AskablePlayer, type CounterPlan } from './autopilotTrades'
import { createRedraftTradeProposal, type TradeAssetInput } from '@/lib/redraft/createTradeProposal'
import { computeRedraftTradeValueSnapshot } from '@/lib/trade-value/captureSnapshot'
import type { ManagerProfile } from './managerProfile'

/** Who answered, in decision records and audit rows. Not a user: `system:` actors are never FK-written. */
export const CHIMMY_TRADE_ACTOR = 'system:chimmy-autopilot'
export const CHIMMY_TRADE_ACTOR_NAME = 'Chimmy'
export const TRADE_ACCEPT_ACTION = 'chimmy_autopilot.trade_accept'
export const TRADE_REJECT_ACTION = 'chimmy_autopilot.trade_reject'
export const TRADE_COUNTER_ACTION = 'chimmy_autopilot.trade_counter'

/** Counter-offers a Chimmy team may send in any 7 days, so a back-and-forth cannot run forever. */
export const MAX_COUNTERS_PER_WEEK = 3
/** How many of the other team's bench players are priced when looking for one to ask for. */
const MAX_BENCH_PRICED = 20
const WEEK_MS = 7 * 24 * 3600_000

/** At most this many offers answered per run, so one busy league cannot hold the hourly job. */
export const MAX_TRADE_ANSWERS_PER_RUN = 40

export type AutopilotTradeRunResult = {
  offers: number
  accepted: number
  rejected: number
  /** Declined with a counter-offer sent. Counted in `rejected` too. */
  countered: number
  skipped: Record<string, number>
  failures: Array<{ leagueId: string; proposalId: string; error: string }>
}

export async function runAutopilotTradeAnswers(opts?: { now?: Date; deadline?: number; limit?: number }): Promise<AutopilotTradeRunResult> {
  const now = opts?.now ?? new Date()
  const deadline = opts?.deadline ?? Date.now() + 25_000
  const result: AutopilotTradeRunResult = { offers: 0, accepted: 0, rejected: 0, countered: 0, skipped: {}, failures: [] }
  const skip = (reason: string) => (result.skipped[reason] = (result.skipped[reason] ?? 0) + 1)

  // Only leagues where AllFantasy manages a team at all: a quiet site costs one indexed read.
  const managedLeagues = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM leagues
    WHERE settings ? ${AF_MANAGED_LINEUPS_KEY} AND settings -> ${AF_MANAGED_LINEUPS_KEY} <> '{}'::jsonb`
  if (managedLeagues.length === 0) return result

  const pending = await prisma.redraftTradeProposal.findMany({
    where: {
      leagueId: { in: managedLeagues.map((l) => l.id) },
      status: 'pending',
      acceptedAt: null,
      createdAt: { lte: new Date(now.getTime() - TRADE_ANSWER_DELAY_MS) },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    include: { votes: true, assets: true, valueSnapshot: { select: { payload: true } } },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(opts?.limit ?? MAX_TRADE_ANSWERS_PER_RUN * 5, 500)),
  })
  if (pending.length === 0) return result

  type LeagueCtx = {
    /** Chimmy teams that answer offers, by REDRAFT roster id. */
    teams: Map<string, { rosterId: string; ownerId: string | null; starterIds: string[]; style: Parameters<typeof resolveManagerProfile>[0]['style']; personality: unknown }>
  }
  const leagues = new Map<string, LeagueCtx>()
  const leagueCtx = async (leagueId: string): Promise<LeagueCtx> => {
    const cached = leagues.get(leagueId)
    if (cached) return cached
    const ctx: LeagueCtx = { teams: new Map() }
    leagues.set(leagueId, ctx)
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { id: true, userId: true, settings: true } })
    if (!league) return ctx
    // Without the plan only the free team plays; the others take no offers, as when Chimmy is off.
    const playable = await readPlayableChimmyLineups(league)
    const ids = Object.keys(playable).filter((id) => autopilotTradeMode(playable[id]) !== 'off')
    if (ids.length === 0) return ctx
    const rosters = await prisma.roster.findMany({
      where: { leagueId, id: { in: ids }, redraftRosterId: { not: null } },
      select: { id: true, platformUserId: true, redraftRosterId: true, playerData: true },
    })
    for (const r of rosters) {
      const entry = playable[r.id]!
      // Switched on for a previous owner: the new owner answers their own offers.
      if (managedForOwner(entry, r.platformUserId) === 'new_owner') continue
      ctx.teams.set(r.redraftRosterId!, {
        rosterId: r.id,
        ownerId: r.platformUserId ?? null,
        starterIds: getNormalizedLineupSections(r.playerData).starters.map((row) => String(row.id)).filter(Boolean),
        style: entry.autopilot!.style,
        personality: entry.autopilot!.personality,
      })
    }
    return ctx
  }

  let answered = 0
  for (const row of pending) {
    if (Date.now() >= deadline || answered >= MAX_TRADE_ANSWERS_PER_RUN) break
    try {
      const { valueSnapshot, ...proposal } = row
      const team = (await leagueCtx(proposal.leagueId)).teams.get(proposal.receiverRosterId)
      if (!team) continue
      result.offers += 1

      const multiTeam = isMultiTeamTrade(proposal)
      const profile = resolveManagerProfile({ rosterId: team.rosterId, style: team.style, savedPersonality: team.personality })
      const verdict = decideTradeOffer({
        profile,
        snapshot: (valueSnapshot?.payload ?? null) as TradeValueSnapshot | null,
        rosterId: proposal.receiverRosterId,
        multiTeam,
        starterIds: team.starterIds,
      })

      const owners = await prisma.redraftRoster.findMany({
        where: { id: { in: tradeParticipantRosterIds(proposal) } },
        select: { id: true, ownerId: true },
      })
      const ownerOf = (id: string) => owners.find((o) => o.id === id)?.ownerId ?? undefined
      // Close but not enough: say what would make it work. Any failure here falls back to a plain decline.
      const chimmyTeams = (await leagueCtx(proposal.leagueId)).teams
      const counter = verdict.code === 'not_enough' && !multiTeam && !chimmyTeams.has(proposal.proposerRosterId)
        ? await sendCounterOffer({ proposal: proposal as PendingTradeProposal, snapshot: (valueSnapshot?.payload ?? null) as TradeValueSnapshot | null, profile, now }).catch((e) => {
            console.warn('[chimmy-autopilot] counter-offer skipped', { proposalId: proposal.id, error: String(e) })
            return null
          })
        : null

      const decide = verdict.decision === 'accept' ? acceptRedraftTrade : rejectRedraftTrade
      const outcome = await decide({
        proposal: proposal as PendingTradeProposal,
        actorUserId: CHIMMY_TRADE_ACTOR,
        actorName: CHIMMY_TRADE_ACTOR_NAME,
        reason: counter ? `${counter.plan.reason} It sent you a counter-offer.` : verdict.reason,
        proposerOwnerId: ownerOf(proposal.proposerRosterId),
        receiverOwnerId: ownerOf(proposal.receiverRosterId),
        multiTeam,
        // A multi-team offer is always declined, and a decline needs no acting party.
        actingPartyRosterIds: [],
        participantOwnerIds: tradeParticipantRosterIds(proposal).map(ownerOf),
      })
      answered += 1
      if (outcome.status < 200 || outcome.status >= 300) {
        // The league's own rules said no (deadline, move lock, …). Left pending; it expires by itself.
        skip(String(outcome.body.code ?? `refused_${outcome.status}`))
        continue
      }
      if (verdict.decision === 'accept') result.accepted += 1
      else result.rejected += 1
      if (counter) result.countered += 1
      await logAction({
        leagueId: proposal.leagueId,
        userId: CHIMMY_TRADE_ACTOR,
        actionType: verdict.decision === 'accept' ? TRADE_ACCEPT_ACTION : counter ? TRADE_COUNTER_ACTION : TRADE_REJECT_ACTION,
        entityType: 'roster',
        entityId: team.rosterId,
        metadata: { rosterId: team.rosterId, proposalId: proposal.id, ...(counter ? { counterProposalId: counter.proposalId, counter: counter.plan.kind } : {}), code: verdict.code, give: verdict.give, get: verdict.get, personality: profile.personality, style: profile.style },
      }).catch((e) => console.warn('[chimmy-autopilot] trade audit failed', { proposalId: proposal.id, error: String(e) }))
    } catch (e) {
      result.failures.push({ leagueId: row.leagueId, proposalId: row.id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}

/**
 * Make the counter-offer for a declined-as-not-enough offer, or return null when there is none to make.
 * The new offer runs from the Chimmy team (the original receiver) to the original proposer.
 */
async function sendCounterOffer(args: {
  proposal: PendingTradeProposal
  snapshot: TradeValueSnapshot | null
  profile: ManagerProfile
  now: Date
}): Promise<{ plan: CounterPlan; proposalId: string } | null> {
  const { proposal, snapshot, profile, now } = args
  const chimmyId = proposal.receiverRosterId
  const otherId = proposal.proposerRosterId
  if (!snapshot) return null

  const [sentThisWeek, waitingOnThem] = await Promise.all([
    prisma.redraftTradeProposal.count({ where: { proposerRosterId: chimmyId, createdAt: { gt: new Date(now.getTime() - WEEK_MS) } } }),
    prisma.redraftTradeProposal.count({ where: { proposerRosterId: chimmyId, receiverRosterId: otherId, status: 'pending' } }),
  ])
  if (sentThisWeek >= MAX_COUNTERS_PER_WEEK || waitingOnThem > 0) return null

  const [season, rosters, otherRoster] = await Promise.all([
    prisma.redraftSeason.findFirst({ where: { id: proposal.seasonId, leagueId: proposal.leagueId }, include: { league: { select: { leagueVariant: true } } } }),
    prisma.redraftRoster.findMany({ where: { id: { in: [chimmyId, otherId] }, seasonId: proposal.seasonId, leagueId: proposal.leagueId } }),
    prisma.roster.findFirst({ where: { leagueId: proposal.leagueId, redraftRosterId: otherId }, select: { playerData: true } }),
  ])
  const chimmyRow = rosters.find((r) => r.id === chimmyId)
  const otherRow = rosters.find((r) => r.id === otherId)
  if (!season || !chimmyRow || !otherRow) return null

  // The other team's bench, priced on the same scale as the offer. Never its starters.
  const bench = getNormalizedLineupSections(otherRoster?.playerData).bench
    .map((row) => ({ playerId: String(row.id ?? ''), playerName: typeof row.name === 'string' ? row.name : typeof row.playerName === 'string' ? row.playerName : null }))
    .filter((p) => p.playerId)
    .slice(0, MAX_BENCH_PRICED)
  let askable: AskablePlayer[] = []
  if (bench.length > 0) {
    const priced = await computeRedraftTradeValueSnapshot({
      seasonId: proposal.seasonId,
      leagueId: proposal.leagueId,
      proposerRosterId: otherId,
      receiverRosterId: chimmyId,
      sport: season.sport,
      scoring: season.sport === 'NCAAF' ? 'standard' : 'ppr',
      rosterFormat: 'standard',
      currentSeason: season.season ?? null,
      assets: bench.map((p) => ({ fromRosterId: otherId, toRosterId: chimmyId, assetType: 'player', playerId: p.playerId, playerName: p.playerName })),
    })
    askable = (priced.sides ?? [])
      .flatMap((s) => s.assets ?? [])
      .filter((a) => a.playerId && a.valuationBasis !== 'none' && a.internalValue > 0)
      .map((a) => ({ playerId: String(a.playerId), playerName: a.playerName ?? bench.find((b) => b.playerId === a.playerId)?.playerName ?? null, position: a.position ?? null, value: a.internalValue }))
  }

  const plan = planCounterOffer({ profile, snapshot, rosterId: chimmyId, askable })
  if (!plan) return null

  const kept = plan.kind === 'keep_back' ? plan.keepPlayerId : null
  const assets: TradeAssetInput[] = proposal.assets
    .filter((a) => !(kept && a.fromRosterId === chimmyId && a.assetType === 'player' && a.playerId === kept))
    .map((a) => ({
      fromRosterId: a.fromRosterId,
      toRosterId: a.toRosterId,
      assetType: a.assetType,
      playerId: a.playerId ?? undefined,
      playerName: a.playerName ?? undefined,
      pickSeason: a.pickSeason ?? undefined,
      pickRound: a.pickRound ?? undefined,
      pickNumber: a.pickNumber ?? undefined,
      metadata: (a.metadata ?? {}) as Record<string, unknown>,
    }))
  if (plan.kind === 'add_on') {
    assets.push({ fromRosterId: otherId, toRosterId: chimmyId, assetType: 'player', playerId: plan.add.playerId, playerName: plan.add.playerName ?? undefined })
  }

  const made = await createRedraftTradeProposal({
    leagueId: proposal.leagueId,
    seasonId: proposal.seasonId,
    season,
    proposer: chimmyRow,
    receiver: otherRow,
    additionalRosters: [],
    additionalRosterIds: [],
    actorUserId: CHIMMY_TRADE_ACTOR,
    proposerName: chimmyRow.teamName ? `${CHIMMY_TRADE_ACTOR_NAME} (${chimmyRow.teamName})` : CHIMMY_TRADE_ACTOR_NAME,
    reason: plan.reason,
    assets,
  })
  if (!made.ok || !made.created?.id) return null
  return { plan, proposalId: made.created.id }
}
