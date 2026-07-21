/**
 * E.1.5 — server-side player-headshot resolver.
 *
 * Resolves a real player headshot URL by checking, in order:
 *   - NFL: G49H provider orchestrator (canonical media resolver) first, then falling through
 *     to the shared chain below when it yields no image.
 *   - All sports: TheSportsDB -> api-sports -> local SportsPlayer cache -> Sleeper (NFL only).
 *
 * ClearSports is deliberately not in this chain: it publishes no image product for any sport
 * (see the note at the `csPlayers` declaration below).
 *
 * If none of the above produce a valid HTTP/HTTPS image URL, returns
 * `{ imageUrl: null, source: 'none', confidence: 'none' }` so the UI's
 * silhouette+initials fallback (E.1) keeps applying.
 *
 * MUST be called server-side only — never from the browser. Provider keys
 * are server-only and rate-limited.
 *
 * Two callable shapes:
 *   - `resolvePlayerHeadshot(input)`            — single player (one network call per provider).
 *   - `createBatchPlayerHeadshotResolver()`     — factory for scripts and crons that resolve
 *                                                many players against one shared resolver.
 */

import { prisma } from '@/lib/prisma'
import { theSportsDbProvider } from '@/lib/workers/providers/thesportsdb'
import { apiSportsProvider } from '@/lib/workers/providers/api-sports'
import { sleeperChainProvider } from '@/lib/workers/providers/sleeper-chain'
import { classifyAvatarSource } from '@/lib/draft-room/classify-avatar-source'
import { resolveNflRedraftCanonicalHeadshot } from '@/lib/nfl-provider/nflRedraftProviderCertification'
import {
  PLAYER_IMAGE_TYPE_HEADSHOT,
  readPrimaryPlayerImage,
  writePrimaryPlayerImage,
} from '@/lib/player-assets/playerImageStore'
import { deriveCanonicalPlayerIdentity } from '@/lib/canonical/canonicalIdentity'

export type HeadshotProvider =
  | 'clearsports'
  | 'sportsdb'
  | 'apisports'
  | 'sportsplayer'
  | 'sleeper'
  | 'none'
export type HeadshotConfidence = 'exact' | 'name_team_position' | 'name_only' | 'none'

export interface ResolveHeadshotInput {
  name: string
  sport: string
  team?: string | null
  position?: string | null
  externalIds?: {
    clearSportsId?: string | null
    sleeperId?: string | null
    sportsDbId?: string | null
    rollingInsightsId?: string | null
  }
  /**
   * Phase 1 — player identity used to read/write the `PlayerImage` write-through cache.
   * Omit it and resolution still works exactly as before, just uncached: without an id
   * there is nothing to key a cache row on. See `lib/player-assets/playerImageStore.ts`.
   */
  playerId?: string | null
  /** Optional league scope stored alongside a cached image. */
  leagueKey?: string | null
  /** Force a live provider resolution, ignoring (but still refreshing) the cached row. */
  skipCache?: boolean
}

export interface ResolveHeadshotResult {
  imageUrl: string | null
  source: HeadshotProvider
  confidence: HeadshotConfidence
  /** True when this result was served from `PlayerImage` without any provider call. */
  cacheHit?: boolean
  /** True when a live resolution was persisted back into `PlayerImage`. */
  persisted?: boolean
  /** True when providers failed and a past-TTL cached image was served instead. */
  servedStale?: boolean
}

/**
 * Strip punctuation, lowercase, remove suffixes (Jr/Sr/II/III/IV/V),
 * collapse whitespace. Used for safe name comparisons across providers.
 */
