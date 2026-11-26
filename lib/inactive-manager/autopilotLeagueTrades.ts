import 'server-only'

/**
 * CHIMMY ANSWERS OFFERS MADE ON THE LEAGUE PAGE.
 *
 * The league page's Trades tab makes offers through the league trade engine
 * (lib/league-trade-engine/tradeService.ts, `AfLeagueTrade`), not the older redraft proposals that
 * ./autopilotTradeService.ts answers. This is the same hourly job for that engine: for every pending
 * two-team offer made TO a team Chimmy runs and takes offers for, decide (./autopilotTrades.ts) and
 * answer through the engine's own accept / decline / counter, acting as the team
 * (lib/league-trade-engine/chimmyActor.ts) — so the deadline, roster rules, Survivor rules, the
 * league's review mode and every notice apply exactly as they do for a manager.
 *
 * Values come from the same pricing every trade screen shows (lib/trade-value), read against the
 * league's redraft season: a league with no season, or an asset the pricing cannot read, is declined.
 *
 * A counter here is the engine's counter: the original offer closes as `countered` and the new one is
 * linked to it, so there is no separate decline.
 */
import { prisma } from '@/lib/prisma'
import { logAction } from '@/server/services/auditService'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { acceptAfLeagueTrade, createAfLeagueTrade, rejectAfLeagueTrade } from '@/lib/league-trade-engine/tradeService'
import { chimmyTradeTeams } from '@/lib/league-trade-engine/chimmyActor'
import { computeRedraftTradeValueSnapshot } from '@/lib/trade-value/captureSnapshot'
import type { TradeValueSnapshot } from '@/lib/trade-value/types'
import { AF_MANAGED_LINEUPS_KEY, readManagedLineups } from './inactiveManagerMode'
import { resolveManagerProfile, type ManagerProfile } from './managerProfile'
import { TRADE_ANSWER_DELAY_MS, decideTradeOffer, planCounterOffer, type AskablePlayer, type TradeAnswer } from './autopilotTrades'

export const LEAGUE_TRADE_ACCEPT_ACTION = 'chimmy_autopilot.league_trade_accept'
export const LEAGUE_TRADE_REJECT_ACTION = 'chimmy_autopilot.league_trade_reject'
export const LEAGUE_TRADE_COUNTER_ACTION = 'chimmy_autopilot.league_trade_counter'

/** Offers answered per run, and counters a Chimmy team may send in any 7 days. */
export const MAX_LEAGUE_ANSWERS_PER_RUN = 40
export const MAX_LEAGUE_COUNTERS_PER_WEEK = 3
const MAX_BENCH_PRICED = 20
const WEEK_MS = 7 * 24 * 3600_000

export type LeagueTradeAnswerRunResult = {
  offers: number
  accepted: number
  rejected: number
  countered: number
  skipped: Record<string, number>
  failures: Array<{ leagueId: string; tradeId: string; error: string }>
}

/** The engine throws a coded error for a rule that said no; anything else is a plain message. */
export function engineRefusalCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code
  if (typeof code === 'string' && code) return code
  const msg = e instanceof Error ? e.message : String(e)
  return `refused:${msg.slice(0, 60)}`
}

type Item = { itemType: string; itemReference: string | null; fromRosterId: string; toRosterId: string; faabAmount: number | null; metadata: unknown }
const meta = (m: unknown) => (m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>) : {})
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * An engine item as a pricing asset on the redraft roster ids, or null when the pricing cannot read it
 * (a specialty asset, a pick with no season or round). Null means the trade is not valued.
 */
export function pricingAsset(item: Item, redraftIdOf: (rosterId: string) => string | undefined) {
  const from = redraftIdOf(item.fromRosterId)
  const to = redraftIdOf(item.toRosterId)
  if (!from || !to) return null
  const md = meta(item.metadata)
  if (item.itemType === 'player' && item.itemReference) return { fromRosterId: from, toRosterId: to, assetType: 'player', playerId: item.itemReference, playerName: typeof md.playerName === 'string' ? md.playerName : null }
  if (item.itemType === 'faab' && num(item.faabAmount) != null) return { fromRosterId: from, toRosterId: to, assetType: 'faab', metadata: { amount: item.faabAmount } }
  if (['rookie_pick', 'future_pick', 'devy_pick'].includes(item.itemType) && num(md.pickSeason) != null && num(md.pickRound) != null) {
    return { fromRosterId: from, toRosterId: to, assetType: 'draft_pick', pickSeason: num(md.pickSeason), pickRound: num(md.pickRound) }
  }
  return null
}

