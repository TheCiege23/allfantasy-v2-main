/**
 * Write Authority — the single answer to "when a manager changes something here, where does it land?"
 *
 * Three modes:
 *
 *   NATIVE     The league lives on AllFantasy. AF's database IS the system of record.
 *              A write is the real thing.
 *
 *   SHADOW     The league was imported from an external platform (ESPN, Yahoo, Sleeper, …).
 *              AF holds a digital twin. Writes are real *inside AllFantasy* and are never
 *              propagated to the source platform, which remains the system of record.
 *              Shadow leagues are fully editable on purpose — that is what makes Decision OS
 *              usable as a simulator ("what if I bench Josh Allen?") without touching a live
 *              league. The obligation is disclosure, not prohibition.
 *
 *   CONNECTED  The league is external AND AF holds a working write-back adapter, so a write
 *              propagates to the source platform. NOTHING is CONNECTED today — no provider
 *              write-back exists in the codebase.
 *
 * Adding write-back for a provider means adding it to `WRITE_BACK_CONNECTED_PLATFORMS` and
 * building the adapter. Every call site below then flips its own copy and behavior with no
 * further edits: that is the entire point of routing this through one predicate instead of
 * scattering `platform === 'sleeper'` checks (which is how the pre-Shadow codebase drifted
 * into showing "Lineup saved" for an ESPN league that never heard about the change).
 *
 * Client-safe by design: no `@/lib/prisma` import, so UI components can call it directly.
 * The DB-backed resolver lives in `./write-authority-server`.
 */

import { importedPlatformLabel, isNativePlatform } from '@/lib/dashboard/platform-label'
import { hasTeamSwitched, isOfficialOnAllFantasy } from './switching/switchingLeague'

export type WriteAuthority = 'NATIVE' | 'SHADOW' | 'CONNECTED'

/**
 * Mutations that need distinct user-facing copy. Keep in sync with `SHADOW_ACTION_COPY`.
 */
export type WriteAuthorityAction =
  | 'lineup'
  | 'trade'
  | 'waiver_claim'
  | 'waiver_add_drop'
  | 'settings'

/**
 * External platforms AllFantasy can write back to.
 *
 * INTENTIONALLY EMPTY. No provider write-back adapter exists. When one ships, add the
 * `League.platform` value here — that single edit promotes every surface for that provider
 * from SHADOW to CONNECTED, swapping "Save Shadow Lineup" for "Save to Sleeper" everywhere.
 */
export const WRITE_BACK_CONNECTED_PLATFORMS: ReadonlySet<string> = new Set<string>()

/**
 * The authority for a league, from its `League.platform` value alone.
 *
 * `platform` is a plain Prisma `String` with no DB enum, so treat it as untrusted text — the
 * same assumption `lib/dashboard/platform-label.ts` documents. A null/undefined platform means
 * a native AF league (matching that module's `isNativePlatform` default).
 *
 * Anything unrecognised — including an empty string, which `isNativePlatform` does NOT treat as
 * native — resolves to SHADOW. That asymmetry is deliberate and is the fail-safe direction: a
 * spurious shadow banner on a malformed native row is a cosmetic annoyance, whereas defaulting
 * a malformed imported row to NATIVE would tell a manager their change reached ESPN when it
 * did not. Over-disclose rather than over-claim.
 */
export function resolveWriteAuthority(league: LeagueAuthoritySource): WriteAuthority {
  /*
   * A caller past the types (an `any`, plain JS, an old test) may still pass the bare platform string,
   * the pre-switching signature. Read it as a platform: `undefined` would resolve to NATIVE and tell a
   * manager their change reached Sleeper — the over-claim direction this module exists to prevent.
   */
  const raw = league as unknown
  if (raw == null || typeof raw === 'string') return resolveWriteAuthority({ platform: raw as string | null, settings: null })
  const platform = league.platform
  if (isNativePlatform(platform)) return 'NATIVE'
  // An imported league the commissioner made official on AllFantasy (lib/league/switching).
  if (isOfficialOnAllFantasy(league.settings)) return 'NATIVE'
  const p = (platform ?? '').trim().toLowerCase()
  return WRITE_BACK_CONNECTED_PLATFORMS.has(p) ? 'CONNECTED' : 'SHADOW'
}

