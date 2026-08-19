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

/** Canonical FantasyUser identifier. Equal to `AppUser.id` today — see FantasyUserResolver. */
export type FantasyUserId = string

export interface FantasyUser {
  fantasyUserId: FantasyUserId
  displayName: string | null
  email: string
  createdAt: Date
}

/**
 * How a PlatformIdentity was resolved. Never fabricated: a platform that only
 * stores a credential (not a durable provider-user-id) reports
 * `transient_credential_only`, not a fake `stored` identity.
 */
export type IdentityResolutionMethod =
  | 'stored'
  | 'transient_credential_only'
  | 'not_available'

export interface SourceAttribution {
  sourceTable: 'UserProfile' | 'LeagueAuth' | 'FantraxUser' | 'PlayerIdentityMap' | 'derived'
  resolvedAt: Date
}

export interface PlatformIdentity {
  fantasyUserId: FantasyUserId
  platform: ImportProvider
  /** Null whenever resolutionMethod !== 'stored' — never a guessed or fuzzy-matched value. */
  providerUserId: string | null
  displayName: string | null
  linkedAt: Date | null
  verifiedAt: Date | null
  resolutionMethod: IdentityResolutionMethod
  sourceAttribution: SourceAttribution
}

export interface PlatformIdentityLinkRequest {
  fantasyUserId: FantasyUserId
  platform: ImportProvider
  /**
   * Must be a value already obtained from a real provider verification step
   * (e.g. an OAuth callback, or a confirmed username->id lookup against the
   * provider's own API). Never a raw, unverified, user-typed value — the
   * Identity Service performs no fuzzy or inferred matching.
   */
  verifiedProviderUserId: string
  displayName?: string | null
}

/** Reuses playerIdResolver's existing confidence vocabulary rather than inventing a new one. */
export type PlayerIdentityConfidence = 'direct' | 'name_match' | 'miss'

export interface PlayerIdentityResult {
  canonicalPlayerId: string | null
  confidence: PlayerIdentityConfidence
  matchedProvider: ImportProvider
  /** The PlayerIdentityMap column that produced a direct match, or null otherwise. */
  matchedField: string | null
  sourceAttribution: SourceAttribution
}
