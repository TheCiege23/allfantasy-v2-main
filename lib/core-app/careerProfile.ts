import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  buildCareerData,
  loadCareerIdentity,
  loadCareerRows,
  type CareerData,
  type CareerFilter,
  type CareerRow,
  type CareerSource,
} from '@/lib/core-app/career'
import { tradeAssetCount } from '@/lib/core-app/careerTrades'

/**
 * The precomputed career profile — item 9 of the career brief: "update the
 * career profile after imports rather than recalculating every visit".
 *
 * One stored document per user in `sportsDataCache`, holding the deduplicated
 * league-season ROWS and per-season trade counts. Every filter and every tab is
 * built from it in memory (`buildCareerData`), so a visit reads one row instead
 * of re-joining three history tables.
 *
 * ── Who writes it ───────────────────────────────────────────────────────────
 *
 *   `refreshCareerProfile` — called when an import or a rank recalculation
 *   finishes, so the first visit after an import is already warm.
 *   `readCareerProfile`    — rebuilds and stores when the stored copy is missing
 *   or out of date. That fallback is not optional: CLAUDE.md records what a
 *   surface pointed at a table nothing refreshes does — `ingestCFBDStats` had no
 *   caller and the screen served nulls while looking correct. A career profile
 *   that only a hook writes would go stale the first time an import path forgot
 *   the hook.
 *
 * ── How "out of date" is decided ───────────────────────────────────────────
 *
 * ⚠ BY A STAMP OF THE SOURCES, NOT BY A CLOCK. A career changes when a row it is
 * built from changes, never because time passed, so a TTL would either serve an
 * import late or rebuild a settled career for nothing. The stamp is counts plus
 * newest `updatedAt` per source, read with aggregates — a handful of index scans
 * against the full join the build does.
 *
 * ⚠ `SeasonStandingFact` HAS NO `updatedAt`. Its part of the stamp is a count and
 * summed wins/losses/points, which moves when a backfill rewrites a record.
 *
 * ⚠ STORED IN `sportsDataCache`, NOT A NEW TABLE. A table is a migration, and a
 * migration is the user's call — the same reason the rankings snapshots live there.
 *
 * ⚠ IDENTITY IS NEVER STORED. Name, avatar and XP are read live on every visit
 * (`loadCareerIdentity`); a rename must not wait for an import.
 */

/*
 * v2 — rows carry `finalResult` (career Finals, from stored Sleeper brackets). A v1 document
 * has no such field, so it fails `isStoredProfile` and is rebuilt on its next read.
 */
export const CAREER_PROFILE_VERSION = 2
export const CAREER_PROFILE_PREFIX = `core-career:profile:v${CAREER_PROFILE_VERSION}:`
/** A profile is rebuilt whenever its sources move; this only bounds an abandoned account's row. */
const PROFILE_RETENTION_DAYS = 400

/** Trades per season and league — the only trade facts the overview needs. */
export type CareerTradeCount = {
  season: number
  /** The league the trades were made in, when it resolves to one of your league-seasons. */
  leagueKey: string | null
  count: number
  /** Most players and picks moved in one trade that season, in that league. */
  maxAssets: number
}

export type StoredCareerProfile = {
  version: number
  builtAt: string
  stamp: string
  rows: CareerRow[]
  platforms: string[]
  rosterless: number
  trades: CareerTradeCount[]
}

export type CareerProfile = {
  source: CareerSource
  trades: CareerTradeCount[]
  builtAt: string
  /** `stored` — served from the document; `built` — rebuilt on this request. */
  origin: 'stored' | 'built'
}

export function careerProfileKey(userId: string): string {
  return `${CAREER_PROFILE_PREFIX}${userId}`
}

function isStoredProfile(value: unknown): value is StoredCareerProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Partial<StoredCareerProfile>
  return (
    v.version === CAREER_PROFILE_VERSION &&
    typeof v.stamp === 'string' &&
    typeof v.builtAt === 'string' &&
    Array.isArray(v.rows) &&
    Array.isArray(v.platforms) &&
    Array.isArray(v.trades) &&
    typeof v.rosterless === 'number'
  )
}