const sectionPlayers = (rows: Array<Record<string, unknown>>) =>
  rows
    .map((row) => ({ playerId: String(row.id ?? ''), playerName: typeof row.name === 'string' ? row.name : typeof row.playerName === 'string' ? row.playerName : null }))
    .filter((p) => p.playerId)

type LeagueCtx = {
  managed: ReturnType<typeof readManagedLineups>
  teams: Awaited<ReturnType<typeof chimmyTradeTeams>>
  /** Roster.id → { redraft roster id, season id, eliminated, playerData } for this league's current season. */
  rosters: Map<string, { redraftId: string | null; seasonId: string | null; eliminated: boolean; playerData: unknown }>
  season: { id: string; sport: string; season: number | null } | null
}

async function loadLeague(leagueId: string): Promise<LeagueCtx> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const teams = await chimmyTradeTeams(leagueId)
  const rows = await prisma.roster.findMany({ where: { leagueId }, select: { id: true, redraftRosterId: true, playerData: true } })
  const redraftIds = rows.map((r) => r.redraftRosterId).filter((id): id is string => Boolean(id))
  const redraft = redraftIds.length
    ? await prisma.redraftRoster.findMany({ where: { id: { in: redraftIds } }, select: { id: true, seasonId: true, isEliminated: true } })
    : []
  const byRedraft = new Map(redraft.map((r) => [r.id, r]))
  const rosters: LeagueCtx['rosters'] = new Map()
  for (const r of rows) {
    const rr = r.redraftRosterId ? byRedraft.get(r.redraftRosterId) : undefined
    rosters.set(r.id, { redraftId: rr?.id ?? null, seasonId: rr?.seasonId ?? null, eliminated: Boolean(rr?.isEliminated), playerData: r.playerData })
  }
  const seasonId = [...rosters.values()].find((r) => r.seasonId)?.seasonId ?? null
  const season = seasonId ? await prisma.redraftSeason.findFirst({ where: { id: seasonId, leagueId }, select: { id: true, sport: true, season: true } }) : null
  return { managed: readManagedLineups(league?.settings), teams, rosters, season: season ? { id: season.id, sport: season.sport, season: season.season ?? null } : null }
}

async function priceDeal(ctx: LeagueCtx, leagueId: string, proposerRosterId: string, receiverRosterId: string, assets: NonNullable<ReturnType<typeof pricingAsset>>[]) {
  return computeRedraftTradeValueSnapshot({
    seasonId: ctx.season!.id,
    leagueId,
    proposerRosterId,
    receiverRosterId,
    sport: ctx.season!.sport,
    scoring: ctx.season!.sport === 'NCAAF' ? 'standard' : 'ppr',
    rosterFormat: 'standard',
    currentSeason: ctx.season!.season,
    assets,
  })
}

