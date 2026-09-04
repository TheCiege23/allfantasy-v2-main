/**
 * Fantasy OS — resolve a fresh normalized payload for ONE connected league, whatever its provider.
 *
 * ── THE ONE PROBLEM GENERALISING THE COLLECTOR ACTUALLY CREATED ──────────────────────
 *
 * Everything else in the collector was already provider-neutral. This is not, and cannot be:
 *
 *   sleeper, fleaflicker   keyless public reads, and UNOWNED. Anyone can refresh any league.
 *   fantrax                unauthenticated `fxea` reads — no credential — but the refresh reads a
 *                          STORED SNAPSHOT whose `appUserId` is checked by a fail-closed ownership
 *                          gate, so it still needs an importing USER.
 *   espn, yahoo, mfl       need a credential stored against a specific AllFantasy user.
 *
 * 🛑 SO THE BRANCH BELOW ASKS `providerNeedsUser`, NOT `providerNeedsCredential`. It used to ask
 * the credential question, which put Fantrax on the no-user path and made the pipeline refuse it
 * with "Sign in before importing from Fantrax." forever — see USER_SCOPED_PROVIDERS in ./types
 * for the production measurement. "Needs a key" and "needs an owner" are different questions and
 * Fantrax is the provider where they diverge.
 *
 * And a connection is not one user. `League` is keyed `(userId, platform, platformLeagueId,
 * season)`, so the same external league is mirrored by a row per importing manager — the
 * collector deliberately collapses those to ONE run key so a refresh costs one provider read.
 * Which means the question "whose credentials do we use?" has no single answer, and some of the
 * candidates will have revoked, expired or never-working ones.
 *
 * So: try the mirrors in turn, bounded, and treat a credential failure as "ask the next one"
 * rather than as a failed run. A league where nobody has working credentials is SKIPPED with an
 * honest note — never guessed at, and never reported as a provider outage.
 *
 * ⚠ THIS IS THE SAME SHAPE `externalMatchupParity` ALREADY USES, AND THAT IS DELIBERATE. That
 * collector solved this for its own narrow schedule fetch; this generalises the idea to the full
 * normalized refresh rather than inventing a second convention beside it.
 *
 * ⚠ CLASSIFY BY CODE, NEVER BY MESSAGE. `runImportedLeagueNormalizationPipeline` returns a
 * typed code, and the distinctions matter enormously here:
 *
 *   CONNECTION_REQUIRED / UNAUTHORIZED   this user's credential is no good  → try the next
 *   LEAGUE_NOT_FOUND                     the league is gone                 → stop, skip, note it
 *   PROVIDER_UNAVAILABLE                 throttled / 5xx / timeout          → THROW, so the
 *                                        runner records the scope incomplete, does not advance
 *                                        freshness, and retries later
 *
 * That third one is why the import path's typed-error work had to land first. Without it a
 * throttle arrived as "League not found", and the collector would have quietly skipped a live
 * league on a transient failure — the same wrong diagnosis, now on a schedule.
 */

import { runImportedLeagueNormalizationPipeline } from '@/lib/league-import/ImportedLeagueNormalizationPipeline'
import type { NormalizedImportResult } from '@/lib/league-import/types'
import { prisma } from '@/lib/prisma'
/*
 * BOTH questions are asked in this file, deliberately: `providerNeedsUser` decides whether to
 * attribute the read to an importing user at all, `providerNeedsCredential` decides whether a
 * stored `leagueAuth` row is a precondition. Fantrax answers yes to the first and no to the second.
 */
import { providerNeedsCredential, providerNeedsUser, type LeagueSyncConnection } from './types'

/**
 * Bound on credential probes per league.
 *
 * A popular league can have a dozen importing users, and probing every one on every heartbeat
 * turns one league's refresh into a dozen provider round trips — most of them failing. Three is
 * the same bound `externalMatchupParity` settled on.
 */
export const MAX_USER_CANDIDATES = 3

