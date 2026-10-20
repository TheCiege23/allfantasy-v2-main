/**
 * Draft-pick trading in a REDRAFT league: the current season's draft only, never a future season.
 *
 * Policy (owner's default, 2026-10-19):
 *   - A pick in the league's current draft — upcoming (`pre_draft` / `configur*`) or running
 *     (`in_progress` / `paused`) — is tradable for any pick not yet made, alone or mixed with players.
 *   - A pick for any later season is refused with `future_picks_not_allowed_in_redraft`.
 *   - A pick already made is refused with `redraft_pick_already_used`.
 *   - Once the draft completes there is nothing left to trade (`redraft_no_draft_picks_available`).
 * Dynasty, devy, C2C, salary-cap and keeper leagues are untouched: they keep `nativeFuturePicks.ts`.
 *
 * ⚠ ONE OWNERSHIP MODEL, THE DRAFT ROOM'S. A current-draft pick is identified exactly the way the
 * draft room resolves an owner — `(round, originalRosterId)` against `DraftSession.slotOrder`, with
 * `DraftSession.tradedPicks` saying who holds it now (`resolvePickOwner`, latest record wins). A
 * trade settles by APPENDING a `TradedPickRecord` to that same array, so the draft room, autopick
 * and the archive put the new owner on the clock with no second table to keep in step. The draft
 * room's own pick-for-pick proposals write the same array, which is why settlement re-reads it
 * inside the trade's transaction and writes conditionally on `version`: a pick sold in the room
 * between offer and settlement is refused here rather than sold twice.
 *
 * ⚠ THE ID CARRIES THE SESSION. `rdp:<draftSessionId>:<round>:<originalRosterId>`. A pick offered
 * against one draft cannot settle against the next season's, even though round and roster match.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER, OPEN_DRAFT_SESSION_STATUSES } from '@/lib/draft-room/currentDraftSession'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import { resolveOverallForRoundSlot } from '@/lib/live-draft-engine/draftPickTradeInventory'
import { isDraftPickRowEmpty } from '@/lib/live-draft-engine/draftPickEmpty'
import type { SlotOrderEntry, TradedPickRecord } from '@/lib/live-draft-engine/types'
import { supportsKeeperDeclarations } from '@/lib/league/keeper-policy'
import { seasonSetupBlocked } from '@/lib/tournament/seasonNativeContract'
import { recordArchiveEvent } from '@/lib/draft-archive/events'
import { parseInventoryPickId } from './nativeFuturePicks'

type Db = Prisma.TransactionClient

export const FUTURE_PICKS_NOT_ALLOWED_IN_REDRAFT = 'future_picks_not_allowed_in_redraft'
export const REDRAFT_PICK_ALREADY_USED = 'redraft_pick_already_used'
export const REDRAFT_NO_DRAFT_PICKS = 'redraft_no_draft_picks_available'
export const REDRAFT_PICK_RECEIVER_NOT_IN_DRAFT = 'redraft_pick_receiver_not_in_draft'

export const FUTURE_PICKS_REDRAFT_REASON =
  'Future draft picks cannot be traded in a redraft league. Only picks in this season’s draft can be traded.'

/** A refusal that keeps its machine-readable code all the way to the route's JSON. */
export class CodedTradeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'CodedTradeError'
  }
}

/**
 * A league that trades only its current draft's picks. Everything dynasty-family (which keeps a
 * rookie draft and a future inventory), salary-cap, and anything with keeper declarations is not.
 */
export function isRedraftPickLeague(league: { leagueType?: string | null; isDynasty?: boolean | null }): boolean {
  if (league.isDynasty === true) return false
  const type = String(league.leagueType ?? '').trim().toLowerCase()
  if (supportsKeeperDeclarations(type)) return false
  // Compound spellings (`c2c_dynasty`, `devy_dynasty`, `salary_cap`) carry multi-season picks too —
  // the same substring reading the trade-settings resolver uses for its C2C and devy gates.
  return !/dynasty|devy|c2c|keeper|salary/.test(type)
}

