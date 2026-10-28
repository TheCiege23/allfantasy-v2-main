/**
 * Renew a REDRAFT league into its next season in one commissioner action — every sport
 * (NFL, NBA, NHL, MLB; nothing here is sport-specific).
 *
 * 🛑 THIS WAS TWO DISCONNECTED PATHS. `POST /api/commissioner/leagues/[id]/renew` cleared
 * `Roster.playerData` and advanced `League.season`, and the next draft was a separate
 * `create_next_draft` control (`createNextLeagueDraft`) that always used the league's default
 * seat order. The `prev_standings` / `worst_to_first` draft-order settings were saved and shown,
 * but nothing ever computed them. A commissioner who renewed and forgot the second step had a
 * league with empty rosters and no draft; one who did both got last year's lineups, pending
 * waiver claims and pending trades carried into a season whose players no longer existed.
 *
 * What one call does, in ONE transaction:
 *   (a) resets every roster — players and lineups cleared, teams and owners kept, FAAB restored
 *       (or carried over, by the commissioner's rule — lib/waiver-wire/faab-rollover.ts);
 *       pending waiver claims and pending trades are CANCELLED (not deleted, so they stay
 *       readable as history);
 *   (b) creates the next `RedraftSeason` (via `ensureNextRedraftSeasonShell`, now writing through
 *       the caller's transaction) and the next `DraftSession`;
 *   (c) orders that draft by the commissioner's choice — random (shuffled server-side), last
 *       season's standings worst-to-first (champion last), reverse standings (champion first),
 *       or an explicit list validated to be exactly the league's teams.
 *
 * Every refusal happens BEFORE the transaction opens, so a bad request resets nothing.
 *
 * Idempotency: a second renew into the same season is refused (`ALREADY_RENEWED`) when
 *   - the newest season is the not-yet-started one a renew created and its draft is still open, or
 *   - `lifecycleMetadata.renewedIntoSeason` (written here) names that newest, not-yet-started
 *     season — which covers a renewed league that has already drafted but not kicked off; or
 *   - inside the transaction, another draft became open between the read and the write.
 * A renew in the following offseason is allowed again, because by then the marked season is
 * `complete` and a new shell is created.
 */
import type { Prisma } from '@prisma/client'
import { randomInt } from 'crypto'
import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER, OPEN_DRAFT_SESSION_STATUSES } from '@/lib/draft-room/currentDraftSession'
import { buildSlotOrderForLeague } from '@/lib/live-draft-engine/DraftSessionService'
import {
  championAndRunnerUp,
  draftRosterIdForOwner,
  rookieOrderFromStandings,
} from '@/lib/live-draft-engine/createNextLeagueDraft'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'
import { ensureNextRedraftSeasonShell } from '@/lib/redraft/offseason/ensureNextRedraftSeasonShell'
import { seasonSetupBlocked } from '@/lib/tournament/seasonNativeContract'
import { SEASON_DRAFT_MUTATION_BLOCKED } from '@/lib/tournament/seasonDraftMutationGate'
import { logAction } from '@/server/services/auditService'
import { effectiveFaabRolloverRule, storedFaabRolloverRule, type RenewalFamily } from '@/lib/waiver-wire/faab-rollover'

export type RenewDraftOrderMode = 'random' | 'standings' | 'reverse_standings' | 'manual'

export const RENEW_DRAFT_ORDER_MODES: readonly RenewDraftOrderMode[] = ['random', 'standings', 'reverse_standings', 'manual']

/**
 * The renew modes ARE the existing `LeagueSettings.draftOrderMethod` values under clearer names —
 * not a parallel enum. `worst_to_first` is "standings" (champion last); `prev_standings` is what
 * `LeagueSettingsTab` already renders as best-record-first, i.e. "reverse standings".
 */
const MODE_ALIASES: Record<string, RenewDraftOrderMode> = {
  random: 'random',
  randomized: 'random',
  standings: 'standings',
  worst_to_first: 'standings',
  reverse_standings: 'reverse_standings',
  prev_standings: 'reverse_standings',
  manual: 'manual',
}

const DRAFT_ORDER_METHOD_FOR_MODE: Record<RenewDraftOrderMode, string> = {
  random: 'randomized',
  standings: 'worst_to_first',
  reverse_standings: 'prev_standings',
  manual: 'manual',
}