/**
 * No mirror of this league has credentials that work.
 *
 * ⚠ DISTINCT FROM A PROVIDER FAILURE ON PURPOSE. This is a durable, structural condition — it
 * will be just as true on the next heartbeat — so the caller records it as a skip with a reason
 * rather than a failure that inflates `consecutiveFailures` and triggers retry backoff against
 * a provider that is behaving perfectly well.
 */
export class SyncCredentialsUnavailableError extends Error {
  readonly provider: string
  readonly candidatesTried: number

  constructor(message: string, options: { provider: string; candidatesTried: number }) {
    super(message)
    this.name = 'SyncCredentialsUnavailableError'
    this.provider = options.provider
    this.candidatesTried = options.candidatesTried
  }
}

/** The league is no longer readable at the provider — not a credential problem, not transient. */
export class SyncLeagueGoneError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncLeagueGoneError'
  }
}

/**
 * Importing users who might hold a working credential for this connection, in import order.
 *
 * Oldest first: the original importer is the likeliest to still be a member, and for ESPN the
 * likeliest to hold the cookies that were captured at import time.
 */
export async function resolveCredentialCandidates(
  connection: LeagueSyncConnection,
): Promise<string[]> {
  const rows = await prisma.league
    .findMany({
      where: {
        platform: connection.provider,
        platformLeagueId: connection.externalLeagueId,
        season: connection.season,
      },
      select: { userId: true },
      orderBy: { createdAt: 'asc' },
    })
    .catch(() => [] as { userId: string }[])

  const seen = new Set<string>()
  const out: string[] = []
  for (const row of rows) {
    const userId = String(row.userId ?? '').trim()
    if (!userId || seen.has(userId)) continue
    seen.add(userId)
    out.push(userId)
  }
  return out
}

/**
 * Which of this connection's importing users have a STORED credential of the right shape.
 *
 * ⚠ THIS IS A PRE-FLIGHT, NOT A VALIDATION, AND THE DIFFERENCE IS THE POINT. It asks a
 * database, never the provider. A league where nobody ever connected ESPN is a durable,
 * structural fact — it will be equally true next heartbeat — so the collector should skip it
 * with a reason and spend nothing. Discovering that by attempting a provider read would cost a
 * request per candidate per heartbeat, forever, to learn something a `SELECT` already knows.
 *
 * ⚠ A STORED CREDENTIAL THAT NO LONGER WORKS IS DELIBERATELY NOT FILTERED HERE. Only the
 * provider can say that, and when it happens the run SHOULD surface as a failure — someone's
 * ESPN cookies expiring is a real problem a manager can fix, and silently skipping it forever
 * would hide a league going stale behind a reassuring "not due".
 *
 * The per-provider shape check matters: a `leagueAuth` row can exist with the wrong column
 * populated (an ESPN row carrying only an `apiKey`, say), and counting that as a credential
 * would send us to the provider to be refused.
 */
export async function resolveStoredCredentialUserIds(
  connection: LeagueSyncConnection,
): Promise<string[]> {
  if (!providerNeedsCredential(connection.provider)) return []
  const candidates = await resolveCredentialCandidates(connection)
  if (candidates.length === 0) return []

  const rows = await prisma.leagueAuth
    .findMany({
      where: { platform: connection.provider, userId: { in: candidates } },
      select: { userId: true, apiKey: true, oauthToken: true, espnSwid: true, espnS2: true },
    })
    .catch(() => [] as Array<{
      userId: string
      apiKey: string | null
      oauthToken: string | null
      espnSwid: string | null
      espnS2: string | null
    }>)

  const usable = new Set<string>()
  for (const row of rows) {
    const ok =
      connection.provider === 'espn'
        ? Boolean(row.espnSwid && row.espnS2)
        : connection.provider === 'yahoo'
          ? Boolean(row.oauthToken)
          : Boolean(row.apiKey) // mfl
    if (ok) usable.add(row.userId)
  }

  /* Preserve import order — `resolveCredentialCandidates` returns oldest first, and that is the
     order the loader probes in. */
  return candidates.filter((userId) => usable.has(userId))
}

