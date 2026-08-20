import "server-only"

import { prisma } from "@/lib/prisma"
import { resolvePlayerNamesForSport } from "@/lib/roster/resolvePlayerNames"
import type { ActivityFeedItem, ActivityLeagueEntry, ActivitySourceContext } from "@/lib/activity/types"
import { isNativePlatform } from "@/lib/league/isNativeLeague"


/** Only surface recent native events — matches the ~2-week window the Sleeper source uses. */
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000
/** Per-event-type cap so one busy league can't dominate the merged feed or the query cost. */
const PER_TYPE_LIMIT = 40
const MAX_DESCRIPTION = 160

function truncate(text: string, max = MAX_DESCRIPTION): string {
  const clean = text.replace(/\s+/g, " ").trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function isNativeLeague(league: ActivityLeagueEntry): boolean {
  return Boolean(league.id) && isNativePlatform(league.platform)
}

/**
 * Resolve `Roster.id` → a manager display name. For native leagues `Roster.platformUserId` is the
 * owner's AppUser id, so we join through AppUser. Unresolved rosters fall back to a neutral label —
 * never a fabricated name.
 */
async function resolveManagerNames(rosterIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = Array.from(new Set(rosterIds.filter(Boolean)))
  if (ids.length === 0) return out

  const rosters = await prisma.roster.findMany({
    where: { id: { in: ids } },
    select: { id: true, platformUserId: true },
  })
  const appUserIds = Array.from(new Set(rosters.map((r) => r.platformUserId).filter(Boolean)))
  const users = appUserIds.length
    ? await prisma.appUser.findMany({
        where: { id: { in: appUserIds } },
        select: { id: true, displayName: true, username: true },
      })
    : []
  const nameByUserId = new Map(users.map((u) => [u.id, u.displayName || u.username || "A manager"]))
  for (const r of rosters) {
    out.set(r.id, nameByUserId.get(r.platformUserId) ?? "A manager")
  }
  return out
}

/** Batch-resolve player ids → names, grouped by each event's league sport (id-space is per-sport). */
async function resolvePlayerNames(
  entries: Array<{ sport: string; playerId: string }>,
): Promise<Map<string, string>> {
  const idsBySport = new Map<string, Set<string>>()
  for (const { sport, playerId } of entries) {
    if (!playerId) continue
    const key = (sport || "NFL").toUpperCase()
    if (!idsBySport.has(key)) idsBySport.set(key, new Set())
    idsBySport.get(key)!.add(playerId)
  }
  const merged = new Map<string, string>()
  await Promise.all(
    Array.from(idsBySport.entries()).map(async ([sport, ids]) => {
      const names = await resolvePlayerNamesForSport(Array.from(ids), sport)
      for (const [id, name] of names) merged.set(id, name)
    }),
  )
  return merged
}

/**
 * Source 2 — native AllFantasy league DB events for the leagues the viewer plays natively:
 * completed trades (`AfLeagueTrade.status='processed'`), awarded waiver claims
 * (`WaiverResult.resultType='awarded'`), and commissioner announcements + league chat
 * (`LeagueChatMessage`). Real DB rows only, read via cheap indexed queries — never a live provider
 * hit. Returns [] (never throws) so a failure here can't sink the merged feed; nothing is fabricated.
 */
export async function collectNativeLeagueActivity(ctx: ActivitySourceContext): Promise<ActivityFeedItem[]> {
  try {
    let native = ctx.leagues.filter(isNativeLeague)
    if (ctx.leagueIdFilter) native = native.filter((l) => l.id === ctx.leagueIdFilter)
    if (native.length === 0) return []

    const leagueIds = native.map((l) => l.id as string)
    const leagueById = new Map(native.map((l) => [l.id as string, l]))
    const sportForLeague = (leagueId: string) => String(leagueById.get(leagueId)?.sport ?? "NFL")
    const nameForLeague = (leagueId: string) => leagueById.get(leagueId)?.name ?? null
    const since = new Date(Date.now() - LOOKBACK_MS)

    const [trades, waivers, chats] = await Promise.all([
      prisma.afLeagueTrade.findMany({
        where: { leagueId: { in: leagueIds }, status: "processed", processedAt: { not: null, gte: since } },
        select: {
          id: true,
          leagueId: true,
          processedAt: true,
          items: { select: { itemType: true, itemReference: true, toRosterId: true, faabAmount: true } },
        },
        orderBy: { processedAt: "desc" },
        take: PER_TYPE_LIMIT,
      }),
      prisma.waiverResult.findMany({
        where: { leagueId: { in: leagueIds }, resultType: "awarded", createdAt: { gte: since } },
        select: { id: true, leagueId: true, rosterId: true, addPlayerId: true, dropPlayerId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: PER_TYPE_LIMIT,
      }),
      prisma.leagueChatMessage.findMany({
        where: {
          leagueId: { in: leagueIds },
          isPrivate: false,
          createdAt: { gte: since },
          NOT: [{ source: "draft" }, { source: { startsWith: "tribe_" } }],
          /*
           * ⚠ COMMISSIONER BROADCASTS WERE FALLING THROUGH THIS FILTER ENTIRELY.
           * `/api/commissioner/broadcast` writes its message with `type: "broadcast"` and leaves
           * `messageSubtype` null, so it matched neither arm: not `global_broadcast` (that is the
           * ADMIN-wide broadcast from /api/chat/global-broadcast, a different thing), and not
           * `type: "text"`. The loop below is titled "Commissioner announcements + league chat"
           * and was silently carrying none of the former — every @everyone a commissioner sent
           * was invisible in the activity feed.
           */
          OR: [
            { messageSubtype: "global_broadcast" },
            { type: "broadcast" },
            { type: "text", messageSubtype: null },
          ],
        },
        select: {
          id: true,
          leagueId: true,
          message: true,
          messageSubtype: true,
          type: true,
          createdAt: true,
          user: { select: { displayName: true, username: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        take: PER_TYPE_LIMIT,
      }),
    ])

    // Batch-resolve every roster + player name the descriptions need, up front.
    const rosterIds: string[] = []
    const playerEntries: Array<{ sport: string; playerId: string }> = []
    for (const trade of trades) {
      const sport = sportForLeague(trade.leagueId)
      for (const item of trade.items) {
        if (item.toRosterId) rosterIds.push(item.toRosterId)
        if (item.itemType === "player" && item.itemReference) {
          playerEntries.push({ sport, playerId: item.itemReference })
        }
      }
    }
    for (const w of waivers) {
      const sport = sportForLeague(w.leagueId)
      if (w.rosterId) rosterIds.push(w.rosterId)
      if (w.addPlayerId) playerEntries.push({ sport, playerId: w.addPlayerId })
      if (w.dropPlayerId) playerEntries.push({ sport, playerId: w.dropPlayerId })
    }
    const [managerNames, playerNames] = await Promise.all([
      resolveManagerNames(rosterIds),
      resolvePlayerNames(playerEntries),
    ])

    const describeAsset = (item: { itemType: string; itemReference: string | null; faabAmount: number | null }): string => {
      if (item.itemType === "player") return item.itemReference ? playerNames.get(item.itemReference) ?? "a player" : "a player"
      if (item.itemType === "faab") return item.faabAmount != null ? `$${item.faabAmount} FAAB` : "FAAB"
      if (item.itemType.endsWith("_pick")) return "a draft pick"
      return "an asset"
    }

    const items: ActivityFeedItem[] = []

    // Completed trades → "Manager A gets X · Manager B gets Y".
    for (const trade of trades) {
      const byReceiver = new Map<string, string[]>()
      for (const item of trade.items) {
        if (!item.toRosterId) continue
        const arr = byReceiver.get(item.toRosterId) ?? []
        arr.push(describeAsset(item))
        byReceiver.set(item.toRosterId, arr)
      }
      const parts = Array.from(byReceiver.entries()).map(
        ([rosterId, assets]) => `${managerNames.get(rosterId) ?? "A manager"} gets ${assets.join(", ")}`,
      )
      const description = parts.length > 0 ? parts.join(" · ") : "Trade processed"
      items.push({
        id: `native-trade:${trade.id}`,
        type: "trade",
        userId: "",
        userName: "Trade",
        avatarUrl: null,
        description: truncate(description),
        timestamp: (trade.processedAt ?? new Date()).toISOString(),
        leagueId: trade.leagueId,
        leagueName: nameForLeague(trade.leagueId),
        href: `/league/${trade.leagueId}`,
        source: "native",
      })
    }

    // Awarded waiver claims → "Manager claimed X (dropped Y)".
    for (const w of waivers) {
      const manager = w.rosterId ? managerNames.get(w.rosterId) ?? "A manager" : "A manager"
      const added = w.addPlayerId ? playerNames.get(w.addPlayerId) ?? "a player" : "a player"
      const dropped = w.dropPlayerId ? playerNames.get(w.dropPlayerId) : null
      const description = dropped
        ? `${manager} claimed ${added}, dropped ${dropped}`
        : `${manager} claimed ${added}`
      items.push({
        id: `native-waiver:${w.id}`,
        type: "waiver",
        userId: "",
        userName: manager,
        avatarUrl: null,
        description: truncate(description),
        timestamp: w.createdAt.toISOString(),
        leagueId: w.leagueId,
        leagueName: nameForLeague(w.leagueId),
        href: `/league/${w.leagueId}`,
        source: "native",
      })
    }

    // Commissioner announcements + league chat.
    for (const chat of chats) {
      // Both kinds of broadcast read as announcements: the admin-wide one and a commissioner's
      // league @everyone. They differ in who can send, not in how the feed should present them.
      const isAnnouncement =
        chat.messageSubtype === "global_broadcast" || chat.type === "broadcast"
      const poster = chat.user?.displayName || chat.user?.username || chat.user?.email || "A manager"
      const description = isAnnouncement ? truncate(chat.message) : truncate(`${poster}: ${chat.message}`)
      items.push({
        id: `native-chat:${chat.id}`,
        type: isAnnouncement ? "announcement" : "message",
        userId: "",
        userName: poster,
        avatarUrl: null,
        description,
        timestamp: chat.createdAt.toISOString(),
        leagueId: chat.leagueId,
        leagueName: nameForLeague(chat.leagueId),
        href: `/league/${chat.leagueId}`,
        source: "native",
      })
    }

    return items
  } catch (err) {
    console.error("[api/shared/activity] native league source failed:", err)
    return []
  }
}
