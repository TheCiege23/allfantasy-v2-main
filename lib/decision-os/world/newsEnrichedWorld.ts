/**
 * Decision OS — Phase 2 Canonical Enrichment: F2.7 News Signals derived VIEW.
 *
 * Additive, read-only view layering on F2.1 EnrichedCanonicalWorld. Exposes deterministic
 * player-news signals (from already-persisted `PlayerNewsRecord` rows only) with age-based
 * freshness, category classification, impact tier, and honest degradation via null + uncertainty[].
 *
 * Architecture Freeze invariants (must hold forever):
 * - Pure `CanonicalWorld` is NOT mutated. All news data lives on this derived view only.
 * - Origin (provider / native) is NEVER used as a decision input. Provenance only.
 * - No live API calls, no cache warming, no writes. Port reads only already-persisted rows.
 * - Join is exact case-insensitive playerName match (see ADR_F2_7 §3) — deterministic.
 * - AI-generated summaries are NOT used (P3). Only stored `PlayerNewsRecord` rows.
 * - All fields degrade to null + uncertainty[] when data is unavailable (P2 — never fabricate).
 * - `resolveNewsEnrichedCanonicalWorld` NEVER throws; errors surface as uncertainty entries.
 * - News is player-level; no team-level aggregation needed (unlike F2.6 weather).
 *
 * See ADR_F2_7_NEWS_SIGNALS.md for source audit, join strategy, freshness model, and
 * real-data coverage results.
 */

import type { EnrichedCanonicalWorld, EnrichedPlayer } from './enrichedWorld'
import { resolveEnrichedCanonicalWorld } from './enrichedWorld'
import type { RawNewsRow } from './facts'
import { loadNewsRows } from './port'
import { classifyPlayerNewsCategory } from '@/lib/news/player-news-category'

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

/** Re-export for consumers — same union type as lib/news/player-news-category.ts. */
export type NewsSignalCategory =
  | 'injury'
  | 'suspension'
  | 'trade'
  | 'signing'
  | 'release'
  | 'roster_move'
  | 'team_news'
  | 'player_news'
  | 'game_update'
  | 'coaching'

/** Age-tier for news freshness (no expiresAt available — see ADR §4). */
export type NewsAgeTier = 'fresh' | 'recent' | 'stale'

export interface NewsSignalFreshness {
  publishedAt: Date | null
  ageTier: NewsAgeTier | null
  /** True when publishedAt ≤ (now − 7 days). */
  isStale: boolean | null
  staleReason: string | null
}

export interface NewsSignalContext {
  headline: string | null
  body: string | null
  category: NewsSignalCategory | null
  /** Heuristic impact tier from the importer: 'high' | 'medium' | 'low'. Carried as-is. */
  impact: string | null
  fantasyRelevant: boolean | null
  /** Import source label (e.g. 'rolling_insights', 'clearsports'). Provenance only. */
  source: string | null
  freshness: NewsSignalFreshness
  uncertainty: string[]
}

export interface NewsEnrichedPlayer extends EnrichedPlayer {
  newsContext: NewsSignalContext
}

export interface NewsEnrichedRosterFacts {
  rosterId: string
  teamId: string
  players: NewsEnrichedPlayer[]
}

export interface NewsEnrichmentSummary {
  totalPlayers: number
  withNews: number
  fantasyRelevantCount: number
  staleCount: number
  missingCount: number
}

export interface NewsEnrichedCanonicalWorld extends EnrichedCanonicalWorld {
  rosters: NewsEnrichedRosterFacts[]
  newsSummary: NewsEnrichmentSummary
}

/** Result type for the resolver (so callers never need to catch). */
export interface NewsContextResult {
  /** Keyed by lowercased playerName — matches how the projector looks up by player.name. */
  rowsByName: Map<string, RawNewsRow[]>
  error: string | null
}

export interface NewsPort {
  loadNewsRows(sport: string, playerNames: string[], since: Date): Promise<RawNewsRow[]>
}

export interface NewsEnrichedWorldDeps {
  news?: NewsPort
  now?: Date
  /** Look-back window for news. Default: 14 days. */
  lookbackDays?: number
}

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

const FRESH_HOURS = 24
const STALE_DAYS = 7
const DEFAULT_LOOKBACK_DAYS = 14

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Derive age tier from publishedAt. Pure, never throws.
 * fresh  = within 24h
 * recent = within 7 days (but > 24h)
 * stale  = older than 7 days
 */
export function deriveNewsAgeTier(publishedAt: Date, now: Date): NewsAgeTier {
  const ageMs = now.getTime() - publishedAt.getTime()
  const ageHours = ageMs / (1000 * 60 * 60)
  if (ageHours <= FRESH_HOURS) return 'fresh'
  if (ageHours <= STALE_DAYS * 24) return 'recent'
  return 'stale'
}

/** Compute freshness from a news row's publishedAt. Pure, never throws. */
export function projectNewsFreshness(row: RawNewsRow | null, now: Date): NewsSignalFreshness {
  if (!row) {
    return { publishedAt: null, ageTier: null, isStale: null, staleReason: 'news_freshness_unavailable' }
  }
  const ageTier = deriveNewsAgeTier(row.publishedAt, now)
  const isStale = ageTier === 'stale'
  return {
    publishedAt: row.publishedAt,
    ageTier,
    isStale,
    staleReason: isStale ? 'news_stale_7d' : null,
  }
}

/**
 * Select best row from candidates for one player. Pure.
 * Priority: fantasyRelevant rows first, then most recent.
 */