export function resolveRenewDraftOrderMode(value: unknown): RenewDraftOrderMode | null {
  if (typeof value !== 'string') return null
  return MODE_ALIASES[value.trim().toLowerCase()] ?? null
}

export function draftOrderMethodForRenewMode(mode: RenewDraftOrderMode): string {
  return DRAFT_ORDER_METHOD_FOR_MODE[mode]
}

export type RenewOrderFailureCode = 'STANDINGS_UNAVAILABLE' | 'INVALID_MANUAL_ORDER'

type RenewTeam = { rosterId: string; displayName: string }

/** Fisher-Yates. `random` returns [0, 1); the default is the crypto RNG, server-side. */
function shuffle<T>(items: T[], random?: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = random ? Math.min(i, Math.floor(random() * (i + 1))) : randomInt(i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** True when `ids` is a permutation of exactly `teams`' roster ids — no gaps, extras or repeats. */
function isExactPermutation(ids: readonly string[], teams: readonly RenewTeam[]): boolean {
  if (ids.length !== teams.length) return false
  const want = new Set(teams.map((t) => t.rosterId))
  const seen = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || !want.has(id) || seen.has(id)) return false
    seen.add(id)
  }
  return seen.size === want.size
}

/**
 * The new draft's seat order. Pure: standings arrive pre-computed as `worstToFirst` roster ids.
 * Standings that do not cover every team are REFUSED rather than padded — guessing where a team
 * with no record picks is a decision for the commissioner (manual or random), not for this code.
 */
export function buildRenewalSlotOrder(args: {
  mode: RenewDraftOrderMode
  teams: RenewTeam[]
  worstToFirst?: string[] | null
  manualOrder?: readonly string[] | null
  random?: () => number
}):
  | { ok: true; slotOrder: SlotOrderEntry[] }
  | { ok: false; code: RenewOrderFailureCode; message: string } {
  const { mode, teams } = args
  const byId = new Map(teams.map((t) => [t.rosterId, t]))
  const toSlots = (ids: string[]): SlotOrderEntry[] =>
    ids.map((rosterId, i) => ({ slot: i + 1, rosterId, displayName: byId.get(rosterId)?.displayName ?? `Team ${i + 1}` }))

  if (mode === 'random') return { ok: true, slotOrder: toSlots(shuffle(teams.map((t) => t.rosterId), args.random)) }

  if (mode === 'manual') {
    const list = Array.isArray(args.manualOrder) ? args.manualOrder : null
    if (!list || !isExactPermutation(list, teams)) {
      return {
        ok: false,
        code: 'INVALID_MANUAL_ORDER',
        message: `A manual draft order must list each of the league's ${teams.length} teams exactly once.`,
      }
    }
    return { ok: true, slotOrder: toSlots([...list]) }
  }

  const worst = args.worstToFirst ?? []
  if (!isExactPermutation(worst, teams)) {
    return {
      ok: false,
      code: 'STANDINGS_UNAVAILABLE',
      message:
        "Last season's standings do not cover every team in this league, so a standings order cannot be built. Choose random or set the order manually.",
    }
  }
  return { ok: true, slotOrder: toSlots(mode === 'standings' ? [...worst] : [...worst].reverse()) }
}

export type RenewRedraftLeagueResult =
  | {
      ok: true
      sessionId: string
      seasonId: string
      season: number
      orderMode: RenewDraftOrderMode
      slotOrder: SlotOrderEntry[]
      rostersReset: number
      waiverClaimsCancelled: number
      tradesCancelled: number
    }
  | {
      ok: false
      code:
        | 'LEAGUE_NOT_FOUND'
        | 'TOURNAMENT_RULES_FROZEN'
        | 'NO_PRIOR_DRAFT'
        | 'NO_SEASON'
        | 'NO_TEAMS'
        | 'SEASON_IN_PROGRESS'
        | 'DRAFT_STILL_OPEN'
        | 'ALREADY_RENEWED'
        | 'INVALID_DRAFT_ORDER'
        | RenewOrderFailureCode
      message: string
    }

