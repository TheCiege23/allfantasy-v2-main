/**
 * Phase 2 — the canonical read path.
 *
 * `getCanonicalPlayer(id)` is the single server-side call that Phase 3 will swap the 86
 * `getAllPlayers()` call sites onto. It assembles the whole player object — profile, primary
 * image, latest season stats, projections, outlook, news, injury, and the cross-platform id
 * map — from the canonical tables in one batched round trip, instead of re-resolving anything
 * live per request.
 *
 * ── Live resolution is the exception, not the path ──
 * If a player has no `PlayerImage` row (a new signing, or someone the backfill missed) we fall
 * back to the provider chain exactly once and Phase 1's write-through persists the result, so
 * the next read is a pure DB hit. Pass `skipLiveFallback` to guarantee zero network calls.
 *
 * ── A note on where the satellites live ──
 * Stats, injuries and news are canonical (`sports_core_*`). Projections and outlook are not:
 * they live in `fantasy_projections` and `ai_player_outlooks_cache`, which predate the
 * canonical family. They still key on a plain `playerId` string, so once canonical ids are
 * what gets written everywhere they line up without a schema change. Note that
 * `PlayerOutlook` (`player_outlooks`) is deliberately NOT used here — it is user-scoped
 * (`userId` is required), so it cannot answer "the outlook for this player" without a viewer.
 * `AiPlayerOutlookCache` is the global one.
 */

import { prisma } from '@/lib/prisma'
import {
  PLAYER_IMAGE_TYPE_HEADSHOT,
  readPrimaryPlayerImage,
  type StoredPlayerImage,
} from '@/lib/player-assets/playerImageStore'
import { readPrimaryTeamImage, type StoredTeamImage } from '@/lib/sport-teams/teamImageStore'
import { resolvePlayerHeadshot } from '@/lib/player-assets/resolvePlayerHeadshot'

/**
 * True when an error is Postgres/Prisma complaining that a table or column does not exist.
 *
 * The canonical read path queries the `sports_core_*` tables + the Phase-1 `Player` columns, which
 * exist only after the canonical migration has been applied to the target database. The prod build
 * does NOT run `migrate deploy` (build = `next build`, postinstall = `prisma generate`), so there is
 * a window — however long the migration goes un-run — where this code is deployed but the objects do
 * not exist. Every one of these helpers previously issued its first `prisma` query with no guard, so
 * in that window they THREW. A caller with a local try/catch degraded to empty; a caller without one
 * (legacy/waiver/analyze reads getCanonicalPlayerMapForSport in its outer try) returned a 500.
 *
 * The write path (playerImageStore/teamImageStore) already "never throws" for exactly this reason.
 * This makes the read path match: a missing object degrades to the empty result, so the feature is
 * inert until the tables exist rather than erroring. Any OTHER error still propagates.
 *
 * Prisma: P2021 (table does not exist), P2022 (column does not exist). Raw Postgres: 42P01 / 42703.
 */
export function isMissingDatabaseObjectError(err: unknown): boolean {
  const e = err as { code?: unknown; meta?: { code?: unknown } } | null | undefined
  const code = typeof e?.code === 'string' ? e.code : undefined
  const pgCode = typeof e?.meta?.code === 'string' ? (e.meta.code as string) : undefined
  return (
    code === 'P2021' ||
    code === 'P2022' ||
    code === '42P01' ||
    code === '42703' ||
    pgCode === '42P01' ||
    pgCode === '42703'
  )
}

export interface CanonicalPlayerProjection {
  season: string
  week: number
  projectedPoints: number
  source: string
}

export interface CanonicalPlayerNews {
  headline: string
  url: string | null
  publishedAt: Date | null
}

export interface CanonicalPlayer {
  id: string
  name: string
  sport: string
  position: string
  team: string | null
  active: boolean
  height: string | null
  weight: string | null
  injuryStatus: string | null