/** The Sleeper ids a `LeagueTradeHistory` may be keyed on for this account. */
export async function sleeperTradeKeys(legacyUserId: string | null): Promise<string[]> {
  if (!legacyUserId) return []
  const lu = await prisma.legacyUser
    .findUnique({ where: { id: legacyUserId }, select: { sleeperUserId: true, sleeperUsername: true } })
    .catch(() => null)
  /*
   * ⚠ THE COLUMN IS NAMED `sleeperUsername` AND HOLDS THE SLEEPER USER ID.
   * Measured 2026-09-16: the ten busiest histories are all keyed on numeric
   * Sleeper ids, and none matches a LegacyUser's username. Both are passed so a
   * history written the other way is not silently dropped.
   */
  return [lu?.sleeperUserId, lu?.sleeperUsername].filter((s): s is string => !!s)
}

type Stamped = { stamp: string; tradeKeys: string[] }

/**
 * The source stamp. Every part is a count and a newest-change marker, so an
 * added, removed or rewritten row moves it.
 */
export async function computeCareerStamp(userId: string, legacyUserId: string | null): Promise<Stamped> {
  const tradeKeys = await sleeperTradeKeys(legacyUserId)
  const claimed = await prisma.leagueTeam.findMany({
    where: { claimedByUserId: userId },
    select: { leagueId: true, externalId: true, lastUpdatedAt: true },
  })
  const claimedLeagueIds = [...new Set(claimed.map((c) => c.leagueId))]
  const claimsPart = claimed
    .map((c) => `${c.leagueId}:${c.externalId}`)
    .sort()
    .join(',')
  const claimsNewest = claimed.reduce<number>((m, c) => Math.max(m, c.lastUpdatedAt?.getTime() ?? 0), 0)

  const [imports, facts, legacyLeagues, legacyRosters, trades, titleGames] = await Promise.all([
    prisma.league.aggregate({
      where: { userId, importWins: { not: null } },
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    claimedLeagueIds.length
      ? prisma.seasonStandingFact.aggregate({
          where: { leagueId: { in: claimedLeagueIds } },
          _count: { _all: true },
          _sum: { wins: true, losses: true, ties: true, pointsFor: true },
        })
      : null,
    legacyUserId
      ? prisma.legacyLeague.aggregate({
          where: { userId: legacyUserId },
          _count: { _all: true },
          _max: { updatedAt: true },
        })
      : null,
    legacyUserId
      ? prisma.legacyRoster.aggregate({
          where: { isOwner: true, league: { userId: legacyUserId } },
          _count: { _all: true },
          _max: { updatedAt: true },
        })
      : null,
    tradeKeys.length
      ? prisma.leagueTrade.aggregate({
          where: { history: { sleeperUsername: { in: tradeKeys } } },
          _count: { _all: true },
          _max: { createdAt: true },
        })
      : null,
    storedTitleGameStamp(userId, legacyUserId, claimedLeagueIds),
  ])

  const t = (d: Date | null | undefined) => (d ? d.getTime() : 0)
  const parts = [
    `i${imports._count._all}@${t(imports._max.updatedAt)}`,
    `c${claimed.length}@${claimsNewest}#${hash(claimsPart)}`,
    facts
      ? `f${facts._count._all}:${facts._sum.wins ?? 0}:${facts._sum.losses ?? 0}:${facts._sum.ties ?? 0}:${Math.round(facts._sum.pointsFor ?? 0)}`
      : 'f0',
    legacyLeagues ? `l${legacyLeagues._count._all}@${t(legacyLeagues._max.updatedAt)}` : 'l0',
    legacyRosters ? `r${legacyRosters._count._all}@${t(legacyRosters._max.updatedAt)}` : 'r0',
    trades ? `t${trades._count._all}@${t(trades._max.createdAt)}` : 't0',
    titleGames,
    `u${legacyUserId ?? '-'}`,
  ]
  return { stamp: parts.join('|'), tradeKeys }
}

/**
 * The stored Sleeper title games (`league_dynasty_seasons`) the Finals tile can read.
 *
 * ⚠ A DIGEST OF THE TITLE-GAME FIELDS, NOT `importedAt`. Every re-sync rewrites
 * `importedAt`, including the four-hourly refresh of seasons still being played, so a date
 * would rebuild settled careers for nothing. The digest moves when a row is added or removed,
 * when a backfill stamps `bracketPlacementVersion`, or when a stored final is decided.
 *
 * ⚠ THE SAME MATCH AS THE LOADER: Sleeper league ids from legacy history and from this
 * account's leagues, and `League.id`s owned or claimed. Never throws — a failed read stamps
 * `d?`, which rebuilds once rather than taking the page down.
 */
async function storedTitleGameStamp(userId: string, legacyUserId: string | null, claimedLeagueIds: string[]): Promise<string> {
  try {
    const rows = await prisma.$queryRaw<Array<{ n: number; digest: string | null }>>`
      SELECT count(*)::int AS n,
             md5(string_agg(
               coalesce(metadata->'playoffStructure'->>'bracketPlacementVersion', '') || ':' ||
               coalesce(metadata->'playoffStructure'->>'championRosterId', '') || ':' ||
               coalesce(metadata->'playoffStructure'->>'runnerUpRosterId', ''),
               ',' ORDER BY id
             )) AS digest
      FROM league_dynasty_seasons
      WHERE provider = 'sleeper'
        AND (
          "platformLeagueId" IN (SELECT "sleeperLeagueId" FROM "LegacyLeague" WHERE "userId" = ${legacyUserId ?? ''})
          OR "platformLeagueId" IN (SELECT "platformLeagueId" FROM leagues WHERE "userId" = ${userId} AND "platformLeagueId" IS NOT NULL)
          OR "leagueId" IN (SELECT id FROM leagues WHERE "userId" = ${userId})
          OR "leagueId" = ANY(${claimedLeagueIds}::text[])
          OR "platformLeagueId" IN (
            SELECT "platformLeagueId" FROM leagues WHERE id = ANY(${claimedLeagueIds}::text[]) AND "platformLeagueId" IS NOT NULL
          )
        )
    `
    const row = rows[0]
    return `d${row?.n ?? 0}#${(row?.digest ?? '').slice(0, 12)}`
  } catch (err) {
    console.error('[core-app/careerProfile] title-game stamp read failed', err)
    return 'd?'
  }
}

/** FNV-1a — a short, stable digest for the claim list; not a security boundary. */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** Trade counts per season and league for this account. */
export async function loadCareerTradeCounts(tradeKeys: string[], rows: CareerRow[]): Promise<CareerTradeCount[]> {
  if (tradeKeys.length === 0) return []
  const trades = await prisma.leagueTrade.findMany({
    where: { history: { sleeperUsername: { in: tradeKeys } } },
    select: {
      season: true,
      playersGiven: true,
      playersReceived: true,
      picksGiven: true,
      picksReceived: true,
      history: { select: { sleeperLeagueId: true } },
    },
    take: 20_000,
  })
  const leagueKeyByProvider = new Map<string, string>()
  for (const r of rows) {
    if (r.providerLeagueId) leagueKeyByProvider.set(`${r.providerLeagueId}`, r.leagueKey)
  }
  const acc = new Map<string, CareerTradeCount>()
  for (const tr of trades) {
    const leagueKey = leagueKeyByProvider.get(tr.history.sleeperLeagueId) ?? null
    const k = `${tr.season}|${leagueKey ?? ''}`
    const assets = tradeAssetCount(tr)
    const held = acc.get(k)
    if (held) {
      held.count += 1
      held.maxAssets = Math.max(held.maxAssets, assets)
    } else {
      acc.set(k, { season: tr.season, leagueKey, count: 1, maxAssets: assets })
    }
  }
  return [...acc.values()].sort((a, b) => a.season - b.season || (a.leagueKey ?? '').localeCompare(b.leagueKey ?? ''))
}

async function buildStored(userId: string, legacyUserId: string | null, stamped: Stamped): Promise<StoredCareerProfile> {
  const loaded = await loadCareerRows(userId, legacyUserId)
  const trades = await loadCareerTradeCounts(stamped.tradeKeys, loaded.rows).catch((err: unknown) => {
    console.error('[core-app/careerProfile] trade count read failed', err)
    return [] as CareerTradeCount[]
  })
  return {
    version: CAREER_PROFILE_VERSION,
    builtAt: new Date().toISOString(),
    stamp: stamped.stamp,
    rows: loaded.rows,
    platforms: loaded.platforms,
    rosterless: loaded.rosterless,
    trades,
  }
}

async function writeStored(userId: string, profile: StoredCareerProfile): Promise<void> {
  const expiresAt = new Date(Date.now() + PROFILE_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const data = JSON.parse(JSON.stringify(profile)) as object
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: careerProfileKey(userId) },
    create: { cacheKey: careerProfileKey(userId), data, expiresAt },
    update: { data, expiresAt },
  })
}

