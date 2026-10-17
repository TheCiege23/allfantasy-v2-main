import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadWaiverWorldFacts } from '@/lib/decision-os/waiver/loader'
import { faabBidFor } from '@/lib/trade-intel/marketValueService'
import { loadLeagueValueMap } from './playerDepth'
import { waiverClaimLink, type PlatformLink } from './platformLinks'

/**
 * "Available in your leagues" — for each league where the searched player is a FREE AGENT
 * (leagueStrip.freeLeagueIds, the same rule as the strip's FA chip): where to claim him, and — AF
 * Pro — a suggested FAAB bid with the league's own winning bids beside it.
 *
 * ⚠ THE BID IS WAIVER INTEL'S FORMULA, NOT A NEW ENGINE. `faabBidFor` (marketValueService) is the
 * market-anchored bid WaiverIntel prices its targets with: this league's format's chart value,
 * against the chart's FAAB anchor, capped at 60% of the budget. The league's winning bids (median /
 * p75) are shown BESIDE it as context, never blended in — the copy says "the room", not "priced
 * from history".
 *
 * ⚠ DB-FIRST, AND THAT IS WHY IT IS NOT WAIVER INTEL'S LOADER. WaiverIntel rebuilds a league's
 * history from the live Sleeper API (~230 calls cold, per viewer). Here every input is already in
 * Postgres: budget and FAAB remaining from the waiver settings and your roster
 * (loadWaiverWorldFacts, any platform), the value from the finder's own per-league value map, and
 * winning bids from `dw_transaction_facts` (Sleeper `waiver.waiverBid` — 37,011 bids across 222
 * leagues measured 2026-09-28 — and ESPN `waiver_add.bidAmount`).
 *
 * Bounded: bids are computed for the first `BID_LEAGUE_CAP` free leagues; the rest are still listed
 * with their claim link and say why no bid was computed.
 */

export const BID_LEAGUE_CAP = 12

export type FreeAgentBidRow = {
  leagueId: string
  leagueName: string
  platform: string
  /** Where to claim him: a VERIFIED waiver screen or the in-app wire — null when neither exists. */
  claim: PlatformLink | null
  /** AF Pro. Null when locked, not computed, or not priceable (see `note`). */
  bid: { amount: number; budget: number; remaining: number | null } | null
  /** This league's winning bids — context for the bid, never part of it. AF Pro with the bid. */
  room: { claims: number; median: number; p75: number } | null
  /** Why there is no bid, in words — null when there is one or the viewer is locked. */
  note: string | null
}

export type FreeAgentBids = { rows: FreeAgentBidRow[]; bidsLocked: boolean }

type HistoryRow = { leagueId: string; claims: number; median: number | null; p75: number | null }

/** Winning bids per league, one query. Numeric strings only — a malformed payload is skipped, not cast. */
async function loadRoom(leagueIds: readonly string[]): Promise<Map<string, { claims: number; median: number; p75: number }>> {
  const out = new Map<string, { claims: number; median: number; p75: number }>()
  if (leagueIds.length === 0) return out
  // POSIX classes and brackets, no backslashes: nothing between here and Postgres can eat an escape.
  const rows = await prisma
    .$queryRaw<HistoryRow[]>(Prisma.sql`
      SELECT "leagueId",
             count(*)::int AS claims,
             (percentile_cont(0.5) WITHIN GROUP (ORDER BY bid))::float8 AS median,
             (percentile_cont(0.75) WITHIN GROUP (ORDER BY bid))::float8 AS p75
      FROM (
        SELECT "leagueId",
               CASE
                 WHEN payload->>'waiverBid' ~ '^[0-9]+([.][0-9]+)?$' THEN (payload->>'waiverBid')::numeric
                 WHEN payload->>'bidAmount' ~ '^[0-9]+([.][0-9]+)?$' THEN (payload->>'bidAmount')::numeric
               END AS bid
        FROM dw_transaction_facts
        WHERE "leagueId" IN (${Prisma.join([...leagueIds])})
          AND type IN ('waiver', 'waiver_add')
          AND coalesce(payload->>'status', 'complete') = 'complete'
      ) b
      WHERE bid > 0
      GROUP BY "leagueId"
    `)
    .catch(() => [] as HistoryRow[])
  for (const r of rows) {
    if (r.median == null || r.p75 == null || !(Number(r.claims) > 0)) continue
    out.set(r.leagueId, { claims: Number(r.claims), median: Math.round(Number(r.median)), p75: Math.round(Number(r.p75)) })
  }
  return out
}

