/**
 * Membership gate for external league imports. Any authenticated user who is a
 * member of the source league (or can access its data via their linked account)
 * may import it into AF.
 *
 * Per-provider strategy:
 *   - sleeper: hit /league/{id}/users and require the user is a league member.
 *   - espn / yahoo: require a linked account that can fetch the league (proves membership).
 *   - fantrax / mfl / fleaflicker: pass through — public APIs allow any user to read.
 */

import { prisma } from '@/lib/prisma'
import { getDecryptedAuth } from '@/lib/league-sync-core'
import type { ImportProvider } from './types'
import { fetchEspnLeagueForImport, EspnImportLeagueNotFoundError } from './espn/EspnLeagueFetchService'
import { fetchYahooLeagueForImport, YahooImportLeagueNotFoundError } from './yahoo/YahooLeagueFetchService'
import { fetchMflUserLeagues, parseMflSourceInput, MflImportLeagueNotFoundError } from './mfl/MflLeagueFetchService'
import { MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER } from './attestationProviders'

/**
 * Re-exported (not redefined) so every existing caller of
 * `MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER` from this module keeps
 * working unchanged. The real definition lives in `attestationProviders.ts`
 * — a dependency-free file safe to import from client components, which
 * this module (server-only: `@/lib/prisma`, decrypted-auth lookups) is not.
 */
export { MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER }

export interface CommissionerGateResult {
  ok: boolean
  reason?: string
  /** Source manager id belonging to the requesting user (when we can resolve it). */
  sourceManagerId?: string | null
  /** How the check passed — lets the persistence layer stamp an audit trail. */
  verification?: 'api' | 'attestation'
  /** True when the provider can't be API-verified and caller must resubmit with attestation. */
  requiresAttestation?: boolean
  /**
   * Whether the requesting user is the source-league commissioner/owner. Set only for
   * providers we can determine it for (Sleeper today). `undefined` = not determined for
   * this provider — a caller requiring a commissioner fails closed only when this is
   * explicitly `false` (Phase 2.2: Sleeper full-league import is commissioner-only).
   */
  isCommissioner?: boolean
  /** True when the source league itself doesn't exist/isn't reachable — maps to 404, not 403. */
  notFound?: boolean
}

export const PROVIDER_LABELS: Partial<Record<ImportProvider, string>> = {
  mfl: 'MFL',
  espn: 'ESPN',
  yahoo: 'Yahoo',
}

export interface AttestationInput {
  /** User explicitly confirmed they are the commissioner/co-commissioner. */
  accepted: boolean
  /** Their free-text statement, stored in the audit trail. */
  statement?: string
  /**
   * Commissioner Import Attestation UI phase — the provider/league the
   * client UI displayed when the user checked the box, echoed back for a
   * consistency check. Never trusted as authoritative on its own (identity,
   * provider, and league are always re-derived server-side from the
   * enclosing request/session) — this only catches a stale UI state (e.g.
   * the user switched leagues without the checkbox resetting, or a
   * malformed/replayed client payload) so it fails closed instead of
   * silently applying one league's attestation to another. Optional: when
   * omitted, only the enclosing request's own `provider`/`sourceLeagueId`
   * govern (unchanged pre-phase behavior for any caller that hasn't
   * upgraded yet).
   */
  confirmedProvider?: ImportProvider
  confirmedSourceLeagueId?: string
}

async function resolveSleeperUserId(appUserId: string): Promise<string | null> {
  const profile = await prisma.userProfile.findFirst({
    where: { userId: appUserId },
    select: { sleeperUserId: true, sleeperUsername: true },
  })
  if (profile?.sleeperUserId) return profile.sleeperUserId
  if (!profile?.sleeperUsername) return null
  try {
    const r = await fetch(`https://api.sleeper.app/v1/user/${encodeURIComponent(profile.sleeperUsername)}`)
    if (!r.ok) return null
    const body = (await r.json()) as { user_id?: string }
    return body?.user_id ?? null
  } catch {
    return null
  }
}