async function readStored(userId: string): Promise<StoredCareerProfile | null> {
  const row = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: careerProfileKey(userId) }, select: { data: true, expiresAt: true } })
    .catch(() => null)
  if (!row || row.expiresAt.getTime() <= Date.now()) return null
  return isStoredProfile(row.data) ? row.data : null
}

/**
 * The writer. Rebuilds from the sources and stores, whatever is stored now.
 *
 * Never throws: it runs at the tail of imports and rank recalculations, and a
 * career cache must not be able to fail either.
 */
export async function refreshCareerProfile(userId: string): Promise<{ ok: boolean; rows: number }> {
  if (!userId || process.env.CORE_CAREER_PROFILE_DISABLED === '1') return { ok: false, rows: 0 }
  try {
    const identity = await loadCareerIdentity(userId)
    const stamped = await computeCareerStamp(userId, identity.legacyUserId)
    const stored = await buildStored(userId, identity.legacyUserId, stamped)
    await writeStored(userId, stored)
    return { ok: true, rows: stored.rows.length }
  } catch (err) {
    console.error('[core-app/careerProfile] refresh failed', err)
    return { ok: false, rows: 0 }
  }
}

/**
 * The reader. Serves the stored profile when its stamp still matches the
 * sources; otherwise rebuilds, stores (not awaited) and serves the rebuild.
 *
 * ⚠ A STALE PROFILE IS NEVER SERVED, not even while a rebuild runs. The person
 * most likely to open this screen right after its sources moved is the person
 * who just imported, and a pre-import board is exactly what they must not see.
 */
export async function readCareerProfile(userId: string): Promise<CareerProfile> {
  const identity = await loadCareerIdentity(userId)
  const { legacyUserId, ...who } = identity
  const [stamped, stored] = await Promise.all([computeCareerStamp(userId, legacyUserId), readStored(userId)])

  if (stored && stored.stamp === stamped.stamp) {
    return {
      source: { identity: who, rows: stored.rows, platforms: stored.platforms, rosterless: stored.rosterless },
      trades: stored.trades,
      builtAt: stored.builtAt,
      origin: 'stored',
    }
  }

  const built = await buildStored(userId, legacyUserId, stamped)
  void writeStored(userId, built).catch((err: unknown) => {
    console.error('[core-app/careerProfile] store failed', err)
  })
  return {
    source: { identity: who, rows: built.rows, platforms: built.platforms, rosterless: built.rosterless },
    trades: built.trades,
    builtAt: built.builtAt,
    origin: 'built',
  }
}

/** The page's read: the profile, built under one filter. */
export async function getCareerFromProfile(
  userId: string,
  filter: CareerFilter,
): Promise<{ data: CareerData; profile: CareerProfile }> {
  const profile = await readCareerProfile(userId)
  return { data: buildCareerData(profile.source, filter), profile }
}