/** The draft is run by AllFantasy itself, so a pick traded here is the pick the room drafts with. */
export function isNativeDraftPlatform(platform: string | null | undefined): boolean {
  const p = String(platform ?? '').trim().toLowerCase()
  return p === '' || p === 'manual' || p === 'allfantasy'
}

export function redraftPickId(args: { sessionId: string; round: number; originalRosterId: string }): string {
  return `rdp:${args.sessionId}:${args.round}:${args.originalRosterId}`
}

export function parseRedraftPickId(ref: string): { sessionId: string; round: number; originalRosterId: string } | null {
  const m = /^rdp:([^:]+):(\d{1,3}):(.+)$/.exec(String(ref ?? ''))
  if (!m) return null
  const round = Number(m[2])
  if (!(round > 0)) return null
  return { sessionId: m[1]!, round, originalRosterId: m[3]! }
}

export type RedraftDraftPick = {
  pickId: string
  sessionId: string
  season: number | null
  round: number
  slot: number
  overall: number
  originalRosterId: string
  originalOwnerName: string
  ownerRosterId: string
  ownerName: string
}

export type RedraftPickBook = {
  sessionId: string | null
  season: number | null
  draftStatus: string | null
  version: number
  /** No pick can trade: no draft, a completed draft, an auction, an imported draft or a frozen tournament. */
  closed: boolean
  closedReason: string | null
  /** Every pick not yet made, with its current holder. */
  picks: RedraftDraftPick[]
  ownerByPickId: Map<string, string>
  usedPickIds: Set<string>
  slotOrder: SlotOrderEntry[]
  tradedPicks: TradedPickRecord[]
}

export type RedraftSessionView = {
  id: string
  status: string
  draftType: string
  rounds: number
  teamCount: number
  thirdRoundReversal: boolean
  version?: number | null
  slotOrder: unknown
  tradedPicks: unknown
  picks?: { overall: number; playerName?: string | null; position?: string | null; pickMetadata?: unknown }[]
}

const NO_DRAFT_REASON = 'This league has no draft scheduled, so there are no picks to trade.'
const COMPLETED_REASON = 'This season’s draft is complete — there are no picks left to trade.'

function closedBook(season: number | null, reason: string, session?: RedraftSessionView | null): RedraftPickBook {
  return {
    sessionId: session?.id ?? null,
    season,
    draftStatus: session?.status ?? null,
    version: Number(session?.version ?? 0),
    closed: true,
    closedReason: reason,
    picks: [],
    ownerByPickId: new Map(),
    usedPickIds: new Set(),
    slotOrder: [],
    tradedPicks: [],
  }
}

/** Pure: the current draft's tradable picks, from the same session row the draft room reads. */
export function buildRedraftPickBook(session: RedraftSessionView | null, season: number | null): RedraftPickBook {
  if (!session) return closedBook(season, NO_DRAFT_REASON)
  const slotOrder = Array.isArray(session.slotOrder) ? (session.slotOrder as SlotOrderEntry[]) : []
  const tradedPicks = Array.isArray(session.tradedPicks) ? (session.tradedPicks as TradedPickRecord[]) : []
  const draftType = String(session.draftType ?? 'snake') as 'snake' | 'linear' | 'auction'

  // A completed draft still lists its picks as used, so "already used" can be said precisely.
  const used = new Set<string>()
  const made = new Set(
    (session.picks ?? []).filter((p) => !isDraftPickRowEmpty(p)).map((p) => p.overall),
  )

  const picks: RedraftDraftPick[] = []
  const ownerByPickId = new Map<string, string>()
  if (draftType !== 'auction') {
    for (let round = 1; round <= session.rounds; round += 1) {
      for (const entry of slotOrder) {
        const overall = resolveOverallForRoundSlot({
          round,
          slot: entry.slot,
          teamCount: session.teamCount,
          draftType,
          thirdRoundReversal: session.thirdRoundReversal,
        })
        if (overall == null) continue
        const pickId = redraftPickId({ sessionId: session.id, round, originalRosterId: entry.rosterId })
        if (made.has(overall)) {
          used.add(pickId)
          continue
        }
        const owner = resolvePickOwner(round, entry.slot, slotOrder, tradedPicks)
        if (!owner) continue
        ownerByPickId.set(pickId, owner.rosterId)
        picks.push({
          pickId,
          sessionId: session.id,
          season,
          round,
          slot: entry.slot,
          overall,
          originalRosterId: entry.rosterId,
          originalOwnerName: entry.displayName,
          ownerRosterId: owner.rosterId,
          ownerName: owner.displayName,
        })
      }
    }
  }
  picks.sort((a, b) => a.overall - b.overall)

  const open = (OPEN_DRAFT_SESSION_STATUSES as readonly string[]).includes(session.status)
  const closedReason = !open
    ? COMPLETED_REASON
    : draftType === 'auction'
      ? 'This is an auction draft, so it has no draft picks to trade.'
      : picks.length === 0
        ? COMPLETED_REASON
        : null
  return {
    sessionId: session.id,
    season,
    draftStatus: session.status,
    version: Number(session.version ?? 0),
    closed: closedReason != null,
    closedReason,
    picks: closedReason ? [] : picks,
    ownerByPickId: closedReason ? new Map() : ownerByPickId,
    usedPickIds: used,
    slotOrder,
    tradedPicks,
  }
}

