import type { PrismaClient } from '@prisma/client'
import { REFERENCE_NFL_BUCKETS } from '@/lib/sports-data-gateway/canonical/canonicalPosition'

/**
 * ADP, resolved into Sleeper-id space.
 *
 * ⚠ `AdpDataRecord` HELD 94,116 FRESH ROWS THAT NOTHING COULD READ. The table is keyed by
 * `playerId`, and both consumers — `trade/loader.ts` and `world/port.ts` — equality-joined it
 * against the SLEEPER ids their callers pass. Not one row matched: 0 of 2,000 sampled ADP ids
 * are bare numerics. Every ADP lookup in the product returned an empty array, and an empty array
 * is indistinguishable from "we have no ADP for these players yet".
 *
 * What is actually in that column is TWO id spaces, neither of them Sleeper's:
 *
 *   - 3,243 players keyed `NFL:brian-thomas:WR:JAX` — sport, name slug, position, team. The
 *     slug lowercases, strips punctuation (`T.J. Watt` → `tj-watt`) and DROPS generational
 *     suffixes (`Brian Thomas Jr.` → `brian-thomas`).
 *   - 467 players keyed by a bare uuid, which is `SportsPlayer.id` — 200 of 200 sampled matched.
 *     These are the older rows; the writer changed keying and the legacy ones were left behind.
 *
 * The defenders are the reason this matters most: 28,780 of the rows are DB, LB or DL — a third
 * of the table, more DB rows than TE rows — and they are the only cross-positional market signal
 * we hold for IDP at all. `PlayerValueSnapshot`, the trade-value board, contains ZERO defenders.
 *
 * ⚠ THE BOARD IS ONE OVERALL RANKING, AND AN EARLIER NOTE HERE CLAIMED OTHERWISE. It looked like
 * positional and overall scales were mixed, because DL bottoms out at 6.6 and LB at 8.1 while
 * Jalen Ramsey sits at 383. Inspecting a single snapshot settles it: 791 players from 1.54 to
 * 699.8 with 18 duplicate values, offence and defence interleaved — Chase 1.54, Bijan 2.5,
 * Parsons 6.6, Hunter 6.7, Watt 8.1, Lamb 9.52, Bonitto 10, Josh Allen 21.5. Elite defenders go
 * early on an IDP board and aging corners go late. That is the ranking working, not two scales.
 *
 * What IS mixed is snapshots and scoring variants, and both bite:
 *
 *   - Snapshots run s2026w18 through w35 and the old ones are badly stale — Austin Ekeler is 11
 *     in w18 and 157.6 in w35. Reading any snapshot but the freshest prices a player off a board
 *     the market left behind, which is why the ordering below is not negotiable.
 *   - Each snapshot carries one row per scoring variant, and they disagree by more than rounding:
 *     Ekeler is 157.6 AND 345 in the same source and snapshot. Pass `scoring` when it matters.
 */

/** The row we return, always keyed by the Sleeper id the caller asked about. */
export interface ResolvedAdp {
  sleeperId: string
  /** The ADP table's OWN key for this row, so a caller needing more columns can re-query by it. */
  adpPlayerId: string
  adp: number
  position: string | null
  /** 'dynasty' | 'redraft' | 'standard' as the record states it. Never inferred. */
  format: string | null
  scoring: string | null
  /** How the row was matched. Reported so a caller can weigh a name match differently. */
  via: 'sports_player_id' | 'slug' | 'name'
}

const SUFFIX = /\b(?:jr|sr|ii|iii|iv|v)\b/g

/**
 * Normalise a player name to the form the ADP slug is built from.
 *
 * Punctuation is removed rather than replaced, because that is what the slug does: `T.J. Watt`
 * becomes `tj-watt`, not `t-j-watt`. Generational suffixes go too — the slug for
 * `Brian Thomas Jr.` is `brian-thomas`, so keeping the suffix would miss every junior in the
 * league, which is a systematically biased sample rather than a random one.
 */
