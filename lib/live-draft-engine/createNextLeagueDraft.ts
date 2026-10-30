import { isWeightedRookieLottery } from '@/lib/draft-lottery/rookieOrderMethod'
import { seasonSetupBlocked } from '@/lib/tournament/seasonNativeContract'
import { SEASON_DRAFT_MUTATION_BLOCKED } from '@/lib/tournament/seasonDraftMutationGate'
/**
 * Create a league's NEXT draft once its current one is complete and its season is over.
 *
 * 🛑 THERE WAS NO WAY TO DO THIS. A league got exactly one draft: `getOrCreateDraftSession`
 * returns any existing row, completed or not, and nothing else created a second. So a dynasty
 * league never held a rookie draft and a keeper or redraft league never drafted for year two —
 * the league simply stopped at the end of its first season.
 *
 *   dynasty / devy / C2C  → a ROOKIE draft: `rookies_only` pool, `DynastyLeagueConfig` rounds and
 *                           type. Ordered by the lottery or the live rookie order when on; worst-to-
 *                           first from last season (champion last, runner-up second to last) only
 *                           under the automatic order, an AF Commissioner setting that is off by
 *                           default; otherwise the league's own order. Whole rosters carry over first.
 *   keeper / everything   → a full draft with last draft's settings, and every LOCKED keeper
 *                           placed on the board in the round it costs.
 *
 * The draft is written into NEXT season: the shell `ensureNextRedraftSeasonShell` creates, which
 * `finalizeDraftToRedraftSeason` picks up because it is the league's newest season. Without the
 * shell, year two's picks would land on year one's completed rosters.
 *
 * A native dynasty league's future picks traded before this draft existed (`future_draft_picks`,
 * written by `transferNativeFuturePick`) are placed on its board as `tradedPicks`, and consumed.
 *
 * ⚠ A SECOND DRAFT NEEDS MIGRATION `20260924160000_draft_session_many_per_league`. Until it is
 * applied a database allows one draft per league ever, and the create fails with P2002; that is
 * reported as NEEDS_DATABASE_UPDATE rather than as a server error.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER, OPEN_DRAFT_SESSION_STATUSES } from '@/lib/draft-room/currentDraftSession'
import { buildSlotOrderForLeague } from '@/lib/live-draft-engine/DraftSessionService'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'
import type { KeeperSelection } from '@/lib/live-draft-engine/keeper/types'
import { ensureNextRedraftSeasonShell } from '@/lib/redraft/offseason/ensureNextRedraftSeasonShell'
import { carryDynastyRostersForward, isDynastyFamilyLeague } from '@/lib/redraft/offseason/carryDynastyRosters'
import {
  consumeNativeFuturePicksForDraft,
  isNativeFuturePickLeague,
  resolveRookieDraftRounds,
} from '@/lib/league-trade-engine/nativeFuturePicks'
import { logAction } from '@/server/services/auditService'
import { CHAMPIONSHIP_ROUND_WHERE } from '@/lib/playoff-runtime/playoffRoundWeeks'
import { resolveLiveRookieDraftSlots } from '@/lib/rookie-order/liveRookieOrderService'
import { automaticRookieOrderMethod } from '@/lib/rookie-order/automaticRookieOrder'
import { ensureRookieDraftLottery } from '@/lib/draft-lottery/rookieDraftLottery'

export type NextDraftKind = 'rookie' | 'standard'

export type NextDraftOrderSource = 'lottery' | 'live_rookie_order' | 'standings' | 'default'

/**
 * A stored order is seated only when it places every draft roster exactly once — a stale order
 * from before a manager swap must fall through to standings, never seat a roster that is gone.
 */
function seatsEveryRoster(
  order: { slot: number; rosterId: string; displayName: string }[] | null,
  draftRosters: { id: string }[],
): order is SlotOrderEntry[] {
  if (!order || order.length !== draftRosters.length || order.length === 0) return false
  const ids = new Set(draftRosters.map((r) => r.id))
  const seated = new Set(order.map((e) => e.rosterId))
  const slots = new Set(order.map((e) => e.slot))
  return seated.size === order.length && [...seated].every((id) => ids.has(id)) &&
    slots.size === order.length && order.every((e) => Number.isInteger(e.slot) && e.slot >= 1 && e.slot <= order.length)
}

