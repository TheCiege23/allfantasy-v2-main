/**
 * Universal League Hub — truthful provider capability derivation (Part 6).
 *
 * Reuses the real classification arrays from `commissionerGate.ts`
 * (`OPEN_READ_PROVIDERS`, `MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER`)
 * instead of re-deriving which providers can prove what — this file has zero
 * independent opinion about provider trust, it only labels what the
 * authorization layer already established.
 *
 * ⚠ IT ANSWERS TWO DIFFERENT QUESTIONS AND MUST NOT CONFLATE THEM AGAIN.
 * "What can we prove about the importer?" comes from the two arrays above.
 * "Does this league actually get re-read?" comes from `SYNCABLE_PROVIDERS` and,
 * for Fantrax, from the league row. Using the first to answer the second is the
 * defect corrected in `deriveImportType` below — it is an easy mistake precisely
 * because the two agreed for as long as nothing refreshed on a schedule.
 *
 * 🛑 THE PARAGRAPH THAT USED TO BE HERE IS RETRACTED, AND IT HAD PROPAGATED.
 * It read: "No background resync cron exists for any imported provider today (checked
 * `app/api/cron/*` ...). So every non-native provider honestly gets `manual_refresh` — never
 * claim automatic background sync that doesn't exist."
 *
 * That was true when written and is false now. `/api/cron/fantasy-os-exec-sync` runs every ten
 * minutes (`cron-schedule.json`) and refreshes the imported leagues of every provider in
 * `SYNCABLE_PROVIDERS` — all six. So the rule inverted: `manual_refresh` on a league the
 * collector refreshes is now itself the false claim, and `auto_refresh` is the honest badge.
 *
 * ⚠ `syncFreshness.ts` REPEATED THE SAME CLAIM AND CITED THIS FILE FOR IT, so one stale fact
 * became two. Both are corrected together; if this paragraph ever changes again, grep for the
 * other one rather than trusting that it was noticed.
 *
 * ⚠ WHAT IS STILL TRUE, AND IS THE POINT OF THE ORIGINAL WARNING: never claim a refresh that does
 * not happen. A badge here must be derived from something real — `SYNCABLE_PROVIDERS` for the
 * provider-level question, `FantraxLeague.sourceLeagueId` for the per-league one — never from what
 * would be nice to show.
 *
 * ⚠ NOT CLAIMED EITHER WAY: whether that cron is firing in production right now. This file says
 * what the system is built to do; a dead scheduler is a deployment fact no derivation here can
 * see, and `SyncFreshness.lastSyncedAt` is what actually tells a viewer when this league last
 * moved.
 */
import {
  OPEN_READ_PROVIDERS,
  MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER,
} from '@/lib/league-import/commissionerGate'
/*
 * The collector's OWN list of what it syncs — imported rather than restated, because a second
 * copy of this list is exactly how the card and the collector would drift apart again. The two
 * sets below answer authorization; this one answers refresh, and keeping them visibly separate is
 * the point of the note on `deriveImportType`.
 */
import { SYNCABLE_PROVIDERS } from '@/lib/import-os/collector/types'
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
  /** Per-league refreshability; see `DeriveImportTypeInput.isRefreshable`. */
  isRefreshable?: boolean | null
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

export interface DeriveImportTypeInput {
  provider: LeagueHubProvider
  /**
   * Per-league: can THIS league be re-read from a live provider source?
   *
   * `undefined`/`null` means "not established" and the provider answers alone, which is correct
   * for five of the six — their refreshability is a property of the provider. Only Fantrax
   * genuinely varies league by league, via `FantraxLeague.sourceLeagueId`; see
   * `leagueRefreshability.ts` for why, and for why the unknown case resolves conservatively.
   */
  isRefreshable?: boolean | null
}

/**
 * 🛑 THIS USED TO ANSWER A SYNC QUESTION WITH AUTHORIZATION DATA, WHICH IS WHY TWO LABELS WERE
 * WRONG. The old body fell through `OPEN_READ_PROVIDERS` — a set from `commissionerGate` about
 * what we can PROVE about the importer (public read, no membership proof) — and used it to decide
 * whether a league gets re-read. Those are unrelated questions that happened to agree for a while.
 *
 * The consequences were both visible on the League Hub card: Fleaflicker read `read_only` despite
 * being refreshed on the same ten-minute heartbeat as everyone else, and Fantrax was hardcoded to
 * `csv_snapshot` from before it had a live API at all.
 *
 * `SYNCABLE_PROVIDERS` is the real authority for the provider-level question — it is the list the
 * collector itself iterates — so this now asks that, and asks the league only where the provider
 * cannot answer.
 */
export function deriveImportType(input: DeriveImportTypeInput): LeagueImportType {
  const { provider, isRefreshable } = input
  if (provider === 'allfantasy') return 'native'

  /*
   * An unrecognised or legacy platform string (e.g. 'cbs') was never certified by this program and
   * the collector does not sync it. Never claim live sync for it — most conservative honest label,
   * unchanged from before.
   */
  if (!isImportProvider(SYNCABLE_PROVIDERS, provider)) return 'read_only'

  /*
   * The provider CAN be synced; this league specifically may still not be. Only a definite `false`
   * downgrades — an unknown leaves the provider's answer standing, because for five of the six
   * there is nothing league-specific to know.
   */
  if (isRefreshable === false) return 'csv_snapshot'

  return 'live_sync'
}

export function deriveProviderCapabilities(input: DeriveCapabilitiesInput): ProviderCapabilityBadge[] {
  const { provider, isCommissioner, settings } = input

  if (provider === 'allfantasy') {
    return ['native']
  }

  const badges: ProviderCapabilityBadge[] = []
  const importType = deriveImportType({ provider, isRefreshable: input.isRefreshable })

  if (importType === 'csv_snapshot') {
    badges.push('csv_snapshot')
  } else if (importType === 'read_only') {
    badges.push('read_only')
  } else {
    badges.push('live_sync')
  }

  /*
   * ⚠ THE REFRESH BADGE FOLLOWS THE IMPORT TYPE, AND USED TO BE AN UNCONDITIONAL `manual_refresh`.
   * That was honest while nothing refreshed on a schedule; it is now backwards for anything the
   * ten-minute collector covers. A league that really is re-read gets `auto_refresh`; one that is
   * genuinely a frozen snapshot, or a legacy platform the collector does not know, keeps
   * `manual_refresh` — which for those is not a downgrade but the only true statement available.
   */
  badges.push(importType === 'live_sync' ? 'auto_refresh' : 'manual_refresh')

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
