/**
 * The future draft picks each team of a NATIVE dynasty league holds, the one writer that moves
 * them, and the read that hands them to next season's rookie draft.
 *
 * 🛑 A NATIVE DYNASTY LEAGUE COULD NOT TRADE A FUTURE PICK. The Trade Center offers picks from
 * `Roster.playerData`, and in a native league that JSON holds the players each team DRAFTED — no
 * pick objects with ids. So no native team ever had a "2027 1st" to put in an offer, and a pick
 * moved any other way would have been ignored anyway: `createNextLeagueDraft` started every rookie
 * draft with no traded picks, so the original team was on the clock for it.
 *
 * The model is the one imported leagues already use (`futurePickInventory.ts`): every team owns its
 * own pick in every round of every upcoming rookie draft, and a `future_draft_picks` row, where one
 * exists, says who holds it instead. Native ids are `Roster.id` — the id a draft's `slotOrder` and
 * `tradedPicks` use — so the inventory, the trade and the draft agree without a mapping.
 *
 * ⚠ THE HORIZON STARTS AFTER THE LEAGUE'S NEWEST DRAFT. Once a season's rookie draft exists, its
 * picks are traded in the draft room (`DraftPickTradeProposal` → `tradedPicks`), not here; a pick
 * listed in both places could be sold twice. Because settlement re-reads the inventory inside the
 * trade's own transaction, an offer made before that draft was created is refused at processing
 * rather than moving a pick the draft has already been built without.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { OPEN_DRAFT_SESSION_STATUSES } from '@/lib/draft-room/currentDraftSession'
import { DYNASTY_DEFAULT_ROOKIE_DRAFT_ROUNDS } from '@/lib/dynasty-core/constants'
import type { SlotOrderEntry, TradedPickRecord } from '@/lib/live-draft-engine/types'
import { isDynastyFamilyLeague } from '@/lib/redraft/offseason/carryDynastyRosters'
import { futurePickInventory, inventoryPickId, type InventoryPick } from './futurePickInventory'

type Db = Prisma.TransactionClient

/** Seasons ahead a native pick can be traded — the three-year horizon imported leagues use. */
export const NATIVE_PICK_YEARS = 3

/** The league's rookie-draft round count, clamped exactly as `createNextLeagueDraft` clamps it. */
export function resolveRookieDraftRounds(configured: number | null | undefined): number {
  return Math.min(Math.max(1, configured ?? DYNASTY_DEFAULT_ROOKIE_DRAFT_ROUNDS), 10)
}

/** A league whose future picks are listed, traded and drafted through this module. */
export function isNativeFuturePickLeague(league: {
  platform?: string | null
  leagueType?: string | null
  isDynasty?: boolean | null
}): boolean {
  return String(league.platform ?? '').trim().toLowerCase() === 'manual' && isDynastyFamilyLeague(league)
}

/**
 * The first season whose rookie-draft picks can still be traded here.
 *
 * - An open draft belongs to the newest season; its picks trade in the draft room, so the horizon
 *   starts the season after it.
 * - With no open draft, a newest season still in `setup` has not been drafted — its picks are open.
 *   Any other newest season has had its draft.
 */
export function nativePickHorizonStart(args: {
  newestSeason: { season: number; status: string } | null
  hasOpenDraft: boolean
  leagueSeason: number | null
}): number | null {
  const newest = args.newestSeason
  if (args.hasOpenDraft) {
    const drafting = newest?.season ?? args.leagueSeason
    return drafting != null ? drafting + 1 : null
  }
  if (newest) return newest.status === 'setup' ? newest.season : newest.season + 1
  return args.leagueSeason != null ? args.leagueSeason + 1 : null
}

/** `fdp:<season>:<round>:<originalRosterId>` → its parts, or null for any other reference. */
export function parseInventoryPickId(ref: string): { season: number; round: number; originalRosterId: string } | null {
  const m = /^fdp:(\d{4}):(\d{1,2}):(.+)$/.exec(ref)
  if (!m) return null
  const round = Number(m[2])
  if (!(round > 0)) return null
  return { season: Number(m[1]), round, originalRosterId: m[3]! }
}

export type NativeFuturePicks = {
  picks: InventoryPick[]
  seasons: number[]
  rounds: number
  /** `fdp:` id → the roster that holds it now. What an offer and its settlement are checked against. */
  ownerByPickId: Map<string, string>
}

