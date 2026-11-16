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
 *   TRADES — not counted for any of them yet. ESPN splits one trade into one row per message (and
 *     production held no ESPN trades); MFL's parser is suspected of dropping trades; Fleaflicker's sides
 *     lose what was given; Fantrax trades are inferred and deliberately kept out; Yahoo import is off.
 *     A count built on any of those would be a wrong number that looks right.
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

/** Platforms whose `waiver_add` rows carry the claiming team. */
const WAIVER_TEAM_PLATFORMS = new Set(['espn', 'mfl'])
/** ...and of those, the ones that also record the winning bid. */
const WAIVER_BID_PLATFORMS = new Set(['espn'])

/** Past this, the history may be out of date: provider history is refreshed by the import, not daily. */
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000

export function providerTradesReason(platform: string): string {
  return `${platformLabel(platform)} trades aren't imported in a form that can be counted per manager yet.`
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
