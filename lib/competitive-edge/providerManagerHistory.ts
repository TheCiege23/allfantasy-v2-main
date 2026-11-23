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
 *     out. And for Yahoo (2026-11-23) from the historical backfill: one Yahoo transaction is one trade
 *     (`payload.yahooTransactionId`), each leg a row with the team (`rosterId`) and `direction` add / drop,
 *     the team matched to its person per season like the drafts below. ONLY those rows: the import commit
 *     writes the same trade again with `providerTransactionId` and the receiving side only. Yahoo stores no
 *     traded picks, and trades read before the leg fix carry no players — both named as gaps.
 *     Not counted yet for the rest: ESPN stores one row per MESSAGE keyed by the message id, and the topic
 *     id that groups a trade's messages is not stored (and production held no ESPN trades); MFL's parser
 *     reads only per-player `to_franchise`/`from_franchise`, so its trade rows carry no legs; Fleaflicker's
 *     sides lose what was given. A count built on any of those would be a wrong number that looks right.
 *
 *   DRAFTS — ESPN, MFL and Yahoo (2026-11-23): the historical backfill writes each pick under the TEAM
 *     (`dw_draft_facts.managerId` = ESPN team id / MFL franchise id / Yahoo team key) with its season, and in
 *     the same run writes that season's end-of-season roster snapshot per team (`dw_roster_snapshots`,
 *     period 0), each player stamped with the team's `ownerId` — the same id the import puts on
 *     `LeagueTeam.platformUserId`. So a pick is credited to the PERSON who owned the team THAT season, never
 *     to whoever holds the slot now. ⚠ Where the backfill had no person id it stamped the team's own id
 *     instead (`managerId || teamId`, and Yahoo's slot-like numeric `manager_id`); those seasons are left
 *     unattributed and named, never credited.
 *   Not counted: Fantrax has no person per team; Fleaflicker's draft board is read at import but no
 *     importer stores it (there is no Fleaflicker historical backfill), and no per-season team→owner map.
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
import type { EdgeDraftPick } from './draftEdge'

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

/** Platforms whose backfill stores picks by team AND each season's team → person (see the header). */
const DRAFT_TEAM_PLATFORMS = new Set(['espn', 'mfl', 'yahoo'])
/** `SEASON_END_ROSTER_SNAPSHOT_PERIOD` in the ESPN / MFL / Yahoo historical backfills. */
const SEASON_END_SNAPSHOT_PERIOD = 0

export function providerDraftSupport(platform: string): boolean {
  return DRAFT_TEAM_PLATFORMS.has(platform.toLowerCase())
}

const seasonTeamKey = (season: number, teamId: string) => `${season}|${teamId}`

/** MFL franchise ids are zero-padded strings: "0003" and "3" are the same franchise. */
function sameTeamId(a: string, b: string): boolean {
  if (a === b) return true
  return /^\d+$/.test(a) && /^\d+$/.test(b) && a.replace(/^0+/, '') === b.replace(/^0+/, '')
}

/**
 * PURE. The person who owned a team in one season, from that season's snapshot, or null when the backfill
 * recorded none. ⚠ The backfills stamp `managerId || teamId` (Yahoo: `guid || manager_id || team key`), so an
 * owner equal to the team's own id is the fallback, not a person. Yahoo's `manager_id` and ESPN's `team.id`
 * fallback are small integers that name a SLOT, which is reused across seasons — a numeric owner on those two
 * is refused for the same reason Sleeper's slot number is (`draftEdge.ts`). MFL's owner id is kept as given.
 */
export function seasonOwnerFromSnapshot(platform: string, teamId: string, rosterPlayers: unknown): string | null {
  if (!Array.isArray(rosterPlayers)) return null
  const owners = new Set<string>()
  for (const p of rosterPlayers) {
    const v = p && typeof p === 'object' ? (p as { ownerId?: unknown }).ownerId : null
    if (typeof v === 'string' && v.trim()) owners.add(v.trim())
  }
  if (owners.size !== 1) return null
  const owner = [...owners][0]!
  if (sameTeamId(owner, teamId.trim()) || owner === 'manager') return null
  const p = platform.toLowerCase()
  if ((p === 'espn' || p === 'yahoo') && /^\d+$/.test(owner)) return null
  return owner
}

/** PURE. Every `season|team` → person the snapshots name. */
export function seasonTeamOwners(
  platform: string,
  rows: ReadonlyArray<{ teamId: string; season: number | null; rosterPlayers: unknown }>,
): Map<string, string> {
  const out = new Map<string, string>()
  const refused = new Set<string>()
  for (const r of rows) {
    if (r.season == null) continue
    const key = seasonTeamKey(r.season, String(r.teamId).trim())
    const owner = seasonOwnerFromSnapshot(platform, String(r.teamId), r.rosterPlayers)
    // Two snapshots for one team-season that disagree are not a person either.
    if (!owner || refused.has(key) || (out.has(key) && out.get(key) !== owner)) {
      out.delete(key)
      refused.add(key)
      continue
    }
    out.set(key, owner)
  }
  return out
}

/** PURE. Stored picks (filed under the team) credited to the person who owned that team that season. */
export function creditProviderDraftPicks(
  rows: ReadonlyArray<{ season: number | null; round: number; playerId: string; managerId: string | null }>,
  owners: ReadonlyMap<string, string>,
  positionOf: (playerId: string) => string | null,
): { picks: EdgeDraftPick[]; unattributedSeasons: number[] } {
  const picks: EdgeDraftPick[] = []
  const unattributed = new Set<number>()
  for (const r of rows) {
    if (r.season == null) continue
    const team = String(r.managerId ?? '').trim()
    const owner = team ? owners.get(seasonTeamKey(r.season, team)) : undefined
    if (!owner) {
      unattributed.add(r.season)
      continue
    }
    picks.push({ season: r.season, round: r.round, position: positionOf(r.playerId), ownerSleeperId: owner })
  }
  return { picks, unattributedSeasons: [...unattributed].sort((a, b) => a - b) }
}

/**
 * An ESPN / MFL / Yahoo league's past drafts, each pick credited to the person who owned the drafting team that
 * season, or why there are none to count.
 *
 * ⚠ NO ROWS IS NOT "NEVER DRAFTED" — it is a league whose history was not backfilled, said in words. And picks on
 * file with NO owner for any season would make every manager read "0 drafts", so that is a reason too.
 * ⚠ A draft held after the import is not here: drafts are written by the one-time backfill only (the daily refresh
 * re-reads waiver claims). The record's `seasons` list shows which seasons were read.
 */
export async function readProviderDrafts(league: {
  id: string
  sport: string
  platform: string
}): Promise<SectionState<{ picks: EdgeDraftPick[]; unattributedSeasons: number[] }>> {
  const platform = league.platform.toLowerCase()
  if (!providerDraftSupport(platform)) return { available: false, reason: providerDraftsReason(platform) }

  const [rows, snapshots] = await Promise.all([
    prisma.draftFact.findMany({
      where: { leagueId: league.id, season: { not: null } },
      select: { season: true, round: true, playerId: true, managerId: true },
    }),
    prisma.rosterSnapshot.findMany({
      where: { leagueId: league.id, weekOrPeriod: SEASON_END_SNAPSHOT_PERIOD, season: { not: null } },
      select: { teamId: true, season: true, rosterPlayers: true },
    }),
  ])
  if (rows.length === 0) return { available: false, reason: `No ${platformLabel(platform)} draft picks have been imported for this league yet.` }

  const owners = seasonTeamOwners(platform, snapshots)
  const players = await resolveTradePlayers(
    rows.map((r) => r.playerId),
    { space: playerIdSpaceFor({ platform, sport: league.sport }), sport: league.sport },
  ).catch(() => new Map())
  const positionOf = (id: string) => {
    const p = players.get(id)
    return p?.ok ? p.position : null
  }
  const credited = creditProviderDraftPicks(rows, owners, positionOf)
  if (credited.picks.length === 0) {
    return {
      available: false,
      reason: `${platformLabel(platform)} draft picks are on file, but who owned each team in those seasons wasn't recorded.`,
    }
  }
  return { available: true, data: credited }
}

/** Yahoo transaction statuses that are not a completed trade. Yahoo's league feed lists completed ones; this is a floor. */
const NOT_COMPLETED = new Set(['pending', 'proposed', 'vetoed', 'rejected', 'declined', 'cancelled', 'canceled', 'failed'])

type StoredYahooTradeRow = { playerId: string | null; rosterId: string | null; season: number | null; createdAt: Date; payload: unknown }

/**
 * PURE. The Yahoo backfill's trade rows into the record builder's trades: one trade per Yahoo transaction, one side
 * per team in it, each side credited to the person who owned that team that season. A trade with no player legs (read
 * before the leg fix) or fewer than two teams is not a trade we can read: left out and its season named. A side whose
 * team has no person on file that season stays in the trade with no owner, so it is credited to nobody.
 */
export function yahooTradeRowsToEdge(
  rows: ReadonlyArray<StoredYahooTradeRow>,
  owners: ReadonlyMap<string, string>,
  positionOf: (playerId: string) => string | null,
): { trades: EdgeTrade[]; unreadableSeasons: number[]; unmatchedSeasons: number[] } {
  const byTx = new Map<string, StoredYahooTradeRow[]>()
  for (const r of rows) {
    const p = (r.payload ?? {}) as Record<string, unknown>
    const id = typeof p.yahooTransactionId === 'string' ? p.yahooTransactionId.trim() : ''
    if (!id) continue
    const held = byTx.get(id)
    if (held) held.push(r)
    else byTx.set(id, [r])
  }
  const trades: EdgeTrade[] = []
  const unreadable = new Set<number>()
  const unmatched = new Set<number>()
  for (const [id, group] of byTx) {
    const season = group.find((r) => r.season != null)?.season ?? null
    if (season == null) continue
    const statuses = group.map((r) => String(((r.payload ?? {}) as Record<string, unknown>).status ?? '').toLowerCase())
    if (statuses.some((st) => NOT_COMPLETED.has(st))) continue
    // One leg per player, direction and team — a status re-read writes the same leg again under a new row.
    const legs = new Map<string, { playerId: string; team: string; dir: 'add' | 'drop' }>()
    for (const r of group) {
      const dir = ((r.payload ?? {}) as Record<string, unknown>).direction
      const team = String(r.rosterId ?? '').trim()
      if (!r.playerId || !team || (dir !== 'add' && dir !== 'drop')) continue
      legs.set(`${r.playerId}|${dir}|${team}`, { playerId: r.playerId, team, dir })
    }
    const teams = [...new Set([...legs.values()].map((l) => l.team))]
    if (legs.size === 0 || teams.length < 2) {
      unreadable.add(season)
      continue
    }
    const sides: EdgeTradeSide[] = teams.map((team) => {
      const owner = owners.get(seasonTeamKey(season, team)) ?? null
      if (!owner) unmatched.add(season)
      const mine = [...legs.values()].filter((l) => l.team === team)
      return {
        ownerId: owner,
        playersIn: mine.filter((l) => l.dir === 'add').map((l) => ({ position: positionOf(l.playerId) })),
        playersOut: mine.filter((l) => l.dir === 'drop').map((l) => ({ position: positionOf(l.playerId) })),
        picksIn: [],
        picksOut: [],
      }
    })
    const at = group.reduce((min, r) => (r.createdAt < min ? r.createdAt : min), group[0]!.createdAt)
    trades.push({ id: `yahoo:${id}`, season: String(season), week: 0, createdIso: at.toISOString(), sides })
  }
  trades.sort((a, b) => b.createdIso.localeCompare(a.createdIso))
  return {
    trades,
    unreadableSeasons: [...unreadable].sort((a, b) => a - b),
    unmatchedSeasons: [...unmatched].sort((a, b) => a - b),
  }
}

/**
 * A Yahoo league's trades from its historical backfill, or why there are none to count.
 *
 * ⚠ NO SNAPSHOTS MEANS THE BACKFILL NEVER RAN — said in words, never "0 trades". With snapshots and no trade rows the
 * backfill ran and saw none, which reads as "no completed trades on file" — true of what is on file.
 * ⚠ Written once, at import (there is no daily Yahoo refresh), so the history is as of that import and goes stale.
 */
export async function readYahooTrades(
  league: { id: string; sport: string; platform: string },
  now: Date = new Date(),
): Promise<SectionState<{ trades: EdgeTrade[]; seasonsScanned: string[]; historyGaps: string[]; asOf: string; stale: boolean }>> {
  const [rows, snapshots] = await Promise.all([
    prisma.transactionFact.findMany({
      where: { leagueId: league.id, type: 'trade' },
      select: { playerId: true, rosterId: true, season: true, createdAt: true, payload: true },
    }),
    prisma.rosterSnapshot.findMany({
      where: { leagueId: league.id, weekOrPeriod: SEASON_END_SNAPSHOT_PERIOD, season: { not: null } },
      select: { teamId: true, season: true, rosterPlayers: true, createdAt: true },
    }),
  ])
  if (snapshots.length === 0) {
    return { available: false, reason: "Yahoo's season-by-season history hasn't been imported for this league yet, so its trades can't be counted per manager." }
  }
  const owners = seasonTeamOwners('yahoo', snapshots)
  const players = await resolveTradePlayers(
    rows.map((r) => r.playerId).filter((x): x is string => Boolean(x)),
    { space: playerIdSpaceFor({ platform: 'yahoo', sport: league.sport }), sport: league.sport },
  ).catch(() => new Map())
  const positionOf = (id: string) => {
    const p = players.get(id)
    return p?.ok ? p.position : null
  }
  const read = yahooTradeRowsToEdge(rows, owners, positionOf)
  const importedAt = snapshots.reduce((max, s) => (s.createdAt > max ? s.createdAt : max), snapshots[0]!.createdAt)
  const historyGaps = ["Draft picks moved in Yahoo trades aren't stored in the imported transactions, so these counts are players only."]
  if (read.unreadableSeasons.length) {
    historyGaps.push(`Some Yahoo trades from ${read.unreadableSeasons.join(', ')} were imported without the players each team got, so they aren't counted until the league's transactions are imported again.`)
  }
  if (read.unmatchedSeasons.length) {
    historyGaps.push(`In ${read.unmatchedSeasons.join(', ')}, some teams' managers weren't recorded, so their side of a trade isn't credited to anyone.`)
  }
  return {
    available: true,
    data: {
      trades: read.trades,
      seasonsScanned: [...new Set(snapshots.flatMap((s) => (s.season == null ? [] : [String(s.season)])))].sort(),
      historyGaps,
      asOf: importedAt.toISOString(),
      stale: now.getTime() - importedAt.getTime() > STALE_AFTER_MS,
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