export type RenewRedraftLeagueOptions = {
  /** A renew mode or an existing `draftOrderMethod` value. Omitted → the league's saved method. */
  draftOrder?: unknown
  /** Roster ids in pick order, required for `manual`. */
  manualOrder?: unknown
  /** Test seam for the shuffle; production uses crypto. */
  random?: () => number
  /** Whose default FAAB rollover applies when none is stored (faabRolloverFamilyForLeague); redraft when omitted. */
  faabFamily?: RenewalFamily
}

const ALREADY_RENEWED_MESSAGE = 'This league has already been renewed into its next season.'

class AlreadyRenewedError extends Error {}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Last season's final standings as draft-roster ids, worst first, champion last. */
export async function worstToFirstDraftRosterIds(
  leagueId: string,
  outgoingSeasonId: string,
  draftRosters: Array<{ id: string; platformUserId: string | null }>,
): Promise<string[] | null> {
  const standings = await prisma.redraftRoster.findMany({
    where: { leagueId, seasonId: outgoingSeasonId },
    select: { id: true, ownerId: true, wins: true, losses: true, ties: true, pointsFor: true },
  })
  if (standings.length === 0) return null
  const finalists = await championAndRunnerUp(outgoingSeasonId)
  const order = rookieOrderFromStandings(standings, { method: 'standings', ...finalists })
  const ownerBySeasonRoster = new Map(standings.map((r) => [r.id, r.ownerId]))
  const ids: string[] = []
  for (const seasonRosterId of order) {
    const ownerId = ownerBySeasonRoster.get(seasonRosterId)
    const rosterId = ownerId ? draftRosterIdForOwner(ownerId, draftRosters) : null
    if (!rosterId) return null
    ids.push(rosterId)
  }
  return ids
}

