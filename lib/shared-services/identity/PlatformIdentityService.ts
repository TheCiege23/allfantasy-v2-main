/**
 * PlatformIdentityService — Identity Service, Fantasy OS Migration Plan Milestone 1.
 *
 * Reads through THREE existing, real storage mechanisms rather than introducing a
 * new table (this phase is additive infrastructure only — no schema changes):
 *
 *   - Sleeper:  UserProfile.sleeperUserId / sleeperUsername / sleeperLinkedAt / sleeperVerifiedAt
 *               (a durable, stored provider-user-id)
 *   - ESPN:     LeagueAuth.espnSwid (a durable, stored provider-user-id — SWID is ESPN's
 *               own stable per-user cookie identifier)
 *   - Yahoo/MFL: LeagueAuth.oauthToken / apiKey (a CREDENTIAL only — no durable provider-user-id
 *               is stored anywhere today; Yahoo's manager GUID is resolved transiently, per
 *               request, from a live API call — see lib/league-import/commissionerGate.ts's
 *               checkYahoo). This service reports that honestly via `resolutionMethod:
 *               'transient_credential_only'` rather than fabricating a stored identity.
 *   - Fantrax:  FantraxUser.fantraxUsername exists but has NO relation back to AppUser —
 *               there is no query path from a FantasyUserId to a FantraxUser row today.
 *               Reported as `resolutionMethod: 'not_available'`. This is a real gap,
 *               tracked in the Migration Plan's blocker list, not something this service
 *               can silently paper over.
 *   - Fleaflicker: no per-user credential or identity is stored at all (it's one of the
 *               commissioner-gate's OPEN_READ_PROVIDERS) — `resolutionMethod: 'not_available'`.
 *
 * This module does not modify UserProfile, LeagueAuth, or FantraxUser rows except via the
 * explicit `linkPlatformIdentity` write path below, and nothing in the existing codebase
 * calls into this module yet — see the phase brief's "no consumer migrations" rule.
 */

import { prisma } from '@/lib/prisma'
import { IMPORT_PROVIDERS, type ImportProvider } from '@/lib/league-import/types'
import { DuplicateIdentityLinkError, IdentityValidationError, UnverifiedIdentityLinkError } from './errors'
import type { FantasyUserId, PlatformIdentity, PlatformIdentityLinkRequest } from './types'

const CREDENTIAL_ONLY_PLATFORMS: ReadonlySet<ImportProvider> = new Set(['yahoo', 'mfl'])

function notAvailable(
  fantasyUserId: FantasyUserId,
  platform: ImportProvider,
  resolvedAt: Date
): PlatformIdentity {
  return {
    fantasyUserId,
    platform,
    providerUserId: null,
    displayName: null,
    linkedAt: null,
    verifiedAt: null,
    resolutionMethod: 'not_available',
    sourceAttribution: { sourceTable: 'derived', resolvedAt },
  }
}

async function resolveSleeperIdentity(
  fantasyUserId: FantasyUserId,
  resolvedAt: Date
): Promise<PlatformIdentity> {
  const profile = await prisma.userProfile.findFirst({
    where: { userId: fantasyUserId },
    select: {
      sleeperUserId: true,
      sleeperUsername: true,
      sleeperLinkedAt: true,
      sleeperVerifiedAt: true,
    },
  })
  return {
    fantasyUserId,
    platform: 'sleeper',
    providerUserId: profile?.sleeperUserId ?? null,
    displayName: profile?.sleeperUsername ?? null,
    linkedAt: profile?.sleeperLinkedAt ?? null,
    verifiedAt: profile?.sleeperVerifiedAt ?? null,
    resolutionMethod: profile?.sleeperUserId ? 'stored' : 'not_available',
    sourceAttribution: { sourceTable: 'UserProfile', resolvedAt },
  }
}

async function resolveEspnIdentity(
  fantasyUserId: FantasyUserId,
  resolvedAt: Date
): Promise<PlatformIdentity> {
  const auth = await prisma.leagueAuth.findUnique({
    where: { userId_platform: { userId: fantasyUserId, platform: 'espn' } },
    select: { espnSwid: true, createdAt: true, updatedAt: true },
  })
  return {
    fantasyUserId,
    platform: 'espn',
    // Stored encrypted at rest; callers needing the raw value still go through the
    // existing lib/league-sync-core.ts#getDecryptedAuth, matching how every current
    // ESPN consumer already fetches it. This service reports presence, not the secret.
    providerUserId: auth?.espnSwid ? '[stored:encrypted]' : null,
    displayName: null,
    linkedAt: auth?.createdAt ?? null,
    verifiedAt: auth?.updatedAt ?? null,
    resolutionMethod: auth?.espnSwid ? 'stored' : 'not_available',
    sourceAttribution: { sourceTable: 'LeagueAuth', resolvedAt },
  }
}

