/**
 * League Command Center — action capability + source trust derivation.
 *
 * This is the module that makes "never show a fake write button" structurally
 * true rather than a review-time convention.
 *
 * It does **not** invent a capability taxonomy. `deriveProviderCapabilities`
 * (`lib/shared-services/league-hub/providerCapabilities.ts`) already decides
 * what a provider can prove, and `RecommendationExecutionCapability`
 * (`lib/shared-services/league-hub/types.ts`) already decides how an action can
 * be executed. This file only projects those existing facts into the shape the
 * UI renders, and downgrades honestly whenever the underlying fact is weaker
 * than the UI would like.
 *
 * The one genuinely new decision here is deep-link constructibility: an
 * `open_provider` action becomes a real `external_deep_link` only when a
 * verifiable provider URL can be built from data we actually store. When it
 * cannot, it degrades to `read_only_guidance` ("complete on <Platform>")
 * rather than rendering a link that would 404.
 */
import {
  deriveImportType,
  deriveProviderCapabilities,
} from '@/lib/shared-services/league-hub/providerCapabilities'
import type {
  LeagueHubProvider,
  ProviderCapabilityBadge,
  RecommendationExecutionCapability,
  SyncFreshness,
  SyncFreshnessState,
} from '@/lib/shared-services/league-hub/types'
import type {
  ActionCapability,
  ActionCapabilityKind,
  CommandCenterSource,
  SourceTrustStatus,
} from './types'

// ── Provider display ──────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  allfantasy: 'AllFantasy',
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  mfl: 'MyFantasyLeague',
  fantrax: 'Fantrax',
  fleaflicker: 'Fleaflicker',
}

export function providerLabel(provider: LeagueHubProvider): string {
  const key = String(provider ?? '').trim().toLowerCase()
  return PROVIDER_LABELS[key] ?? 'External platform'
}

/**
 * Mirrors `isNativePlatform` in `lib/dashboard/platform-label.ts`, including its
 * treatment of an absent platform as native. Kept as a delegation rather than a
 * fifth copy of the `NATIVE_PLATFORMS` set — that set is already duplicated in
 * four places in this repo and should not grow.
 */
export { isNativePlatform } from '@/lib/dashboard/platform-label'

// ── Deep links ────────────────────────────────────────────────────────────────

/**
 * Football-scoped provider URL patterns. Only patterns that can be built from a
 * `platformLeagueId` alone are listed.
 *
 * MyFantasyLeague is deliberately absent: its league URLs are sharded across
 * numbered hosts (`www43.myfantasyleague.com/...`) and the shard is not stored,
 * so no correct URL can be constructed. MFL therefore resolves to
 * `read_only_guidance`. Guessing a host would produce a broken link, which is
 * worse than honestly telling the user to finish on MFL.
 */
const FOOTBALL_LEAGUE_URL_BUILDERS: Record<string, (leagueId: string) => string> = {
  sleeper: (id) => `https://sleeper.com/leagues/${encodeURIComponent(id)}`,
  espn: (id) => `https://fantasy.espn.com/football/league?leagueId=${encodeURIComponent(id)}`,
  yahoo: (id) => `https://football.fantasysports.yahoo.com/f1/${encodeURIComponent(id)}`,
  fantrax: (id) => `https://www.fantrax.com/fantasy/league/${encodeURIComponent(id)}/home`,
  fleaflicker: (id) => `https://www.fleaflicker.com/nfl/leagues/${encodeURIComponent(id)}`,
}

/** Sports whose URL patterns above are correct. Anything else returns null. */
const FOOTBALL_SPORTS = new Set(['NFL', 'NCAAF', 'FOOTBALL'])

/**
 * Builds a real, user-openable provider league URL, or null when one cannot be
 * constructed with confidence.
 *
 * Returns null when: the league is native (nothing external to open), the
 * provider has no constructible pattern (MFL), `platformLeagueId` is missing,
 * or the sport is outside the patterns above.
 */
export function buildProviderLeagueUrl(input: {
  provider: LeagueHubProvider
  platformLeagueId: string | null | undefined
  sport: string | null | undefined
}): string | null {
  const provider = String(input.provider ?? '').trim().toLowerCase()
  const leagueId = input.platformLeagueId?.trim()
  if (!leagueId) return null

  const sport = String(input.sport ?? '').trim().toUpperCase()
  if (!FOOTBALL_SPORTS.has(sport)) return null

  const builder = FOOTBALL_LEAGUE_URL_BUILDERS[provider]
  if (!builder) return null

  return builder(leagueId)
}