export type CreateNextDraftResult =
  | {
      ok: true
      sessionId: string
      kind: NextDraftKind
      seasonId: string
      season: number
      rounds: number
      /**
       * `lottery` = the stored weighted-lottery result; `live_rookie_order` = the saved live rookie
       * order (AF Commissioner automation); `standings` = worst-to-first from last season;
       * `default` = the league's usual draft order.
       */
      orderSource: NextDraftOrderSource
      keepersPlaced: number
      playersCarried: number
      /** Future picks traded before this draft existed, now on its board with their new owners. */
      tradedPicksApplied: number
    }
  | {
      ok: false
      code:
        | 'TOURNAMENT_RULES_FROZEN'
        | 'LEAGUE_NOT_FOUND'
        | 'NO_PRIOR_DRAFT'
        | 'DRAFT_STILL_OPEN'
        | 'NO_SEASON'
        | 'SEASON_IN_PROGRESS'
        | 'NEEDS_DATABASE_UPDATE'
        | 'ROOKIE_LOTTERY_UNAVAILABLE'
      message: string
    }

type StandingRow = { id: string; wins: number; losses: number; ties: number; pointsFor: number }

/**
 * Worst to first. `max_pf` orders on points scored alone (the anti-tank method); every other
 * method on record first, points second. The champion always picks last and the runner-up
 * second to last, as the rookie order settings describe.
 */
