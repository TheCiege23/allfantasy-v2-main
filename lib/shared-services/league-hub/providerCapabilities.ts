/**
 * Universal League Hub — truthful provider capability derivation (Part 6).
 *
 * Reuses the real classification arrays from `commissionerGate.ts`
 * (`OPEN_READ_PROVIDERS`, `MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER`)
 * instead of re-deriving which providers can prove what — this file has zero
 * independent opinion about provider trust, it only labels what the
 * authorization layer already established.
 *
 * No background resync cron exists for any imported provider today (checked
 * `app/api/cron/*` — only score/player/schedule/news feeds are cron-driven;
 * league resync is a real, user-triggered action at
 * `app/api/leagues/import/resync/route.ts`). So every non-native provider
 * honestly gets `manual_refresh` — never claim automatic background sync
 * that doesn't exist.
 */
import {
  OPEN_READ_PROVIDERS,
  MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER,
} from '@/lib/league-import/commissionerGate'
import type { ImportProvider } from '@/lib/league-import/types'
import type { LeagueHubProvider, LeagueImportType, ProviderCapabilityBadge } from './types'

/**
 * `LeagueHubProvider` is intentionally wider than `ImportProvider` (it also
 * accepts `'allfantasy'` and arbitrary legacy platform strings — see
 * `types.ts`). `.includes()` on an `ImportProvider[]` still behaves exactly
 * right for a wider runtime value (a real `===` comparison that just
 * returns `false` for anything outside the six certified providers), this
 * cast only tells TypeScript that's a safe, intentional comparison.
 */
function isImportProvider(
  list: readonly ImportProvider[],
  provider: LeagueHubProvider
): boolean {
  return list.includes(provider as ImportProvider)
}

export interface DeriveCapabilitiesInput {
  provider: LeagueHubProvider
  /** Real, viewer-resolved commissioner flag already computed by the dashboard aggregator. */
  isCommissioner: boolean
  /** Raw `League.settings` JSON — read only for the two known additive keys. */
  settings: Record<string, unknown> | null
}

function readCommissionerVerification(settings: Record<string, unknown> | null): {
  method: 'api' | 'attestation' | 'membership-only' | null
} {
  if (!settings || typeof settings !== 'object') return { method: null }
  const raw = settings['commissionerVerification']
  if (!raw || typeof raw !== 'object') return { method: null }
  const method = (raw as Record<string, unknown>)['method']
  if (method === 'api' || method === 'attestation' || method === 'membership-only') {
    return { method }
  }
  return { method: null }
}

function readCommissionerAttestation(settings: Record<string, unknown> | null): boolean {
  if (!settings || typeof settings !== 'object') return false
  const raw = settings['commissionerAttestation']
  if (!raw || typeof raw !== 'object') return false
  return (raw as Record<string, unknown>)['accepted'] === true
}

const KNOWN_LIVE_SYNC_PROVIDERS: readonly ImportProvider[] = [
  'sleeper',
  ...MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER,
]

export function deriveImportType(provider: LeagueHubProvider): LeagueImportType {
  if (provider === 'allfantasy') return 'native'
  if (provider === 'fantrax') return 'csv_snapshot'
  if (isImportProvider(OPEN_READ_PROVIDERS, provider)) return 'read_only'
  if (isImportProvider(KNOWN_LIVE_SYNC_PROVIDERS, provider)) return 'live_sync'
  // Unrecognized/legacy platform string (e.g. 'cbs') — never certified in this
  // program, so never claim live sync. Most conservative honest label.
  return 'read_only'
}

export function deriveProviderCapabilities(input: DeriveCapabilitiesInput): ProviderCapabilityBadge[] {
  const { provider, isCommissioner, settings } = input

  if (provider === 'allfantasy') {
    return ['native']
  }

  const badges: ProviderCapabilityBadge[] = []
  const importType = deriveImportType(provider)

  if (importType === 'csv_snapshot') {
    badges.push('csv_snapshot')
  } else if (importType === 'read_only') {
    badges.push('read_only')
  } else {
    badges.push('live_sync')
  }
  badges.push('manual_refresh')

  if (provider === 'sleeper') {
    // Sleeper is the only provider with a real API-verified `true`/`false` commissioner signal.
    badges.push(isCommissioner ? 'commissioner_verified' : 'membership_verified')
    return badges
  }

  if (isImportProvider(MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER, provider)) {
    badges.push('membership_verified')
    const { method } = readCommissionerVerification(settings)
    if (method === 'attestation') badges.push('user_attested')
    return badges
  }

  if (isImportProvider(OPEN_READ_PROVIDERS, provider)) {
    // Fantrax/Fleaflicker: never membership- or commissioner-verified by a real API call.
    // Only label `user_attested` when a real attestation was actually recorded.
    if (readCommissionerAttestation(settings)) badges.push('user_attested')
    return badges
  }

  return badges
}