async function resolveCredentialOnlyIdentity(
  fantasyUserId: FantasyUserId,
  platform: ImportProvider,
  resolvedAt: Date
): Promise<PlatformIdentity> {
  const auth = await prisma.leagueAuth.findUnique({
    where: { userId_platform: { userId: fantasyUserId, platform } },
    select: { createdAt: true, updatedAt: true, apiKey: true, oauthToken: true },
  })
  const hasCredential = Boolean(auth?.apiKey || auth?.oauthToken)
  return {
    fantasyUserId,
    platform,
    // Never stored for these platforms — must be resolved live from the provider's own
    // API on each request (see commissionerGate.ts's checkYahoo for the existing pattern).
    providerUserId: null,
    displayName: null,
    linkedAt: hasCredential ? (auth?.createdAt ?? null) : null,
    verifiedAt: hasCredential ? (auth?.updatedAt ?? null) : null,
    resolutionMethod: hasCredential ? 'transient_credential_only' : 'not_available',
    sourceAttribution: { sourceTable: 'LeagueAuth', resolvedAt },
  }
}

/** Resolve a single platform identity for a FantasyUser. Never throws for a missing link — returns `not_available`. */
export async function resolvePlatformIdentity(
  fantasyUserId: FantasyUserId,
  platform: ImportProvider
): Promise<PlatformIdentity> {
  const resolvedAt = new Date()

  if (platform === 'sleeper') return resolveSleeperIdentity(fantasyUserId, resolvedAt)
  if (platform === 'espn') return resolveEspnIdentity(fantasyUserId, resolvedAt)
  if (CREDENTIAL_ONLY_PLATFORMS.has(platform)) {
    return resolveCredentialOnlyIdentity(fantasyUserId, platform, resolvedAt)
  }
  // fantrax (no AppUser relation exists) and fleaflicker (no per-user storage at all)
  return notAvailable(fantasyUserId, platform, resolvedAt)
}

/** Resolve every known provider's identity for a FantasyUser in one call. */
export async function listPlatformIdentities(fantasyUserId: FantasyUserId): Promise<PlatformIdentity[]> {
  return Promise.all(IMPORT_PROVIDERS.map((platform) => resolvePlatformIdentity(fantasyUserId, platform)))
}

/**
 * Explicit provider-link workflow — Sleeper only in this phase (see module docstring for
 * why ESPN/Yahoo/MFL are credential flows, not identity-link flows, and why Fantrax/
 * Fleaflicker have no link target to write to yet).
 *
 * Requires an already-verified `verifiedProviderUserId` — this function performs no
 * network calls of its own and no fuzzy/inferred matching. The caller is responsible
 * for having verified the id against the provider's own API before calling this.
 */
export async function linkPlatformIdentity(request: PlatformIdentityLinkRequest): Promise<PlatformIdentity> {
  const { fantasyUserId, platform, verifiedProviderUserId, displayName } = request

  if (!verifiedProviderUserId || verifiedProviderUserId.trim().length === 0) {
    throw new UnverifiedIdentityLinkError(
      `Cannot link a ${platform} identity without a verified provider user id. The Identity Service never infers or fuzzy-matches identity links.`
    )
  }

  if (platform !== 'sleeper') {
    throw new IdentityValidationError(
      `Explicit identity linking is not supported for "${platform}" in this phase. ESPN/Yahoo/MFL are credential-based flows (see lib/league-sync-core.ts); Fantrax/Fleaflicker have no per-user identity target today.`
    )
  }

  const existingOwner = await prisma.userProfile.findFirst({
    where: {
      sleeperUserId: verifiedProviderUserId,
      NOT: { userId: fantasyUserId },
    },
    select: { userId: true },
  })
  if (existingOwner) {
    throw new DuplicateIdentityLinkError(
      `Sleeper user_id "${verifiedProviderUserId}" is already linked to a different FantasyUser.`
    )
  }

  const now = new Date()
  await prisma.userProfile.update({
    where: { userId: fantasyUserId },
    data: {
      sleeperUserId: verifiedProviderUserId,
      ...(displayName ? { sleeperUsername: displayName } : {}),
      sleeperLinkedAt: now,
    },
  })

  return resolveSleeperIdentity(fantasyUserId, now)
}
