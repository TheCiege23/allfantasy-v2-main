/**
 * Provider capability table — Phase 14 audit findings, not assumptions.
 *
 * `PlayerIdentityMap` has dedicated columns for sleeperId / espnId / mflId /
 * fleaflickerId — confirmed by reading prisma/schema.prisma directly — and, since
 * 2026-08-31, `fantraxId`. The migration this note called out of scope has been
 * applied, and the column is written weekly by
 * `lib/devy/ingestFantraxPlayerIdentities.ts`.
 *
 * There is still **NO yahooId column** — a real, pre-existing gap first documented in
 * the Phase 1 Identity Service, and still true. Yahoo resolution falls straight to
 * name/team/position matching (step 4 of the resolution strategy).
 *
 * ⚠ `supportsDirectId: true` FOR FANTRAX IS A STATEMENT ABOUT THE COLUMN, NOT ABOUT
 * COVERAGE. 4,210 of 16,904 Fantrax CFB ids are linked (25%); the rest miss because the
 * NCAAF registry has no row for that player, not because matching failed — the first
 * run recorded **0 ambiguous**. A miss returns no row and the resolver falls through to
 * name matching exactly as it did before, so this is strictly better and never worse.
 *
 * `SportsPlayer` additionally has its own, separately-populated `sleeperId`
 * column (confirmed via schema + a real query against Phase 13's validation
 * league: 2 of 10 real starters were missing from `PlayerIdentityMap` but
 * present in `SportsPlayer` by sleeperId) — a real second direct-id source
 * for Sleeper only. It has no espnId/mflId/fleaflickerId column.
 *
 * Never leaks a provider-specific object — this module only exposes which
 * table/column combinations exist, never provider API response shapes.
 */

import type { ImportProvider } from '@/lib/league-import/types'
import type { ProviderCapability } from './types'

const CAPABILITIES: Record<ImportProvider, ProviderCapability> = {
  sleeper: {
    provider: 'sleeper',
    directIdSources: [
      { table: 'PlayerIdentityMap', column: 'sleeperId' },
      { table: 'SportsPlayer', column: 'sleeperId' },
    ],
    supportsDirectId: true,
  },
  espn: {
    provider: 'espn',
    directIdSources: [{ table: 'PlayerIdentityMap', column: 'espnId' }],
    supportsDirectId: true,
  },
  mfl: {
    provider: 'mfl',
    directIdSources: [{ table: 'PlayerIdentityMap', column: 'mflId' }],
    supportsDirectId: true,
  },
  fleaflicker: {
    provider: 'fleaflicker',
    directIdSources: [{ table: 'PlayerIdentityMap', column: 'fleaflickerId' }],
    supportsDirectId: true,
  },
  // yahoo: no dedicated id column on either table today — real, disclosed gap.
  // Resolution falls straight to name/team/position matching (step 4 of the
  // resolution strategy).
  yahoo: {
    provider: 'yahoo',
    directIdSources: [],
    supportsDirectId: false,
  },
  fantrax: {
    provider: 'fantrax',
    directIdSources: [{ table: 'PlayerIdentityMap', column: 'fantraxId' }],
    supportsDirectId: true,
  },
}

/**
 * `provider` is typed as `ImportProvider`, but real callers (e.g.
 * `crossLeaguePlayerPortfolio.ts`) pass the broader `LeagueHubProvider` set
 * (adds 'allfantasy' for native leagues) through an unsafe cast, so a value
 * outside `CAPABILITIES`'s 6 keys reaches this function at runtime despite
 * the type. Falls back to "no direct id, name-match only" (the same real
 * behavior already used for yahoo/fantrax) instead of returning `undefined`
 * and crashing the caller on `.directIdSources`.
 */
export function getProviderCapability(provider: ImportProvider): ProviderCapability {
  return CAPABILITIES[provider] ?? { provider, directIdSources: [], supportsDirectId: false }
}

export function getAllProviderCapabilities(): ProviderCapability[] {
  return Object.values(CAPABILITIES)
}