export function normalizePlayerName(name: string | null | undefined): string {
  if (!name) return ''
  let s = String(name).trim().toLowerCase()
  // Strip apostrophes, hyphens, periods entirely.
  s = s.replace(/['‘’`.,]/g, '')
  s = s.replace(/-/g, ' ')
  // Drop common suffixes after the last space.
  s = s.replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
  // Collapse repeated whitespace, trim.
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

function normalizeTeam(team: string | null | undefined): string {
  return String(team ?? '').trim().toUpperCase()
}

/**
 * E.1.6 — generate name-search variants for provider lookups. Different sports
 * APIs index player names differently:
 *   - SportsDB tolerates spaces but not apostrophes/periods.
 *   - TheSportsAPI / api-sports also has its own indexing quirks.
 *
 * To maximize hit rate without spamming requests, we generate up to ~7 unique
 * variants per name and try them in order from "most specific" to "most lenient".
 * Used for both SportsDB and TheSportsAPI tiers in `resolvePlayerHeadshot`.
 *
 * Examples:
 *   Ja'Marr Chase   → ["Ja'Marr Chase", "JaMarr Chase", "Ja Marr Chase", "jamarr chase"]
 *   A.J. Brown      → ["A.J. Brown",   "AJ Brown",     "A J Brown",     "aj brown"]
 *   Amon-Ra St. Brown → ["Amon-Ra St. Brown", "AmonRa St Brown", "Amon Ra St Brown", "amon ra st brown"]
 *   D.K. Metcalf    → ["D.K. Metcalf", "DK Metcalf",   "D K Metcalf",   "dk metcalf"]
 *   Brian Thomas Jr. → original + suffix-stripped + normalized
 */
export function buildNameSearchVariants(rawName: string | null | undefined, normalized: string): string[] {
  const out: string[] = []
  const push = (v: string | null | undefined) => {
    const s = (v ?? '').trim()
    if (s && !out.includes(s)) out.push(s)
  }
  if (!rawName) {
    push(normalized)
    return out
  }
  // 1. Exact original (catches the easy cases first).
  push(rawName)
  // 2. Strip apostrophes/periods/commas/backticks but keep capitalization.
  //    "Ja'Marr Chase" → "JaMarr Chase"; "A.J. Brown" → "AJ Brown"
  push(rawName.replace(/['‘’`.,]/g, '').replace(/\s+/g, ' ').trim())
  // 3. Replace apostrophes/periods with spaces, then collapse — gives "Ja Marr",
  //    "A J", "D K", "Amon Ra" (same as hyphen→space).
  push(
    rawName
      .replace(/['‘’`.]/g, ' ')
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  // 4. Hyphens → spaces only (preserve apostrophes/periods).
  //    "Amon-Ra St. Brown" → "Amon Ra St. Brown"
  push(rawName.replace(/-/g, ' ').replace(/\s+/g, ' ').trim())
  // 5. Drop trailing Jr/Sr/II/III/IV/V after stripping punctuation.
  push(
    rawName
      .replace(/['‘’`.,]/g, '')
      .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
      .trim(),
  )
  // 6. Last resort: the full normalize-pool-name output (lowercase, no punctuation, no suffix).
  push(normalized)
  return out
}

function normalizePosition(pos: string | null | undefined): string {
  return String(pos ?? '').trim().toUpperCase()
}

/**
 * Validate that the URL is a real HTTP(S) image we want to render. Rejects:
 *   - empty / null
 *   - data: URIs (synthesized SVG placeholders — see E.1 audit)
 *   - team-logo paths (`/teamLogos/...`)
 */
export function isValidHeadshotUrl(url: string | null | undefined): boolean {
  if (!url) return false
  const trimmed = String(url).trim()
  if (trimmed.length === 0) return false
  const source = classifyAvatarSource(trimmed)
  return source === 'headshot'
}

interface ClearSportsPlayerLite {
  id?: string
  name?: string
  full_name?: string
  position?: string
  team?: string | { name?: string; abbr?: string }
  team_abbr?: string
  image?: string
  image_url?: string
}

function getClearSportsImage(p: ClearSportsPlayerLite): string | null {
  const url = p.image ?? p.image_url ?? null
  return isValidHeadshotUrl(url) ? url : null
}

function clearSportsTeamCode(p: ClearSportsPlayerLite): string {
  const direct = p.team_abbr ?? null
  if (direct) return normalizeTeam(direct)
  if (typeof p.team === 'object' && p.team) return normalizeTeam(p.team.abbr ?? p.team.name ?? '')
  if (typeof p.team === 'string') return normalizeTeam(p.team)
  return ''
}

function clearSportsName(p: ClearSportsPlayerLite): string {
  return String(p.name ?? p.full_name ?? '').trim()
}

type SportsPlayerHeadshotCacheRow = {
  imageUrl: string | null
  team: string | null
  position: string | null
}

export interface BatchPlayerHeadshotResolver {
  resolve(input: ResolveHeadshotInput): Promise<ResolveHeadshotResult>
  /** Stats about the underlying ClearSports cache — useful for script summaries. */
  stats(): { clearSportsCacheSize: number; sport: string }
}

/**
 * Factory for scripts that resolve many players. Pre-fetches the entire
 * ClearSports player list for the sport ONCE, then matches each player in-memory
 * before falling back to SportsDB (per-player network call) and SportsPlayer.
 */
export async function createBatchPlayerHeadshotResolver(args: {
  sport: string
}): Promise<BatchPlayerHeadshotResolver> {
  const sport = String(args.sport || 'NFL').toUpperCase()
  // ClearSports contributes nothing to headshots for ANY sport, so we no longer call it here.
  //  - NFL was already hardcoded to skip it.
  //  - Non-NFL hit `{domain}/players`, which does not exist: ClearSports only publishes
  //    `/api/v1/nfl/{player,team,injury}-stats`, `teams/:id` and `games` — no image product.
  // Measured during Phase 2 verification: three 500s per player (~120ms wasted) on every
  // soccer resolution before this change. The tiers below are left in place but now read from
  // an empty map, so they fall through for free. See providerFallbackPolicy.ts for the
  // matching removal from the declarative player_images / team_logos chains.
  const csPlayers: ClearSportsPlayerLite[] = []

  // Build name → players index. Ambiguous names (multiple players with same normalized name)
  // are kept as a list; the caller resolves with team/position.
  const csByName = new Map<string, ClearSportsPlayerLite[]>()
  for (const p of csPlayers) {
    const nk = normalizePlayerName(clearSportsName(p))
    if (!nk) continue
    const list = csByName.get(nk) ?? []
    list.push(p)
    csByName.set(nk, list)
  }

  return {
    stats: () => ({ clearSportsCacheSize: csPlayers.length, sport }),
    async resolve(input: ResolveHeadshotInput): Promise<ResolveHeadshotResult> {
      return resolveOnce(input, sport, csByName)
    },
  }
}

/** Single-player resolution. Spawns its own ClearSports call (use the batch resolver for scripts). */
export async function resolvePlayerHeadshot(
  input: ResolveHeadshotInput,
): Promise<ResolveHeadshotResult> {
  const sport = String(input.sport || 'NFL').toUpperCase()
  // ClearSports contributes nothing to headshots for ANY sport, so we no longer call it here.
  //  - NFL was already hardcoded to skip it.
  //  - Non-NFL hit `{domain}/players`, which does not exist: ClearSports only publishes
  //    `/api/v1/nfl/{player,team,injury}-stats`, `teams/:id` and `games` — no image product.
  // Measured during Phase 2 verification: three 500s per player (~120ms wasted) on every
  // soccer resolution before this change. The tiers below are left in place but now read from
  // an empty map, so they fall through for free. See providerFallbackPolicy.ts for the
  // matching removal from the declarative player_images / team_logos chains.
  const csPlayers: ClearSportsPlayerLite[] = []
  const csByName = new Map<string, ClearSportsPlayerLite[]>()
  for (const p of csPlayers) {
    const nk = normalizePlayerName(clearSportsName(p))
    if (!nk) continue
    const list = csByName.get(nk) ?? []
    list.push(p)
    csByName.set(nk, list)
  }
  return resolveOnce(input, sport, csByName)
}

/**
 * Map the resolver's categorical confidence onto the numeric `PlayerImage.confidence`
 * column, so cached rows stay comparable with rows written by other producers.
 */
function confidenceToScore(confidence: HeadshotConfidence): number | null {
  switch (confidence) {
    case 'exact':
      return 1
    case 'name_team_position':
      return 0.8
    case 'name_only':
      return 0.5
    default:
      return null
  }
}

/**
 * Phase 1 write-through wrapper around the provider chain.
 *
 * Order of operations:
 *   1. Fresh row in `PlayerImage`      → return it, zero provider calls.
 *   2. Otherwise run the provider chain (`resolveFromProviders`, unchanged behaviour).
 *   3. Success                          → persist as the player's primary image.
 *   4. Failure but a stale row exists   → serve the stale URL rather than nothing.
 *
 * Every cache interaction is best-effort: `playerImageStore` swallows its own errors, so a
 * DB outage degrades this back to the exact pre-Phase-1 live-resolution behaviour.
 */
async function resolveOnce(
  input: ResolveHeadshotInput,
  sport: string,
  csByName: Map<string, ClearSportsPlayerLite[]>,
): Promise<ResolveHeadshotResult> {
  // Phase 2 cache key. The live callers (Roster/Waivers/Trades/Matchups via
  // components/league/PlayerHeadshot.tsx) send name/team/position and sometimes a *Sleeper* id,
  // but never a canonical `Player.id` — so before this the cache read below was always skipped
  // and every headshot hit the provider chain. The backfilled `PlayerImage` rows are keyed by
  // canonical `Player.id` (e.g. `nfl-aj-terrell-016b78ba`), which is the SAME deterministic id
  // `deriveCanonicalPlayerIdentity` produces from (name, sport, position, team). Deriving it
  // here — rather than threading an id client-side — is what actually reaches those rows,
  // including the ~88% keyed by `rolling_insights` with no Sleeper id at all.
  const playerId =
    input.playerId?.trim() ||
    (input.name?.trim()
      ? deriveCanonicalPlayerIdentity({
          name: input.name,
          sport,
          position: input.position,
          team: input.team,
          sleeperId: input.externalIds?.sleeperId ?? null,
        }).id
      : null)

  const cached = playerId
    ? await readPrimaryPlayerImage({ playerId, imageType: PLAYER_IMAGE_TYPE_HEADSHOT })
    : null

  // 1. Fresh cache hit — the whole point of Phase 1. No provider call is made.
  if (cached && !cached.stale && !input.skipCache && isValidHeadshotUrl(cached.url)) {
    return {
      imageUrl: cached.url,
      source: (cached.provider as HeadshotProvider | null) ?? 'none',
      confidence: 'exact',
      cacheHit: true,
    }
  }

  // 2. Live resolution through the untouched provider chain.
  const resolved = await resolveFromProviders(input, sport, csByName)

  // 3. Persist a successful resolution so the next lookup takes branch 1.
  if (playerId && resolved.imageUrl) {
    const write = await writePrimaryPlayerImage({
      playerId,
      sportKey: sport,
      leagueKey: input.leagueKey ?? null,
      imageType: PLAYER_IMAGE_TYPE_HEADSHOT,
      url: resolved.imageUrl,
      provider: resolved.source,
      confidence: confidenceToScore(resolved.confidence),
    })
    return { ...resolved, cacheHit: false, persisted: write.written }
  }

  // 4. Providers came back empty but we have a past-TTL image — an old headshot beats none.
  if (!resolved.imageUrl && cached && isValidHeadshotUrl(cached.url)) {
    return {
      imageUrl: cached.url,
      source: (cached.provider as HeadshotProvider | null) ?? 'none',
      confidence: 'name_only',
      cacheHit: true,
      servedStale: true,
    }
  }

  return { ...resolved, cacheHit: false }
}

async function resolveFromProviders(
  input: ResolveHeadshotInput,
  sport: string,
  csByName: Map<string, ClearSportsPlayerLite[]>,
): Promise<ResolveHeadshotResult> {
  const targetName = normalizePlayerName(input.name)
  const targetTeam = normalizeTeam(input.team ?? '')
  const targetPos = normalizePosition(input.position ?? '')
  const isNfl = String(sport).trim().toUpperCase() === 'NFL'

  // ── 0. NFL canonical provider (highest priority for NFL) ──
  // Only *returns* on a hit. It previously returned unconditionally, which made tiers 2–6
  // below unreachable for NFL: when the orchestrator fell back to `default_avatar` it
  // handed back `headshotUrl: null` and the resolver reported "no headshot" for players
  // whose image TheSportsDB serves on request. Falling through preserves the intended
  // dedicated-provider-first ordering while restoring the documented fallback chain.
  if (isNfl) {
    try {
      const canonical = await resolveNflRedraftCanonicalHeadshot({
        name: input.name,
        team: input.team,
        position: input.position,
        allFantasyPlayerId:
          input.externalIds?.rollingInsightsId ??
          input.externalIds?.sleeperId ??
          input.externalIds?.sportsDbId ??
          input.externalIds?.clearSportsId ??
          null,
      })
      const canonicalUrl = canonical.imageUrl
      if (canonicalUrl && isValidHeadshotUrl(canonicalUrl)) {
        return {
          imageUrl: canonicalUrl,
          source: canonical.source,
          confidence: canonical.confidence,
        }
      }
    } catch {
      /* swallow — continue down the fallback chain */
    }
  }

  // ── 1. ClearSports (non-NFL primary) ──
  if (!isNfl && targetName.length > 0) {
    const candidates = csByName.get(targetName) ?? []
    if (candidates.length === 1) {
      const url = getClearSportsImage(candidates[0]!)
      if (url) {
        return {
          imageUrl: url,
          source: 'clearsports',
          confidence: targetTeam || targetPos ? 'exact' : 'name_only',
        }
      }
    } else if (candidates.length > 1) {
      // Disambiguate by team + position when available.
      const exact = candidates.find(
        (c) =>
          (targetTeam && clearSportsTeamCode(c) === targetTeam) ||
          (targetPos && normalizePosition(c.position ?? '') === targetPos),
      )
      if (exact) {
        const url = getClearSportsImage(exact)
        if (url) {
          return {
            imageUrl: url,
            source: 'clearsports',
            confidence: 'name_team_position',
          }
        }
      }
      // Multiple matches and we can't disambiguate safely — refuse to pick.
    }
  }

  // ── 2. SportsDB ──
  // Per-player headshot search. The provider's name index is unforgiving with
  // apostrophes / periods / hyphens, so we try several variants before giving up.
  const nameCandidates = buildNameSearchVariants(input.name, targetName)
  for (const candidate of nameCandidates) {
    try {
      const result = await theSportsDbProvider.fetch({
        sport,
        dataType: 'player_headshots',
        query: { search: candidate, teamCode: input.team ?? undefined },
      })
      const sdbUrl =
        result && typeof result === 'object' && 'headshotUrl' in (result as Record<string, unknown>)
          ? String((result as { headshotUrl?: unknown }).headshotUrl ?? '')
          : ''
      if (isValidHeadshotUrl(sdbUrl)) {
        return {
          imageUrl: sdbUrl,
          source: 'sportsdb',
          confidence: targetTeam ? 'name_team_position' : 'name_only',
        }
      }
    } catch {
      /* swallow — try next variant */
    }
  }

  // ── 3. TheSportsAPI (api-sports) ──
  for (const candidate of nameCandidates) {
    try {
      const result = await apiSportsProvider.fetch({
        sport,
        dataType: 'player_headshots',
        query: { search: candidate, teamCode: input.team ?? undefined },
      })
      const apiUrl =
        result && typeof result === 'object' && 'headshotUrl' in (result as Record<string, unknown>)
          ? String((result as { headshotUrl?: unknown }).headshotUrl ?? '')
          : ''
      if (isValidHeadshotUrl(apiUrl)) {
        return {
          imageUrl: apiUrl,
          source: 'apisports',
          confidence: targetTeam ? 'name_team_position' : 'name_only',
        }
      }
    } catch {
      /* swallow — provider may be down or unconfigured */
    }
  }

  // ── 4. SportsPlayer DB cache ──
  try {
    const dbRows: SportsPlayerHeadshotCacheRow[] = await prisma.sportsPlayer.findMany({
      where: {
        sport,
        name: { equals: input.name, mode: 'insensitive' },
      },
      select: { imageUrl: true, team: true, position: true },
      take: 5,
    })
    const exact = dbRows.find((row) => {
      const sameTeam = !targetTeam || normalizeTeam(row.team) === targetTeam
      const samePos = !targetPos || normalizePosition(row.position) === targetPos
      return sameTeam || samePos
    }) ?? dbRows[0]

    if (exact?.imageUrl && isValidHeadshotUrl(exact.imageUrl)) {
      return {
        imageUrl: exact.imageUrl,
        source: 'sportsplayer',
        confidence: targetTeam || targetPos ? 'exact' : 'name_only',
      }
    }
  } catch {
    /* swallow — db cache may be unavailable */
  }

  // ── 5. ClearSports (NFL secondary, non-NFL primary) ──
  if (isNfl && targetName.length > 0) {
    const candidates = csByName.get(targetName) ?? []
    if (candidates.length === 1) {
      const url = getClearSportsImage(candidates[0]!)
      if (url) {
        return {
          imageUrl: url,
          source: 'clearsports',
          confidence: targetTeam || targetPos ? 'exact' : 'name_only',
        }
      }
    } else if (candidates.length > 1) {
      const exact = candidates.find(
        (c) =>
          (targetTeam && clearSportsTeamCode(c) === targetTeam) ||
          (targetPos && normalizePosition(c.position ?? '') === targetPos),
      )
      if (exact) {
        const url = getClearSportsImage(exact)
        if (url) {
          return {
            imageUrl: url,
            source: 'clearsports',
            confidence: 'name_team_position',
          }
        }
      }
    }
  }

  // ── 6. Sleeper (NFL tertiary) ──
  if (isNfl) {
    for (const candidate of nameCandidates) {
      try {
        const result = await sleeperChainProvider.fetch({
          sport,
          dataType: 'player_headshots',
          query: { search: candidate, teamCode: input.team ?? undefined },
        })
        const sleeperUrl =
          result && typeof result === 'object' && 'headshotUrl' in (result as Record<string, unknown>)
            ? String((result as { headshotUrl?: unknown }).headshotUrl ?? '')
            : ''
        if (isValidHeadshotUrl(sleeperUrl)) {
          return {
            imageUrl: sleeperUrl,
            source: 'sleeper',
            confidence: targetTeam ? 'name_team_position' : 'name_only',
          }
        }
      } catch {
        /* swallow — continue fallback chain */
      }
    }
  }

  return { imageUrl: null, source: 'none', confidence: 'none' }
}
