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
 * ⚠ FAAB BIDS ARE NOT STORED ON HISTORICAL ROWS. `sleeperActivityEmitter`
 * copies `adds`, `drops` and `draft_picks` out of each transaction and nothing
 * else, so every row already in the table has no bid on it. The emitter now also
 * carries the bid forward when the provider sends one, which means new syncs can
 * show "$47" and old rows stay silent — `bid: null` is read as UNKNOWN and
 * rendered as nothing, never as $0. A losing bid and an unrecorded bid are not
 * the same fact.
 *
 * Read tolerantly, the way `readWaiverBudgetUsed` does: several spellings are
 * tried and absence is a null rather than a guess.
 *
 * PER-TEAM FAAB REMAINING IS A DIFFERENT AND BETTER-SUPPORTED NUMBER — it is
 * persisted at import on `Roster.faabRemaining`, and the standings panel reads
 * it. Do not confuse the two: one is what a claim cost, the other is what a
 * manager has left.
 */

export type ActivityKind = 'trade' | 'waiver' | 'roster_move'

/**
 * A player who moved. Carries the headshot so a feed of transactions reads as
 * people and not as ids.
 *
 * ⚠ `label` IS ALWAYS SAFE TO PRINT and is never empty: a player id we hold no
 * row for stays `player 4034` rather than vanishing from the sentence. A feed
 * that silently drops the unresolvable half of a trade is worse than one that
 * admits it does not know the name.
 */
export type ActivityPlayer = {
  id: string
  label: string
  name: string | null
  position: string | null
  team: string | null
  imageUrl: string | null
}

export type LeagueActivityItem = {
  id: string
  kind: ActivityKind
  occurredAt: Date
  /** Manager the row is attributed to, when we can name them. */
  managerName: string | null
  teamName: string | null
  avatarUrl: string | null
  /** Players added / dropped, resolved to names and headshots where possible. */
  adds: ActivityPlayer[]
  drops: ActivityPlayer[]
  /**
   * What the claim cost, when the provider recorded it. NULL MEANS UNKNOWN, not
   * free — every row written before the emitter started carrying bids is null,
   * and so is every non-FAAB league. Render nothing, never "$0".
   */
  bid: number | null
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
  settings?: unknown
  waiverBid?: unknown
}

/**
 * The winning bid, if the provider recorded one anywhere we recognise.
 *
 * Deliberately tolerant about placement and spelling, exactly like
 * `readWaiverBudgetUsed` in lib/decision-os/world/derive.ts: the bid may arrive
 * nested under `settings` or flattened by a normalizer, and a reader that knows
 * only one spelling reports "no bid" for data we are holding.
 *
 * Zero is a REAL bid — a $0 claim on an uncontested player is the most common
 * waiver in most leagues — so only absence returns null.
 */
function readBid(p: Payload): number | null {
  const settings = (p.settings ?? {}) as Record<string, unknown>
  const candidates = [settings.waiver_bid, settings.waiverBid, p.waiverBid]
  for (const c of candidates) {
    const n = typeof c === 'string' ? Number.parseInt(c, 10) : c
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return n
  }
  return null
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
        /*
         * ⚠ `rosterId` IS HARDCODED NULL BY THE WRITER, on every row. Joining
         * on it is why every line in League Buzz read "A manager". The real
         * attribution is `normalized.managerKeys`, which the writer's own
         * comment calls authoritative.
         */
        normalized: true,
      },
    })
    .catch(() => [])

  if (rows.length === 0) return null

  const teams = await prisma.leagueTeam
    .findMany({
      where: { leagueId: args.leagueId },
      select: {
        externalId: true,
        teamName: true,
        ownerName: true,
        avatarUrl: true,
        platformUserId: true,
        claimedByUserId: true,
      },
    })
    .catch(() => [])

  type Team = (typeof teams)[number]

  /*
   * A manager key is either our own user id, or the provider's stable key in
   * the form `provider:manager:<sourceId>` — for Sleeper, the source id IS the
   * platform user id. Both spellings are indexed so a row resolves whichever
   * way its manager was identified at ingest time.
   */
  const byKey = new Map<string, Team>()
  for (const t of teams) {
    if (t.platformUserId) {
      byKey.set(t.platformUserId, t)
      byKey.set(`sleeper:manager:${t.platformUserId}`, t)
    }
    if (t.claimedByUserId) byKey.set(t.claimedByUserId, t)
    // Kept as a last resort for any writer that does populate rosterId.
    byKey.set(t.externalId, t)
  }

  /** The last segment of a stable key, for any provider prefix we did not index. */
  function resolveTeam(keys: string[], rosterId: string | null): Team | undefined {
    for (const k of [...keys, rosterId].filter(Boolean) as string[]) {
      const direct = byKey.get(k)
      if (direct) return direct
      const tail = k.includes(':') ? k.slice(k.lastIndexOf(':') + 1) : null
      if (tail) {
        const viaTail = byKey.get(tail)
        if (viaTail) return viaTail
      }
    }
    return undefined
  }

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
          select: {
            sleeperId: true,
            name: true,
            position: true,
            team: true,
            imageUrl: true,
          },
        })
        .catch(() => [])
    : []
  const nameBy = new Map(
    players.filter((p) => p.sleeperId).map((p) => [p.sleeperId as string, p]),
  )

  /** A player id we cannot name stays an id — never silently dropped. */
  const resolve = (id: string): ActivityPlayer => {
    const p = nameBy.get(id)
    if (!p) {
      return { id, label: `player ${id}`, name: null, position: null, team: null, imageUrl: null }
    }
    return {
      id,
      label: p.position && p.team ? `${p.name} (${p.position} · ${p.team})` : p.name,
      name: p.name,
      position: p.position,
      team: p.team,
      imageUrl: p.imageUrl,
    }
  }

  let unattributed = 0
  const counts = { trade: 0, waiver: 0, rosterMove: 0 }

  const items: LeagueActivityItem[] = rows.map((r) => {
    const p = (r.payload ?? {}) as Payload
    const kind = r.activityType as ActivityKind
    if (kind === 'trade') counts.trade += 1
    else if (kind === 'waiver') counts.waiver += 1
    else counts.rosterMove += 1

    const norm = (r.normalized ?? {}) as { managerKeys?: unknown }
    const keys = Array.isArray(norm.managerKeys)
      ? (norm.managerKeys as unknown[]).map((k) => String(k)).filter(Boolean)
      : []
    const team = resolveTeam(keys, r.rosterId)
    if (!team) unattributed += 1

    return {
      id: r.id,
      kind,
      occurredAt: r.occurredAt,
      managerName: team?.ownerName ?? null,
      teamName: team?.teamName ?? null,
      avatarUrl: team?.avatarUrl ?? null,
      adds: ids(p.adds).map(resolve),
      drops: ids(p.drops).map(resolve),
      bid: readBid(p),
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
    const key = `${i.kind}:${i.occurredAt.getTime()}:${[...i.adds, ...i.drops]
      .map((pl) => pl.id)
      .sort()
      .join('|')}`
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
