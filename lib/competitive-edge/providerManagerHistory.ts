/**
 * Manager history for leagues imported from ESPN, Yahoo, MFL, Fantrax and Fleaflicker (2026-11-16,
 * re-score item 11 step E: "all platforms"). What can be counted honestly per manager today, and what
 * cannot, in words. Censused per importer on 2026-11-16, from code only (no database, no provider):
 *
 *   WAIVERS — ESPN and MFL: the historical backfill writes each claim as a `waiver_add` row in
 *     `dw_transaction_facts`, with the team in `managerId` (ESPN also writes the winning bid in
 *     `payload.bidAmount`). ONLY `waiver_add` rows are read: the import commit writes the same claim
 *     again as `waiver`, with no team and no bid, and counting both would double it. MFL records no
 *     bid, so an MFL record states claims and no dollar figures; "spent $0" would be false.
 *   Not counted: Yahoo writes `add` / `drop` only (waiver and free agent cannot be told apart, and Yahoo
 *     import is switched off); Fantrax infers adds from roster diffs and has no person per team;
 *     Fleaflicker imports no waiver activity.
 *
 *   TRADES — counted for Fantrax from the commissioner's own trade-history upload only (2026-11-19, build
 *     item 6): `importFantraxTradeHistory` writes a trade only when every player, pick and team in it was
 *     placed, both sides at once, keyed `fantrax-csv:` — so the trade-inferred-from-roster-diffs rows stay
 *     out. Not counted yet for the rest: ESPN splits one trade into one row per message (and production
 *     held no ESPN trades); MFL's parser is suspected of dropping trades; Fleaflicker's sides lose what was
 *     given; Yahoo import is off. A count built on any of those would be a wrong number that looks right.
 *
 *   DRAFTS — the backfill writes picks under the TEAM, never the person who owned it that season, so
 *     a pick cannot be credited to a manager across seasons. Fleaflicker writes no picks at all.
 *
 * Each "not yet" is a named reason, never an empty section that reads as a quiet manager.
 * DB-first: nothing here calls a provider.
 */
import 'server-only'

import { prisma } from '@/lib/prisma'
import type { SectionState } from '@/lib/core-app/leagueHome'
import { platformLabel } from '@/lib/core-app/platformLinks'
import { playerIdSpaceFor, resolveTradePlayers } from '@/lib/decision-os/trade/tradePlayers'
import type { EdgeWaiverClaim } from './waiverEdge'
import type { EdgeTrade, EdgeTradeSide } from './tradeEdge'

/** Platforms whose `waiver_add` rows carry the claiming team. */
const WAIVER_TEAM_PLATFORMS = new Set(['espn', 'mfl'])
/** ...and of those, the ones that also record the winning bid. */
const WAIVER_BID_PLATFORMS = new Set(['espn'])

/**
 * Past this since the newest claim, the history may be out of date. ESPN and MFL claims are re-read daily since
 * 2026-11-21 (`lib/league-import/providerWaiverRefresh.ts`), so this now flags a quiet league or a failed refresh
 * rather than an import that was never repeated.
 */
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000

export function providerTradesReason(platform: string): string {
  return `${platformLabel(platform)} trades aren't imported in a form that can be counted per manager yet.`
}

/** The id prefix of a trade written from a commissioner's Fantrax export (`fantraxTradeHistoryCsv.ts`). */
const FANTRAX_UPLOAD_PREFIX = 'fantrax-csv:'

type StoredTradeSide = {
  transactionId: string
  season: number
  week: number
  tradeDate: Date | null
  createdAt: Date
  playersGiven: unknown
  playersReceived: unknown
  picksGiven: unknown
  picksReceived: unknown
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [])
const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0)

/**
 * Pure: stored trade sides (one `LeagueTrade` row per side, filed under its owner's `LeagueTradeHistory`) into the
 * record builder's trades. A trade is the rows sharing a transaction id; each row is one owner's side.
 */
