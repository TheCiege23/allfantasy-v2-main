/**
 * Format model registry. PURE.
 *
 * ── 🛑 AN UNKNOWN FORMAT RETURNS NULL, NOT A DEFAULT MODEL ──────────────────────────────────
 * A "generic" fallback would apply somebody's guess about guillotine to a pirate league and
 * produce a number nobody chose. Null means "no format opinion". The shared engine still prices
 * the asset from `LeagueShape`, scoring settings and the market, which is a real answer; what it
 * does not do is invent a format-specific adjustment for a format nobody has modelled.
 *
 * ── ⚠ THIS FILE PREVIOUSLY CARRIED A FALSE CLAIM, AND THE CORRECTION IS THE POINT ───────────
 * It said "fifteen of the sixteen formats this codebase implements have no model yet", off a list
 * of sixteen ids produced by COUNTING STRING OCCURRENCES. A census on 2026-09-02 found that list
 * wrong three separate ways, and each error is instructive:
 *
 *   1. THREE OF THE SIXTEEN ARE NOT FORMATS. `idol` is a Survivor mechanic (idols are tradeable
 *      and expire at the merge), `exile` is a Survivor sub-mechanic, and `lottery` is the draft
 *      lottery in `lib/draft-lottery/`. Counting occurrences of a word finds mechanics, features
 *      and comments; it does not find formats.
 *   2. IT MISSED `c2c` ENTIRELY, which IS a first-class format id.
 *   3. `pirate` AND `king_of_the_hill` ARE NOT `leagueType` VALUES AT ALL — see below.
 *
 * The honest statement is narrower and more useful: these formats are not unmodelled, they lack a
 * *value* model. `lib/trade-intel/` already carries per-format logic for pirate, zombie, king of
 * the hill, survivor, tournament, guillotine, salary cap and devy/c2c — reached through
 * `tradeContextNotes.ts` from `/api/trade-value/analyze`. What that layer produces is prose and
 * risk description; none of it reaches `normalizedPlayerValue`. THAT is the gap this registry
 * fills, and saying "unmodelled" hid a subsystem that already exists.
 *
 * ── 🛑 WHY RESOLUTION DOES NOT KEY OFF `leagueType` ─────────────────────────────────────────
 * `lib/league-creation/canonical/normalizeConcept.ts` FLATTENS four product concepts onto base
 * formats and keeps the original only as an alias tag:
 *
 *     pirate_vampire → dynasty        king_of_the_hill → redraft
 *     royal          → dynasty        idp              → redraft
 *
 * So a pirate league's `leagueType` is the literal string `dynasty`. A registry keyed on
 * `leagueType` can never resolve a pirate model no matter how well written — it would be dead
 * code from the day it landed. `lib/trade-intel/leagueFormatRules.ts` already solved this by
 * reading `aliasTags` first, and reusing it is mandatory rather than optional: two
 * implementations of "what format is this league" is the defect, not the fix.
 */

import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'
import type { FormatValueModel } from './types'
import { fourHorsemenModel } from './fourHorsemen'
import { guillotineModel } from './guillotine'
import { tournamentModel } from './tournament'
import { keeperModel } from './keeper'
import { zombieModel } from './zombie'

/**
 * The canonical format ids, copied from the `LeagueFormatId` union in
 * `lib/league/format-engine.ts` — the definition site, not a count of mentions.
 *
 * ⚠ Kept as a literal rather than imported so this list cannot silently follow a change to that
 * union without someone reading this comment.
 *
 * ⚠ NOTHING ENFORCES THE COPY, and that is a real gap rather than a design choice — if someone
 * adds a thirteenth format id to `LeagueFormatId`, this list goes quietly stale and
 * `formatIdsWithoutValueModel()` under-reports by one. The test asserts the exact twelve, so it
 * fails loudly the moment the two disagree; that is a tripwire, not a guarantee.
 */
export const CANONICAL_FORMAT_IDS = [
  'redraft', 'dynasty', 'keeper', 'best_ball', 'guillotine', 'survivor',
  'tournament', 'devy', 'c2c', 'zombie', 'salary_cap', 'big_brother',
] as const