export async function runAutopilotLeagueTradeAnswers(opts?: { now?: Date; deadline?: number }): Promise<LeagueTradeAnswerRunResult> {
  const now = opts?.now ?? new Date()
  const deadline = opts?.deadline ?? Date.now() + 25_000
  const result: LeagueTradeAnswerRunResult = { offers: 0, accepted: 0, rejected: 0, countered: 0, skipped: {}, failures: [] }
  const skip = (reason: string) => (result.skipped[reason] = (result.skipped[reason] ?? 0) + 1)

  const managedLeagues = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM leagues
    WHERE settings ? ${AF_MANAGED_LINEUPS_KEY} AND settings -> ${AF_MANAGED_LINEUPS_KEY} <> '{}'::jsonb`
  if (managedLeagues.length === 0) return result

  const pending = await prisma.afLeagueTrade.findMany({
    where: {
      leagueId: { in: managedLeagues.map((l) => l.id) },
      status: 'pending',
      createdAt: { lte: new Date(now.getTime() - TRADE_ANSWER_DELAY_MS) },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    include: { items: true },
    orderBy: { createdAt: 'asc' },
    take: MAX_LEAGUE_ANSWERS_PER_RUN * 5,
  })
  const leagues = new Map<string, Promise<LeagueCtx>>()

  let answered = 0
  for (const trade of pending) {
    if (Date.now() >= deadline || answered >= MAX_LEAGUE_ANSWERS_PER_RUN) break
    try {
      if (!leagues.has(trade.leagueId)) leagues.set(trade.leagueId, loadLeague(trade.leagueId))
      const ctx = await leagues.get(trade.leagueId)!
      const team = ctx.teams.get(trade.receiverRosterId)
      if (!team) continue
      result.offers += 1
      const chimmyId = trade.receiverRosterId
      const entry = ctx.managed[chimmyId]
      const profile = resolveManagerProfile({ rosterId: chimmyId, style: entry?.autopilot?.style, savedPersonality: entry?.autopilot?.personality })
      const participants = [...new Set([trade.proposerRosterId, trade.receiverRosterId, ...trade.items.flatMap((i) => [i.fromRosterId, i.toRosterId])])]
      const multiTeam = participants.length > 2

      const verdict = await decide({ ctx, leagueId: trade.leagueId, trade, chimmyId, profile, multiTeam })
      const counter = verdict.code === 'not_enough' && !multiTeam && !ctx.teams.has(trade.proposerRosterId)
        ? await sendCounter({ ctx, leagueId: trade.leagueId, trade, chimmyId, actorUserId: team.actorUserId, profile, now }).catch((e) => {
            console.warn('[chimmy-autopilot] league counter-offer skipped', { tradeId: trade.id, error: String(e) })
            return null
          })
        : null

      try {
        if (verdict.decision === 'accept') {
          await acceptAfLeagueTrade({ tradeId: trade.id, leagueId: trade.leagueId, userId: team.actorUserId, chimmyForRosterId: chimmyId })
        } else if (!counter) {
          await rejectAfLeagueTrade({ tradeId: trade.id, leagueId: trade.leagueId, userId: team.actorUserId, chimmyForRosterId: chimmyId, note: verdict.reason })
        }
      } catch (e) {
        // The league's own rules said no (deadline, roster limits, …). Left as it was; it expires by itself.
        skip(engineRefusalCode(e))
        answered += 1
        continue
      }
      answered += 1
      if (verdict.decision === 'accept') result.accepted += 1
      else result.rejected += 1
      if (counter) result.countered += 1
      await logAction({
        leagueId: trade.leagueId,
        userId: team.actorUserId,
        actionType: verdict.decision === 'accept' ? LEAGUE_TRADE_ACCEPT_ACTION : counter ? LEAGUE_TRADE_COUNTER_ACTION : LEAGUE_TRADE_REJECT_ACTION,
        entityType: 'roster',
        entityId: chimmyId,
        metadata: { rosterId: chimmyId, tradeId: trade.id, ...(counter ? { counterTradeId: counter.tradeId } : {}), code: verdict.code, reason: verdict.reason, give: verdict.give, get: verdict.get, personality: profile.personality, style: profile.style },
      }).catch((e) => console.warn('[chimmy-autopilot] league trade audit failed', { tradeId: trade.id, error: String(e) }))
    } catch (e) {
      result.failures.push({ leagueId: trade.leagueId, tradeId: trade.id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}

const reject = (code: TradeAnswer['code'], reason: string): TradeAnswer => ({ decision: 'reject', code, reason, give: 0, get: 0 })

async function decide(args: { ctx: LeagueCtx; leagueId: string; trade: { proposerRosterId: string; items: Item[] }; chimmyId: string; profile: ManagerProfile; multiTeam: boolean }): Promise<TradeAnswer> {
  const { ctx, trade, chimmyId, profile } = args
  if (args.multiTeam) return reject('multi_team', 'Chimmy only does two-team trades.')
  const mine = ctx.rosters.get(chimmyId)
  const theirs = ctx.rosters.get(trade.proposerRosterId)
  if (mine?.eliminated || theirs?.eliminated) return reject('eliminated', 'One of these teams is out of the league, so Chimmy passed.')
  if (!ctx.season || !mine?.redraftId || !theirs?.redraftId) return reject('cannot_value', 'Chimmy could not put a value on this deal, so it passed.')
  const redraftIdOf = (id: string) => ctx.rosters.get(id)?.redraftId ?? undefined
  const assets = trade.items.map((i) => pricingAsset(i, redraftIdOf))
  if (assets.some((a) => a == null)) return reject('cannot_value', 'Chimmy could not put a value on this deal, so it passed.')
  const snapshot = (await priceDeal(ctx, args.leagueId, theirs.redraftId, mine.redraftId, assets as NonNullable<(typeof assets)[number]>[])) as TradeValueSnapshot
  return decideTradeOffer({
    profile,
    snapshot,
    rosterId: mine.redraftId,
    multiTeam: false,
    starterIds: getNormalizedLineupSections(mine.playerData).starters.map((row) => String(row.id)).filter(Boolean),
  })
}

/** Make the counter for a close offer through the engine, or return null when there is none to make. */
async function sendCounter(args: {
  ctx: LeagueCtx
  leagueId: string
  trade: { id: string; proposerRosterId: string; items: Item[] }
  chimmyId: string
  actorUserId: string
  profile: ManagerProfile
  now: Date
}): Promise<{ tradeId: string; reason: string } | null> {
  const { ctx, trade, chimmyId, profile, now } = args
  const otherId = trade.proposerRosterId
  const mine = ctx.rosters.get(chimmyId)
  const theirs = ctx.rosters.get(otherId)
  if (!ctx.season || !mine?.redraftId || !theirs?.redraftId) return null
  const sentThisWeek = await prisma.afLeagueTrade.count({ where: { leagueId: args.leagueId, proposerRosterId: chimmyId, createdAt: { gt: new Date(now.getTime() - WEEK_MS) } } })
  if (sentThisWeek >= MAX_LEAGUE_COUNTERS_PER_WEEK) return null

  const redraftIdOf = (id: string) => ctx.rosters.get(id)?.redraftId ?? undefined
  const assets = trade.items.map((i) => pricingAsset(i, redraftIdOf)) as NonNullable<ReturnType<typeof pricingAsset>>[]
  const snapshot = (await priceDeal(ctx, args.leagueId, theirs.redraftId, mine.redraftId, assets)) as TradeValueSnapshot

  // The other team's bench, priced on the same scale. Never its starters.
  const bench = sectionPlayers(getNormalizedLineupSections(theirs.playerData).bench).slice(0, MAX_BENCH_PRICED)
  let askable: AskablePlayer[] = []
  if (bench.length > 0) {
    const priced = await priceDeal(ctx, args.leagueId, theirs.redraftId, mine.redraftId,
      bench.map((p) => ({ fromRosterId: theirs.redraftId!, toRosterId: mine.redraftId!, assetType: 'player', playerId: p.playerId, playerName: p.playerName })))
    askable = (priced.sides ?? [])
      .flatMap((s) => s.assets ?? [])
      .filter((a) => a.playerId && a.valuationBasis !== 'none' && a.internalValue > 0)
      .map((a) => ({ playerId: String(a.playerId), playerName: a.playerName ?? bench.find((b) => b.playerId === a.playerId)?.playerName ?? null, position: a.position ?? null, value: a.internalValue }))
  }
  const plan = planCounterOffer({ profile, snapshot, rosterId: mine.redraftId, askable })
  if (!plan) return null

  // The same deal from Chimmy's side, with the one change. Items keep their engine shape.
  const kept = plan.kind === 'keep_back' ? plan.keepPlayerId : null
  const items = trade.items
    .filter((i) => !(kept && i.fromRosterId === chimmyId && i.itemType === 'player' && i.itemReference === kept))
    .map((i) => ({ itemType: i.itemType as 'player', itemReference: i.itemReference, fromRosterId: i.fromRosterId, toRosterId: i.toRosterId, faabAmount: i.faabAmount, metadata: meta(i.metadata) }))
  if (plan.kind === 'add_on') items.push({ itemType: 'player', itemReference: plan.add.playerId, fromRosterId: otherId, toRosterId: chimmyId, faabAmount: null, metadata: {} })

  const made = await createAfLeagueTrade({
    leagueId: args.leagueId,
    proposedByUserId: args.actorUserId,
    chimmyForRosterId: chimmyId,
    proposerRosterId: chimmyId,
    receiverRosterId: otherId,
    parentTradeId: trade.id,
    assets: items,
    metadata: { source: 'chimmy_autopilot', note: plan.reason },
  })
  return { tradeId: made.id, reason: plan.reason }
}
