import 'server-only'

import { prisma } from '@/lib/prisma'
import { lastSyncByLeagueFrom, staleLeagueIds } from './outstandingIssues'

/**
 * Urgency counts on the Core tabs — "how many of my leagues need me here".
 *
 * User decisions, 2026-09-14: My team (lineup problems), Trades (offers waiting on
 * you), Draft HQ (drafts live or starting within a day) and Sync (stale leagues);
 * every number is LEAGUES AFFECTED; lineup counts cached per user for 10 minutes.
 *
 * ⚠ THESE ARE CHROME, SO THEY RENDER ON EVERY /core PAGE. Each source is chosen for
 * what it costs there:
 *   - Sync and Draft HQ come from data every page already holds (the league list and
 *     the activity snapshot) — free.
 *   - My team reuses the home's own lineup facts (`getDash34Data`: empty starting
 *     slots and starters ruled out). That reads rosters and the injury feed, which
 *     the page deliberately does only on the home — so it is CACHED per user. The
 *     home refreshes the cache for nothing, since it computes those facts anyway;
 *     any other tab recomputes at most once per URGENCY_TTL_MS.
 *   - Trades counts pending Sleeper offers waiting on you. Finding one takes a
 *     provider read, which only surfaces that already scan trades perform — so this
 *     module never reads the provider. It records what those scans found, and a
 *     league whose last scan is older than the TTL simply is not counted. A stale
 *     "1 offer" for an offer already answered is worse than no badge.
 *
 * ⚠ ONE RULE PER BADGE. Stale leagues go through `staleLeagueIds`, the same function
 * the issues queue uses; lineup problems are the same fields the home's brief reads.
 * A badge that disagreed with the screen it links to would train people to ignore it.
 */

export const URGENCY_KEY_PREFIX = 'core-urgency:v1:'
export const URGENCY_TTL_MS = 10 * 60_000
export const DRAFT_SOON_MS = 24 * 3_600_000
const CACHE_ROW_TTL_MS = 60 * 60_000

export type LineupLeague = { id: string; emptyStarters?: number | null; hurtStarters?: number | null }

export type UrgencyCache = {
  version: 1
  /** Whole-portfolio lineup read: leagues with an empty starting slot or a starter ruled out. */
  lineup: { at: string; leagueIds: string[] } | null
  /** Per league, from the last trade scan that answered for it. */
  offers: Record<string, { at: string; waiting: number }>
}

export type UrgencyBadges = {
  myTeam: number | null
  trades: number | null
  draftHq: number | null
  sync: number | null
}

export function lineupLeagueIds(leagues: LineupLeague[]): string[] {
  return leagues.filter((l) => (l.emptyStarters ?? 0) > 0 || (l.hurtStarters ?? 0) > 0).map((l) => l.id)
}

export function draftLeagueIds(
  leagues: Array<{ id: string; draftDate?: string | Date | null }>,
  liveDraftLeagueIds: string[],
  now: Date,
): string[] {
  const ids = new Set(liveDraftLeagueIds)
  for (const l of leagues) {
    if (!l.draftDate) continue
    const at = new Date(l.draftDate).getTime()
    if (Number.isFinite(at) && at > now.getTime() && at - now.getTime() <= DRAFT_SOON_MS) ids.add(l.id)
  }
  return [...ids]
}

export function isFresh(at: string | null | undefined, now: Date, ttlMs = URGENCY_TTL_MS): boolean {
  if (!at) return false
  const t = new Date(at).getTime()
  return Number.isFinite(t) && t <= now.getTime() && now.getTime() - t < ttlMs
}

const countOrNull = (n: number): number | null => (n > 0 ? n : null)

function emptyCache(): UrgencyCache {
  return { version: 1, lineup: null, offers: {} }
}