type LeagueForBook = {
  leagueType?: string | null
  isDynasty?: boolean | null
  platform?: string | null
  season?: number | null
  settings?: unknown
}

/**
 * The league's current-draft pick book, or null when the league is not a redraft league. Pass the
 * league row when the caller already holds it, to save a read.
 */
export async function loadRedraftPickBook(
  leagueId: string,
  db: Db = prisma,
  leagueRow?: LeagueForBook | null,
): Promise<RedraftPickBook | null> {
  const league =
    leagueRow ??
    (await db.league.findUnique({
      where: { id: leagueId },
      select: { leagueType: true, isDynasty: true, platform: true, season: true, settings: true },
    }))
  if (!league || !isRedraftPickLeague(league)) return null
  const season = Number(league.season) || null
  if (!isNativeDraftPlatform(league.platform)) {
    return closedBook(season, 'This league drafts on its own platform, so its picks cannot be traded here.')
  }
  if (seasonSetupBlocked(league.settings)) {
    return closedBook(season, 'Tournament draft rules are frozen, so picks cannot be traded.')
  }
  const session = await db.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: {
      id: true,
      status: true,
      draftType: true,
      rounds: true,
      teamCount: true,
      thirdRoundReversal: true,
      version: true,
      slotOrder: true,
      tradedPicks: true,
      picks: { select: { overall: true, playerName: true, position: true, pickMetadata: true } },
    },
  })
  return buildRedraftPickBook(session as RedraftSessionView | null, season)
}

export type RedraftPickCheck =
  | { ok: true; kind: 'current_draft'; pick: RedraftDraftPick }
  | { ok: true; kind: 'legacy' }
  | { ok: false; code: string; message: string }

/**
 * Pure: may this pick asset move in a redraft league? `rosterPickSeason` is the season a legacy
 * `playerData` pick declares, when the caller found one.
 */