/** True when writes stay inside AllFantasy and must say so. */
export function isShadowLeague(league: LeagueAuthoritySource): boolean {
  return resolveWriteAuthority(league) === 'SHADOW'
}

/**
 * What authority is read from: the league's platform AND its settings, because an imported league can
 * be made official on AllFantasy (`League.settings.switching`). Both are required on purpose, so a
 * caller that never selected `settings` fails to compile rather than silently reading every switched
 * league as a shadow. Pass `settings: null` only where no league row exists.
 */
export type LeagueAuthoritySource = { platform?: string | null; settings: unknown }

/**
 * ⚠ ONLY FOR A SURFACE THAT HAS NOT LOADED `settings` (a badge given just a platform prop). It reads an
 * imported league as NOT official, which is what every league was before switching existed. Greppable on
 * purpose: each caller is a place still to wire `settings` into before a switched league looks right there.
 */
/**
 * The same bare-string tolerance as `resolveWriteAuthority`, for any helper that reads `.platform` itself
 * (the copy builders here, `leagueWorkspaceMode`, `buildStagedWriteAuthority`).
 */
export function asAuthoritySource(league: LeagueAuthoritySource): LeagueAuthoritySource {
  const raw = league as unknown
  return raw == null || typeof raw === 'string' ? { platform: raw as string | null, settings: null } : league
}

export function platformOnlyAuthority(platform: string | null | undefined): { platform: string | null | undefined; settings: null } {
  return { platform, settings: null }
}

/**
 * Who is in charge of ONE team's moves. `MIRRORED`: the league is official on AllFantasy but this
 * team's manager has not switched, so the team is copied in from the old platform and its moves happen
 * there. A write to it here would be undone by the next copy, so callers refuse it.
 */
export type TeamWriteAuthority = WriteAuthority | 'MIRRORED'

export function resolveTeamWriteAuthority(league: LeagueAuthoritySource, leagueTeamId: string | null | undefined): TeamWriteAuthority {
  const leagueAuthority = resolveWriteAuthority(league)
  if (leagueAuthority !== 'NATIVE' || isNativePlatform(league.platform)) return leagueAuthority
  return hasTeamSwitched(league.settings, leagueTeamId) ? 'NATIVE' : 'MIRRORED'
}

/**
 * Display name of the source platform ("ESPN", "Yahoo", "Sleeper"), or null for native leagues.
 * Used to name the system of record in copy rather than saying a vague "your host platform".
 */
export function sourcePlatformLabel(platform: string | null | undefined): string | null {
  return importedPlatformLabel(platform)
}

export type WriteAuthorityCopy = {
  /** Success headline, e.g. "Shadow lineup saved". */
  title: string
  /** One-line consequence statement. Empty string when there is nothing to disclose. */
  detail: string
}

/**
 * Per-action copy. `source` is the platform label ("ESPN"); callers pass it pre-resolved so
 * these stay pure string builders.
 *
 * Deliberately avoids naming a specific weekday for waivers — AF does not reliably know the
 * source league's waiver run day, and inventing "before Wednesday" would trade one honesty
 * problem for another.
 */
const SHADOW_ACTION_COPY: Record<WriteAuthorityAction, (source: string) => WriteAuthorityCopy> = {
  lineup: (source) => ({
    title: 'Shadow lineup saved',
    detail: `Saved in AllFantasy only — your ${source} lineup is unchanged.`,
  }),
  trade: (source) => ({
    title: 'Shadow trade created',
    detail: `Send this offer in ${source} to make it real.`,
  }),
  waiver_claim: (source) => ({
    title: 'Waiver recommendation saved',
    detail: `Submit it in ${source} before your league's waiver deadline.`,
  }),
  waiver_add_drop: (source) => ({
    title: 'Shadow add/drop recorded',
    detail: `Make the move in ${source} to apply it to your real roster.`,
  }),
  settings: (source) => ({
    title: 'Shadow rules updated',
    detail: `Your ${source} league settings are unchanged.`,
  }),
}

