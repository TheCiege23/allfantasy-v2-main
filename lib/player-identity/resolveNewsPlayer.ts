/**
 * Resolve a news item's extracted player name to a canonical player, at INGESTION time.
 *
 * ── Why this exists, measured rather than assumed ─────────────────────────────────────────────
 *
 * `PlayerNewsRecord.playerId` was NULL on 100% of 17,625 production rows, so Decision OS's news
 * enrichment could only reach a player through `playerName` with `mode: 'insensitive'` — a raw
 * string match with no suffix, apostrophe or initial handling.
 *
 * The obvious fix — normalise that join at READ time — was measured and REJECTED: it scored
 * net −44 against the raw match, because normalising collapses distinct players onto one key and
 * creates ~50 ambiguities for a handful of recoveries. `scripts/measure-news-identity-recovery.ts`
 * holds that measurement and is the control any change here must beat.
 *
 * What the measurement actually found is that the loss is UPSTREAM, in extraction quality:
 *
 *     x_grok_search         8% unattributable
 *     espn                 49%
 *     newsapi_everything   50%
 *     newsapi_headlines    56%
 *
 * ESPN and NewsAPI write headline fragments and bylines into the player column — "Power Rankings",
 * "Dallas Cowboys", "Eric Karabell", "Various (e.g., Jaydon Blue, Hunter Renfrow)". Those are not
 * failed player matches; they are not players. Resolving at ingestion separates the two.
 *
 * ── The contract ──────────────────────────────────────────────────────────────────────────────
 *
 * - Resolves against `PlayerIdentityMap`, the canonical registry (~98% unique by normalised name
 *   for NFL) — NOT `SportsPlayer`, which stores one row per provider and collides on ~52% of NFL
 *   names by construction.
 * - Uses the canonical JS `normalizePlayerName`. Never a SQL copy: CLAUDE.md records a SQL
 *   reimplementation of that exact function disagreeing with the real one on 7.2% of players.
 * - 🛑 AN AMBIGUOUS NAME IS NEVER GUESSED. Attaching an injury to the wrong player is worse than
 *   attaching it to nobody, because a wrong attribution is acted on and a missing one is visible.
 * - Unresolved is a legitimate outcome, not a failure: the row is kept as general news with its
 *   headline intact and `playerId` left null. `playerId IS NOT NULL` becomes the marker for
 *   "attributed to a player", which needs no schema change — the column already exists.
 */