export function normalizeAdpName(raw: string | null | undefined): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The slug the ADP writer produces for a player. */
export function adpSlug(
  sport: string,
  name: string | null | undefined,
  position: string | null | undefined,
  team: string | null | undefined,
): string | null {
  const n = normalizeAdpName(name).replace(/ /g, '-')
  if (!n) return null
  const pos = String(position ?? '').toUpperCase()
  const tm = String(team ?? '').toUpperCase()
  if (!pos || !tm) return null
  return `${sport.toUpperCase()}:${n}:${pos}:${tm}`
}

/*
 * Specific defensive positions collapse onto the group the ADP board ranks them in, the same way
 * the roster slots do. Without this a `CB` on our side never matches a `DB` on theirs.
 *
 * ⚠ DERIVED FROM THE CANONICAL BUCKETS, NOT WRITTEN OUT AGAIN. This was a hand-kept copy of the
 * same mapping, which is a second normalization truth — the thing
 * `unified-plane-provider-boundary` exists to stop spreading. Inverting the governed buckets keeps
 * one definition, so a position added there reaches the ADP join automatically.
 *
 * ⚠ ONLY THE THREE DEFENSIVE GROUPS. `REFERENCE_NFL_BUCKETS` also defines IDP_FLEX, FLEX and
 * SUPER_FLEX, and those OVERLAP — inverting the whole map would make RB, WR and TE collapse to
 * FLEX and quietly wreck every offensive ADP match.
 */
const GROUPED_FOR_ADP = ['DL', 'LB', 'DB'] as const
const POSITION_GROUP: Record<string, string> = Object.fromEntries(
  GROUPED_FOR_ADP.flatMap((bucket) =>
    (REFERENCE_NFL_BUCKETS.buckets[bucket] ?? []).map((member) => [member.toUpperCase(), bucket]),
  ),
)
const group = (p: string | null | undefined) => {
  const up = String(p ?? '').toUpperCase()
  return POSITION_GROUP[up] ?? up
}

/**
 * A value that dominates a whole board is a placeholder, not a draft position.
 *
 * ⚠ WITHOUT THIS, HALF THE REDRAFT BOARD READS AS "GOES 170th". Measured 2026-08-26: the `espn`
 * feed has exactly ONE distinct `adp` across all 20,000 of its rows — 170 — which is what it
 * writes for a player it does not rank. That is 21.6% of the table on its own, and it LEAKS: the
 * `consensus` source is genuinely informative (3,503 distinct values) but averages ESPN in, so
 * 7,873 of its rows are 170 too. Excluding by source therefore fails in both directions — it
 * would keep the contaminated consensus rows and throw away the good ones.
 *
 * So the test is on the VALUE, per board, and it is derived rather than hardcoded: 170 accounts
 * for 48% of redraft rows, while dynasty's most common value accounts for 0.2%. Anything above
 * this share is not a draft position that thousands of players coincidentally share.
 *
 * The players it was hitting are backups nobody drafts at all, which is the worst case: a wrong
 * number gets used, where a missing one gets refused.
 */
const SENTINEL_SHARE = 0.05

let sentinelCache: Promise<Map<string, Set<number>>> | null = null

async function sentinelValues(
  prisma: LoadAdpArgs['prisma'],
  sport: string,
): Promise<Map<string, Set<number>>> {
  if (!sentinelCache) {
    sentinelCache = (async () => {
      const out = new Map<string, Set<number>>()
      try {
        const groups = await prisma.adpDataRecord.groupBy({
          by: ['format', 'adp'],
          where: { sport },
          _count: { _all: true },
        })
        const totals = new Map<string, number>()
        for (const g of groups) {
          totals.set(g.format, (totals.get(g.format) ?? 0) + (g._count?._all ?? 0))
        }
        for (const g of groups) {
          const total = totals.get(g.format) ?? 0
          if (total <= 0 || typeof g.adp !== 'number') continue
          if ((g._count?._all ?? 0) / total < SENTINEL_SHARE) continue
          const set = out.get(g.format) ?? new Set<number>()
          set.add(g.adp)
          out.set(g.format, set)
        }
      } catch {
        // A failure here must not invent a filter; an empty map filters nothing.
      }
      return out
    })()
  }
  return sentinelCache
}