async function checkSleeper(appUserId: string, sourceLeagueId: string): Promise<CommissionerGateResult> {
  const sleeperUserId = await resolveSleeperUserId(appUserId)
  if (!sleeperUserId) {
    return {
      ok: false,
      reason: 'Link your Sleeper account to import from Sleeper — commissioner check requires it.',
    }
  }
  try {
    const r = await fetch(
      `https://api.sleeper.app/v1/league/${encodeURIComponent(sourceLeagueId)}/users`,
    )
    if (!r.ok) {
      return {
        ok: false,
        notFound: r.status === 404,
        reason: r.status === 404
          ? `Sleeper league ${sourceLeagueId} does not exist.`
          : `Sleeper league ${sourceLeagueId} not reachable.`,
      }
    }
    const users = (await r.json()) as Array<{
      user_id: string
      is_owner?: boolean
      metadata?: { is_commissioner?: string | boolean; co_owner?: string | boolean }
    }>
    const me = users.find((u) => u.user_id === sleeperUserId)
    if (!me) {
      return { ok: false, reason: 'You are not a member of that Sleeper league.' }
    }
    // Sleeper marks commissioners with `is_owner: true` (co-commissioners allowed).
    // `metadata.is_commissioner` is unreliable — verified null on real leagues — so it
    // is only a secondary signal, never the sole basis. Fails closed: a member who is
    // neither owner-flagged nor commissioner-flagged resolves to isCommissioner=false.
    const metaCommish = me.metadata?.is_commissioner
    const isCommissioner =
      me.is_owner === true || metaCommish === true || metaCommish === 'true'
    return { ok: true, sourceManagerId: sleeperUserId, verification: 'api', isCommissioner }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'Sleeper commissioner check failed.',
    }
  }
}

async function checkYahoo(appUserId: string, sourceLeagueId: string): Promise<CommissionerGateResult> {
  try {
    const payload = await fetchYahooLeagueForImport(appUserId, sourceLeagueId)
    const viewerTeamKey = payload.viewerTeamKey?.trim() || null
    if (!viewerTeamKey) {
      return {
        ok: false,
        reason: 'Link the Yahoo account that manages this league before importing it.',
      }
    }
    const commissionerTeamKeys = (payload.commissionerTeamKeys ?? []).filter(Boolean)
    const viewerTeam = payload.teams.find((team) => team.teamKey === viewerTeamKey)
    // Use Yahoo's own commissioner list (see checkEspn for semantics).
    const isCommissioner = commissionerTeamKeys.includes(viewerTeamKey) ? true : undefined
    return {
      ok: true,
      sourceManagerId: viewerTeam?.managerGuid ?? viewerTeam?.managerId ?? viewerTeamKey,
      verification: 'api',
      isCommissioner,
    }
  } catch (err) {
    return {
      ok: false,
      // Yahoo Commissioner Import Certification phase — shared provider
      // hardening (Part 8): both fetch services already threw a dedicated
      // not-found error class; only Sleeper's gate mapped it to `notFound`
      // (-> real 404) before this fix. Same normalization applied to ESPN below.
      notFound: err instanceof YahooImportLeagueNotFoundError,
      reason: err instanceof Error ? err.message : 'Yahoo commissioner check failed.',
    }
  }
}

async function checkEspn(appUserId: string, sourceLeagueId: string): Promise<CommissionerGateResult> {
  try {
    const payload = await fetchEspnLeagueForImport(appUserId, sourceLeagueId, {
      includePreviousSeasons: false,
    })
    const viewerTeamId = payload.viewerTeamId?.trim() || null
    if (!viewerTeamId) {
      return {
        ok: false,
        reason: 'Link the ESPN account that manages this league before importing it.',
      }
    }
    const commissionerTeamIds = (payload.commissionerTeamIds ?? []).filter(Boolean)
    const viewerTeam = payload.teams.find((team) => team.teamId === viewerTeamId)
    // Use ESPN's own commissioner list: viewer in it → API-verified commissioner
    // (skips the attestation checkbox). Otherwise leave undefined so the caller
    // still requires the attestation — never hard-blocks a possibly-mis-detected
    // commissioner. (Change `: undefined` to `: false` if you want to hard-block
    // verified NON-commissioners instead.)
    const isCommissioner = commissionerTeamIds.includes(viewerTeamId) ? true : undefined
    return {
      ok: true,
      sourceManagerId: viewerTeam?.managerId ?? viewerTeamId,
      verification: 'api',
      isCommissioner,
    }
  } catch (err) {
    return {
      ok: false,
      notFound: err instanceof EspnImportLeagueNotFoundError,
      reason: err instanceof Error ? err.message : 'ESPN commissioner check failed.',
    }
  }
}

