/**
 * Commissioner OS · the provider interface. T-201.
 *
 * "One `Provider` interface, one binding model, one sync-job table with status
 * and cursor. Credentials go to a secret store; the DB holds a reference only."
 *
 * ─── 🛑 A PROVIDER NEVER RECEIVES A CREDENTIAL AS A STRING ───────────────────
 * `connect` and `fetch*` take a `SecretRef` — a handle — and resolve it through
 * the injected `SecretStore` at the moment of use. That is not ceremony, and it
 * is the difference between the acceptance test passing by construction and
 * passing by vigilance:
 *
 *   - a credential that is never a parameter cannot be spread into an audit
 *     `before`/`after` by a caller who did not think about it;
 *   - it cannot be captured by a logger that stringifies its arguments;
 *   - it cannot be closed over by a retry wrapper and outlive the request;
 *   - and `ProviderError` below cannot carry one, because the provider never
 *     had one to put there.
 *
 * The root CLAUDE.md records why this matters concretely here: Rolling Insights
 * passes its token as a QUERY PARAMETER, so a naive "log the request URL" leaks
 * a long-lived credential. A provider that only ever holds a handle cannot log
 * the token even if it logs everything it has.
 *
 * ─── AND PROVIDER DATA IS UNTRUSTED ─────────────────────────────────────────
 * Everything returned here crosses a trust boundary. T-203 puts it through a
 * reconciler with a synthetic actor so it can never trigger an action the
 * matrix would deny a human. Nothing in this file writes anything.
 */

import { type DomainError, invariant } from './errors'
import { type Result, err, ok } from './result'

// ─── Secrets ─────────────────────────────────────────────────────────────────

/**
 * A handle, not a secret.
 *
 * Branded so a plain string cannot be passed where a reference is expected —
 * which is what stops someone "simplifying" a call by inlining the token they
 * already have in scope.
 */
declare const SECRET_REF_BRAND: unique symbol
export type SecretRef = string & { readonly [SECRET_REF_BRAND]: true }

export function secretRef(handle: string): SecretRef {
  return handle as SecretRef
}

export type SecretStore = {
  /**
   * Resolve a handle to credential material.
   *
   * ⚠ THE RETURN IS DELIBERATELY NOT `string`. A caller that wants the value
   * has to call `use()`, which scopes it to a callback — so there is no
   * variable holding a token for the rest of a function body, and nothing for a
   * later `JSON.stringify(this)` to find.
   */
  resolve(ref: SecretRef): Promise<ResolvedSecret | null>
}

export type ResolvedSecret = {
  /** Run `fn` with the credential. The value must not escape the callback. */
  use<T>(fn: (value: string) => Promise<T>): Promise<T>
}

/** Wrap a raw value. For tests and for a real store's own implementation. */
export function resolvedSecret(value: string): ResolvedSecret {
  return { use: (fn) => fn(value) }
}

// ─── What a provider returns ─────────────────────────────────────────────────

export type ExternalLeague = {
  readonly externalLeagueId: string
  readonly name: string
  readonly season: string | null
  readonly teamCount: number | null
}

export type ExternalTeam = {
  readonly externalTeamId: string
  readonly name: string
  /** The provider's id for the manager. NOT one of ours — T-203 maps it. */
  readonly externalManagerId: string | null
}

export type ExternalManager = {
  readonly externalManagerId: string
  readonly displayName: string
  /**
   * ⚠ OPTIONAL AND OFTEN ABSENT. Sleeper does not expose manager emails; a
   * reconciler that assumes one is present will silently drop every manager on
   * the platform this phase starts with.
   */
  readonly email: string | null
}