  image: StoredPlayerImage | null
  seasonStats: {
    seasonKey: string
    seasonType: string
    stats: unknown
    fantasyPoints: number | null
    gamesPlayed: number | null
    source: string | null
  } | null
  projections: CanonicalPlayerProjection[]
  outlook: { payload: unknown; expiresAt: Date } | null
  news: CanonicalPlayerNews[]
  injury: { status: string | null; bodyPart: string | null; description: string | null } | null

  /** Cross-platform ids: `{ sleeper: "4034", espn: "3139477", ... }`. */
  providerIds: Record<string, string>

  meta: {
    /** True when the image was resolved live on this call and persisted for next time. */
    resolvedLiveImage: boolean
    /** Satellites that returned nothing — useful for spotting ingestion gaps. */
    missing: string[]
  }
}

export interface GetCanonicalPlayerOptions {
  /** Never touch the provider chain, even when no image exists. */
  skipLiveFallback?: boolean
  newsLimit?: number
  projectionLimit?: number
}

export async function getCanonicalPlayer(
  id: string,
  opts: GetCanonicalPlayerOptions = {},
): Promise<CanonicalPlayer | null> {
  const playerId = id?.trim()
  if (!playerId) return null

  const newsLimit = opts.newsLimit ?? 5
  const projectionLimit = opts.projectionLimit ?? 5

  const player = await prisma.player.findUnique({ where: { id: playerId } })
  if (!player) return null

  const sportKey = String(player.sport ?? '').toUpperCase()

  // One batched round trip for every satellite.
  const [image, seasonStats, projections, outlook, news, injury, identities] = await Promise.all([
    readPrimaryPlayerImage({ playerId }),
    prisma.playerSeasonStat.findFirst({
      where: { playerId, sportKey },
      orderBy: [{ seasonKey: 'desc' }, { fetchedAt: 'desc' }],
      select: {
        seasonKey: true, seasonType: true, stats: true,
        fantasyPoints: true, gamesPlayed: true, source: true,
      },
    }),
    prisma.fantasyProjection.findMany({
      where: { playerId, sport: sportKey },
      orderBy: [{ season: 'desc' }, { week: 'desc' }],
      take: projectionLimit,
      select: { season: true, week: true, projectedPoints: true, source: true },
    }),
    prisma.aiPlayerOutlookCache.findFirst({
      where: { playerId, sport: sportKey, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { outlookPayload: true, expiresAt: true },
    }),
    prisma.playerNewsItem.findMany({
      where: { playerId },
      orderBy: { publishedAt: 'desc' },
      take: newsLimit,
      select: { headline: true, url: true, publishedAt: true },
    }),
    // NOTE: InjuryReport has no `publishedAt` — its recency column is `reportDate`
    // (`sports_core_injury_reports`). Ordering by publishedAt here throws at runtime.
    prisma.injuryReport.findFirst({
      where: { playerId },
      orderBy: [{ reportDate: 'desc' }, { fetchedAt: 'desc' }],
      select: { status: true, bodyPart: true, description: true },
    }),
    prisma.playerProviderIdentity.findMany({
      where: { playerId },
      select: { provider: true, providerPlayerId: true },
    }),
  ])

  let resolvedImage = image
  let resolvedLiveImage = false

  // Only genuinely unmapped players pay the provider cost, and only once.
  if (!resolvedImage && !opts.skipLiveFallback) {
    const live = await resolvePlayerHeadshot({
      name: player.name,
      sport: sportKey,
      team: player.team,
      position: player.position,
      playerId,
    })
    if (live.imageUrl) {
      resolvedLiveImage = true
      resolvedImage = await readPrimaryPlayerImage({ playerId })
    }
  }

  const missing: string[] = []
  if (!resolvedImage) missing.push('image')
  if (!seasonStats) missing.push('seasonStats')
  if (projections.length === 0) missing.push('projections')
  if (!outlook) missing.push('outlook')
  if (news.length === 0) missing.push('news')
  if (!injury) missing.push('injury')

  return {
    id: player.id,
    name: player.name,
    sport: sportKey,
    position: player.position,
    team: player.team,
    active: player.active,
    height: player.height,
    weight: player.weight,
    injuryStatus: player.injuryStatus,

    image: resolvedImage,
    seasonStats: seasonStats
      ? {
          seasonKey: seasonStats.seasonKey,
          seasonType: seasonStats.seasonType,
          stats: seasonStats.stats,
          fantasyPoints: seasonStats.fantasyPoints,
          gamesPlayed: seasonStats.gamesPlayed,
          source: seasonStats.source,
        }
      : null,
    projections: projections.map((p) => ({
      season: p.season,
      week: p.week,
      projectedPoints: p.projectedPoints,
      source: p.source,
    })),
    outlook: outlook ? { payload: outlook.outlookPayload, expiresAt: outlook.expiresAt } : null,
    news: news.map((n) => ({ headline: n.headline, url: n.url, publishedAt: n.publishedAt })),
    injury: injury
      ? { status: injury.status, bodyPart: injury.bodyPart, description: injury.description }
      : null,

    providerIds: Object.fromEntries(
      identities.map((i) => [i.provider, i.providerPlayerId]),
    ),

    meta: { resolvedLiveImage, missing },
  }
}

/**
 * Lightweight canonical player for bulk lookups.
 *
 * Phase 3 note — why this exists. Every `getAllPlayers()` call site holds **Sleeper ids**
 * (they come from Sleeper rosters/leagues) and uses the result in one of three shapes:
 * enumerate everything, look up many ids at once, or look up one. `getCanonicalPlayer()`
 * serves none of them directly: it is keyed by canonical `Player.id`, and it hydrates every
 * satellite, which is far more than a name/headshot lookup needs. Calling it in a loop would
 * turn one live fetch into N×7 queries — strictly worse than the thing being replaced.
 *
 * So bulk call sites migrate onto `getCanonicalPlayersBySleeperIds()`, which answers any
 * number of ids in a fixed 3 queries and returns only the display fields those sites use.
 */
export interface CanonicalPlayerLite {
  id: string
  sleeperId: string
  name: string
  sport: string
  position: string
  team: string | null
  active: boolean
  /**
   * Injury/availability designation only (Questionable, IR, PUP, ...), never a roster state.
   * `SportsPlayer.status` mixes both; the backfill splits them — roster state lands on
   * `active`. See `classifySourceStatus` in backfillCanonical.ts.
   */
  injuryStatus: string | null
  /** Primary `PlayerImage` URL, falling back to the denormalized `Player.imageUrl`. */
  imageUrl: string | null
}

/** Postgres caps bound parameters; chunk large id lists rather than letting the query fail. */
const ID_CHUNK = 1000

/**
 * Batch 3 — the freshness guard.
 *
 * Batch 2 held `waiver/analyze` back because there was no mechanism for this. `skipLiveFallback`
 * looked like one but only governs *headshot* re-resolution; nothing re-checked roster state.
 *
 * ── What counts as "stale" ──
 * `Player.fetchedAt` is the SOURCE row's observation time, carried through from
 * `SportsPlayer.fetchedAt` by the backfill. It is deliberately not backfill time: stamping
 * `now()` there would make every row look freshly observed the instant a backfill ran, so the
 * guard would measure its own bookkeeping instead of the data. `expiresAt` is the source's own
 * TTL and is honoured when set.
 *
 * ── Why one live call, not N ──
 * `getAllPlayers()` is all-or-nothing (and in-process cached), so the guard fetches it at most
 * ONCE per call and overlays only the rows that are actually stale. Rows that are current are
 * never touched, which is the property that matters: a mostly-fresh table costs one fetch and
 * zero overwritten rows, not one fetch per player.
 */
export interface FreshnessStats {
  /** Rows considered. */
  checked: number
  /** Rows whose source observation was older than the threshold. */
  stale: number
  /** Rows actually overwritten from live data. */
  refreshed: number
  /** True when the live provider was contacted at all. */
  liveFetched: boolean
}

export interface FreshnessOptions {
  /**
   * Fall through to live provider data for rows whose source observation is older than this.
   * Omit for cache-only, which stays the default — most surfaces are descriptive and should
   * not pay for a live fetch.
   */
  maxAgeMs?: number
  /** Optional sink so callers and tests can assert what the guard actually did. */
  stats?: FreshnessStats
}

/** Common decision-time threshold: roster state older than this can mislead a live decision. */
export const DECISION_FRESHNESS_MS = 6 * 60 * 60 * 1000

interface RecencyFields {
  fetchedAt: Date | null
  expiresAt: Date | null
}

function isSourceStale(row: RecencyFields, maxAgeMs: number, now: number): boolean {
  // A source-declared expiry is authoritative when present.
  if (row.expiresAt && row.expiresAt.getTime() <= now) return true
  // No observation time at all means we cannot claim freshness.
  if (!row.fetchedAt) return true
  return now - row.fetchedAt.getTime() > maxAgeMs
}

function initStats(stats?: FreshnessStats): FreshnessStats {
  const s = stats ?? { checked: 0, stale: 0, refreshed: 0, liveFetched: false }
  s.checked = 0
  s.stale = 0
  s.refreshed = 0
  s.liveFetched = false
  return s
}

/**
 * Overlay live Sleeper state onto the stale entries of a canonical map.
 * Mutates `map` in place and records what happened in `stats`.
 */
async function applyFreshnessOverlay(
  map: Map<string, CanonicalPlayerLite>,
  staleSleeperIds: Set<string>,
  stats: FreshnessStats,
): Promise<void> {
  if (staleSleeperIds.size === 0) return

  const { getAllPlayers } = await import('@/lib/sleeper-client')
  const live = await getAllPlayers()
  stats.liveFetched = true

  for (const sleeperId of staleSleeperIds) {
    const fresh = live[sleeperId]
    const cached = map.get(sleeperId)
    if (!cached) continue
    if (!fresh) {
      // Present in canonical, absent from Sleeper's current universe. Do not invent a value —
      // leave the cached row and let the caller see it via `stats.stale`.
      continue
    }
    const liveName =
      fresh.full_name || `${fresh.first_name ?? ''} ${fresh.last_name ?? ''}`.trim() || cached.name
    map.set(sleeperId, {
      ...cached,
      name: liveName,
      position: fresh.position ?? cached.position,
      team: fresh.team ?? null,
    })
    stats.refreshed++
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Resolve many Sleeper ids to canonical players in a fixed number of queries.
 * Returns a Map keyed by the *Sleeper* id, so call sites keep indexing the way they already do.
 * Ids with no canonical player are simply absent — callers keep their existing fallback.
 */
export async function getCanonicalPlayersBySleeperIds(
  sleeperIds: string[],
  opts: FreshnessOptions = {},
): Promise<Map<string, CanonicalPlayerLite>> {
  const out = new Map<string, CanonicalPlayerLite>()
  const stats = initStats(opts.stats)
  const staleIds = new Set<string>()
  const now = Date.now()
  const ids = [...new Set(sleeperIds.filter((id) => typeof id === 'string' && id.trim()))]
  if (ids.length === 0) return out

  try {
  for (const batch of chunk(ids, ID_CHUNK)) {
    const identities = await prisma.playerProviderIdentity.findMany({
      where: { provider: 'sleeper', providerPlayerId: { in: batch } },
      select: { playerId: true, providerPlayerId: true },
    })
    const playerIds = identities
      .map((i) => i.playerId)
      .filter((id): id is string => Boolean(id))
    if (playerIds.length === 0) continue

    const [players, images] = await Promise.all([
      prisma.player.findMany({
        where: { id: { in: playerIds } },
        select: {
          id: true, name: true, sport: true, position: true,
          team: true, active: true, imageUrl: true, injuryStatus: true,
          fetchedAt: true, expiresAt: true,
        },
      }),
      prisma.playerImage.findMany({
        where: {
          playerId: { in: playerIds },
          imageType: PLAYER_IMAGE_TYPE_HEADSHOT,
          isPrimary: true,
        },
        select: { playerId: true, url: true },
      }),
    ])

    const byId = new Map(players.map((p) => [p.id, p]))
    const imageById = new Map(
      images.filter((i) => i.playerId).map((i) => [i.playerId as string, i.url]),
    )

    for (const identity of identities) {
      if (!identity.playerId) continue
      const player = byId.get(identity.playerId)
      if (!player) continue
      out.set(identity.providerPlayerId, {
        id: player.id,
        sleeperId: identity.providerPlayerId,
        name: player.name,
        sport: String(player.sport ?? '').toUpperCase(),
        position: player.position,
        team: player.team,
        active: player.active,
        injuryStatus: player.injuryStatus ?? null,
        imageUrl: imageById.get(player.id) ?? player.imageUrl ?? null,
      })

      if (opts.maxAgeMs !== undefined) {
        stats.checked++
        if (isSourceStale(player, opts.maxAgeMs, now)) {
          stats.stale++
          staleIds.add(identity.providerPlayerId)
        }
      }
    }
  }
  } catch (err) {
    // Tables/columns not migrated yet -> degrade to empty (see isMissingDatabaseObjectError).
    if (isMissingDatabaseObjectError(err)) return out
    throw err
  }

  if (opts.maxAgeMs !== undefined) await applyFreshnessOverlay(out, staleIds, stats)

  return out
}

/**
 * Enumerate every canonical player for a sport, keyed by Sleeper id.
 *
 * This is the third `getAllPlayers()` usage shape — a call site that iterates the whole player
 * universe rather than looking specific ids up (free-agent scans, "list every player" endpoints,
 * name searches). It is deliberately a separate function from
 * `getCanonicalPlayersBySleeperIds()` because the cost profile is different: that one answers a
 * bounded set of ids, this one is a full-table read for the sport (~13.9k rows for NFL).
 *
 * Two queries regardless of size, and it stays lightweight on purpose:
 *   - Keyed by **Sleeper id**, matching the `Record<sleeperId, player>` shape callers already
 *     index, so migrating a site is a data-source swap rather than a rewrite.
 *   - `includeImages` is **off by default**. Joining `PlayerImage` across an entire sport is a
 *     third read over every row to populate a field enumeration callers rarely use; the
 *     denormalized `Player.imageUrl` is still returned either way.
 *
 * Players without a Sleeper identity are absent by construction. That matches the old path —
 * `getAllPlayers()` only ever returned Sleeper's universe — but it does mean this is an
 * NFL-shaped accessor today, because Sleeper covers no other sport (see `canonicalIdentity.ts`).
 */
export async function getCanonicalPlayerMapForSport(
  sport: string,
  opts: { activeOnly?: boolean; includeImages?: boolean } & FreshnessOptions = {},
): Promise<Map<string, CanonicalPlayerLite>> {
  const sportKey = String(sport ?? '').trim().toUpperCase()
  const out = new Map<string, CanonicalPlayerLite>()
  const stats = initStats(opts.stats)
  if (!sportKey) return out

  // Inferred tuple type from the selects — no explicit annotation, so the narrowed select shape
  // (not the full Player row) is preserved. Returns null on a missing table/column so the function
  // degrades to the empty map. waiver/analyze reads this in its outer try with no local catch, so an
  // unguarded throw here is a user-facing 500. Everything else re-throws.
  const loaded = await (async () => {
    try {
      return await Promise.all([
        prisma.playerProviderIdentity.findMany({
          where: { provider: 'sleeper', sportKey },
          select: { playerId: true, providerPlayerId: true },
        }),
        prisma.player.findMany({
          where: opts.activeOnly ? { sport: sportKey, active: true } : { sport: sportKey },
          select: {
            id: true, name: true, sport: true, position: true,
            team: true, active: true, imageUrl: true, injuryStatus: true,
            fetchedAt: true, expiresAt: true,
          },
        }),
      ])
    } catch (err) {
      if (isMissingDatabaseObjectError(err)) return null
      throw err
    }
  })()
  if (!loaded) return out
  const [identities, players] = loaded

  const byId = new Map(players.map((p) => [p.id, p]))

  let imageById = new Map<string, string>()
  if (opts.includeImages) {
    const images = await prisma.playerImage.findMany({
      where: {
        playerId: { in: [...byId.keys()] },
        imageType: PLAYER_IMAGE_TYPE_HEADSHOT,
        isPrimary: true,
      },
      select: { playerId: true, url: true },
    })
    imageById = new Map(images.filter((i) => i.playerId).map((i) => [i.playerId as string, i.url]))
  }

  const now = Date.now()
  const staleIds = new Set<string>()

  for (const identity of identities) {
    if (!identity.playerId) continue
    const player = byId.get(identity.playerId)
    if (!player) continue
    out.set(identity.providerPlayerId, {
      id: player.id,
      sleeperId: identity.providerPlayerId,
      name: player.name,
      sport: String(player.sport ?? '').toUpperCase(),
      position: player.position,
      team: player.team,
      active: player.active,
      injuryStatus: player.injuryStatus ?? null,
      imageUrl: imageById.get(player.id) ?? player.imageUrl ?? null,
    })

    if (opts.maxAgeMs !== undefined) {
      stats.checked++
      if (isSourceStale(player, opts.maxAgeMs, now)) {
        stats.stale++
        staleIds.add(identity.providerPlayerId)
      }
    }
  }

  if (opts.maxAgeMs !== undefined) await applyFreshnessOverlay(out, staleIds, stats)

  return out
}

/** Full canonical player, resolved from a Sleeper id rather than a canonical id. */
export async function getCanonicalPlayerBySleeperId(
  sleeperId: string,
  opts: GetCanonicalPlayerOptions = {},
): Promise<CanonicalPlayer | null> {
  const id = sleeperId?.trim()
  if (!id) return null

  const identity = await prisma.playerProviderIdentity.findFirst({
    where: { provider: 'sleeper', providerPlayerId: id },
    select: { playerId: true },
  })
  if (!identity?.playerId) return null

  return getCanonicalPlayer(identity.playerId, opts)
}

export interface CanonicalTeam {
  id: string
  sportKey: string
  leagueKey: string | null
  canonicalName: string
  shortName: string | null
  abbreviation: string | null
  city: string | null
  conference: string | null
  division: string | null
  active: boolean
  logo: StoredTeamImage | null
  providerIds: Record<string, string>
  meta: { missing: string[] }
}

export async function getCanonicalTeam(id: string): Promise<CanonicalTeam | null> {
  const teamId = id?.trim()
  if (!teamId) return null

  const team = await prisma.team.findUnique({ where: { id: teamId } })
  if (!team) return null

  const [logo, identities] = await Promise.all([
    readPrimaryTeamImage({ teamId }),
    prisma.teamProviderIdentity.findMany({
      where: { teamId },
      select: { provider: true, providerTeamId: true },
    }),
  ])

  const missing: string[] = []
  if (!logo) missing.push('logo')

  return {
    id: team.id,
    sportKey: team.sportKey,
    leagueKey: team.leagueKey,
    canonicalName: team.canonicalName,
    shortName: team.shortName,
    abbreviation: team.abbreviation,
    city: team.city,
    conference: team.conference,
    division: team.division,
    active: team.active,
    logo,
    providerIds: Object.fromEntries(identities.map((i) => [i.provider, i.providerTeamId])),
    meta: { missing },
  }
}