export function storedTradeSidesToEdge(
  histories: ReadonlyArray<{ ownerId: string; trades: ReadonlyArray<StoredTradeSide> }>,
  positionOf: (playerId: string) => string | null,
): EdgeTrade[] {
  const byTx = new Map<string, { first: StoredTradeSide; sides: EdgeTradeSide[] }>()
  for (const h of histories) {
    for (const t of h.trades) {
      const side: EdgeTradeSide = {
        ownerId: h.ownerId,
        playersIn: ids(t.playersReceived).map((id) => ({ position: positionOf(id) })),
        playersOut: ids(t.playersGiven).map((id) => ({ position: positionOf(id) })),
        picksIn: Array.from({ length: count(t.picksReceived) }, () => ({})),
        picksOut: Array.from({ length: count(t.picksGiven) }, () => ({})),
      }
      const held = byTx.get(t.transactionId)
      if (held) held.sides.push(side)
      else byTx.set(t.transactionId, { first: t, sides: [side] })
    }
  }
  return [...byTx.entries()]
    .map(([id, { first, sides }]) => ({
      id,
      season: String(first.season),
      week: first.week,
      createdIso: (first.tradeDate ?? first.createdAt).toISOString(),
      sides,
    }))
    .sort((a, b) => b.createdIso.localeCompare(a.createdIso))
}

/**
 * A Fantrax league's trades from the commissioner's uploaded trade history, or why there are none to count.
 *
 * ⚠ NO ROWS IS NOT "NOBODY TRADED". Fantrax sends no trades, so an empty history means the export has not been
 * uploaded — said in words, so a record does not read "0 trades" for a league that traded all season.
 * ⚠ AND OWNERS THAT MATCH NO TEAM ARE NOT ZEROS: if no stored owner is a team's person in this league, every manager
 * would count 0 — the record says the trades could not be matched instead.
 */
export async function readFantraxUploadedTrades(
  league: { platformLeagueId: string | null; sport: string; platform: string },
  teamOwnerIds: ReadonlySet<string>,
  now: Date = new Date(),
): Promise<SectionState<{ trades: EdgeTrade[]; seasonsScanned: string[]; historyGaps: string[]; asOf: string; stale: boolean }>> {
  if (!league.platformLeagueId) return { available: false, reason: 'This league has no Fantrax league id on file.' }
  const histories = await prisma.leagueTradeHistory.findMany({
    where: { sleeperLeagueId: league.platformLeagueId },
    select: {
      sleeperUsername: true,
      trades: {
        where: { platform: 'fantrax', transactionId: { startsWith: FANTRAX_UPLOAD_PREFIX } },
        select: {
          transactionId: true,
          season: true,
          week: true,
          tradeDate: true,
          createdAt: true,
          playersGiven: true,
          playersReceived: true,
          picksGiven: true,
          picksReceived: true,
        },
      },
    },
  })
  const withTrades = histories.filter((h) => h.trades.length > 0)
  if (withTrades.length === 0) {
    return {
      available: false,
      reason: 'No Fantrax trade history has been uploaded for this league yet. The commissioner adds it under Commissioner → Trades and draft archive.',
    }
  }
  if (!withTrades.some((h) => teamOwnerIds.has(h.sleeperUsername))) {
    return { available: false, reason: 'The uploaded Fantrax trades could not be matched to this league’s managers.' }
  }
  const playerIds = withTrades.flatMap((h) => h.trades.flatMap((t) => [...ids(t.playersGiven), ...ids(t.playersReceived)]))
  const space = playerIdSpaceFor({ platform: league.platform, sport: league.sport })
  const players = await resolveTradePlayers(playerIds, { space, sport: league.sport }).catch(() => new Map())
  const positionOf = (id: string) => {
    const p = players.get(id)
    return p?.ok ? p.position : null
  }
  const trades = storedTradeSidesToEdge(
    withTrades.map((h) => ({ ownerId: h.sleeperUsername, trades: h.trades })),
    positionOf,
  )
  return {
    available: true,
    data: {
      trades,
      seasonsScanned: [...new Set(trades.map((t) => t.season))].sort(),
      // Only what was uploaded: a trade after the last export is not here until the next upload.
      historyGaps: ['Only trades in the uploaded Fantrax export are counted; trades made since the last upload are not.'],
      asOf: now.toISOString(),
      stale: false,
    },
  }
}