export async function renewRedraftLeague(
  leagueId: string,
  actorUserId: string,
  opts: RenewRedraftLeagueOptions = {},
): Promise<RenewRedraftLeagueResult> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      sport: true,
      waiverBudget: true,
      lifecycleState: true,
      lifecycleMetadata: true,
      settings: true,
      waiverSettings: { select: { waiverEngineConfig: true } },
    },
  })
  if (!league) return { ok: false, code: 'LEAGUE_NOT_FOUND', message: 'League not found.' }
  if (seasonSetupBlocked(league.settings)) {
    return { ok: false, code: 'TOURNAMENT_RULES_FROZEN', message: SEASON_DRAFT_MUTATION_BLOCKED }
  }

  // ─── Order mode: explicit, else the league's saved draftOrderMethod, else random. ───
  let mode: RenewDraftOrderMode | null
  if (opts.draftOrder !== undefined && opts.draftOrder !== null && opts.draftOrder !== '') {
    mode = resolveRenewDraftOrderMode(opts.draftOrder)
    if (!mode) {
      return {
        ok: false,
        code: 'INVALID_DRAFT_ORDER',
        message: `Unknown draft order. Use one of: ${RENEW_DRAFT_ORDER_MODES.join(', ')}.`,
      }
    }
  } else {
    const saved = await prisma.leagueSettings
      .findUnique({ where: { leagueId }, select: { draftOrderMethod: true } })
      .catch(() => null)
    mode = resolveRenewDraftOrderMode(saved?.draftOrderMethod)
    // A saved `manual` method carries no list through this call, so it cannot be honoured here.
    if (!mode || mode === 'manual') mode = 'random'
  }

  // ─── Where the league is in its life. ───
  const seasons = await prisma.redraftSeason.findMany({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    take: 2,
    select: { id: true, season: true, status: true },
  })
  const latest = seasons[0]
  if (!latest) return { ok: false, code: 'NO_SEASON', message: 'This league has no season yet.' }

  const previous = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER })
  if (!previous) {
    return { ok: false, code: 'NO_PRIOR_DRAFT', message: 'This league has not drafted yet — set up its first draft instead.' }
  }

  const meta = asRecord(league.lifecycleMetadata)
  let outgoingId: string
  if (latest.status === 'setup') {
    // A not-yet-started season already exists. Ours, if the marker names it or its draft is open.
    if (meta.renewedIntoSeason === latest.season || previous.status !== 'completed') {
      return { ok: false, code: 'ALREADY_RENEWED', message: ALREADY_RENEWED_MESSAGE }
    }
    const before = seasons[1]
    if (!before || before.status !== 'complete') {
      return { ok: false, code: 'SEASON_IN_PROGRESS', message: 'Last season has not been finalized yet.' }
    }
    outgoingId = before.id
  } else if (latest.status === 'complete') {
    if (previous.status !== 'completed') {
      return { ok: false, code: 'DRAFT_STILL_OPEN', message: 'The current draft is not finished yet.' }
    }
    outgoingId = latest.id
  } else {
    return {
      ok: false,
      code: 'SEASON_IN_PROGRESS',
      message: 'This season is still being played. Finalize it before renewing the league.',
    }
  }

  // ─── The league's teams, and the draft order over exactly them. ───
  const draftRosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true },
  })
  if (draftRosters.length === 0) return { ok: false, code: 'NO_TEAMS', message: 'This league has no teams to draft.' }
  const seatOrder = await buildSlotOrderForLeague(leagueId)
  const nameByRoster = new Map(seatOrder.map((s) => [s.rosterId, s.displayName]))
  const seatIndex = new Map(seatOrder.map((s, i) => [s.rosterId, i]))
  const teams: RenewTeam[] = [...draftRosters]
    .sort((a, b) => (seatIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (seatIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER))
    .map((r, i) => ({ rosterId: r.id, displayName: nameByRoster.get(r.id) ?? `Team ${i + 1}` }))

  const worstToFirst =
    mode === 'standings' || mode === 'reverse_standings'
      ? await worstToFirstDraftRosterIds(leagueId, outgoingId, draftRosters)
      : null
  const order = buildRenewalSlotOrder({
    mode,
    teams,
    worstToFirst,
    manualOrder: Array.isArray(opts.manualOrder) ? (opts.manualOrder as string[]) : null,
    random: opts.random,
  })
  if (!order.ok) return order
  const slotOrder = order.slotOrder

  const faab =
    typeof league.waiverBudget === 'number' && Number.isFinite(league.waiverBudget) ? league.waiverBudget : 100
  // The commissioner's FAAB rollover rule (lib/waiver-wire/faab-rollover.ts); unset, a redraft resets
  // and a keeper / dynasty league (the caller's `faabFamily`) carries its balances over.
  const faabRule = effectiveFaabRolloverRule(storedFaabRolloverRule(league.waiverSettings?.waiverEngineConfig), opts.faabFamily ?? 'redraft')
  const now = new Date()
  const fromState = league.lifecycleState

  let written: {
    sessionId: string
    seasonId: string
    season: number
    rostersReset: number
    waiverClaimsCancelled: number
    tradesCancelled: number
  }
  try {
    written = await prisma.$transaction(
      async (tx) => {
        // Re-checked inside the transaction: a concurrent renew may have opened a draft since the read.
        const open = await tx.draftSession.findFirst({
          where: { leagueId, status: { in: [...OPEN_DRAFT_SESSION_STATUSES] } },
          select: { id: true },
        })
        if (open) throw new AlreadyRenewedError(ALREADY_RENEWED_MESSAGE)

        // (b) the season — through THIS transaction, so it rolls back with everything else.
        const incoming = await ensureNextRedraftSeasonShell(leagueId, outgoingId, tx)
        if (!incoming) throw new Error('Next season could not be created.')

        // (a) the reset. Teams and owners (Roster rows, platformUserId, LeagueTeam) are untouched.
        const rosters = await tx.roster.updateMany({
          where: { leagueId },
          data: { playerData: {}, ...(faabRule === 'reset' ? { faabRemaining: faab } : {}) },
        })
        // Carry over: each team keeps its balance; only one with none yet is given the budget.
        if (faabRule === 'carry_over') await tx.roster.updateMany({ where: { leagueId, faabRemaining: null }, data: { faabRemaining: faab } })
        await tx.afRosterLineupAssignment.deleteMany({ where: { leagueId } })
        await tx.afLineupLockState.deleteMany({ where: { leagueId } })
        // A redraft starts every team empty, even when the next-season shell already existed.
        await tx.redraftRosterPlayer.deleteMany({ where: { roster: { seasonId: incoming.id } } })

        const renewNote = `Cancelled: league renewed for ${incoming.season}.`
        const claims = await tx.waiverClaim.updateMany({
          where: { leagueId, status: 'pending' },
          data: { status: 'cancelled', processedAt: now, resultMessage: renewNote },
        })
        const redraftClaims = await tx.redraftWaiverClaim.updateMany({
          where: { leagueId, status: 'pending' },
          data: { status: 'cancelled', processedAt: now, denialReason: renewNote },
        })
        // `pending` and `scheduled` are the states `cancelAfLeagueTrade` itself accepts.
        const afTrades = await tx.afLeagueTrade.updateMany({
          where: { leagueId, status: { in: ['pending', 'scheduled'] } },
          data: { status: 'cancelled', cancelledAt: now },
        })
        const proposals = await tx.redraftTradeProposal.updateMany({
          where: { leagueId, status: 'pending' },
          data: { status: 'cancelled', cancelledAt: now, reason: renewNote },
        })
        const legacyTrades = await tx.redraftLeagueTrade.updateMany({
          where: { leagueId, status: 'pending' },
          data: { status: 'cancelled', processedAt: now, notes: renewNote },
        })

        // (b) the draft, cloned from the last one and ordered by (c).
        const session = await tx.draftSession.create({
          data: {
            leagueId,
            sportType: previous.sportType ?? league.sport ?? null,
            status: 'pre_draft',
            draftType: previous.draftType,
            rounds: previous.rounds,
            teamCount: slotOrder.length,
            thirdRoundReversal: previous.thirdRoundReversal,
            timerSeconds: previous.timerSeconds,
            aiAutoPick: previous.aiAutoPick,
            cpuAutoPick: previous.cpuAutoPick,
            alphabeticalSort: previous.alphabeticalSort,
            playerPool: 'all',
            draftModeLabel: 'standard',
            slotOrder: slotOrder as unknown as Prisma.InputJsonValue,
            auctionBudgetPerTeam: previous.draftType === 'auction' ? previous.auctionBudgetPerTeam : null,
            onClockTradeTimerBehavior: previous.onClockTradeTimerBehavior,
            inDraftPlayerTradesEnabled: previous.inDraftPlayerTradesEnabled,
            customRankingsEnabled: previous.customRankingsEnabled,
          },
          select: { id: true },
        })

        await tx.league.update({
          where: { id: leagueId },
          data: {
            lifecycleState: 'pre_draft',
            lifecycleMetadata: {
              ...meta,
              lastTransitionAt: now.toISOString(),
              lastTransitionFrom: fromState,
              nextDraftCreated: session.id,
              renewedIntoSeason: incoming.season,
              renewedAt: now.toISOString(),
              renewDraftOrder: mode,
            } as Prisma.InputJsonValue,
          },
        })
        await tx.leagueSettings.updateMany({
          where: { leagueId },
          data: { draftOrderMethod: draftOrderMethodForRenewMode(mode!) },
        })

        return {
          sessionId: session.id,
          seasonId: incoming.id,
          season: incoming.season,
          rostersReset: rosters.count,
          waiverClaimsCancelled: claims.count + redraftClaims.count,
          tradesCancelled: afTrades.count + proposals.count + legacyTrades.count,
        }
      },
      // The shell writes one row per roster and per scheduled matchup; the default 5s is not enough.
      { timeout: 60_000, maxWait: 10_000 },
    )
  } catch (error) {
    if (error instanceof AlreadyRenewedError) return { ok: false, code: 'ALREADY_RENEWED', message: error.message }
    // Two renews racing on `@@unique([leagueId, season])` — the loser is a second renew.
    if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
      return { ok: false, code: 'ALREADY_RENEWED', message: ALREADY_RENEWED_MESSAGE }
    }
    throw error
  }

  await logAction({
    leagueId,
    userId: actorUserId,
    actionType: 'league_renewed_redraft',
    entityType: 'draft_session',
    entityId: written.sessionId,
    beforeState: { lifecycleState: fromState, previousDraftSessionId: previous.id, outgoingSeasonId: outgoingId },
    afterState: {
      lifecycleState: 'pre_draft',
      seasonId: written.seasonId,
      season: written.season,
      orderMode: mode,
      slotOrder: slotOrder.map((s) => s.rosterId),
    },
  }).catch(() => null)

  return { ok: true, orderMode: mode, slotOrder, ...written }
}