export function selectBestNewsRow(rows: RawNewsRow[]): RawNewsRow | null {
  if (rows.length === 0) return null
  // Prefer fantasy-relevant; port already orders by publishedAt desc so first match is freshest
  const relevant = rows.filter((r) => r.fantasyRelevant)
  return relevant[0] ?? rows[0] ?? null
}

/** Classify news category deterministically from headline + body. Wraps existing pure util. */
export function classifyNewsCategory(row: RawNewsRow): NewsSignalCategory {
  return classifyPlayerNewsCategory(row.headline, row.body) as NewsSignalCategory
}

/**
 * Build a NewsSignalContext for one player from their rows. Pure, never throws.
 * `playerName` is the resolved player name from F2.1 (used only for uncertainty messaging).
 */
export function projectNewsContext(rows: RawNewsRow[], now: Date): NewsSignalContext {
  const uncertainty: string[] = []

  if (rows.length === 0) {
    return {
      headline: null,
      body: null,
      category: null,
      impact: null,
      fantasyRelevant: null,
      source: null,
      freshness: projectNewsFreshness(null, now),
      uncertainty: ['news_unavailable'],
    }
  }

  const row = selectBestNewsRow(rows)
  if (!row) {
    return {
      headline: null,
      body: null,
      category: null,
      impact: null,
      fantasyRelevant: null,
      source: null,
      freshness: projectNewsFreshness(null, now),
      uncertainty: ['news_unavailable'],
    }
  }

  const freshness = projectNewsFreshness(row, now)
  if (freshness.isStale === true) uncertainty.push('news_stale')

  return {
    headline: row.headline,
    body: row.body,
    category: classifyNewsCategory(row),
    impact: row.impact,
    fantasyRelevant: row.fantasyRelevant,
    source: row.source,
    freshness,
    uncertainty,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Pure projector
// ──────────────────────────────────────────────────────────────────────────

/**
 * Fold news context onto an EnrichedCanonicalWorld. Pure — never mutates base world,
 * never reads from DB. Lookup key = player.name lowercased (exact case-insensitive match).
 */
export function projectNewsEnrichedWorld(
  world: EnrichedCanonicalWorld,
  contextResult: NewsContextResult,
  now: Date,
): NewsEnrichedCanonicalWorld {
  const { rowsByName } = contextResult

  let totalPlayers = 0
  let withNews = 0
  let fantasyRelevantCount = 0
  let staleCount = 0
  let missingCount = 0

  const rosters: NewsEnrichedRosterFacts[] = world.rosters.map((roster) => ({
    rosterId: roster.rosterId,
    teamId: roster.teamId,
    players: roster.players.map((player) => {
      totalPlayers++
      const nameKey = player.name?.toLowerCase() ?? ''
      const rows = nameKey ? (rowsByName.get(nameKey) ?? []) : []

      // Players with no resolved name have no possible match
      if (!player.name) {
        const ctx: NewsSignalContext = {
          headline: null, body: null, category: null, impact: null,
          fantasyRelevant: null, source: null,
          freshness: { publishedAt: null, ageTier: null, isStale: null, staleReason: null },
          uncertainty: ['news_name_unmatched'],
        }
        missingCount++
        return { ...player, newsContext: ctx }
      }

      const ctx = projectNewsContext(rows, now)

      if (ctx.headline !== null) {
        withNews++
        if (ctx.fantasyRelevant === true) fantasyRelevantCount++
      } else {
        missingCount++
      }
      if (ctx.freshness.isStale === true) staleCount++

      return { ...player, newsContext: ctx }
    }),
  }))

  return {
    ...world,
    rosters,
    newsSummary: { totalPlayers, withNews, fantasyRelevantCount, staleCount, missingCount },
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Read-only resolver
// ──────────────────────────────────────────────────────────────────────────

export const defaultNewsPort: NewsPort = { loadNewsRows }

/**
 * Load news rows for a set of player names grouped by lowercased name.
 * NEVER throws — errors surface as contextResult.error + empty map.
 */
export async function resolveNewsContext(
  sport: string,
  playerNames: string[],
  lookbackDays: number,
  port?: NewsPort,
): Promise<NewsContextResult> {
  if (playerNames.length === 0) {
    return { rowsByName: new Map(), error: null }
  }
  const p = port ?? defaultNewsPort
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
  try {
    const rows = await p.loadNewsRows(sport, playerNames, since)
    // Group by lowercased playerName; port already orders by publishedAt desc
    const rowsByName = new Map<string, RawNewsRow[]>()
    for (const row of rows) {
      const key = row.playerName.toLowerCase()
      const existing = rowsByName.get(key)
      if (existing) existing.push(row)
      else rowsByName.set(key, [row])
    }
    return { rowsByName, error: null }
  } catch (err) {
    return {
      rowsByName: new Map(),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Top-level orchestrator: chains F2.1 enrichment → resolves news context → projects.
 * NEVER throws. Returns null when the league does not exist.
 */
export async function resolveNewsEnrichedCanonicalWorld(
  leagueId: string,
  deps?: NewsEnrichedWorldDeps,
): Promise<NewsEnrichedCanonicalWorld | null> {
  const now = deps?.now ?? new Date()
  const lookbackDays = deps?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  const base = await resolveEnrichedCanonicalWorld(leagueId).catch(() => null)
  if (!base) return null

  const sport = base.leagueFacts.sport

  // Collect unique resolved player names from F2.1 metadata
  const playerNames = Array.from(
    new Set(
      base.rosters
        .flatMap((r) => r.players.map((p) => p.name))
        .filter((n): n is string => typeof n === 'string' && n.length > 0),
    ),
  )

  const contextResult = await resolveNewsContext(sport, playerNames, lookbackDays, deps?.news)
  return projectNewsEnrichedWorld(base, contextResult, now)
}
