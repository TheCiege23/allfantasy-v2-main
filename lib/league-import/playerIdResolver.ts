/**
 * Resolve external source player ids (Sleeper, ESPN, Yahoo, MFL, Fantrax,
 * Fleaflicker) to AF's canonical PlayerIdentityMap rows.
 *
 * Strategy:
 *   1. Direct lookup by the provider-specific id column on PlayerIdentityMap.
 *   2. Fallback to normalized-name match when the provider column is unset.
 *   3. Record a warning when no match (caller decides whether to surface).
 *
 * ⚠ THIS MODULE HAS NO PRODUCTION CALLERS. It previously claimed here that it was
 * "used by scoring lookups to match imported roster entries against weekly stats";
 * that was not true and is corrected rather than deleted so the next reader does
 * not re-derive it. Censused 2026-08-28 across all four import forms (`@/lib/…`,
 * relative, `require(`, dynamic `import(`) plus re-export facades: the only
 * importer is `lib/shared-services/identity/PlayerIdentityService.ts`, which is
 * itself imported by nothing but its own test. Prefer
 * `lib/shared-services/player-identity/PlayerIdentityResolver.ts`, which is live,
 * disambiguates multiple candidates, and reports tie counts.
 *
 * ⚠ The name fallback below does NOT filter by sport, and 3,091 normalized names
 * / 7,347 rows exist in more than one sport. Anything wiring this up must pass a
 * sport through first.
 */

import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/team-abbrev'
import type { ImportProvider } from './types'

export interface PlayerIdResolveResult {
  canonicalId: string | null
  /**
   * ⚠ `ambiguous` IS NOT A KIND OF `miss`, AND SEPARATING THEM IS THE POINT.
   * "We hold no row for this player" and "we hold several and cannot choose"
   * are different problems with different fixes — the first wants wider
   * ingestion, the second wants a better discriminator. Folding the second into
   * `miss` is how it stays invisible while the coverage numbers look merely
   * disappointing.
   */
  confidence: 'direct' | 'name_match' | 'ambiguous' | 'miss'
}

type ProviderColumn = 'sleeperId' | 'espnId' | 'mflId' | 'fleaflickerId' | 'fantraxId'

const PROVIDER_COLUMN: Partial<Record<ImportProvider, ProviderColumn>> = {
  sleeper: 'sleeperId',
  espn: 'espnId',
  mfl: 'mflId',
  fleaflicker: 'fleaflickerId',
  /*
   * `fantraxId` was added to PlayerIdentityMap on 2026-08-31 and is written
   * weekly by `lib/devy/ingestFantraxPlayerIdentities.ts`. Before that, Fantrax
   * had no column and this comment said so.
   *
   * ⚠ COVERAGE IS PARTIAL AND THAT IS SAFE HERE. Measured on the first real
   * run: 4,210 of 16,904 Fantrax CFB ids linked (25%), because the NCAAF
   * identity registry itself is thin — `ambiguous: 0` across the whole run,
   * which says the bottleneck is registry coverage rather than matching. A miss
   * returns no row and falls through to the same name match this provider used
   * for everything before, so enabling the column is strictly better than the
   * previous behaviour and never worse.
   */
  fantrax: 'fantraxId',
  // yahoo has no dedicated column yet — fallback to name match.
}

/**
 * Must be the writer's normalizer. `[^a-z0-9]` was stripping the space that
 * `lib/sports-data/multiSportIdentityMap.ts` keeps, so this matched 4 of 9,563 NFL
 * rows (127 of 65,152 across all sports) — see the same note on
 * `normalizePlayerNameForResolution` in the live resolver.
 */
function normalizeName(s: string | null | undefined): string {
  return normalizePlayerName(s ?? '')
}

/**
 * Resolve a single source player id. Pass `nameHint` to enable fallback
 * normalized-name matching when the provider-specific column is null.
 */
export async function resolveCanonicalPlayerId(args: {
  provider: ImportProvider
  sourceId: string
  nameHint?: string | null
  positionHint?: string | null
}): Promise<PlayerIdResolveResult> {
  const column = PROVIDER_COLUMN[args.provider]
  if (column) {
    const direct = await prisma.playerIdentityMap.findFirst({
      where: { [column]: args.sourceId } as Record<string, string>,
      select: { id: true },
    })
    if (direct) return { canonicalId: direct.id, confidence: 'direct' }
  }

  if (args.nameHint) {
    const normalized = normalizeName(args.nameHint)
    if (normalized.length > 0) {
      /*
       * 🛑 MORE THAN ONE MATCH IS NOT A MATCH.
       *
       * This was `findFirst`, which returns whichever row the database happened
       * to reach first when several people share a name — and then reports it as
       * a `name_match`, indistinguishable from a real one. Measured on production
       * 2026-08-31: 1,227 NCAAF normalized names in `PlayerIdentityMap` are
       * already held by more than one row, so this was already arbitrary for
       * them, silently.
       *
       * ⚠ AND IT WOULD GET MUCH WORSE, WHICH IS WHY THE GUARD LANDS WITH THE
       * WIDENING RATHER THAN AFTER IT. Widening the NCAAF registry from
       * `SportsPlayer` adds 44,692 rows keyed on (name, team) precisely BECAUSE
       * 4,925 colliding names are different people at different schools — Ryan
       * Davis is 8 rows across 7 schools. Adding those rows while `findFirst`
       * still picks one at random converts a coverage gap into confident wrong
       * answers, which is the worse of the two failures: a miss shows a gap, a
       * mis-link shows another player's projection on your roster.
       *
       * `take: 2` is enough to tell "one" from "more than one" without counting
       * the whole set, and the position hint narrows before we decide.
       */
      const byName = await prisma.playerIdentityMap.findMany({
        where: {
          normalizedName: normalized,
          ...(args.positionHint ? { position: args.positionHint.toUpperCase() } : {}),
        },
        select: { id: true },
        take: 2,
      })
      if (byName.length === 1) return { canonicalId: byName[0]!.id, confidence: 'name_match' }
      /*
       * Two or more: refuse. Reported as `ambiguous` rather than `miss` so a
       * caller can tell "we have no row for this player" from "we have several
       * and cannot choose" — different problems with different fixes, and
       * folding them together is how the second one stays invisible.
       */
      if (byName.length > 1) return { canonicalId: null, confidence: 'ambiguous' }
    }
  }

  return { canonicalId: null, confidence: 'miss' }
}

/**
 * Bulk resolver. Returns a map keyed by source id. Callers pass a
 * hydrated player-map (name + position) when available for better matching.
 */
export async function resolveCanonicalPlayerIds(args: {
  provider: ImportProvider
  sourceIds: string[]
  playerMap?: Record<string, { name: string; position: string }>
}): Promise<Record<string, PlayerIdResolveResult>> {
  const out: Record<string, PlayerIdResolveResult> = {}
  for (const sourceId of args.sourceIds) {
    const hint = args.playerMap?.[sourceId]
    out[sourceId] = await resolveCanonicalPlayerId({
      provider: args.provider,
      sourceId,
      nameHint: hint?.name ?? null,
      positionHint: hint?.position ?? null,
    })
  }
  return out
}
