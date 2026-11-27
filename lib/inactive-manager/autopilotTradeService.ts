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
import { AF_MANAGED_LINEUPS_KEY, autopilotRosterIds, autopilotTradeMode, managedForOwner, readManagedLineups } from './inactiveManagerMode'
import { planTradeOffer, sendsThisHour, teamsToShopToday, type PricedPlayer } from './autopilotTradeOffers'
import { WEEKLY_OFFER_LIMIT } from './managerProfile'
import { isSeatPlaceholderUserId } from '@/lib/orphan-ai-manager/orphan-platform-ids'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { readPlayableChimmyLineups } from './chimmyPlayable'
import { resolveManagerProfile } from './managerProfile'
import { TRADE_ANSWER_DELAY_MS, decideTradeOffer, planCounterOffer, type AskablePlayer, type CounterPlan } from './autopilotTrades'
import { createRedraftTradeProposal, type TradeAssetInput } from '@/lib/redraft/createTradeProposal'
import { createAfLeagueTrade } from '@/lib/league-trade-engine/tradeService'
import { engineRefusalCode } from './autopilotLeagueTrades'
// NBA, college basketball and NHL deals are priced on the league's value board (./chimmyBoardPricing.ts).
import { priceChimmyDeal } from './chimmyBoardPricing'
import type { ManagerProfile } from './managerProfile'

