/**
 * Provider capability table — Phase 14 audit findings, not assumptions.
 *
 * `PlayerIdentityMap` has dedicated columns for sleeperId / espnId / mflId /
 * fleaflickerId — confirmed by reading prisma/schema.prisma directly. It has
 * NO yahooId or fantraxId column (a real, pre-existing gap first documented
 * in the Phase 1 Identity Service, still true today; closing it requires a
 * schema migration, out of scope for this additive phase).
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
  // yahoo / fantrax: no dedicated id column on either table today — real,
  // disclosed gap. Resolution for these providers falls straight to
  // name/team/position matching (step 4 of the resolution strategy).
  yahoo: {
    provider: 'yahoo',
    directIdSources: [],
    supportsDirectId: false,
  },
  fantrax: {
    provider: 'fantrax',
    directIdSources: [],
    supportsDirectId: false,
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