/**
 * Import Security Closure phase — real membership verification via MFL's
 * `TYPE=myleagues` export (see `fetchMflUserLeagues`). Proves the caller's
 * own linked API key is actually associated with the target league —
 * closes the "any authenticated user with any valid key can import any
 * MFL league" gap. Deliberately leaves `isCommissioner` undefined (not
 * `false`): MFL's real API has no commissioner/admin flag, confirmed
 * absent from every real response shape this codebase parses. A caller
 * requiring commissioner status must fall through to the attestation path
 * in `assertImportCommissioner` below — never silently treated as proven.
 */
async function checkMfl(appUserId: string, sourceLeagueId: string): Promise<CommissionerGateResult> {
  const auth = await getDecryptedAuth(appUserId, 'mfl')
  if (!auth?.apiKey) {
    return {
      ok: false,
      reason: 'Save your MFL API key in League Sync before importing from MyFantasyLeague.',
    }
  }
  const { leagueId, season } = parseMflSourceInput(sourceLeagueId)
  try {
    const leagues = await fetchMflUserLeagues(auth.apiKey, season)
    const membership = leagues.find((l) => l.leagueId === leagueId)
    if (!membership) {
      return {
        ok: false,
        reason: 'You are not a member of that MFL league according to your linked API key.',
      }
    }
    return {
      ok: true,
      sourceManagerId: membership.franchiseId,
      verification: 'api',
      // Explicitly undefined, not false — MFL cannot determine this.
      isCommissioner: undefined,
    }
  } catch (err) {
    return {
      ok: false,
      notFound: err instanceof MflImportLeagueNotFoundError,
      reason: err instanceof Error ? err.message : 'MFL commissioner check failed.',
    }
  }
}

/**
 * Providers whose public APIs allow anyone to read league data, so any
 * authenticated user may import them — no membership token required.
 */
export const OPEN_READ_PROVIDERS: readonly ImportProvider[] = [
  'fantrax',
  'fleaflicker',
]

/**
 * Providers a full-league (playable) commit must have a commissioner ATTESTATION for
 * when commissioner status can't be API-verified. Union of:
 *  - MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER (mfl, espn, yahoo): real membership
 *    proven, commissioner unknowable → attest.
 *  - OPEN_READ_PROVIDERS (fantrax, fleaflicker): public read, NO membership proof at all
 *    → attest. Closes the "any authenticated user can import" hole.
 */
export const ATTESTATION_REQUIRED_PROVIDERS: readonly ImportProvider[] = [
  ...MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER,
  ...OPEN_READ_PROVIDERS,
]