export async function loadFreeAgentBids(args: {
  userId: string
  sleeperId: string | null
  /** The free leagues, from leagueStrip.freeLeagueIds. */
  freeLeagueIds: readonly string[]
  /** False for a viewer without AF Pro (player_depth): bids and the room are neither computed nor sent. */
  includeBids: boolean
}): Promise<FreeAgentBids> {
  const ids = [...new Set(args.freeLeagueIds)]
  if (ids.length === 0) return { rows: [], bidsLocked: !args.includeBids }

  const leagues = await prisma.league
    .findMany({ where: { id: { in: ids } }, select: { id: true, name: true, platform: true, platformLeagueId: true, season: true } })
    .catch(() => [] as Array<{ id: string; name: string | null; platform: string | null; platformLeagueId: string | null; season: number | null }>)
  const byId = new Map(leagues.map((l) => [l.id, l]))
  const ordered = ids.map((id) => byId.get(id)).filter((l): l is NonNullable<typeof l> => Boolean(l))
  ordered.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))

  const priced = args.includeBids && args.sleeperId ? ordered.slice(0, BID_LEAGUE_CAP).map((l) => l.id) : []
  const [values, room, facts] = await Promise.all([
    priced.length ? loadLeagueValueMap([args.sleeperId!], priced).catch(() => new Map()) : Promise.resolve(new Map()),
    priced.length ? loadRoom(priced) : Promise.resolve(new Map<string, { claims: number; median: number; p75: number }>()),
    Promise.all(priced.map(async (id) => [id, await loadWaiverWorldFacts(args.userId, id).catch(() => null)] as const)).then((pairs) => new Map(pairs)),
  ])

  const rows: FreeAgentBidRow[] = ordered.map((l) => {
    const leagueName = l.name ?? 'your league'
    const platform = String(l.platform ?? 'allfantasy')
    const claim = waiverClaimLink({ id: l.id, platform: l.platform, platformLeagueId: l.platformLeagueId, season: l.season, name: l.name })
    const base = { leagueId: l.id, leagueName, platform, claim }
    if (!args.includeBids) return { ...base, bid: null, room: null, note: null }
    if (!args.sleeperId) return { ...base, bid: null, room: null, note: 'no market value to price him' }
    if (!priced.includes(l.id)) return { ...base, bid: null, room: null, note: `bids are shown for ${BID_LEAGUE_CAP} leagues at a time` }

    const f = facts.get(l.id) ?? null
    const leagueRoom = room.get(l.id) ?? null
    const budget = f?.settings.faabBudget ?? null
    /*
     * 🛑 FAAB ONLY WHEN THE LEAGUE'S OWN SETTINGS ROW SAYS SO. Without a row the settings service
     * falls back to the sport's defaults — which can carry a FAAB budget for a league that runs
     * rolling waivers, and a bid there is a number for a mechanism the league does not have.
     * Measured 2026-09-28: 344 of 345 Sleeper leagues carry a row, 255 of them `faab`.
     */
    if (!f || !f.settingsKnown) return { ...base, bid: null, room: leagueRoom, note: 'this league’s waiver settings are not on file' }
    if (f.settings.normalizedWaiverType !== 'faab' || budget == null) return { ...base, bid: null, room: leagueRoom, note: 'waiver-priority league — no FAAB bid' }

    const v = (values.get(l.id) as Map<string, { value: number; faabAnchor?: number | null }> | undefined)?.get(args.sleeperId)
    if (!v) return { ...base, bid: null, room: leagueRoom, note: 'no market value to price him in this format' }
    const raw = faabBidFor(v.value, budget, v.faabAnchor ?? null)
    if (raw == null) return { ...base, bid: null, room: leagueRoom, note: 'the value chart is still syncing' }
    const remaining = f.faabRemaining
    // Never suggest more than you have left.
    const amount = remaining != null ? Math.max(0, Math.min(raw, remaining)) : raw
    return { ...base, bid: { amount, budget, remaining }, room: leagueRoom, note: null }
  })

  return { rows, bidsLocked: !args.includeBids }
}
