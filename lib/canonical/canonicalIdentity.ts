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
 *   2. **`(sport, normalizedName, position, team)` otherwise.** Name alone is not safe — the
 *      NFL has two Josh Allens (QB/BUF and LB/JAX) — and name+position alone is not safe
 *      either, which only became visible at production scale (see below).
 *      `normalizePlayerName` already folds punctuation and Jr/Sr/III suffixes so
 *      "Ja'Marr"/"Ja’Marr" agree.
 *
 * ── Why `team` is in the fallback key (measured, not assumed) ──
 *
 * Against the real 95,839-row `SportsPlayer` table, `sleeperId` covers **NFL only** (87.2%);
 * every other sport is 0%. So 84% of production resolves through the fallback key, not 16% as
 * a small NFL-shaped sample suggests.
 *
 * With `(sport, name, position)` alone, 5,826 groups contained rows from the *same* ingesting
 * source — a source does not list one person twice, so those were distinct humans about to be
 * fused: five different NCAAB guards named "Jordan Williams" (Arizona State, Rice, St. Francis
 * Brooklyn, Texas A&M, Vanderbilt) collapsing into one canonical player. 6,439 rows were at
 * risk. Adding `team` cuts that to 137 (0.14%), and the residual is genuinely ambiguous
 * same-name/same-team/same-position rows, mostly NCAAB.
 *
 * Keying on `team` risks *under*-merging a traded player into two canonical rows — but that
 * only applies to rows without a `sleeperId`, and the sports that rely on this key are
 * single-source college/international rosters, while NFL (6 sources, real trades) is 87.2%
 * covered by `sleeperId` and unaffected. Under-merging is also the safe direction: a duplicate
 * canonical row is cosmetic, whereas fusing two people corrupts their images, stats and
 * identity irreversibly.
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
  team?: string | null
  sleeperId?: string | null
}

/** How a canonical id was derived — recorded on the row so a re-match can be audited. */
export type CanonicalMatchStrategy = 'sleeper_id' | 'name_sport_position_team'

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

/**
 * Long-form position names → the short codes the app renders and matches on.
 *
 * Only NFL is affected, because it is the only sport ingesting from more than one source:
 * Sleeper emits `WR`, while the other five emit `Wide Receiver`. 1,076 of 14,117 canonical NFL
 * players (7.6%) carried a long form. That breaks two things at once — migrated call sites
 * render "Wide Receiver" where they used to render "WR", and because `position` is part of the
 * fallback matching key, the same player from two sources derives two different canonical ids
 * and never collapses.
 *
 * Derived from the actual distinct values in production, not guessed.
 */
const LONG_FORM_POSITIONS: Record<string, string> = {
  'OFFENSIVE TACKLE': 'OT', 'RIGHT TACKLE': 'OT', 'GUARD': 'G', 'OFFENSIVE GUARD': 'G',
  'CENTER': 'C', 'OFFENSIVE LINEMAN': 'OL', 'WIDE RECEIVER': 'WR', 'RUNNING BACK': 'RB',
  'FULLBACK': 'FB', 'FULL-BACK': 'FB', 'TIGHT END': 'TE', 'QUARTERBACK': 'QB',
  'LINEBACKER': 'LB', 'OUTSIDE LINEBACKER': 'OLB', 'INSIDE LINEBACKER': 'ILB',
  'MIDDLE LINEBACKER': 'MLB', 'CORNERBACK': 'CB', 'SAFETY': 'S', 'DEFENSIVE BACK': 'DB',
  'DEFENSIVE TACKLE': 'DT', 'DEFENSIVE END': 'DE', 'DEFENSIVE LINEMAN': 'DL',
  'NOSE TACKLE': 'NT', 'PUNTER': 'P', 'KICKER': 'K', 'LONG SNAPPER': 'LS',
}

/**
 * Non-player roles that leak into `SportsPlayer` from upstream feeds. Kept verbatim rather
 * than mapped — they should be filtered at ingestion, not silently relabelled as positions.
 * Flagged for the ingestion owners; deliberately NOT "fixed" here.
 */
export const NON_PLAYER_POSITIONS = new Set(['ASSISTANT COACH', 'MANAGER', 'CO-DRIVER'])

export function normalizePosition(position: string | null | undefined): string {
  const raw = String(position ?? '').trim().toUpperCase()
  return LONG_FORM_POSITIONS[raw] ?? raw
}

/** Team codes and full school names both appear as `SportsPlayer.team`; compare case-folded. */
export function normalizeTeam(team: string | null | undefined): string {
  return String(team ?? '').trim().toUpperCase()
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

  const strategy: CanonicalMatchStrategy = sleeperId ? 'sleeper_id' : 'name_sport_position_team'
  const matchKey = sleeperId
    ? `sleeper:${sleeperId}`
    : `${sport}|${normalizedName}|${normalizePosition(seed.position)}|${normalizeTeam(seed.team)}`

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