// ── Action capability ─────────────────────────────────────────────────────────

const CAPABILITY_PRESENTATION: Record<
  ActionCapabilityKind,
  { icon: string; label: (platform: string) => string }
> = {
  native_write: { icon: 'ph-check-circle', label: () => 'Handled inside AllFantasy' },
  read_only_guidance: { icon: 'ph-eye', label: (p) => `Reviewed here — complete on ${p}` },
  external_deep_link: { icon: 'ph-arrow-square-out', label: (p) => `Opens ${p} to finish` },
  copyable_message: { icon: 'ph-copy', label: () => 'Copy message to send' },
  informational: { icon: 'ph-info', label: () => 'Informational' },
}

export interface ResolveActionCapabilityInput {
  /** The execution capability the underlying recommendation/service actually reported. */
  execution: RecommendationExecutionCapability
  provider: LeagueHubProvider
  platformLeagueId: string | null | undefined
  sport: string | null | undefined
  /** Required for `copy_action`; ignored otherwise. */
  copyText?: string | null
  /**
   * Optional override for the external destination (e.g. a deep link to a
   * specific trade rather than the league home). Only honoured when it is an
   * absolute http(s) URL.
   */
  hrefOverride?: string | null
}

function isAbsoluteHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false
  return /^https?:\/\//i.test(value.trim())
}

/**
 * Projects a real execution capability into the renderable `ActionCapability`.
 *
 * Downgrade rules — every one of these exists to prevent a control that
 * promises more than the system can deliver:
 *
 *  - `native_execute` on a non-native league is impossible; it degrades to the
 *    same path an imported league would get. This is a defensive downgrade: a
 *    caller passing `native_execute` for a Sleeper league is a bug, and the UI
 *    must not render a live write control because of it.
 *  - `open_provider` with no constructible URL degrades to `read_only_guidance`.
 *  - `copy_action` with no text degrades to `informational`.
 */
export function resolveActionCapability(
  input: ResolveActionCapabilityInput,
): ActionCapability {
  const platform = providerLabel(input.provider)
  const isNative = String(input.provider ?? '').trim().toLowerCase() === 'allfantasy'

  const present = (
    kind: ActionCapabilityKind,
    extra: { href?: string | null; copyText?: string | null; canExecute?: boolean } = {},
  ): ActionCapability => ({
    kind,
    label: CAPABILITY_PRESENTATION[kind].label(platform),
    icon: CAPABILITY_PRESENTATION[kind].icon,
    href: extra.href ?? null,
    copyText: extra.copyText ?? null,
    canExecute: extra.canExecute ?? false,
  })

  switch (input.execution) {
    case 'native_execute': {
      // Only a genuinely native league can execute. Anything else is a caller
      // bug — fall through to the imported path rather than trusting the claim.
      if (isNative) return present('native_write', { canExecute: true })
      break
    }

    case 'copy_action': {
      const text = input.copyText?.trim()
      if (text) return present('copyable_message', { copyText: text })
      return present('informational')
    }

    case 'recommendation_only':
      return present('informational')

    case 'open_provider':
      break
  }

  // `open_provider`, or a downgraded `native_execute`.
  const href = isAbsoluteHttpUrl(input.hrefOverride)
    ? input.hrefOverride.trim()
    : buildProviderLeagueUrl({
        provider: input.provider,
        platformLeagueId: input.platformLeagueId,
        sport: input.sport,
      })

  if (href) return present('external_deep_link', { href })
  return present('read_only_guidance')
}

// ── Source trust ──────────────────────────────────────────────────────────────

const FRESH_WINDOW_MS = 15 * 60 * 1000
const DELAYED_WINDOW_MS = 2 * 60 * 60 * 1000

function relativeAge(from: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - from.getTime())
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * Projects storage-level freshness into user-facing severity.
 *
 * Native leagues are `live` — there is nothing external to sync, so reporting
 * "stale" for them would be meaningless. Imported leagues are graded on the age
 * of the last real sync; a league that has never synced is `unknown`, never
 * silently presented as current.
 */