/**
 * Concepts that exist only as ALIAS TAGS, never as a `leagueType`.
 *
 * Each is flattened onto a base format by `normalizeConcept.ts`, so the alias is the only place
 * the league's real identity survives. `four_horsemen` is deliberately absent: it is a specific
 * league, not a product concept, and it reaches us as a `leagueType` unchanged.
 */
export const ALIAS_ONLY_FORMAT_IDS = [
  'pirate_vampire', 'royal', 'king_of_the_hill', 'idp',
] as const

/** Every id a league can present, by either route. */
export const KNOWN_FORMAT_IDS = [
  ...CANONICAL_FORMAT_IDS,
  ...ALIAS_ONLY_FORMAT_IDS,
] as const

const MODELS: readonly FormatValueModel[] = [
  fourHorsemenModel,
  guillotineModel,
  tournamentModel,
  keeperModel,
  zombieModel,
]

const BY_ID = new Map<string, FormatValueModel>(MODELS.map((m) => [m.formatId, m]))

/** Normalise a format id: case-insensitive, hyphens and spaces to underscores. */
function normalise(id: string | null | undefined): string {
  return String(id ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/**
 * The model for a literal format id, or null when none exists.
 *
 * ⚠ THIS IS THE NARROW LOOKUP AND IS USUALLY THE WRONG ONE TO CALL. It matches the string you
 * hand it and nothing else, so passing a pirate league's `leagueType` ("dynasty") finds a dynasty
 * model rather than a pirate one. Prefer `formatModelForLeague`, which resolves the alias first.
 * This stays exported because a caller that genuinely holds a specific id — a test fixture, or a
 * league whose format is stated directly — should not have to build a league descriptor.
 */
export function formatModelFor(formatId: string | null | undefined): FormatValueModel | null {
  const id = normalise(formatId)
  if (!id) return null
  return BY_ID.get(id) ?? null
}

/** What a league looks like to the resolver. A superset of `readFormatRules`' input. */
export interface FormatLeagueDescriptor {
  leagueType?: string | null
  aliasTags?: string[] | null
  isDynasty?: boolean | null
  keeperCount?: number | null
}

/**
 * The model for a league, resolving the alias flattening described at the top of this file.
 *
 * Candidates are tried MOST SPECIFIC FIRST, and the order is load-bearing:
 *
 *   1. `aliasTags[0]` — a pirate league says `dynasty` in `leagueType` and `pirate_vampire` here.
 *      The alias is what the normaliser preserved precisely because it is the more specific fact.
 *   2. `leagueType` — the ordinary route, and the only one a league like Four Horsemen has.
 *   3. `readFormatRules(...).concept` — the existing authority. It folds `keeperCount > 0` on a
 *      redraft league into `keeper`, and `isDynasty` with no type into `dynasty`, which is real
 *      format knowledge this registry must not re-derive.
 *
 * ⚠ Step 3 can only ever BROADEN the match, never contradict steps 1–2: it runs only when neither
 * literal id resolved, so a specific model always wins over the concept it was flattened onto.
 */
export function formatModelForLeague(
  league: FormatLeagueDescriptor | null | undefined,
): FormatValueModel | null {
  if (!league) return null

  const aliases = (league.aliasTags ?? []).map(normalise).filter(Boolean)
  for (const alias of aliases) {
    const hit = BY_ID.get(alias)
    if (hit) return hit
  }

  const direct = formatModelFor(league.leagueType)
  if (direct) return direct

  /*
   * Guarded: `readFormatRules` is pure and total today, but it is another module's code and a
   * throw from it must not take down a valuation. Null here means "no format opinion", which is
   * the same answer an unmodelled format gives — never an error the caller has to handle.
   */
  try {
    return BY_ID.get(readFormatRules(league).concept) ?? null
  } catch {
    return null
  }
}

/** Which formats have a value model. Surfaces coverage rather than implying it. */
export function modelledFormatIds(): string[] {
  return [...BY_ID.keys()].sort()
}

/**
 * Canonical formats with no VALUE model yet.
 *
 * ⚠ Read the name precisely. These are not unmodelled leagues — most have context and risk logic
 * in `lib/trade-intel/`. What they lack is a model that can move a number, which is what this
 * registry is for. See the header.
 */
export function formatIdsWithoutValueModel(): string[] {
  return KNOWN_FORMAT_IDS.filter((id) => !BY_ID.has(id)).slice().sort()
}