/**
 * Fetch + normalize the CURRENT state of one connected league.
 *
 * Throws on every path the runner should treat as "do not advance freshness":
 *   - `SyncCredentialsUnavailableError` when no mirror's credential works,
 *   - `SyncLeagueGoneError` when the provider says the league is not there,
 *   - a plain Error for a provider outage, which the runner retries.
 */
export async function fetchNormalizedForConnection(
  connection: LeagueSyncConnection,
  deps: {
    /** Injectable for tests; production uses the canonical pipeline. */
    runPipeline?: typeof runImportedLeagueNormalizationPipeline
    resolveCandidates?: (c: LeagueSyncConnection) => Promise<string[]>
    maxCandidates?: number
  } = {},
): Promise<NormalizedImportResult> {
  const runPipeline = deps.runPipeline ?? runImportedLeagueNormalizationPipeline
  const maxCandidates = deps.maxCandidates ?? MAX_USER_CANDIDATES

  /*
   * An UNOWNED provider takes the no-user path directly. Resolving candidates for it would be a
   * wasted query, and — worse — such a league whose only importing user was deleted would then
   * skip for want of a credential it never needed.
   */
  if (!providerNeedsUser(connection.provider)) {
    const result = await runPipeline({
      provider: connection.provider,
      sourceId: connection.externalLeagueId,
      currentStateOnly: true,
    })
    if (result.success) return result.normalized
    if (result.code === 'LEAGUE_NOT_FOUND') {
      throw new SyncLeagueGoneError(`${connection.provider}: ${result.error}`)
    }
    /* PROVIDER_UNAVAILABLE and anything else are retryable — the runner decides. */
    throw new Error(`${connection.provider} normalize failed: ${result.error}`)
  }

  const resolveCandidates = deps.resolveCandidates ?? resolveCredentialCandidates
  const candidates = (await resolveCandidates(connection)).slice(0, maxCandidates)

  if (candidates.length === 0) {
    throw new SyncCredentialsUnavailableError(
      `${connection.provider}: no importing user remains for this league, so there is no credential to read it with`,
      { provider: connection.provider, candidatesTried: 0 },
    )
  }

  let lastCredentialNote: string | null = null

  for (const userId of candidates) {
    const result = await runPipeline({
      provider: connection.provider,
      sourceId: connection.externalLeagueId,
      userId,
      currentStateOnly: true,
    })
    if (result.success) return result.normalized

    if (result.code === 'CONNECTION_REQUIRED' || result.code === 'UNAUTHORIZED') {
      /* This user's stored credential does not unlock the league — ask the next mirror. */
      lastCredentialNote = result.error
      continue
    }
    if (result.code === 'LEAGUE_NOT_FOUND') {
      /*
       * ⚠ NOT WORTH TRYING ANOTHER USER. For a credentialed provider "not found" and "you
       * cannot see it" are frequently the same HTTP answer, but the pipeline has already
       * mapped a 401/403 to CONNECTION_REQUIRED above — so reaching here means the provider
       * distinguished them and said the league is gone. Probing two more users would be two
       * more requests for an answer we have.
       */
      throw new SyncLeagueGoneError(`${connection.provider}: ${result.error}`)
    }
    /*
     * PROVIDER_UNAVAILABLE or an unclassified failure. Throw rather than trying the next
     * candidate: the provider is struggling, and hammering it with two more full league reads
     * is the opposite of what a throttle asks for. The runner retries the whole scope later.
     */
    throw new Error(`${connection.provider} normalize failed: ${result.error}`)
  }

  throw new SyncCredentialsUnavailableError(
    lastCredentialNote ??
      `${connection.provider}: no importing user with working credentials for this league`,
    { provider: connection.provider, candidatesTried: candidates.length },
  )
}