export async function assertImportCommissioner(args: {
  appUserId: string
  provider: ImportProvider
  sourceLeagueId: string
  /** Optional self-attestation payload. Recorded when present; not required. */
  attestation?: AttestationInput
  /**
   * Phase 2.2 — when true, a full-league (playable) import is being requested and the
   * requester must be the source-league commissioner.
   *
   * Three real outcomes, per provider:
   *   - `isCommissioner === false` (Sleeper): fails closed immediately — the
   *     provider proved the requester is a member but NOT the commissioner.
   *   - `isCommissioner === undefined` with real membership proven (MFL, from
   *     the Import Security Closure phase): the provider cannot determine
   *     commissioner status at all. Real membership alone is not enough for a
   *     full-league commit — require an explicit, recorded attestation
   *     (`args.attestation.accepted === true`) before proceeding. This is a
   *     genuinely weaker guarantee than API-verified commissioner status and
   *     is always stamped `verification:'attestation'`, never `'api'`, so the
   *     audit trail never overstates what was actually proven.
   *   - `isCommissioner === true` (Sleeper only today): passes through.
   */
  requireCommissioner?: boolean
}): Promise<CommissionerGateResult> {
  const base = await resolveImportGate(args)
  if (!args.requireCommissioner || !base.ok) return base

  if (base.isCommissioner === false) {
    // Member-import (Aug 2026): the provider PROVED the requester is a real
    // member of the source league — just not its commissioner. Hard-blocking
    // members killed the growth loop (most users aren't commish of every
    // league they play in), so a verified member may proceed WITH an explicit
    // recorded attestation. Stamped `verification:'attestation'`, never
    // `'api'`, so the audit trail records that commissioner status was NOT
    // proven. Non-members are still rejected outright by the membership check.
    if (args.attestation?.accepted === true && attestationMatchesThisRequest(args.attestation, args)) {
      return { ...base, verification: 'attestation' }
    }
    return {
      ...base,
      ok: false,
      isCommissioner: false,
      requiresAttestation: true,
      reason:
        'You’re a verified member of this league (not its commissioner). Confirm to import it anyway — your leaguemates can claim their teams, and the commissioner can take it over later.',
    }
  }

  // Scoped explicitly to providers that went through REAL, active membership
  // verification but have no way to determine commissioner status. This
  // phase's own audit found the identical gap in ESPN and Yahoo, not just
  // MFL: `checkEspn`/`checkYahoo` already prove a real linked-account
  // membership but never set `isCommissioner`, and — before this fix — a
  // real member of ANY of these three providers could complete a
  // full-league commit with no commissioner claim at all. Deliberately NOT
  // applied to true open-read providers (Fantrax, Fleaflicker), which never
  // attempt any verification and must keep their existing "any
  // authenticated user" behavior unchanged — extending it there would
  // silently regress a working import path, exactly what this phase's hard
  // guardrails warn against.
  if (
    base.isCommissioner === undefined &&
    base.verification === 'api' &&
    ATTESTATION_REQUIRED_PROVIDERS.includes(args.provider)
  ) {
    if (args.attestation?.accepted === true && attestationMatchesThisRequest(args.attestation, args)) {
      return { ...base, verification: 'attestation' }
    }
    return {
      ...base,
      ok: false,
      requiresAttestation: true,
      reason: `${PROVIDER_LABELS[args.provider] ?? args.provider} cannot verify commissioner status automatically — confirm you are the league commissioner to continue.`,
    }
  }

  return base
}

/**
 * Commissioner Import Attestation UI phase — Part 4 server enforcement.
 * An attestation that echoes a `confirmedProvider`/`confirmedSourceLeagueId`
 * not matching THIS request's own server-derived `provider`/`sourceLeagueId`
 * is rejected outright (fails closed, same as no attestation at all) — this
 * is what makes "attestation for a different provider/league" a real,
 * testable rejection rather than a structurally-impossible no-op. Fields
 * left `undefined` by the caller are not compared (backward compatible with
 * any caller that hasn't been upgraded to send them).
 */
function attestationMatchesThisRequest(
  attestation: AttestationInput,
  args: { provider: ImportProvider; sourceLeagueId: string },
): boolean {
  if (attestation.confirmedProvider !== undefined && attestation.confirmedProvider !== args.provider) {
    return false
  }
  if (
    attestation.confirmedSourceLeagueId !== undefined &&
    attestation.confirmedSourceLeagueId !== args.sourceLeagueId
  ) {
    return false
  }
  return true
}

async function resolveImportGate(args: {
  appUserId: string
  provider: ImportProvider
  sourceLeagueId: string
}): Promise<CommissionerGateResult> {
  if (args.provider === 'sleeper') {
    return checkSleeper(args.appUserId, args.sourceLeagueId)
  }
  if (args.provider === 'yahoo') {
    return checkYahoo(args.appUserId, args.sourceLeagueId)
  }
  if (args.provider === 'espn') {
    return checkEspn(args.appUserId, args.sourceLeagueId)
  }
  if (args.provider === 'mfl') {
    return checkMfl(args.appUserId, args.sourceLeagueId)
  }
  if (OPEN_READ_PROVIDERS.includes(args.provider)) {
    // Public-read providers: any authenticated user can import.
    return { ok: true, verification: 'api' }
  }
  return {
    ok: false,
    reason: `${args.provider} imports are not yet supported.`,
  }
}