/** Copy for a league whose writes DO land for real (native or a future connected provider). */
const REAL_ACTION_COPY: Record<WriteAuthorityAction, (source: string | null) => WriteAuthorityCopy> = {
  lineup: (source) => ({ title: 'Lineup saved', detail: source ? `Saved to ${source}.` : '' }),
  trade: (source) => ({ title: 'Trade offer sent', detail: source ? `Sent in ${source}.` : '' }),
  waiver_claim: (source) => ({ title: 'Claim submitted', detail: source ? `Submitted in ${source}.` : '' }),
  waiver_add_drop: (source) => ({ title: 'Roster move complete', detail: source ? `Applied in ${source}.` : '' }),
  settings: (source) => ({ title: 'League settings saved', detail: source ? `Applied in ${source}.` : '' }),
}

/**
 * Success copy for one action under one authority. This is the function that keeps a shadow
 * write from ever rendering as though it reached the source platform.
 */
export function writeAuthorityCopy(
  action: WriteAuthorityAction,
  league: LeagueAuthoritySource,
): WriteAuthorityCopy {
  const authority = resolveWriteAuthority(league)
  const source = sourcePlatformLabel(asAuthoritySource(league).platform)
  if (authority === 'SHADOW') {
    // `source` is non-null whenever authority is SHADOW (both derive from the same non-native
    // check), but fall back rather than render "undefined" if that ever stops holding.
    return SHADOW_ACTION_COPY[action](source ?? 'your host platform')
  }
  return REAL_ACTION_COPY[action](authority === 'CONNECTED' ? source : null)
}

/** Standing one-liner for banners and badges — not tied to a particular mutation. */
export function shadowDisclosure(league: LeagueAuthoritySource): string | null {
  if (!isShadowLeague(league)) return null
  const source = sourcePlatformLabel(asAuthoritySource(league).platform) ?? 'your host platform'
  return `Changes stay inside AllFantasy. ${source} remains your league's system of record.`
}

/**
 * Verb for a save control. A shadow save is still a save — the label just refuses to imply
 * it travelled. "Save to Sleeper" appears automatically once Sleeper is CONNECTED.
 */
export function saveActionLabel(
  action: WriteAuthorityAction,
  league: LeagueAuthoritySource,
): string {
  const authority = resolveWriteAuthority(league)
  const source = sourcePlatformLabel(asAuthoritySource(league).platform)
  if (authority === 'CONNECTED' && source) {
    if (action === 'trade') return `Send offer in ${source}`
    return `Save to ${source}`
  }
  if (authority === 'SHADOW') {
    if (action === 'trade') return 'Create shadow trade'
    if (action === 'waiver_claim') return 'Save waiver recommendation'
    if (action === 'settings') return 'Update shadow rules'
    return 'Save shadow lineup'
  }
  if (action === 'trade') return 'Send trade offer'
  if (action === 'waiver_claim') return 'Submit claim'
  if (action === 'settings') return 'Save settings'
  return 'Save lineup'
}

export type WriteAuthorityEnvelope = {
  authority: WriteAuthority
  /** Raw `League.platform`, echoed so clients need not refetch it. */
  platform: string | null
  /** "ESPN" / "Yahoo" / null for native. */
  sourceLabel: string | null
  /** True when this write did NOT reach the source platform. */
  shadow: boolean
  /** Copy the client should show on success. */
  copy: WriteAuthorityCopy
}

/**
 * Response envelope for mutation routes. Every mutating endpoint that can run against an
 * imported league returns this, so a client can never accidentally render a bare "Saved!"
 * for a write that stopped at AF's database.
 */
export function buildWriteAuthorityEnvelope(
  action: WriteAuthorityAction,
  league: LeagueAuthoritySource,
): WriteAuthorityEnvelope {
  const authority = resolveWriteAuthority(league)
  return {
    authority,
    platform: asAuthoritySource(league).platform ?? null,
    sourceLabel: sourcePlatformLabel(asAuthoritySource(league).platform),
    shadow: authority === 'SHADOW',
    copy: writeAuthorityCopy(action, league),
  }
}