export function providerDraftsReason(platform: string): string {
  if (platform === 'fantrax') return `${platformLabel(platform)} doesn't give each team a person id, so there is no per-manager history to read.`
  return `${platformLabel(platform)} draft picks aren't matched to the manager who made them yet.`
}

export function providerWaiversReason(platform: string): string {
  if (platform === 'fantrax') return `${platformLabel(platform)} doesn't give each team a person id, so there is no per-manager history to read.`
  return `${platformLabel(platform)} waiver claims aren't imported in a form that can be counted per manager yet.`
}

/** Whether a platform's waiver claims are counted, and whether its bids are known. */
export function providerWaiverSupport(platform: string): { counted: boolean; bids: boolean } {
  const p = platform.toLowerCase()
  return { counted: WAIVER_TEAM_PLATFORMS.has(p), bids: WAIVER_BID_PLATFORMS.has(p) }
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^[0-9]+([.][0-9]+)?$/.test(v) ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

export async function readProviderWaivers(league: {
  id: string
  sport: string
  season: number
  platform: string
}): Promise<SectionState<{ season: number; claims: EdgeWaiverClaim[]; faabByTeam: Map<string, number | null>; bidsKnown: boolean; asOf: string | null; stale: boolean }>> {
  const platform = league.platform.toLowerCase()
  const support = providerWaiverSupport(platform)
  if (!support.counted) return { available: false, reason: providerWaiversReason(platform) }

  const [rows, teams, rosters] = await Promise.all([
    prisma.transactionFact.findMany({
      where: { leagueId: league.id, type: 'waiver_add', season: league.season, managerId: { not: null } },
      select: { transactionId: true, playerId: true, managerId: true, payload: true, createdAt: true },
    }),
    prisma.leagueTeam.findMany({ where: { leagueId: league.id }, select: { externalId: true, platformUserId: true, claimedByUserId: true } }),
    prisma.roster.findMany({ where: { leagueId: league.id }, select: { platformUserId: true, faabRemaining: true } }),
  ])
  const teamIds = new Set(teams.map((t) => t.externalId))
  const players = await resolveTradePlayers(
    rows.map((r) => r.playerId).filter((x): x is string => Boolean(x)),
    { space: playerIdSpaceFor({ platform, sport: league.sport }), sport: league.sport },
  ).catch(() => new Map())

  const claims: EdgeWaiverClaim[] = []
  let last: Date | null = null
  for (const r of rows) {
    const team = String(r.managerId ?? '').trim()
    if (!teamIds.has(team)) continue
    const p = r.playerId ? players.get(r.playerId) : null
    const payload = (r.payload ?? {}) as Record<string, unknown>
    claims.push({
      teamExternalId: team,
      position: p?.ok ? p.position : null,
      bid: support.bids ? num(payload.bidAmount) : null,
      atIso: r.createdAt.toISOString(),
    })
    if (!last || r.createdAt > last) last = r.createdAt
  }

  // A provider roster's owner key is the linked account, else the provider manager id.
  const faabByOwner = new Map(rosters.map((r) => [r.platformUserId, r.faabRemaining ?? null]))
  const faabByTeam = new Map<string, number | null>()
  for (const t of teams) {
    const keys = [t.claimedByUserId, t.platformUserId].filter((k): k is string => Boolean(k))
    const hit = keys.find((k) => faabByOwner.has(k))
    faabByTeam.set(t.externalId, hit ? (faabByOwner.get(hit) ?? null) : null)
  }

  return {
    available: true,
    data: {
      season: league.season,
      claims,
      faabByTeam,
      bidsKnown: support.bids,
      asOf: last ? last.toISOString() : null,
      stale: last ? Date.now() - last.getTime() > STALE_AFTER_MS : false,
    },
  }
}
