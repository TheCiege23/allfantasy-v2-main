import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * What has actually happened in this league — processed waivers, free-agent
 * moves and trades.
 *
 * ⚠ THE LEAGUE HOME SAID "league transactions are not ingested for this
 * platform yet". THAT IS FALSE, and has been since the Decision-OS activity
 * cron started running: `decision_os_imported_activity` carries thousands of
 * completed Sleeper transactions across dozens of leagues, refreshed daily. The
 * panel was declining to look and blaming the data.
 *
 * ⚠ AND IT IS LEAGUE-WIDE, NOT VIEWER-SCOPED. The emitter attributes each
 * transaction to every roster in `roster_ids`, so this is the whole league's
 * activity — which is what a league home is for.
 *
 * ⚠ TWO ID SPACES, AND THE ROWS HAVE BEEN WRITTEN UNDER BOTH. `afLeagueId` is
 * our uuid and `providerLeagueId` is the platform's. There was a period where
 * `afLeagueId` came back NULL on every row, which made the whole table
 * unreachable through the obvious query. Both are indexed, so both are asked —
 * a feed that silently returns nothing because it guessed the wrong column is
 * exactly the failure this panel already had once.
 *
 * ⚠ FAAB BIDS ARE NOT STORED. The emitter's payload carries adds, drops and
 * picks — no bid amount. "$47 on a waiver" is not available from any durable
 * table, so it is not shown. Reading it live would be a different feature.
 */

export type ActivityKind = 'trade' | 'waiver' | 'roster_move'

export type LeagueActivityItem = {
  id: string
  kind: ActivityKind
  occurredAt: Date
  /** Manager the row is attributed to, when we can name them. */
  managerName: string | null
  teamName: string | null
  avatarUrl: string | null
  /** Sleeper player ids added / dropped, resolved to names where possible. */
  adds: string[]
  drops: string[]
  /** "2027 4th" style pick labels, when the payload carried any. */
  picks: string[]
}

export type LeagueActivity = {
  items: LeagueActivityItem[]
  counts: { trade: number; waiver: number; rosterMove: number }
  /** Newest row we hold, so the panel can say how current it is. */
  newest: Date | null
  /** Rows we hold but could not attribute to a named manager. */
  unattributed: number
}

type Payload = {
  adds?: unknown
  drops?: unknown
  draftPicks?: unknown
  transactionType?: unknown
}

function ids(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (x == null ? '' : String(x))).filter(Boolean)
  // Sleeper sometimes sends adds/drops as an object keyed by player id.
  if (v && typeof v === 'object') return Object.keys(v as Record<string, unknown>)
  return []
}

function pickLabels(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((p) => {
      if (!p || typeof p !== 'object') return null
      const o = p as Record<string, unknown>
      const season = o.season ?? o.year
      const round = o.round
      if (season == null || round == null) return null
      const r = Number(round)
      const suffix = r === 1 ? 'st' : r === 2 ? 'nd' : r === 3 ? 'rd' : 'th'
      return `${season} ${r}${suffix}`
    })
    .filter(Boolean) as string[]
}

const KINDS: ActivityKind[] = ['trade', 'waiver', 'roster_move']

export async function getLeagueActivity(args: {
  /** Internal `League.id`. */
  leagueId: string
  /** `League.platformLeagueId`. */
  platformLeagueId: string | null
  /** How many items to surface. */
  limit?: number
}): Promise<LeagueActivity | null> {
  const limit = args.limit ?? 12

  const rows = await prisma.decisionOsImportedActivity
    .findMany({
      where: {
        activityType: { in: KINDS },
        OR: [
          { afLeagueId: args.leagueId },
          ...(args.platformLeagueId ? [{ providerLeagueId: args.platformLeagueId }] : []),
        ],
      },
      orderBy: { occurredAt: 'desc' },
      take: Math.max(limit * 3, 60),
      select: {
        id: true,
        activityType: true,
        occurredAt: true,
        rosterId: true,
        payload: true,
      },
    })
    .catch(() => [])

  if (rows.length === 0) return null

  // Name the managers. rosterId here is the platform's roster id as a string,
  // which is what LeagueTeam.externalId holds.
  const teams = await prisma.leagueTeam
    .findMany({
      where: { leagueId: args.leagueId },
      select: { externalId: true, teamName: true, ownerName: true, avatarUrl: true },
    })
    .catch(() => [])
  const teamBy = new Map(teams.map((t) => [t.externalId, t]))

  // Resolve player ids to names in one read rather than per row.
  const everyPlayerId = new Set<string>()
  for (const r of rows) {
    const p = (r.payload ?? {}) as Payload
    for (const id of [...ids(p.adds), ...ids(p.drops)]) everyPlayerId.add(id)
  }
  const players = everyPlayerId.size
    ? await prisma.sportsPlayer
        .findMany({
          where: { sleeperId: { in: [...everyPlayerId] } },
          select: { sleeperId: true, name: true, position: true, team: true },
        })
        .catch(() => [])
    : []
  const nameBy = new Map(
    players.filter((p) => p.sleeperId).map((p) => [p.sleeperId as string, p]),
  )

  /** A player id we cannot name stays an id — never silently dropped. */
  const label = (id: string): string => {
    const p = nameBy.get(id)
    if (!p) return `player ${id}`
    return p.position && p.team ? `${p.name} (${p.position} · ${p.team})` : p.name
  }

  let unattributed = 0
  const counts = { trade: 0, waiver: 0, rosterMove: 0 }

  const items: LeagueActivityItem[] = rows.map((r) => {
    const p = (r.payload ?? {}) as Payload
    const kind = r.activityType as ActivityKind
    if (kind === 'trade') counts.trade += 1
    else if (kind === 'waiver') counts.waiver += 1
    else counts.rosterMove += 1

    const team = r.rosterId ? teamBy.get(String(r.rosterId)) : undefined
    if (!team) unattributed += 1

    return {
      id: r.id,
      kind,
      occurredAt: r.occurredAt,
      managerName: team?.ownerName ?? null,
      teamName: team?.teamName ?? null,
      avatarUrl: team?.avatarUrl ?? null,
      adds: ids(p.adds).map(label),
      drops: ids(p.drops).map(label),
      picks: pickLabels(p.draftPicks),
    }
  })

  /*
   * ⚠ DEDUPED BY EVENT, NOT BY ROW. The emitter writes one row PER ROSTER
   * involved, so a two-team trade arrives twice and a waiver once. Showing both
   * halves of a trade as separate items makes a quiet league look busy and
   * double-counts the feed.
   */
  const seen = new Set<string>()
  const deduped = items.filter((i) => {
    const key = `${i.kind}:${i.occurredAt.getTime()}:${[...i.adds, ...i.drops].sort().join('|')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    items: deduped.slice(0, limit),
    counts,
    newest: rows[0]?.occurredAt ?? null,
    unattributed,
  }
}