function asCache(value: unknown): UrgencyCache {
  const v = value as Partial<UrgencyCache> | null
  if (!v || v.version !== 1) return emptyCache()
  return {
    version: 1,
    lineup: v.lineup && typeof v.lineup.at === 'string' && Array.isArray(v.lineup.leagueIds) ? v.lineup : null,
    offers: v.offers && typeof v.offers === 'object' ? (v.offers as UrgencyCache['offers']) : {},
  }
}

async function readCache(userId: string): Promise<UrgencyCache> {
  const row = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: `${URGENCY_KEY_PREFIX}${userId}` }, select: { data: true } })
    .catch(() => null)
  return asCache(row?.data)
}

async function writeCache(userId: string, cache: UrgencyCache, now: Date): Promise<void> {
  const data = cache as unknown as object
  const expiresAt = new Date(now.getTime() + CACHE_ROW_TTL_MS)
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey: `${URGENCY_KEY_PREFIX}${userId}` },
      update: { data, expiresAt },
      create: { cacheKey: `${URGENCY_KEY_PREFIX}${userId}`, data, expiresAt },
    })
    .catch(() => undefined)
}

/**
 * Record what a trade scan found. Only leagues whose scan ANSWERED are passed; each
 * replaces that league's entry, and every other league keeps its own timestamp.
 */
export async function recordPendingOffers(
  userId: string,
  scanned: Array<{ leagueId: string; waiting: number }>,
  now: Date,
): Promise<void> {
  if (scanned.length === 0) return
  const cache = await readCache(userId)
  for (const s of scanned) cache.offers[s.leagueId] = { at: now.toISOString(), waiting: Math.max(0, s.waiting) }
  /* Expired entries can never count again; dropping them keeps the row small. */
  for (const [id, entry] of Object.entries(cache.offers)) {
    if (!isFresh(entry.at, now)) delete cache.offers[id]
  }
  await writeCache(userId, cache, now)
}

export async function getUrgencyBadges(input: {
  userId: string
  /** The leagues the user plays — every count is scoped to these. */
  leagues: Array<{ id: string; platform?: string | null; draftDate?: string | Date | null; lastSyncedAt?: Date | string | null }>
  liveDraftLeagueIds: string[]
  now: Date
  /** The home already computed these; passing them refreshes the cache for free. */
  lineupLeagues?: LineupLeague[] | null
  /** Recomputes lineup facts when the cache is stale. Called at most once per TTL per user. */
  loadLineupLeagues: () => Promise<LineupLeague[] | null>
}): Promise<UrgencyBadges> {
  const { userId, leagues, now } = input
  const played = new Set(leagues.map((l) => l.id))
  const cache = await readCache(userId)

  let lineupIds: string[] | null = null
  if (input.lineupLeagues) {
    lineupIds = lineupLeagueIds(input.lineupLeagues)
    cache.lineup = { at: now.toISOString(), leagueIds: lineupIds }
    await writeCache(userId, cache, now)
  } else if (cache.lineup && isFresh(cache.lineup.at, now)) {
    lineupIds = cache.lineup.leagueIds
  } else {
    const loaded = await input.loadLineupLeagues().catch(() => null)
    if (loaded) {
      lineupIds = lineupLeagueIds(loaded)
      cache.lineup = { at: now.toISOString(), leagueIds: lineupIds }
      await writeCache(userId, cache, now)
    }
  }

  const offerCount = Object.entries(cache.offers).filter(
    ([id, entry]) => played.has(id) && entry.waiting > 0 && isFresh(entry.at, now),
  ).length

  return {
    /* Unknown (no fresh cache and the reload failed) is null — no badge, not a zero. */
    myTeam: lineupIds ? countOrNull(lineupIds.filter((id) => played.has(id)).length) : null,
    trades: countOrNull(offerCount),
    draftHq: countOrNull(draftLeagueIds(leagues, input.liveDraftLeagueIds, now).filter((id) => played.has(id)).length),
    sync: countOrNull(staleLeagueIds(leagues, lastSyncByLeagueFrom(leagues), now).length),
  }
}