export function checkRedraftPickAsset(
  asset: { itemType: string; itemReference?: string | null; fromRosterId: string; toRosterId: string; metadata?: Record<string, unknown> | null },
  ctx: { book: RedraftPickBook | null; currentSeason: number | null; rosterPickSeason?: number | null },
): RedraftPickCheck {
  const ref = String(asset.itemReference ?? '').trim()
  const future = (): RedraftPickCheck => ({ ok: false, code: FUTURE_PICKS_NOT_ALLOWED_IN_REDRAFT, message: FUTURE_PICKS_REDRAFT_REASON })

  const rdp = parseRedraftPickId(ref)
  if (rdp) {
    const book = ctx.book
    if (!book || book.sessionId !== rdp.sessionId) {
      return { ok: false, code: REDRAFT_NO_DRAFT_PICKS, message: 'This pick belongs to a draft that is no longer current.' }
    }
    if (book.usedPickIds.has(ref)) {
      return { ok: false, code: REDRAFT_PICK_ALREADY_USED, message: 'That pick has already been made, so it cannot be traded.' }
    }
    if (book.closed) {
      return { ok: false, code: REDRAFT_NO_DRAFT_PICKS, message: book.closedReason ?? COMPLETED_REASON }
    }
    const pick = book.picks.find((p) => p.pickId === ref)
    if (!pick || pick.ownerRosterId !== asset.fromRosterId) {
      return { ok: false, code: 'PICK_NOT_OWNED', message: 'Pick is not on the sending roster.' }
    }
    if (!book.slotOrder.some((e) => e.rosterId === asset.toRosterId)) {
      return { ok: false, code: REDRAFT_PICK_RECEIVER_NOT_IN_DRAFT, message: 'The receiving team has no seat in this draft.' }
    }
    return { ok: true, kind: 'current_draft', pick }
  }

  // Everything else that names a pick: the dynasty inventory, a future-typed item, or a dated pick.
  if (asset.itemType === 'future_pick') return future()
  if (parseInventoryPickId(ref)) return future()
  const meta = asset.metadata ?? {}
  const declared = [meta.pickSeason, meta.season, ctx.rosterPickSeason]
    .map((v) => Number(v))
    .find((n) => Number.isFinite(n) && n > 0)
  if (declared != null && ctx.currentSeason != null && declared > ctx.currentSeason) return future()
  return { ok: true, kind: 'legacy' }
}

/**
 * Move one current-draft pick inside a trade's transaction, by appending to the session's
 * `tradedPicks` — the array the draft room reads to decide who is on the clock. Re-reads the book
 * with `tx`, so the check and the write see the same state, and writes only if `version` has not
 * moved since that read.
 */
export async function transferRedraftDraftPick(
  tx: Db,
  args: { leagueId: string; ref: string; fromRosterId: string; toRosterId: string; tradeId?: string | null; now?: Date },
): Promise<TradedPickRecord> {
  const parsed = parseRedraftPickId(args.ref)
  if (!parsed) throw new CodedTradeError('PICK_NOT_OWNED', 'Pick not found on roster')
  const book = await loadRedraftPickBook(args.leagueId, tx)
  const check = checkRedraftPickAsset(
    { itemType: 'rookie_pick', itemReference: args.ref, fromRosterId: args.fromRosterId, toRosterId: args.toRosterId },
    { book, currentSeason: book?.season ?? null },
  )
  if (!check.ok) throw new CodedTradeError(check.code, check.message)
  if (check.kind !== 'current_draft' || !book?.sessionId) throw new CodedTradeError(REDRAFT_NO_DRAFT_PICKS, COMPLETED_REASON)

  const nameOf = (rosterId: string) => book.slotOrder.find((e) => e.rosterId === rosterId)?.displayName ?? 'Team'
  const record: TradedPickRecord = {
    round: parsed.round,
    originalRosterId: parsed.originalRosterId,
    previousOwnerName: nameOf(args.fromRosterId),
    newRosterId: args.toRosterId,
    newOwnerName: nameOf(args.toRosterId),
    ...(book.season != null ? { season: String(book.season) } : {}),
  }
  const now = args.now ?? new Date()
  const written = await tx.draftSession.updateMany({
    where: { id: book.sessionId, version: book.version },
    data: {
      tradedPicks: [...book.tradedPicks, record] as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
      updatedAt: now,
    },
  })
  if (written.count === 0) {
    throw new CodedTradeError('DRAFT_MOVED', 'The draft moved while this trade was being processed. Please try again.')
  }
  // The draft room's own trades record an `ownership` archive event; a trade-center trade does too.
  const updated = await tx.draftSession.findUnique({ where: { id: book.sessionId } })
  if (updated) {
    await recordArchiveEvent(tx, updated, 'ownership', { trades: [record], tradeId: args.tradeId ?? null }, now)
  }
  return record
}
