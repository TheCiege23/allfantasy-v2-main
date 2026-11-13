/**
 * Canonical Identity Service types — Phase 1 of the Fantasy OS Migration Plan
 * (docs/os/ALLFANTASY_FANTASY_OS_MIGRATION_PLAN.md, Milestone 1).
 *
 * These types implement the "Identity & Access" object group from the Shared
 * Fantasy Data Model spec (PlatformIdentity, FantasyUser) plus the player
 * identity contract from its "Roster & Players" group (PlayerValue's sibling,
 * canonical Player identity). They intentionally reuse `ImportProvider` from
 * `lib/league-import/types` rather than redefining the provider list.
 */

import type { ImportProvider } from '@/lib/league-import/types'

interface SourceAttribution {
  sourceTable: 'UserProfile' | 'LeagueAuth' | 'FantraxUser' | 'PlayerIdentityMap' | 'derived'
  resolvedAt: Date
}

/**
 * Reuses playerIdResolver's existing confidence vocabulary rather than inventing a new one.
 *
 * ⚠ `ambiguous` MEANS THE REGISTRY HELD SEVERAL PEOPLE OF THAT NAME AND THE
 * RESOLVER REFUSED TO PICK ONE. It is deliberately not folded into `miss`: a
 * caller that treats them the same is still correct, but one that reports them
 * separately can tell a coverage gap from a discriminator gap.
 */
type PlayerIdentityConfidence = 'direct' | 'name_match' | 'ambiguous' | 'miss'

export interface PlayerIdentityResult {
  canonicalPlayerId: string | null
  confidence: PlayerIdentityConfidence
  matchedProvider: ImportProvider
  /** The PlayerIdentityMap column that produced a direct match, or null otherwise. */
  matchedField: string | null
  sourceAttribution: SourceAttribution
}