import { prisma as defaultPrisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'

/**
 * Strings the extractors write into the player column to mean "this news has no player".
 * They are sentinels, not names, and must never reach the registry lookup.
 */
export const NEWS_PLAYER_PLACEHOLDERS: readonly string[] = ['General Update', 'Preferred Source', '']

export type NewsPlayerMatchType =
  /** The stored name matched the registry exactly, case aside. */
  | 'exact'
  /** Matched only after normalisation — apostrophes, initials, suffixes. */
  | 'normalized'
  /** The name alone collided; the news row's own team settled it. */
  | 'team_disambiguated'
  /** More than one player shares the name and nothing settles it. Deliberately unresolved. */
  | 'ambiguous'
  /** No registry entry, a placeholder, or an empty name. General news. */
  | 'unresolved'

export interface NewsPlayerMatch {
  playerId: string | null
  matchType: NewsPlayerMatchType
}

export interface NewsPlayerIndex {
  /** Resolve one extracted name. Pure and synchronous — the DB read happens once, at build. */
  resolve(playerName: string | null | undefined, team?: string | null): NewsPlayerMatch
  /** Distinct normalised names held. 0 means the registry had nothing for this sport. */
  readonly size: number
}

interface RegistryRow {
  id: string
  canonicalName: string
  currentTeam: string | null
}

export interface BuildNewsPlayerIndexDeps {
  loadRegistry(sport: string): Promise<RegistryRow[]>
}

const defaultDeps: BuildNewsPlayerIndexDeps = {
  loadRegistry: (sport) =>
    defaultPrisma.playerIdentityMap.findMany({
      where: { sport },
      select: { id: true, canonicalName: true, currentTeam: true },
    }),
}

function teamKey(team: string | null | undefined): string {
  return (team ?? '').trim().toUpperCase()
}

/**
 * Build a per-sport lookup ONCE per ingestion run.
 *
 * Deliberately not a per-item query: a run inserts hundreds of items, and a lookup per item turns
 * one indexed read into hundreds. Never throws — an unreadable registry yields an index that
 * resolves nothing, so ingestion continues and every row is stored as general news rather than
 * the run failing.
 */
export async function buildNewsPlayerIndex(
  sport: string,
  deps: BuildNewsPlayerIndexDeps = defaultDeps,
): Promise<NewsPlayerIndex> {
  const byName = new Map<string, string[]>()
  const byNameTeam = new Map<string, string[]>()
  const canonicalLower = new Set<string>()

  let rows: RegistryRow[] = []
  try {
    rows = await deps.loadRegistry(sport.toUpperCase())
  } catch {
    rows = []
  }

  for (const row of rows) {
    const key = normalizePlayerName(row.canonicalName)
    if (!key) continue

    canonicalLower.add(row.canonicalName.trim().toLowerCase())

    const bucket = byName.get(key)
    if (bucket) bucket.push(row.id)
    else byName.set(key, [row.id])

    const t = teamKey(row.currentTeam)
    if (t) {
      const tk = `${key}|${t}`
      const tb = byNameTeam.get(tk)
      if (tb) tb.push(row.id)
      else byNameTeam.set(tk, [row.id])
    }
  }

  return {
    size: byName.size,

    resolve(playerName, team) {
      const raw = (playerName ?? '').trim()
      if (!raw || NEWS_PLAYER_PLACEHOLDERS.includes(raw)) {
        return { playerId: null, matchType: 'unresolved' }
      }

      const key = normalizePlayerName(raw)
      if (!key) return { playerId: null, matchType: 'unresolved' }

      const bucket = byName.get(key)
      if (!bucket || bucket.length === 0) {
        return { playerId: null, matchType: 'unresolved' }
      }

      if (bucket.length === 1) {
        // Report whether normalisation was load-bearing, so a drop in `normalized` matches is a
        // visible signal that an extractor's formatting changed.
        const wasExact = canonicalLower.has(raw.toLowerCase())
        return { playerId: bucket[0], matchType: wasExact ? 'exact' : 'normalized' }
      }

      const t = teamKey(team)
      if (t) {
        const byTeam = byNameTeam.get(`${key}|${t}`)
        if (byTeam && byTeam.length === 1) {
          return { playerId: byTeam[0], matchType: 'team_disambiguated' }
        }
      }

      // 🛑 Two or more real players, and nothing to separate them. Refuse.
      return { playerId: null, matchType: 'ambiguous' }
    },
  }
}

/** Per-run counters, so a degraded extractor is visible instead of silent. */
export interface NewsResolutionTally {
  exact: number
  normalized: number
  team_disambiguated: number
  ambiguous: number
  unresolved: number
}

export function emptyNewsResolutionTally(): NewsResolutionTally {
  return { exact: 0, normalized: 0, team_disambiguated: 0, ambiguous: 0, unresolved: 0 }
}

export function tallyNewsResolution(
  tally: NewsResolutionTally,
  matchType: NewsPlayerMatchType,
): NewsResolutionTally {
  tally[matchType] += 1
  return tally
}

/**
 * Attributed share of a run, 0–1. `null` when nothing was processed — a rate over zero items is
 * not 100%, and reporting it as such is how a dead ingestion run reads as healthy.
 */
export function attributionRate(tally: NewsResolutionTally): number | null {
  const total =
    tally.exact + tally.normalized + tally.team_disambiguated + tally.ambiguous + tally.unresolved
  if (total === 0) return null
  return (tally.exact + tally.normalized + tally.team_disambiguated) / total
}
