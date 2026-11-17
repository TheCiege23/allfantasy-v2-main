/**
 * A NATIVE AllFantasy league's manager history, in the shapes the Competitive Edge builders take
 * (2026-11-16, re-score item 11 step E: "all platforms"). The manager record (./managerRecord.ts) reads
 * a native league through this; Sleeper keeps its own readers.
 *
 * ⚠ OUR OWN TABLES, SO THE PERSON IS REAL. A native roster belongs to an AllFantasy account
 * (`Roster.platformUserId` is the AppUser id, as is `LeagueTeam.platformUserId`), so a trade side, a
 * claim and a pick are matched to a person, never to a slot.
 *
 *   trades  — `AfLeagueTrade` with status `processed`, sides from `AfLeagueTradeItem` (to/from roster).
 *   waivers — `WaiverTransaction` rows that came from a CLAIM (`claimId` set); a free-agent add is not a
 *             waiver claim and is left out, as Sleeper's edge leaves out free agents. `faabSpent` is the
 *             winning bid. Budgets from `Roster.faabRemaining`.
 *   drafts  — `DraftPick` rows of this league's draft sessions, position as recorded on the pick.
 *
 * ⚠ ONE LEAGUE ROW, ONE SEASON. How a renewed native league links its seasons was not found
 * (census 2026-11-16), so the history is this league's own; the coverage says which season.
 * DB-first: nothing here calls a provider.
 */
import 'server-only'

import { prisma } from '@/lib/prisma'
import type { SectionState } from '@/lib/core-app/leagueHome'
import { playerIdSpaceFor, resolveTradePlayers } from '@/lib/decision-os/trade/tradePlayers'
import type { EdgeTrade, EdgeTradeSide } from './tradeEdge'
import type { EdgeWaiverClaim } from './waiverEdge'
import type { EdgeDraftPick } from './draftEdge'

export type NativeHistory = {
  trades: SectionState<{ trades: EdgeTrade[]; seasonsScanned: string[]; historyGaps: string[]; asOf: string; stale: boolean }>
  waivers: SectionState<{ season: number; claims: EdgeWaiverClaim[]; faabByTeam: Map<string, number | null>; asOf: string | null; stale: boolean }>
  drafts: SectionState<{ picks: EdgeDraftPick[]; unattributedSeasons: number[] }>
}

const isPick = (itemType: string) => /pick/i.test(itemType)

/**
 * Pure: native trades into the builder's shape. `ownerOf` maps a roster id to its person; a roster with
 * none still gets a side (so the other manager's count stays right) under an id nobody holds.
 */
export function nativeTradesToEdge(
  trades: ReadonlyArray<{
    id: string
    proposerRosterId: string
    receiverRosterId: string
    processedAt: Date | null
    createdAt: Date
    items: ReadonlyArray<{ itemType: string; itemReference: string | null; fromRosterId: string; toRosterId: string }>
  }>,
  season: number,
  ownerOf: (rosterId: string) => string | null,
  positionOf: (playerId: string) => string | null,
): EdgeTrade[] {
  return trades.map((t) => {
    const rosters = [...new Set([t.proposerRosterId, t.receiverRosterId, ...t.items.flatMap((i) => [i.fromRosterId, i.toRosterId])])]
    const sides: EdgeTradeSide[] = rosters.map((r) => {
      const player = (i: (typeof t.items)[number]) => i.itemType === 'player' && i.itemReference
      return {
        ownerId: ownerOf(r) ?? `roster:${r}`,
        playersIn: t.items.filter((i) => player(i) && i.toRosterId === r).map((i) => ({ position: positionOf(i.itemReference!) })),
        playersOut: t.items.filter((i) => player(i) && i.fromRosterId === r).map((i) => ({ position: positionOf(i.itemReference!) })),
        picksIn: t.items.filter((i) => isPick(i.itemType) && i.toRosterId === r).map(() => ({})),
        picksOut: t.items.filter((i) => isPick(i.itemType) && i.fromRosterId === r).map(() => ({})),
      }
    })
    const at = t.processedAt ?? t.createdAt
    return { id: t.id, season: String(season), week: 0, createdIso: at.toISOString(), sides }
  })
}