export function rookieOrderFromStandings(
  rows: StandingRow[],
  opts: { method?: string | null; championId?: string | null; runnerUpId?: string | null } = {},
): string[] {
  const winPct = (r: StandingRow) => {
    const games = r.wins + r.losses + r.ties
    return games > 0 ? (r.wins + r.ties / 2) / games : 0
  }
  const byPoints = String(opts.method ?? '').toLowerCase() === 'max_pf'
  const finalists = new Set([opts.championId, opts.runnerUpId].filter((x): x is string => Boolean(x)))
  const field = rows
    .filter((r) => !finalists.has(r.id))
    .sort((a, b) => {
      if (!byPoints && winPct(a) !== winPct(b)) return winPct(a) - winPct(b)
      if (a.pointsFor !== b.pointsFor) return a.pointsFor - b.pointsFor
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .map((r) => r.id)
  const ids = new Set(rows.map((r) => r.id))
  if (opts.runnerUpId && ids.has(opts.runnerUpId)) field.push(opts.runnerUpId)
  if (opts.championId && ids.has(opts.championId)) field.push(opts.championId)
  return field
}

/** Maps a season roster's `ownerId` to the league's draft roster — the id a pick is made for. */
export function draftRosterIdForOwner(
  ownerId: string,
  rosters: Array<{ id: string; platformUserId: string | null }>,
): string | null {
  if (ownerId.startsWith('roster:')) {
    const id = ownerId.slice('roster:'.length)
    return rosters.some((r) => r.id === id) ? id : null
  }
  return rosters.find((r) => r.platformUserId === ownerId)?.id ?? null
}

/**
 * Keepers in the round they cost, one per round per team. Two keepers costing the same round
 * would claim the same pick and one would vanish from the board, so the later one moves to the
 * next free round (then the nearest earlier one). A cost beyond the last round takes the last.
 */
export function placeKeeperRounds<T extends { rosterId: string; roundCost: number }>(selections: T[], rounds: number): T[] {
  const taken = new Map<string, Set<number>>()
  const placed: T[] = []
  for (const sel of selections) {
    const used = taken.get(sel.rosterId) ?? new Set<number>()
    const want = Math.min(Math.max(1, sel.roundCost), rounds)
    let round: number | null = null
    for (let r = want; r <= rounds && round == null; r++) if (!used.has(r)) round = r
    for (let r = want - 1; r >= 1 && round == null; r--) if (!used.has(r)) round = r
    if (round == null) continue
    used.add(round)
    taken.set(sel.rosterId, used)
    placed.push({ ...sel, roundCost: round })
  }
  return placed
}

function isThirdPlaceGame(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  return String((metadata as Record<string, unknown>).bracketType ?? '').toLowerCase().replace('-', '_') === 'third_place'
}

export async function championAndRunnerUp(seasonId: string): Promise<{ championId: string | null; runnerUpId: string | null }> {
  const finalRound = await prisma.redraftPlayoffRound
    .findFirst({
      // The title bracket only: consolation rounds share this table at `100 + n`, so without the
      // filter the "final round" was the consolation final and the rookie order ignored the champion.
      where: { seasonId, roundNumber: CHAMPIONSHIP_ROUND_WHERE },
      orderBy: { roundNumber: 'desc' },
      select: {
        matchups: {
          orderBy: { matchupNumber: 'asc' },
          select: { homeRosterId: true, awayRosterId: true, winnerRosterId: true, nextMatchupId: true, metadata: true },
        },
      },
    })
    .catch(() => null)
  // The third-place game shares the final's round row; it is not the title game.
  const title = finalRound?.matchups.find((m) => !m.nextMatchupId && m.winnerRosterId && !isThirdPlaceGame(m.metadata))
  if (!title?.winnerRosterId) return { championId: null, runnerUpId: null }
  const runnerUp = title.homeRosterId === title.winnerRosterId ? title.awayRosterId : title.homeRosterId
  return { championId: title.winnerRosterId, runnerUpId: runnerUp ?? null }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002')
}

export async function createNextLeagueDraft(leagueId: string, actorUserId: string): Promise<CreateNextDraftResult> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      sport: true,
      platform: true,
      leagueType: true,
      isDynasty: true,
      keeperCount: true,
      leagueSize: true,
      lifecycleState: true,
      lifecycleMetadata: true,
      settings: true,
      userId: true,
    },
  })
  if (!league) return { ok: false, code: 'LEAGUE_NOT_FOUND', message: 'League not found.' }
  if (seasonSetupBlocked(league.settings)) return { ok: false, code: 'TOURNAMENT_RULES_FROZEN', message: SEASON_DRAFT_MUTATION_BLOCKED }

  const previous = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER })
  if (!previous) {
    return { ok: false, code: 'NO_PRIOR_DRAFT', message: 'This league has not drafted yet — set up its first draft instead.' }
  }
  if (previous.status !== 'completed') {
    return { ok: false, code: 'DRAFT_STILL_OPEN', message: 'The current draft is not finished yet.' }
  }

  const seasons = await prisma.redraftSeason.findMany({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    take: 2,
    select: { id: true, season: true, status: true },
  })
  const latest = seasons[0]
  if (!latest) return { ok: false, code: 'NO_SEASON', message: 'This league has no season yet.' }

  let incoming: { id: string; season: number }
  let outgoingId: string | null
  if (latest.status === 'setup') {
    incoming = latest
    outgoingId = seasons[1]?.id ?? null
  } else if (latest.status === 'complete') {
    const shell = await ensureNextRedraftSeasonShell(leagueId, latest.id)
    if (!shell) return { ok: false, code: 'NO_SEASON', message: 'Next season could not be created.' }
    incoming = shell
    outgoingId = latest.id
  } else {
    return {
      ok: false,
      code: 'SEASON_IN_PROGRESS',
      message: 'This season is still being played. Finalize it before creating next season’s draft.',
    }
  }

  const kind: NextDraftKind = isDynastyFamilyLeague(league) ? 'rookie' : 'standard'
  const draftRosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true },
  })

  let playersCarried = 0
  if (kind === 'rookie' && outgoingId) {
    playersCarried = (await carryDynastyRostersForward(leagueId, outgoingId, incoming.id)).playersCopied
  }

  // Order: worst-to-first for a rookie draft, the league's usual order otherwise.
  let slotOrder: SlotOrderEntry[] | null = null
  let orderSource: NextDraftOrderSource = 'default'
  let rounds = previous.rounds
  let draftType = previous.draftType
  let thirdRoundReversal = previous.thirdRoundReversal
  if (kind === 'rookie') {
    const dynasty = await prisma.dynastyLeagueConfig
      .findUnique({
        where: { leagueId },
        select: { rookieDraftRounds: true, rookieDraftType: true, rookiePickOrderMethod: true },
      })
      .catch(() => null)
    rounds = resolveRookieDraftRounds(dynasty?.rookieDraftRounds)
    draftType = dynasty?.rookieDraftType === 'snake' ? 'snake' : 'linear'
    thirdRoundReversal = false

    /*
     * 🛑 A SAVED ORDER WINS OVER STANDINGS. With the default `max_pf` method this used to go straight
     * to last season's standings, so a weighted-lottery result or the saved live rookie order
     * (`liveRookieOrderService.ts`: "the next rookie draft is seated from it automatically") was
     * silently ignored on exactly the draft it exists for. Same precedence as
     * `buildSlotOrderForLeague`: lottery, then the live order, then worst-to-first.
     *
     * The lottery is THIS draft's draw: one run after the previous draft finished, or — when the
     * league chose the lottery and nobody pressed "Run" — one run now, stored and audited
     * (`rookieDraftLottery.ts`). A league that has not chosen it is not touched.
     */
    const lotteryLeague = isWeightedRookieLottery(dynasty?.rookiePickOrderMethod)
    const lottery = (
      await ensureRookieDraftLottery({
        leagueId,
        season: incoming.season,
        previousDraftEndedAt: previous.completedAt ?? previous.updatedAt ?? null,
        actorUserId,
      }).catch((error) => {
        console.warn('[next-draft] rookie lottery unavailable', { leagueId, error: String(error) })
        return null
      })
    )?.slotOrder ?? null
    if (lotteryLeague && !seatsEveryRoster(lottery, draftRosters)) {
      return { ok: false, code: 'ROOKIE_LOTTERY_UNAVAILABLE', message: 'The weighted rookie lottery could not seat every team. Check the lottery settings and standings, then retry.' }
    }
    if (seatsEveryRoster(lottery, draftRosters)) {
      slotOrder = lottery
      orderSource = 'lottery'
    } else {
      const live = await resolveLiveRookieDraftSlots(leagueId).catch(() => null)
      if (seatsEveryRoster(live, draftRosters)) {
        slotOrder = live
        orderSource = 'live_rookie_order'
      }
    }

    // Standings seat the draft only under the automatic order — an AF Commissioner setting, off by
    // default. A configured weighted lottery must have produced a complete draw above.
    const method = lotteryLeague
      ? 'weighted_lottery'
      : slotOrder
        ? null
        : await automaticRookieOrderMethod({ userId: league.userId ?? null, settings: league.settings })
    if (!slotOrder && outgoingId && method) {
      const standings = await prisma.redraftRoster.findMany({
        where: { leagueId, seasonId: outgoingId },
        select: { id: true, ownerId: true, ownerName: true, teamName: true, wins: true, losses: true, ties: true, pointsFor: true },
      })
      const finalists = await championAndRunnerUp(outgoingId)
      const order = rookieOrderFromStandings(standings, { method, ...finalists })
      const byId = new Map(standings.map((r) => [r.id, r]))
      const entries = order.map((id, i) => {
        const row = byId.get(id)!
        return {
          slot: i + 1,
          rosterId: draftRosterIdForOwner(row.ownerId, draftRosters),
          displayName: row.teamName || row.ownerName,
        }
      })
      if (entries.length > 0 && entries.every((e) => e.rosterId)) {
        slotOrder = entries as SlotOrderEntry[]
        orderSource = 'standings'
      }
    }
  }
  if (!slotOrder) slotOrder = await buildSlotOrderForLeague(leagueId)
  const teamCount = slotOrder.length || previous.teamCount

  // Locked keepers go on the board in the round they cost.
  let keeperSelections: KeeperSelection[] = []
  if (kind === 'standard') {
    const locked = await prisma.keeperRecord.findMany({
      where: { leagueId, seasonId: incoming.id, status: 'locked' },
      orderBy: [{ costRound: 'asc' }, { playerName: 'asc' }],
      select: { rosterId: true, playerId: true, playerName: true, position: true, team: true, costRound: true },
    })
    if (locked.length > 0) {
      const seasonRosters = await prisma.redraftRoster.findMany({
        where: { leagueId, seasonId: incoming.id },
        select: { id: true, ownerId: true },
      })
      const ownerBySeasonRoster = new Map(seasonRosters.map((r) => [r.id, r.ownerId]))
      const mapped: KeeperSelection[] = []
      for (const k of locked) {
        const ownerId = ownerBySeasonRoster.get(k.rosterId)
        const rosterId = ownerId ? draftRosterIdForOwner(ownerId, draftRosters) : null
        // A keeper with no round cost (an auction keeper) has no pick to occupy.
        if (!rosterId || k.costRound == null) continue
        mapped.push({
          rosterId,
          roundCost: k.costRound,
          playerName: k.playerName,
          position: k.position,
          team: k.team ?? null,
          playerId: k.playerId,
        })
      }
      keeperSelections = placeKeeperRounds(mapped, rounds)
    }
  }
  const perRoster = new Map<string, number>()
  for (const k of keeperSelections) perRoster.set(k.rosterId, (perRoster.get(k.rosterId) ?? 0) + 1)
  const maxKeepers = Math.max(league.keeperCount ?? 0, ...perRoster.values(), 0)

  const now = new Date()
  const fromState = league.lifecycleState
  try {
    const created = await prisma.$transaction(async (tx) => {
      const session = await tx.draftSession.create({
        data: {
          leagueId,
          sportType: previous.sportType ?? league.sport ?? null,
          status: 'pre_draft',
          draftType,
          rounds,
          teamCount,
          thirdRoundReversal,
          timerSeconds: previous.timerSeconds,
          aiAutoPick: previous.aiAutoPick,
          cpuAutoPick: previous.cpuAutoPick,
          alphabeticalSort: previous.alphabeticalSort,
          playerPool: kind === 'rookie' ? 'rookies_only' : 'all',
          draftModeLabel: kind,
          slotOrder: slotOrder as unknown as Prisma.InputJsonValue,
          auctionBudgetPerTeam: draftType === 'auction' ? previous.auctionBudgetPerTeam : null,
          devyConfig: kind === 'standard' && previous.devyConfig != null ? (previous.devyConfig as Prisma.InputJsonValue) : undefined,
          c2cConfig: kind === 'standard' && previous.c2cConfig != null ? (previous.c2cConfig as Prisma.InputJsonValue) : undefined,
          keeperConfig: keeperSelections.length > 0 ? ({ maxKeepers } as Prisma.InputJsonValue) : undefined,
          keeperSelections: keeperSelections.length > 0 ? (keeperSelections as unknown as Prisma.InputJsonValue) : undefined,
          onClockTradeTimerBehavior: previous.onClockTradeTimerBehavior,
          inDraftPlayerTradesEnabled: previous.inDraftPlayerTradesEnabled,
          customRankingsEnabled: previous.customRankingsEnabled,
        },
        select: { id: true },
      })
      // Only a native league's rows are in Roster.id space; an import's are provider team ids.
      const tradedPicks = isNativeFuturePickLeague(league)
        ? await consumeNativeFuturePicksForDraft(tx, {
            leagueId,
            season: incoming.season,
            draftSessionId: session.id,
            rounds,
            slotOrder: slotOrder ?? [],
            now,
          })
        : []
      if (tradedPicks.length > 0) {
        await tx.draftSession.update({
          where: { id: session.id },
          data: { tradedPicks: tradedPicks as unknown as Prisma.InputJsonValue },
        })
      }
      // An offseason league refuses every draft action; the new draft needs the league in
      // pre_draft for its settings to be edited, its order set and the draft started.
      if (fromState !== 'pre_draft') {
        const meta =
          league.lifecycleMetadata && typeof league.lifecycleMetadata === 'object' && !Array.isArray(league.lifecycleMetadata)
            ? (league.lifecycleMetadata as Record<string, unknown>)
            : {}
        await tx.league.update({
          where: { id: leagueId },
          data: {
            lifecycleState: 'pre_draft',
            lifecycleMetadata: {
              ...meta,
              lastTransitionAt: now.toISOString(),
              lastTransitionFrom: fromState,
              nextDraftCreated: session.id,
            } as Prisma.InputJsonValue,
          },
        })
      }
      return { ...session, tradedPicksApplied: tradedPicks.length }
    })

    await logAction({
      leagueId,
      userId: actorUserId,
      actionType: 'draft_next_created',
      entityType: 'draft_session',
      entityId: created.id,
      beforeState: { lifecycleState: fromState, previousDraftSessionId: previous.id },
      afterState: { lifecycleState: 'pre_draft', kind, season: incoming.season, rounds, orderSource },
    }).catch(() => null)

    return {
      ok: true,
      sessionId: created.id,
      kind,
      seasonId: incoming.id,
      season: incoming.season,
      rounds,
      orderSource,
      keepersPlaced: keeperSelections.length,
      playersCarried,
      tradedPicksApplied: created.tradedPicksApplied,
    }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const open = await prisma.draftSession.findFirst({
      where: { leagueId, status: { in: [...OPEN_DRAFT_SESSION_STATUSES] } },
      select: { id: true },
    })
    if (open) return { ok: false, code: 'DRAFT_STILL_OPEN', message: 'Another draft was just created for this league.' }
    return {
      ok: false,
      code: 'NEEDS_DATABASE_UPDATE',
      message:
        'This league’s database still allows only one draft per league. It needs the draft-session migration applied before a second draft can be created.',
    }
  }
}
