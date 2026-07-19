/**
 * Phase 2 — canonical identity derivation for `Player` / `Team`.
 *
 * `Player.id` is `@id` with **no default**, so every canonical row needs an id supplied by
 * us. That id has to be *deterministic*: the backfill must be re-runnable without creating a
 * second row for the same person, and Phase 3 will hard-depend on ids being stable.
 *
 * ── The matching key (this is the decision the brief asked to be made and documented) ──
 *
 * There is no FK between `SportsPlayer` and `Player`, and `SportsPlayer` is uniquely keyed on
 * `(sport, externalId, source)` — so the *same real player* can legitimately appear as several
 * `SportsPlayer` rows, one per ingesting source. Collapsing those correctly is the whole job.
 *
 *   1. **`sleeperId` when present.** The strongest key available: it is a real cross-source
 *      player identity that different providers' rows agree on, so two `SportsPlayer` rows
 *      carrying the same `sleeperId` are the same human by construction.
 *   2. **`(sport, normalizedName, position)` otherwise.** Name alone is not safe — the NFL has
 *      two Josh Allens (QB/BUF and LB/JAX), and collapsing them would corrupt every downstream
 *      read. Position separates the realistic collisions; `normalizePlayerName` already folds
 *      punctuation and Jr/Sr/III suffixes so "Ja'Marr"/"JaMarr" agree.
 *
 * The id embeds a readable slug plus a short hash of that key: deterministic and unique, while
 * still being greppable in logs and DB dumps (`nfl-jamarr-chase-3f2a1b9c`).
 *
 * Teams do not need this: `Team` has `@@unique([sportKey, leagueKey, normalizedName])` and a
 * cuid default, so they upsert on their natural key.
 */

import { createHash } from 'crypto'
import { normalizePlayerName } from '@/lib/player-assets/resolvePlayerHeadshot'

export interface CanonicalPlayerSeed {
  name: string
  sport: string
  position?: string | null
  sleeperId?: string | null
}

/** How a canonical id was derived — recorded on the row so a re-match can be audited. */
export type CanonicalMatchStrategy = 'sleeper_id' | 'name_sport_position'

export interface CanonicalPlayerIdentity {
  id: string
  matchKey: string
  strategy: CanonicalMatchStrategy
  normalizedName: string
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 8)
}

export function normalizeSport(sport: string | null | undefined): string {
  return String(sport ?? '').trim().toUpperCase()
}

export function normalizePosition(position: string | null | undefined): string {
  return String(position ?? '').trim().toUpperCase()
}

/**
 * Derive the stable canonical identity for a player.
 *
 * Deterministic: the same seed always yields the same id, which is what makes the backfill
 * idempotent and lets a later run pick up new source rows without disturbing existing ones.
 */
export function deriveCanonicalPlayerIdentity(
  seed: CanonicalPlayerSeed,
): CanonicalPlayerIdentity {
  const sport = normalizeSport(seed.sport)
  const normalizedName = normalizePlayerName(seed.name)
  const sleeperId = seed.sleeperId?.trim()

  const strategy: CanonicalMatchStrategy = sleeperId ? 'sleeper_id' : 'name_sport_position'
  const matchKey = sleeperId
    ? `sleeper:${sleeperId}`
    : `${sport}|${normalizedName}|${normalizePosition(seed.position)}`

  const slug = slugify(normalizedName || seed.name || 'unknown')
  const id = `${sport.toLowerCase() || 'unknown'}-${slug}-${shortHash(matchKey)}`

  return { id, matchKey, strategy, normalizedName }
}

export interface CanonicalTeamSeed {
  name: string
  sport: string
  leagueKey?: string | null
}

export interface CanonicalTeamIdentity {
  normalizedName: string
  sportKey: string
  leagueKey: string | null
}

/**
 * Normalize a team onto `Team`'s natural unique key
 * (`uniq_sports_core_team_identity` = sportKey + leagueKey + normalizedName).
 */
export function deriveCanonicalTeamIdentity(seed: CanonicalTeamSeed): CanonicalTeamIdentity {
  return {
    sportKey: normalizeSport(seed.sport),
    leagueKey: seed.leagueKey?.trim() || null,
    normalizedName: String(seed.name ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' '),
  }
}