export async function readNativeHistory(league: { id: string; sport: string; season: number; platform: string }): Promise<NativeHistory> {
  const now = new Date()
  const [rosters, teams] = await Promise.all([
    prisma.roster.findMany({ where: { leagueId: league.id }, select: { id: true, platformUserId: true, faabRemaining: true } }),
    prisma.leagueTeam.findMany({ where: { leagueId: league.id }, select: { externalId: true, claimedByUserId: true, platformUserId: true } }),
  ])
  const ownerByRoster = new Map(rosters.map((r) => [r.id, r.platformUserId?.trim() || null]))
  // A native LeagueTeam's externalId IS the roster id; fall back to the owner when it is not.
  const teamByRoster = new Map<string, string>()
  for (const r of rosters) {
    const t = teams.find((x) => x.externalId === r.id) ?? teams.find((x) => r.platformUserId && (x.claimedByUserId === r.platformUserId || x.platformUserId === r.platformUserId))
    if (t) teamByRoster.set(r.id, t.externalId)
  }
  const space = playerIdSpaceFor({ platform: league.platform, sport: league.sport })

  const trades: NativeHistory['trades'] = await (async () => {
    const rows = await prisma.afLeagueTrade.findMany({
      where: { leagueId: league.id, status: 'processed' },
      select: {
        id: true,
        proposerRosterId: true,
        receiverRosterId: true,
        processedAt: true,
        createdAt: true,
        items: { select: { itemType: true, itemReference: true, fromRosterId: true, toRosterId: true } },
      },
    })
    const ids = rows.flatMap((t) => t.items.filter((i) => i.itemType === 'player' && i.itemReference).map((i) => i.itemReference!))
    const players = await resolveTradePlayers(ids, { space, sport: league.sport }).catch(() => new Map())
    const positionOf = (id: string) => {
      const p = players.get(id)
      return p?.ok ? p.position : null
    }
    return {
      available: true as const,
      data: {
        trades: nativeTradesToEdge(rows, league.season, (r) => ownerByRoster.get(r) ?? null, positionOf),
        seasonsScanned: [String(league.season)],
        historyGaps: [],
        asOf: now.toISOString(),
        stale: false,
      },
    }
  })().catch(() => ({ available: false as const, reason: 'Trade history could not be read right now.' }))

  const waivers: NativeHistory['waivers'] = await (async () => {
    const rows = await prisma.waiverTransaction.findMany({
      where: { leagueId: league.id, claimId: { not: null } },
      select: { rosterId: true, addPlayerId: true, faabSpent: true, processedAt: true },
    })
    const players = await resolveTradePlayers(rows.map((r) => r.addPlayerId), { space, sport: league.sport }).catch(() => new Map())
    const claims: EdgeWaiverClaim[] = []
    let last: Date | null = null
    for (const r of rows) {
      const team = teamByRoster.get(r.rosterId)
      if (!team) continue
      const p = players.get(r.addPlayerId)
      claims.push({ teamExternalId: team, position: p?.ok ? p.position : null, bid: r.faabSpent ?? null, atIso: r.processedAt.toISOString() })
      if (!last || r.processedAt > last) last = r.processedAt
    }
    const faabByTeam = new Map<string, number | null>()
    for (const r of rosters) {
      const team = teamByRoster.get(r.id)
      if (team) faabByTeam.set(team, r.faabRemaining ?? null)
    }
    return { available: true as const, data: { season: league.season, claims, faabByTeam, asOf: last ? last.toISOString() : null, stale: false } }
  })().catch(() => ({ available: false as const, reason: 'Waiver history could not be read right now.' }))

  const drafts: NativeHistory['drafts'] = await (async () => {
    const picks = await prisma.draftPick.findMany({
      where: { session: { leagueId: league.id } },
      select: { round: true, position: true, rosterId: true, assetType: true, playerId: true, playerName: true },
    })
    const out: EdgeDraftPick[] = []
    let unattributed = false
    for (const p of picks) {
      if (p.assetType && p.assetType !== 'player') continue
      const owner = ownerByRoster.get(p.rosterId)
      if (!owner) {
        unattributed = true
        continue
      }
      out.push({ season: league.season, round: p.round, position: p.position || null, ownerSleeperId: owner })
    }
    return { available: true as const, data: { picks: out, unattributedSeasons: unattributed ? [league.season] : [] } }
  })().catch(() => ({ available: false as const, reason: 'Draft history could not be read right now.' }))

  return { trades, waivers, drafts }
}