export function resolveTrustStatus(
  freshness: SyncFreshness,
  now: Date = new Date(),
): { status: SourceTrustStatus; detail: string } {
  const state: SyncFreshnessState = freshness.state

  if (state === 'not_applicable') {
    return { status: 'live', detail: 'Scoring updates in real time' }
  }
  if (state === 'syncing') {
    return { status: 'current', detail: 'Syncing now…' }
  }
  if (state === 'never_synced') {
    return { status: 'unknown', detail: 'Never synced — no confirmed data yet' }
  }
  if (state === 'failed') {
    return { status: 'stale', detail: 'Last sync failed — showing last confirmed data' }
  }

  const last = freshness.lastSyncedAt ? new Date(freshness.lastSyncedAt) : null
  if (!last || Number.isNaN(last.getTime())) {
    return { status: 'unknown', detail: 'Sync time unavailable' }
  }

  const age = now.getTime() - last.getTime()
  const ago = relativeAge(last, now)

  if (state === 'stale' || age > DELAYED_WINDOW_MS) {
    return { status: 'stale', detail: `Last synced ${ago} — showing last confirmed data` }
  }
  if (age > FRESH_WINDOW_MS) {
    return { status: 'delayed', detail: `Updated ${ago} — can lag on game days` }
  }
  return { status: 'current', detail: `Updated ${ago}` }
}

export interface ResolveSourceInput {
  provider: LeagueHubProvider
  isCommissioner: boolean
  settings: Record<string, unknown> | null
  lastSyncedAt: Date | string | null
  now?: Date
}

/**
 * Assembles the full source/trust block for the hero + data-trust strip.
 *
 * Freshness state is derived from `League.lastSyncedAt` — the same column the
 * League Hub uses — rather than from a second, divergent notion of freshness.
 */
export function resolveSource(input: ResolveSourceInput): CommandCenterSource {
  const now = input.now ?? new Date()
  const providerKey = String(input.provider ?? '').trim().toLowerCase() || 'allfantasy'
  const isNative = providerKey === 'allfantasy' || providerKey === 'af' ||
    providerKey === 'manual' || providerKey === 'native'

  const normalizedProvider: LeagueHubProvider = isNative ? 'allfantasy' : providerKey

  const capabilities: ProviderCapabilityBadge[] = deriveProviderCapabilities({
    provider: normalizedProvider,
    isCommissioner: input.isCommissioner,
    settings: input.settings,
  })
  const importType = deriveImportType(normalizedProvider)

  const lastSyncedAt =
    input.lastSyncedAt instanceof Date
      ? input.lastSyncedAt.toISOString()
      : typeof input.lastSyncedAt === 'string' && input.lastSyncedAt.trim()
        ? input.lastSyncedAt
        : null

  const freshness: SyncFreshness = isNative
    ? { state: 'not_applicable', lastSyncedAt: null }
    : { state: lastSyncedAt ? 'fresh' : 'never_synced', lastSyncedAt }

  const { status, detail } = resolveTrustStatus(freshness, now)
  const label = providerLabel(normalizedProvider)

  const capabilityNote = isNative
    ? 'Native league — changes save directly in AllFantasy.'
    : importType === 'csv_snapshot'
      ? `Snapshot import — reviewed here, completed on ${label}.`
      : `Read-only import — reviewed here, completed on ${label}.`

  return {
    provider: normalizedProvider,
    label,
    isNative,
    kindLabel: isNative ? 'Native' : 'Imported',
    importType,
    capabilities,
    freshness: { ...freshness, state: status === 'stale' ? 'stale' : freshness.state },
    trustStatus: status,
    trustDetail: detail,
    capabilityNote,
  }
}

// ── Season label ──────────────────────────────────────────────────────────────

/**
 * Formats a league season for display, tolerating both column shapes.
 *
 * `League.season` is an `Int` but `SleeperLeague.season` is a `String`. Code
 * that guards with a number-only check has silently nulled every Sleeper league
 * on a user's board before, which is most of a real board. This accepts both
 * and returns null only when the value is genuinely unusable.
 */
export function resolveSeasonLabel(season: number | string | null | undefined): string | null {
  if (season === null || season === undefined) return null
  if (typeof season === 'number') {
    return Number.isFinite(season) ? String(season) : null
  }
  const trimmed = season.trim()
  if (!trimmed) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? String(parsed) : trimmed
}