/** Test seam — the cache is per process and ADP moves weekly, so nothing else needs to clear it. */
export function __resetAdpSentinelCache(): void {
  sentinelCache = null
}

export interface LoadAdpArgs {
  prisma: Pick<PrismaClient, 'sportsPlayer' | 'adpDataRecord'>
  sport: string
  sleeperIds: readonly string[]
  /**
   * Restrict to one ADP board.
   *
   * ⚠ SUPPLY IT WHERE THE CALLER KNOWS IT. Dynasty and redraft ADP are different boards — a
   * rookie sits near the top of one and in the middle of the other — so a row from the wrong
   * board is worse than no row. Left unset, the freshest row wins and its `format` comes back
   * on the result so the caller can see which board it came from rather than assuming.
   */
  format?: string | null
  scoring?: string | null
}

/**
 * Resolve ADP for a set of Sleeper ids. Freshest row per player wins.
 *
 * Three lookups, all narrow — no table scan. Exact keys are tried before the name match, and a
 * name that maps to more than one player is DROPPED rather than guessed at: same-name players
 * are real (the dedupe pass on this database found plenty), and picking one silently attaches a
 * stranger's draft position to a manager's asset.
 */
export async function loadAdpBySleeperId(args: LoadAdpArgs): Promise<Map<string, ResolvedAdp>> {
  const out = new Map<string, ResolvedAdp>()
  const wanted = [...new Set(args.sleeperIds.filter((x) => typeof x === 'string' && x.length > 0))]
  if (wanted.length === 0) return out

  const rows = await args.prisma.sportsPlayer
    .findMany({
      where: { sport: args.sport, sleeperId: { in: wanted } },
      select: { id: true, sleeperId: true, name: true, position: true, team: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    })
    .catch(() => [])

  /* `SportsPlayer` carries duplicates per Sleeper id; prefer a row that actually has a position. */
  const player = new Map<string, { id: string; name: string; position: string | null; team: string | null }>()
  for (const r of rows) {
    if (!r.sleeperId) continue
    const cur = player.get(r.sleeperId)
    if (!cur || (!cur.position && r.position) || (!cur.team && r.team)) {
      player.set(r.sleeperId, { id: r.id, name: r.name, position: r.position, team: r.team })
    }
  }
  if (player.size === 0) return out

  const bySportsPlayerId = new Map<string, string>()
  const bySlug = new Map<string, string>()
  const byName = new Map<string, string | null>() // null marks an ambiguous key
  const byBareName = new Map<string, string | null>() // name without position, same null rule
  const names: string[] = []

  for (const [sleeperId, p] of player) {
    bySportsPlayerId.set(p.id, sleeperId)
    const slug = adpSlug(args.sport, p.name, p.position, p.team)
    if (slug) bySlug.set(slug, sleeperId)

    const key = `${normalizeAdpName(p.name)}|${group(p.position)}`
    // Two of OUR players normalising to one key means we cannot tell them apart either.
    byName.set(key, byName.has(key) ? null : sleeperId)

    /*
     * ⚠ THE FEEDS DISAGREE ABOUT POSITION, AND IT KILLS THE PLAYERS THAT MATTER MOST. We list
     * Micah Parsons at LB; the ADP board lists him at DL. Both the slug and the name+position
     * key therefore miss, and the most valuable IDP asset in the game resolves to nothing.
     *
     * So there is a name-only fallback — but a deliberately narrow one. It applies only when the
     * name identifies exactly ONE player on our side AND exactly one on theirs. Same-name players
     * are real, and a looser rule would hand a manager a stranger's draft position.
     */
    const bare = normalizeAdpName(p.name)
    byBareName.set(bare, byBareName.has(bare) ? null : sleeperId)
    if (p.name) names.push(p.name)
  }

  const sentinels = await sentinelValues(args.prisma, args.sport)

  const formatWhere = {
    ...(args.format ? { format: args.format } : {}),
    ...(args.scoring ? { scoring: args.scoring } : {}),
  }

  const [exact, named] = await Promise.all([
    args.prisma.adpDataRecord
      .findMany({
        where: {
          sport: args.sport,
          playerId: { in: [...bySportsPlayerId.keys(), ...bySlug.keys()] },
          ...formatWhere,
        },
        /*
         * ⚠ `createdAt` ALONE IS NOT A TOTAL ORDER HERE, AND THE TIE IS NOT COSMETIC. A player
         * carries one row per scoring variant per snapshot, and the variants disagree loudly —
         * Austin Ekeler is 157.6 and 345 in the SAME source and snapshot. Ordering on the
         * timestamp alone leaves the pick to the planner, so the same call can return either
         * number on different days. `adp asc` makes the choice deterministic; `scoring` on the
         * result says which board it came from, and a caller that cares passes `scoring` in.
         */
        orderBy: [{ createdAt: 'desc' }, { adp: 'asc' }],
        select: { playerId: true, playerName: true, adp: true, position: true, format: true, scoring: true, source: true },
      })
      .catch(() => []),
    args.prisma.adpDataRecord
      .findMany({
        where: { sport: args.sport, playerName: { in: names }, ...formatWhere },
        /*
         * ⚠ `createdAt` ALONE IS NOT A TOTAL ORDER HERE, AND THE TIE IS NOT COSMETIC. A player
         * carries one row per scoring variant per snapshot, and the variants disagree loudly —
         * Austin Ekeler is 157.6 and 345 in the SAME source and snapshot. Ordering on the
         * timestamp alone leaves the pick to the planner, so the same call can return either
         * number on different days. `adp asc` makes the choice deterministic; `scoring` on the
         * result says which board it came from, and a caller that cares passes `scoring` in.
         */
        orderBy: [{ createdAt: 'desc' }, { adp: 'asc' }],
        select: { playerId: true, playerName: true, adp: true, position: true, format: true, scoring: true, source: true },
      })
      .catch(() => []),
  ])

  type Row = (typeof exact)[number]
  const take = (row: Row, sleeperId: string | null | undefined, via: ResolvedAdp['via']) => {
    if (!sleeperId) return
    if (typeof row.adp !== 'number' || !Number.isFinite(row.adp)) return
    // A board-wide placeholder is an absence of ADP, so it must not occupy the player's slot.
    if (sentinels.get(row.format ?? '')?.has(row.adp)) return
    // Rows arrive freshest-first, and exact keys are consumed before name matches.
    if (out.has(sleeperId)) return
    out.set(sleeperId, {
      sleeperId,
      adpPlayerId: row.playerId,
      adp: row.adp,
      position: row.position ?? null,
      format: row.format ?? null,
      scoring: row.scoring ?? null,
      via,
    })
  }

  for (const row of exact) {
    const bySp = bySportsPlayerId.get(row.playerId)
    if (bySp) take(row, bySp, 'sports_player_id')
    else take(row, bySlug.get(row.playerId), 'slug')
  }

  for (const row of named) {
    const key = `${normalizeAdpName(row.playerName)}|${group(row.position)}`
    take(row, byName.get(key) ?? null, 'name')
  }

  /*
   * Position-disagreement pass. Only names that are unique on BOTH sides are eligible, so a
   * shared name never resolves here — it simply stays unresolved, which is the honest outcome.
   */
  const adpPlayersByBareName = new Map<string, Set<string>>()
  for (const row of named) {
    const bare = normalizeAdpName(row.playerName)
    const set = adpPlayersByBareName.get(bare) ?? new Set<string>()
    set.add(row.playerId)
    adpPlayersByBareName.set(bare, set)
  }
  for (const row of named) {
    const bare = normalizeAdpName(row.playerName)
    if ((adpPlayersByBareName.get(bare)?.size ?? 0) !== 1) continue
    take(row, byBareName.get(bare) ?? null, 'name')
  }

  return out
}
