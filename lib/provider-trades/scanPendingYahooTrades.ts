import 'server-only'

import { prisma } from '@/lib/prisma'
import { fetchYahooPendingTrades } from '@/lib/league-import/yahoo/YahooLeagueFetchService'
import type { PendingProviderTrade, PendingTradeAsset } from './scanPendingSleeperTrades'

/**
 * Pending Yahoo trades, scanned for ONE league — the Sleeper scan's counterpart.
 *
 * The inbox already knew how to say "we have not read this platform". It now
 * reads one more of them, in the same shape and with the same discipline: the
 * result reports whether the scan RAN, because an empty list means four
 * different things and only one of them is "nothing is waiting".
 *
 * ⚠ READ-ONLY, LIKE SLEEPER, FOR A DIFFERENT REASON. Sleeper's public API has
 * no write endpoint at all. Yahoo's does — it can accept and reject — but this
 * product holds read scopes only and has never asked for more. Either way the
 * honest control is a link out, not an Accept button.
 *
 * ⚠ THE VIEWER'S TEAM COMES FROM OUR OWN TABLES, NOT FROM YAHOO. `LeagueTeam`
 * already records it at import, and asking Yahoo again would cost a round trip
 * to re-derive something we stored. It also keeps the identity rule in one
 * place: claimed team first, then the platform id on the row.
 */

export type PendingYahooScan = {
  trades: PendingProviderTrade[]
  scanned: boolean
  reason: string | null
}

type YahooTrade = {
  transactionId: string
  status: string
  createdAt: string | null
  teamKeys: string[]
  adds: Record<string, string>
  drops: Record<string, string>
}

/**
 * Pure: split one Yahoo trade into what leaves and what arrives, from one
 * team's point of view. Exported for tests.
 *
 * ⚠ `adds` AND `drops` ARE KEYED BY PLAYER, VALUED BY TEAM. A player whose
 * `adds` entry names this team is arriving; one whose `drops` entry names it is
 * leaving. Reading the maps the other way round silently reverses every offer
 * on screen, which reads as a plausible trade rather than as a bug.
 */
export function splitYahooTradeForTeam(args: {
  trade: Pick<YahooTrade, 'adds' | 'drops'>
  teamKey: string
  nameOf?: (playerId: string) => { name: string; position: string | null; team: string | null } | null
}): { assetsGiven: PendingTradeAsset[]; assetsReceived: PendingTradeAsset[] } {
  const assetsGiven: PendingTradeAsset[] = []
  const assetsReceived: PendingTradeAsset[] = []
  const lookup = args.nameOf ?? (() => null)

  for (const [playerId, toTeam] of Object.entries(args.trade.adds ?? {})) {
    if (String(toTeam) !== args.teamKey) continue
    const known = lookup(playerId)
    assetsReceived.push({
      playerId,
      /* The raw id is a poor label, but it is a TRUE one — better than a blank. */
      playerName: known?.name ?? playerId,
      position: known?.position ?? '—',
      team: known?.team ?? '—',
    })
  }

  for (const [playerId, fromTeam] of Object.entries(args.trade.drops ?? {})) {
    if (String(fromTeam) !== args.teamKey) continue
    const known = lookup(playerId)
    assetsGiven.push({
      playerId,
      playerName: known?.name ?? playerId,
      position: known?.position ?? '—',
      team: known?.team ?? '—',
    })
  }

  return { assetsGiven, assetsReceived }
}

export async function scanPendingYahooTrades(args: {
  /** `League.id`, for the team lookup. */
  leagueId: string
  /** `League.platformLeagueId` — Yahoo's own league key. */
  platformLeagueId: string
  userId: string
}): Promise<PendingYahooScan> {
  const { leagueId, platformLeagueId, userId } = args
  if (!platformLeagueId?.trim()) {
    return { trades: [], scanned: false, reason: 'this league has no Yahoo league key on file' }
  }

  /* Claimed team first, then the platform id on the row — one identity rule. */
  const team = await prisma.leagueTeam
    .findFirst({
      where: { leagueId, claimedByUserId: userId },
      select: { externalId: true, teamName: true },
    })
    .catch(() => null)
  const teamKey = team?.externalId ? String(team.externalId) : null
  if (!teamKey) {
    return {
      trades: [],
      scanned: false,
      reason: 'claim your team in this league so we know whose offers to read',
    }
  }

  const result = await fetchYahooPendingTrades(userId, platformLeagueId)
  if (!result.ok) return { trades: [], scanned: false, reason: result.reason }

  /*
   * Names for the ids in the offer. Yahoo player keys are stored on our own
   * rows at import, so this is a local read — a miss leaves the id showing,
   * which is worse to look at and still true.
   */
  const ids = [
    ...new Set(
      result.trades.flatMap((t) => [...Object.keys(t.adds ?? {}), ...Object.keys(t.drops ?? {})]),
    ),
  ]
  const known = ids.length
    ? await prisma.sportsPlayer
        .findMany({
          where: { externalId: { in: ids } },
          select: { externalId: true, name: true, position: true, team: true },
        })
        .catch(() => [])
    : []
  const byId = new Map(known.map((p) => [p.externalId, p]))
  const nameOf = (playerId: string) => {
    const p = byId.get(playerId)
    return p ? { name: p.name, position: p.position, team: p.team } : null
  }

  const out: PendingProviderTrade[] = []
  for (const t of result.trades) {
    if (!t.teamKeys?.includes(teamKey)) continue
    const { assetsGiven, assetsReceived } = splitYahooTradeForTeam({ trade: t, teamKey, nameOf })
    if (assetsGiven.length === 0 && assetsReceived.length === 0) continue

    /*
     * ⚠ YAHOO DOES NOT NAME A PROPOSER IN THIS PAYLOAD, so direction cannot be
     * claimed. Guessing it would render a manager's own outgoing offer as
     * incoming, with given and received reversed relative to how they built it
     * — a wrong answer that looks like a right one. Everything unclaimed is
     * shown as incoming and labelled by the other side's team, which is the
     * fact we do have.
     */
    const otherKey = t.teamKeys.find((k) => k !== teamKey) ?? null
    out.push({
      transactionId: t.transactionId,
      proposedBy: otherKey ? `Team ${otherKey.split('.t.')[1] ?? otherKey}` : 'Another team',
      proposedByViewer: false,
      proposedAt: t.createdAt,
      assetsGiven,
      assetsReceived,
      readOnly: true,
      provider: 'yahoo',
    })
  }

  return { trades: out, scanned: true, reason: null }
}