/** The league's native future-pick inventory, or null when it has none (not a native dynasty league). */
export async function loadNativeFuturePicks(leagueId: string, db: Db = prisma): Promise<NativeFuturePicks | null> {
  const league = await db.league.findUnique({
    where: { id: leagueId },
    select: { platform: true, leagueType: true, isDynasty: true, season: true },
  })
  if (!league || !isNativeFuturePickLeague(league)) return null

  const [rosters, newestSeason, openDraft, dynasty] = await Promise.all([
    db.roster.findMany({ where: { leagueId }, select: { id: true } }),
    db.redraftSeason.findFirst({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
      select: { season: true, status: true },
    }),
    db.draftSession.findFirst({
      where: { leagueId, status: { in: [...OPEN_DRAFT_SESSION_STATUSES] } },
      select: { id: true },
    }),
    db.dynastyLeagueConfig.findUnique({ where: { leagueId }, select: { rookieDraftRounds: true } }),
  ])
  const start = nativePickHorizonStart({
    newestSeason: newestSeason ? { season: newestSeason.season, status: String(newestSeason.status) } : null,
    hasOpenDraft: Boolean(openDraft),
    leagueSeason: league.season ?? null,
  })
  if (start == null || rosters.length === 0) return null

  const seasons = Array.from({ length: NATIVE_PICK_YEARS }, (_, i) => start + i)
  const rounds = resolveRookieDraftRounds(dynasty?.rookieDraftRounds)
  const stored = await db.futureDraftPick.findMany({
    where: { leagueId, status: 'active', pickSeason: { in: seasons } },
    select: { pickSeason: true, round: true, originalRosterId: true, currentOwnerId: true },
  })
  const picks = futurePickInventory({ teamIds: rosters.map((r) => r.id), seasons, rounds, stored })
  const ownerByPickId = new Map(picks.map((p) => [inventoryPickId(p), p.ownerTeamId]))
  return { picks, seasons, rounds, ownerByPickId }
}

/**
 * Move one native future pick inside a trade's transaction. Re-reads the inventory with `tx`, so
 * the check and the write see the same state: the pick must still be inside the horizon and still
 * held by the sending roster.
 */
export async function transferNativeFuturePick(
  tx: Db,
  args: { leagueId: string; ref: string; fromRosterId: string; toRosterId: string; tradeId?: string | null; now?: Date },
): Promise<void> {
  const parsed = parseInventoryPickId(args.ref)
  if (!parsed) throw new Error('Pick not found on roster')
  const inventory = await loadNativeFuturePicks(args.leagueId, tx)
  const holder = inventory?.ownerByPickId.get(args.ref)
  if (!holder) throw new Error('Pick is no longer tradeable')
  if (holder !== args.fromRosterId) throw new Error('Pick not found on roster')

  const now = args.now ?? new Date()
  const moved = {
    currentOwnerId: args.toRosterId,
    traded: args.toRosterId !== parsed.originalRosterId,
    status: 'active' as const,
    sourceTradeId: args.tradeId ?? null,
    tradedAt: now,
  }
  await tx.futureDraftPick.upsert({
    where: {
      leagueId_pickSeason_round_originalRosterId: {
        leagueId: args.leagueId,
        pickSeason: parsed.season,
        round: parsed.round,
        originalRosterId: parsed.originalRosterId,
      },
    },
    create: {
      leagueId: args.leagueId,
      pickSeason: parsed.season,
      round: parsed.round,
      originalRosterId: parsed.originalRosterId,
      ...moved,
    },
    update: moved,
  })
}

/**
 * The traded picks a new draft for `season` starts with, and the rows it consumes.
 *
 * A pick moves only when both teams are seated in the draft and its round exists in it; every row
 * for the season is marked used either way, so a pick is never applied to a second draft.
 */
export async function consumeNativeFuturePicksForDraft(
  tx: Db,
  args: { leagueId: string; season: number; draftSessionId: string; rounds: number; slotOrder: SlotOrderEntry[]; now?: Date },
): Promise<TradedPickRecord[]> {
  const rows = await tx.futureDraftPick.findMany({
    where: { leagueId: args.leagueId, pickSeason: args.season, status: 'active' },
    select: { id: true, round: true, originalRosterId: true, currentOwnerId: true },
  })
  if (rows.length === 0) return []

  const nameByRoster = new Map(args.slotOrder.map((e) => [e.rosterId, e.displayName]))
  const traded: TradedPickRecord[] = []
  for (const row of rows) {
    if (row.currentOwnerId === row.originalRosterId || row.round > args.rounds) continue
    if (!nameByRoster.has(row.originalRosterId) || !nameByRoster.has(row.currentOwnerId)) continue
    traded.push({
      round: row.round,
      originalRosterId: row.originalRosterId,
      previousOwnerName: nameByRoster.get(row.originalRosterId) ?? '',
      newRosterId: row.currentOwnerId,
      newOwnerName: nameByRoster.get(row.currentOwnerId) ?? '',
      season: String(args.season),
    })
  }
  await tx.futureDraftPick.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { status: 'used', usedInDraftSessionId: args.draftSessionId, usedAt: args.now ?? new Date() },
  })
  return traded
}