export type ProviderPage<T> = {
  readonly items: readonly T[]
  /** Opaque. Provider-defined; we store it and hand it back, never parse it. */
  readonly nextCursor: string | null
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export type ProviderErrorKind =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'MALFORMED'

/**
 * ⚠ CARRIES A SUMMARY, NEVER A RAW ERROR OR A URL.
 * `summary` is written by the adapter for an operator to read. The provider's
 * own message and the request URL are exactly where credential material shows
 * up, and this type gives them nowhere to live — a field that does not exist
 * cannot be populated by a hurried `catch (e) { summary: String(e) }`.
 */
export type ProviderError = {
  readonly kind: ProviderErrorKind
  readonly summary: string
  /** Whether a later attempt could plausibly succeed. Drives T-204. */
  readonly retryable: boolean
}

export const providerError = (
  kind: ProviderErrorKind,
  summary: string,
  retryable = kind === 'RATE_LIMITED' || kind === 'UNAVAILABLE',
): ProviderError => ({ kind, summary, retryable })

/** Map a provider failure onto the domain vocabulary. */
export function toDomainError(e: ProviderError): DomainError {
  return invariant(`provider.${e.kind.toLowerCase()}`, e.summary)
}

// ─── The interface ───────────────────────────────────────────────────────────

export type ProviderContext = {
  readonly tenantId: string
  readonly secret: ResolvedSecret | null
  readonly cursor: string | null
}

/**
 * One interface, implementable by a stub.
 *
 * Deliberately small. Every method is a READ: a provider is a source, and
 * nothing here can write to the provider or to us. T-203 owns reconciliation
 * and is the only thing that writes.
 */
export type Provider = {
  /** Stable key, matching `LeagueBinding.provider`. */
  readonly key: string
  readonly capabilities: ProviderCapabilities

  /**
   * Confirm a league exists and is reachable with these credentials.
   *
   * Returns the provider's view of it — never a `LeagueBinding`. Constructing
   * the binding is ours, and a provider that could return one could choose its
   * tenantId.
   */
  connect(
    externalLeagueId: string,
    ctx: ProviderContext,
  ): Promise<Result<ExternalLeague, ProviderError>>

  fetchTeams(
    externalLeagueId: string,
    ctx: ProviderContext,
  ): Promise<Result<ProviderPage<ExternalTeam>, ProviderError>>

  fetchManagers(
    externalLeagueId: string,
    ctx: ProviderContext,
  ): Promise<Result<ProviderPage<ExternalManager>, ProviderError>>
}

export type ProviderCapabilities = {
  /** Can we page, or does every sync pull everything? */
  readonly incremental: boolean
  /** Does connecting need a credential at all? Sleeper's read API does not. */
  readonly requiresCredential: boolean
  readonly providesManagerEmail: boolean
}

// ─── Registry ────────────────────────────────────────────────────────────────

export function createProviderRegistry(providers: readonly Provider[]) {
  const byKey = new Map(providers.map((p) => [p.key, p]))

  // A duplicate key silently shadows — the later registration wins and the
  // earlier provider becomes unreachable while still appearing configured.
  if (byKey.size !== providers.length) {
    throw new Error('Duplicate provider keys in the registry.')
  }

  return {
    keys: () => [...byKey.keys()],
    get(key: string): Result<Provider, DomainError> {
      const p = byKey.get(key)
      // Fail closed on an unknown key — a binding naming a provider we do not
      // have is a configuration error, not a reason to guess.
      if (!p) return err(invariant('provider.unknown', `No provider registered for "${key}".`))
      return ok(p)
    },
  }
}

// ─── The stub ────────────────────────────────────────────────────────────────

export type StubProviderOptions = {
  readonly key?: string
  readonly league?: ExternalLeague
  readonly teams?: readonly ExternalTeam[]
  readonly managers?: readonly ExternalManager[]
  readonly failWith?: ProviderError
  readonly capabilities?: Partial<ProviderCapabilities>
  /** Records every credential the stub was actually able to see. */
  readonly credentialSink?: string[]
}

/**
 * A provider that implements the interface with no network.
 *
 * T-201's acceptance: "the interface is implementable by a stub provider used
 * in tests." If the interface cannot be satisfied without a network, every test
 * downstream of it needs one — which is how a suite ends up calling a third
 * party in CI, and T-202 explicitly forbids that.
 *
 * `credentialSink` exists so a test can assert what the provider COULD see,
 * rather than asserting on what it happened to log.
 */
export function createStubProvider(options: StubProviderOptions = {}): Provider {
  const key = options.key ?? 'stub'
  const league: ExternalLeague = options.league ?? {
    externalLeagueId: 'ext-1',
    name: 'Stub League',
    season: '2026',
    teamCount: 2,
  }

  const guard = async (ctx: ProviderContext) => {
    if (options.credentialSink && ctx.secret) {
      await ctx.secret.use(async (value) => {
        options.credentialSink!.push(value)
        return null
      })
    }
    return options.failWith ?? null
  }

  return {
    key,
    capabilities: {
      incremental: true,
      requiresCredential: false,
      providesManagerEmail: false,
      ...options.capabilities,
    },
    async connect(externalLeagueId, ctx) {
      const failure = await guard(ctx)
      if (failure) return err(failure)
      if (externalLeagueId !== league.externalLeagueId) {
        return err(providerError('NOT_FOUND', `No league ${externalLeagueId}.`))
      }
      return ok(league)
    },
    async fetchTeams(_id, ctx) {
      const failure = await guard(ctx)
      if (failure) return err(failure)
      return ok({ items: options.teams ?? [], nextCursor: null })
    },
    async fetchManagers(_id, ctx) {
      const failure = await guard(ctx)
      if (failure) return err(failure)
      return ok({ items: options.managers ?? [], nextCursor: null })
    },
  }
}

// ─── Binding audit ───────────────────────────────────────────────────────────

/**
 * What connecting a league records.
 *
 * ⚠ NO `secretRef`, AND NO SECRET. The reference is omitted as well as the
 * value: it is a pointer to credential material, and putting it in an audit row
 * that an operator can read and export tells them exactly which handle to ask
 * for. The audit answers "which league was connected to which provider", which
 * is the whole question it is there for.
 */
export function bindingAuditDraft(args: {
  bindingId: string
  leagueId: string
  provider: string
  externalLeagueId: string
}) {
  return {
    action: 'league.binding.connect',
    resourceType: 'LeagueBinding',
    resourceId: args.bindingId,
    leagueId: args.leagueId,
    after: {
      provider: args.provider,
      externalLeagueId: args.externalLeagueId,
    },
  }
}