/**
 * Import Security Closure phase — Part 10 audit evidence. Records how
 * commissioner status was established for this import — `'api'`
 * (provider-verified, e.g. Sleeper's `is_owner`), `'attestation'`
 * (user-attested, e.g. MFL), or `'membership-only'` (no commissioner claim
 * required for this import, e.g. a preview or a non-full-league Fantrax
 * import) — so the League's own audit trail can always answer "was this
 * provider-verified or user-attested" without inferring it from other
 * fields. Additive: writes into the same `League.settings` JSON bag
 * `recordImportAttestation` already uses, no schema change, no PII/secret
 * values recorded.
 */
export async function recordCommissionerVerificationMethod(args: {
  leagueId: string
  appUserId: string
  provider: ImportProvider
  sourceLeagueId: string
  method: 'api' | 'attestation' | 'membership-only'
  sourceManagerId?: string | null
  /** Commissioner Import Attestation UI phase — the same commit's `runId` (`persistImportWithCanonicalAudit`), so this evidence is traceable to one specific import request. */
  importRunId?: string | null
}): Promise<void> {
  const { prisma } = await import('@/lib/prisma')
  try {
    const current = await prisma.league.findUnique({
      where: { id: args.leagueId },
      select: { settings: true },
    })
    const merged = {
      ...((current?.settings as Record<string, unknown> | null) ?? {}),
      commissionerVerification: {
        appUserId: args.appUserId,
        provider: args.provider,
        sourceLeagueId: args.sourceLeagueId,
        method: args.method,
        sourceManagerId: args.sourceManagerId ?? null,
        importRunId: args.importRunId ?? null,
        recordedAt: new Date().toISOString(),
      },
    }
    await prisma.league.update({
      where: { id: args.leagueId },
      data: { settings: merged as never },
    })
  } catch (err) {
    console.warn('[commissionerGate] commissioner-verification audit write failed:', err)
  }
}

/**
 * Record a commissioner attestation on the newly-imported league so the
 * claim is auditable. Also writes to console.warn for ops visibility.
 */
/**
 * Version tag for the attestation's required legal language
 * (`CommissionerAttestationPanel`'s checkbox label). Bump this whenever that
 * wording changes so a historical attestation record stays distinguishable
 * from what a user would agree to today — the record itself is immutable
 * audit evidence, not something rewritten in place when copy changes.
 */
export const COMMISSIONER_ATTESTATION_TEXT_VERSION = 'v1'

export async function recordImportAttestation(args: {
  leagueId: string
  appUserId: string
  provider: ImportProvider
  sourceLeagueId: string
  attestation: AttestationInput
  /** Commissioner Import Attestation UI phase — same commit's `runId`, for audit traceability. */
  importRunId?: string | null
}): Promise<void> {
  const { leagueId, appUserId, provider, sourceLeagueId, attestation, importRunId } = args
  const { prisma } = await import('@/lib/prisma')
  try {
    const current = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { settings: true },
    })
    const merged = {
      ...((current?.settings as Record<string, unknown> | null) ?? {}),
      commissionerAttestation: {
        appUserId,
        provider,
        sourceLeagueId,
        accepted: attestation.accepted,
        statement: (attestation.statement ?? '').slice(0, 500),
        textVersion: COMMISSIONER_ATTESTATION_TEXT_VERSION,
        importRunId: importRunId ?? null,
        recordedAt: new Date().toISOString(),
      },
    }
    await prisma.league.update({
      where: { id: leagueId },
      data: { settings: merged as never },
    })
  } catch (err) {
    console.warn('[commissionerGate] attestation audit write failed:', err)
  }
}