/** Who answered, in decision records and audit rows. Not a user: `system:` actors are never FK-written. */
export const CHIMMY_TRADE_ACTOR = 'system:chimmy-autopilot'
export const CHIMMY_TRADE_ACTOR_NAME = 'Chimmy'
export const TRADE_ACCEPT_ACTION = 'chimmy_autopilot.trade_accept'
export const TRADE_REJECT_ACTION = 'chimmy_autopilot.trade_reject'
export const TRADE_COUNTER_ACTION = 'chimmy_autopilot.trade_counter'
export const TRADE_SEND_ACTION = 'chimmy_autopilot.trade_send'
/** Other teams a Chimmy team prices and shops in one day (./autopilotTradeOffers.ts `teamsToShopToday`). */
export const MAX_TEAMS_SHOPPED = 4

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
        select: { id: true, ownerId: true, isEliminated: true },
      })
      const ownerOf = (id: string) => owners.find((o) => o.id === id)?.ownerId ?? undefined
      // A team that is out of the league (Guillotine, Survivor) does not trade: decline, whatever the value.
      const eliminated = owners.some((o) => o.isEliminated)
      if (eliminated) Object.assign(verdict, { decision: 'reject', code: 'eliminated', reason: 'One of these teams is out of the league, so Chimmy passed.' })
      // Close but not enough: say what would make it work. Any failure here falls back to a plain decline.
      const chimmyTeams = (await leagueCtx(proposal.leagueId)).teams
      const counter = verdict.code === 'not_enough' && !eliminated && !multiTeam && !chimmyTeams.has(proposal.proposerRosterId)
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
    const priced = await priceChimmyDeal({
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

export type AutopilotOfferRunResult = {
  teams: number
  sent: number
  skipped: Record<string, number>
  failures: Array<{ leagueId: string; rosterId: string; error: string }>
}

type SeasonCtx = { leagueId: string; seasonId: string; sport: string; season: number | null }

/** Players priced on the trade engine's scale: one read for one team's players, going one way. */
async function pricePlayers(ctx: SeasonCtx, fromRosterId: string, toRosterId: string, players: Array<{ playerId: string; playerName: string | null }>): Promise<PricedPlayer[]> {
  if (players.length === 0) return []
  const priced = await priceChimmyDeal({
    seasonId: ctx.seasonId,
    leagueId: ctx.leagueId,
    proposerRosterId: fromRosterId,
    receiverRosterId: toRosterId,
    sport: ctx.sport,
    scoring: ctx.sport === 'NCAAF' ? 'standard' : 'ppr',
    rosterFormat: 'standard',
    currentSeason: ctx.season,
    assets: players.map((p) => ({ fromRosterId, toRosterId, assetType: 'player', playerId: p.playerId, playerName: p.playerName })),
  })
  return (priced.sides ?? [])
    .flatMap((side) => side.assets ?? [])
    .filter((a) => a.playerId && a.valuationBasis !== 'none' && a.internalValue > 0)
    .map((a) => ({ playerId: String(a.playerId), playerName: a.playerName ?? players.find((p) => p.playerId === a.playerId)?.playerName ?? null, position: a.position ?? null, value: a.internalValue }))
}

const sectionPlayers = (rows: Array<Record<string, unknown>>) =>
  rows
    .map((row) => ({ playerId: String(row.id ?? ''), playerName: typeof row.name === 'string' ? row.name : typeof row.playerName === 'string' ? row.playerName : null }))
    .filter((p) => p.playerId)

/**
 * Hourly: each Chimmy team whose trades are set to "answer and send" makes at most one offer in its
 * own hour of the day (./autopilotTradeOffers.ts) — a bench player for a bench player who upgrades a
 * weak starter. Bounded on every side: a weekly limit by the team's activity (counter-offers count
 * toward it), never while an offer of its own is still waiting, never in the playoffs or while moves
 * are locked, never to another Chimmy team or an empty seat. The offer is made through the one
 * offer-creation implementation, so the deadline and every league rule apply as they do for a manager.
 */
export async function runAutopilotTradeOffers(opts?: { now?: Date; deadline?: number }): Promise<AutopilotOfferRunResult> {
  const now = opts?.now ?? new Date()
  const deadline = opts?.deadline ?? Date.now() + 25_000
  const result: AutopilotOfferRunResult = { teams: 0, sent: 0, skipped: {}, failures: [] }
  const skip = (reason: string) => (result.skipped[reason] = (result.skipped[reason] ?? 0) + 1)

  const managedLeagues = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM leagues
    WHERE settings ? ${AF_MANAGED_LINEUPS_KEY} AND settings -> ${AF_MANAGED_LINEUPS_KEY} <> '{}'::jsonb`

  for (const { id: leagueId } of managedLeagues) {
    if (Date.now() >= deadline) break
    const league = await prisma.league.findUnique({ where: { id: leagueId } }).catch(() => null)
    if (!league) continue
    const playable = await readPlayableChimmyLineups(league).catch(() => ({}) as Awaited<ReturnType<typeof readPlayableChimmyLineups>>)
    const senders = Object.keys(playable).filter((id) => autopilotTradeMode(playable[id]) === 'answer_and_send' && sendsThisHour(id, now))
    if (senders.length === 0) continue
    const status = String(league.status ?? league.lifecycleState ?? '').toLowerCase()
    // Best Ball and Guillotine leagues trade only when their settings say so (the offer would be refused
    // at creation anyway — lib/redraft/tradeProposalValidation.ts — so nothing is priced for them).
    const formatTradesOff = (league.bestBallMode || league.guillotineMode)
      ? !(await import('@/lib/league-trade-engine/tradeSettingsResolver')).resolveLeagueTradeSettings(league).tradesAllowed
      : false
    const blocked = resolveWriteAuthority(league) !== 'NATIVE' ? 'not_native' : !['active', 'in_season'].includes(status) ? 'not_in_season' : league.lockAllMoves ? 'moves_locked' : formatTradesOff ? 'trades_disabled' : null
    if (blocked) {
      for (const _ of senders) skip(blocked)
      continue
    }
    const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, redraftRosterId: true, playerData: true } })
    // Every team Chimmy runs, whatever its trade setting: Chimmy teams do not trade with each other.
    const chimmyRosters = new Set(autopilotRosterIds(readManagedLineups(league.settings)))

    for (const rosterId of senders) {
      if (Date.now() >= deadline) break
      try {
        const mine = rosters.find((r) => r.id === rosterId)
        const entry = playable[rosterId]!
        if (!mine?.redraftRosterId || managedForOwner(entry, mine.platformUserId) === 'new_owner') continue
        result.teams += 1
        const myId = mine.redraftRosterId
        const profile = resolveManagerProfile({ rosterId, style: entry.autopilot!.style, savedPersonality: entry.autopilot!.personality })

        // Chimmy's offers live in the league trade engine, the trades the league page shows.
        const [sentThisWeek, waiting] = await Promise.all([
          prisma.afLeagueTrade.count({ where: { leagueId, proposerRosterId: rosterId, createdAt: { gt: new Date(now.getTime() - WEEK_MS) } } }),
          prisma.afLeagueTrade.count({ where: { leagueId, proposerRosterId: rosterId, status: 'pending' } }),
        ])
        if (sentThisWeek >= WEEKLY_OFFER_LIMIT[profile.activity]) { skip('weekly_limit'); continue }
        if (waiting > 0) { skip('offer_waiting'); continue }

        const myRow = await prisma.redraftRoster.findFirst({ where: { id: myId, leagueId } })
        const season = myRow ? await prisma.redraftSeason.findFirst({ where: { id: myRow.seasonId, leagueId }, include: { league: { select: { leagueVariant: true } } } }) : null
        if (!myRow || !season) { skip('no_season'); continue }
        // A team that is out (Guillotine, Survivor) makes no offers, and nobody is offered to a team that is out.
        if (myRow.isEliminated) { skip('eliminated'); continue }
        const out = new Set((await prisma.redraftRoster.findMany({ where: { seasonId: season.id, leagueId, isEliminated: true }, select: { id: true } })).map((r) => r.id))
        if (season.playoffStartWeek > 0 && season.currentWeek >= season.playoffStartWeek) { skip('playoffs'); continue }
        const ctx: SeasonCtx = { leagueId, seasonId: season.id, sport: season.sport, season: season.season ?? null }

        const targets = rosters
          .filter((o) => o.id !== rosterId && o.redraftRosterId && !out.has(o.redraftRosterId) && !chimmyRosters.has(o.id) && o.platformUserId && !isSeatPlaceholderUserId(o.platformUserId))
          .map((o) => ({ rosterId: o.redraftRosterId!, playerData: o.playerData, leagueRosterId: o.id }))
        const shop = teamsToShopToday(targets, rosterId, now, MAX_TEAMS_SHOPPED)
        if (shop.length === 0) { skip('nobody_to_trade_with'); continue }

        const sections = getNormalizedLineupSections(mine.playerData)
        const myStarters = sectionPlayers(sections.starters)
        const myPriced = await pricePlayers(ctx, myId, shop[0]!.rosterId, [...myStarters, ...sectionPlayers(sections.bench)])
        const starterIds = new Set(myStarters.map((p) => p.playerId))
        // Players those managers have listed on the trade block: askable even when they start.
        const listings = await prisma.redraftTradeBlockItem
          .findMany({
            where: { leagueId, rosterId: { in: shop.map((t) => t.rosterId) }, status: 'active', visibility: 'league', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            select: { rosterId: true, playerId: true, playerName: true, askingForPositions: true },
          })
          .catch(() => [])
        // Managers who have said, where the league can see it, that they want one of this team's players.
        const interests = await prisma.redraftTradeInterest
          .findMany({
            where: { leagueId, fromRosterId: { in: shop.map((t) => t.rosterId) }, status: 'active', visibility: 'league', interestType: 'player_interest', playerId: { in: myPriced.map((p) => p.playerId) } },
            select: { fromRosterId: true, playerId: true },
          })
          .catch(() => [])
        const others = []
        for (const team of shop) {
          const bench = sectionPlayers(getNormalizedLineupSections(team.playerData).bench).slice(0, MAX_BENCH_PRICED)
          const listed = listings.filter((l) => l.rosterId === team.rosterId)
          const benchIds = new Set(bench.map((p) => p.playerId))
          // One pricing read per team: its bench plus any listed player not already on the bench.
          const priced = await pricePlayers(ctx, team.rosterId, myId, [...bench, ...listed.filter((l) => !benchIds.has(l.playerId)).map((l) => ({ playerId: l.playerId, playerName: l.playerName }))])
          others.push({
            rosterId: team.rosterId,
            bench: priced.filter((p) => benchIds.has(p.playerId)),
            block: listed.flatMap((l) => {
              const p = priced.find((x) => x.playerId === l.playerId)
              return p ? [{ ...p, askingForPositions: Array.isArray(l.askingForPositions) ? l.askingForPositions.map(String) : [] }] : []
            }),
            wants: interests.filter((i) => i.fromRosterId === team.rosterId && i.playerId).map((i) => String(i.playerId)),
          })
        }
        const plan = planTradeOffer({
          profile,
          starters: myPriced.filter((p) => starterIds.has(p.playerId)),
          bench: myPriced.filter((p) => !starterIds.has(p.playerId)),
          others,
        })
        if (!plan) { skip('no_offer'); continue }

        const toLeagueRoster = shop.find((t) => t.rosterId === plan.toRosterId)?.leagueRosterId
        if (!toLeagueRoster) { skip('no_season'); continue }
        // Made through the league trade engine as the team itself (lib/league-trade-engine/chimmyActor.ts),
        // so every rule a manager's offer meets applies. A refusal is the league's rules saying no.
        let tradeId: string
        try {
          tradeId = (await createAfLeagueTrade({
            leagueId,
            proposedByUserId: entry.autopilot!.byUserId,
            chimmyForRosterId: rosterId,
            proposerRosterId: rosterId,
            receiverRosterId: toLeagueRoster,
            assets: [
              ...plan.give.map((g) => ({ itemType: 'player' as const, itemReference: g.playerId, fromRosterId: rosterId, toRosterId: toLeagueRoster })),
              { itemType: 'player' as const, itemReference: plan.get.playerId, fromRosterId: toLeagueRoster, toRosterId: rosterId },
            ],
            metadata: { source: 'chimmy_autopilot', note: plan.reason },
          })).id
        } catch (e) {
          skip(engineRefusalCode(e))
          continue
        }
        const made = { created: { id: tradeId } }
        result.sent += 1
        await logAction({
          leagueId,
          userId: CHIMMY_TRADE_ACTOR,
          actionType: TRADE_SEND_ACTION,
          entityType: 'roster',
          entityId: rosterId,
          metadata: { rosterId, proposalId: made.created.id, toRosterId: plan.toRosterId, give: plan.give.map((g) => g.playerId), get: plan.get.playerId, onBlock: plan.onBlock, wanted: plan.wanted, replaces: plan.replaces.playerId, personality: profile.personality, style: profile.style },
        }).catch((e) => console.warn('[chimmy-autopilot] trade audit failed', { rosterId, error: String(e) }))
      } catch (e) {
        result.failures.push({ leagueId, rosterId, error: e instanceof Error ? e.message : String(e) })
      }
    }
  }
  return result
}
