/**
 * Commissioner OS · the DomainError union and its HTTP mapping. T-003.
 *
 * `CLAUDE.md`: "Half of perceived admin-tool quality is refusals that explain
 * themselves — 'pause the draft first' with a working Pause button, not a red
 * `Forbidden` toast."
 *
 * That line is the design brief for this file, and it is why each variant
 * carries structured fields rather than a message string. A caller cannot render
 * a Pause button from prose. `WRONG_PHASE` says which phase it wanted and which
 * it found; `REASON_REQUIRED` says which rule the reason broke and what the
 * minimum is. The human-readable sentence is derived from those fields, never
 * the other way round.
 *
 * ⚠ NOTHING HERE MAY CARRY A TENANT ID INTO AN HTTP BODY. See `toHttpResponse`.
 */

import { TENANT_MISMATCH } from './errorCodes'

export { TENANT_MISMATCH } from './errorCodes'

// ─── The union ───────────────────────────────────────────────────────────────

/** The actor is not permitted this action. Authorization said no. */
export type ForbiddenError = {
  readonly code: 'FORBIDDEN'
  /** The `ActionKey` that was denied. Safe to show — it is our vocabulary. */
  readonly action: string
  /** Optional operator-facing explanation. Never include another tenant's data. */
  readonly because?: string
}

/** The resource is in the wrong lifecycle phase for this action. */
export type WrongPhaseError = {
  readonly code: 'WRONG_PHASE'
  readonly action: string
  readonly actual: string
  readonly expected: readonly string[]
  /**
   * What the operator can do about it, as an action key the UI can turn into a
   * button — e.g. `draft.pause`. This field is the entire point of the variant.
   */
  readonly remedy?: string
}

/** A domain rule would be violated. Not a permission problem and not a race. */
export type InvariantError = {
  readonly code: 'INVARIANT'
  /** Short stable identifier, e.g. `roster.slotsExceeded`. */
  readonly invariant: string
  readonly detail: string
}

/** The action requires a reason and the one supplied does not qualify. */
export type ReasonRequiredError = {
  readonly code: 'REASON_REQUIRED'
  readonly action: string
  /**
   * Which rule failed. T-004 owns the validator and the stoplist; this type
   * only has to be able to REPORT its verdict, so the variants are named here
   * and the thresholds travel with the error rather than being duplicated.
   */
  readonly problem: 'MISSING' | 'TOO_SHORT' | 'ECHOES_ACTION' | 'STOPLISTED'
  readonly minLength: number
}

/** The tenant's plan does not include this. A billing answer, not a security one. */
export type NotEntitledError = {
  readonly code: 'NOT_ENTITLED'
  /** e.g. `maxLeagues`, `maxSeats`, `apiRateLimit` — a `Tenant` column name. */
  readonly limit: string
  readonly planKey: string
  readonly current?: number
  readonly allowed?: number
}

/** Someone else changed it first. The only variant that is worth retrying. */
export type ConflictError = {
  readonly code: 'CONFLICT'
  readonly resource: string
  readonly detail: string
}

/**
 * `withTenant(b)` inside an open `withTenant(a)`.
 *
 * ⚠ THE ODD ONE OUT: this is a BUG AT THE CALL SITE, never something the caller
 * did. Every other variant describes a legitimate request that was refused; this
 * one describes code that would have silently read tenant A's rows while
 * believing it was reading tenant B's. It maps to 500, not 4xx.
 */
export type TenantMismatchDomainError = {
  readonly code: typeof TENANT_MISMATCH
  readonly outerTenantId: string
  readonly innerTenantId: string
}

export type DomainError =
  | ForbiddenError
  | WrongPhaseError
  | InvariantError
  | ReasonRequiredError
  | NotEntitledError
  | ConflictError
  | TenantMismatchDomainError

export type DomainErrorCode = DomainError['code']

/**
 * Every code, as data.
 *
 * `__tests__/commissioner-os/domainErrors.test.ts` iterates this to assert one
 * HTTP mapping per variant. Without it, adding an eighth variant and forgetting
 * its mapping produces a test suite that still passes — it would simply never
 * ask about the new one. The exhaustiveness check in `toHttpResponse` catches
 * the same omission at compile time; this catches it in a test that reports
 * WHICH one, which is the difference between a red build and a diagnosis.
 */
export const DOMAIN_ERROR_CODES = [
  'FORBIDDEN',
  'WRONG_PHASE',
  'INVARIANT',
  'REASON_REQUIRED',
  'NOT_ENTITLED',
  'CONFLICT',
  TENANT_MISMATCH,
] as const satisfies readonly DomainErrorCode[]

// ─── Constructors ────────────────────────────────────────────────────────────
// Thin, but they make the `code` unforgeable at call sites and keep the literal
// strings in one file.

export const forbidden = (action: string, because?: string): ForbiddenError => ({
  code: 'FORBIDDEN',
  action,
  ...(because === undefined ? {} : { because }),
})

export const wrongPhase = (
  action: string,
  actual: string,
  expected: readonly string[],
  remedy?: string,
): WrongPhaseError => ({
  code: 'WRONG_PHASE',
  action,
  actual,
  expected,
  ...(remedy === undefined ? {} : { remedy }),
})

export const invariant = (invariantName: string, detail: string): InvariantError => ({
  code: 'INVARIANT',
  invariant: invariantName,
  detail,
})

export const reasonRequired = (
  action: string,
  problem: ReasonRequiredError['problem'],
  minLength: number,
): ReasonRequiredError => ({ code: 'REASON_REQUIRED', action, problem, minLength })

export const notEntitled = (
  limit: string,
  planKey: string,
  bounds?: { current?: number; allowed?: number },
): NotEntitledError => ({ code: 'NOT_ENTITLED', limit, planKey, ...bounds })

export const conflict = (resource: string, detail: string): ConflictError => ({
  code: 'CONFLICT',
  resource,
  detail,
})

export const tenantMismatch = (
  outerTenantId: string,
  innerTenantId: string,
): TenantMismatchDomainError => ({
  code: TENANT_MISMATCH,
  outerTenantId,
  innerTenantId,
})

// ─── The throwable carrier ───────────────────────────────────────────────────

/**
 * Thrown when `withTenant(b, …)` is called inside an already-open
 * `withTenant(a, …)`.
 *
 * A THROW rather than a returned `Result`, and that is not an inconsistency
 * with the "errors are returned" convention — see the note at the top of
 * `result.ts`. A Prisma interactive transaction commits unless its callback
 * throws, so returning here would report the mismatch and commit the writes
 * anyway.
 *
 * Re-entry reuses the OUTER transaction, which carries `app.tenant_id = a`. So
 * proceeding would run tenant B's callback against tenant A's RLS scope: every
 * read returns A's rows, every write lands in A, no error, no audit signal.
 * Nesting across tenants is always a bug at the call site.
 */
export class TenantMismatchError extends Error {
  readonly code = TENANT_MISMATCH

  constructor(
    readonly outerTenantId: string,
    readonly innerTenantId: string,
  ) {
    super(
      `TENANT_MISMATCH: withTenant(${innerTenantId}) called inside an open withTenant(${outerTenantId}). ` +
        `The inner call would silently run under the outer tenant's RLS scope.`,
    )
    this.name = 'TenantMismatchError'
  }

  /** For the boundary that turns a thrown error back into a `Result`. */
  toDomainError(): TenantMismatchDomainError {
    return tenantMismatch(this.outerTenantId, this.innerTenantId)
  }
}

// ─── HTTP mapping ────────────────────────────────────────────────────────────

export type HttpErrorResponse = {
  readonly status: number
  readonly body: {
    readonly error: {
      readonly code: DomainErrorCode
      readonly message: string
      /** Structured, client-safe. Absent rather than empty when there is none. */
      readonly details?: Record<string, unknown>
      /** Worth trying the same request again. Only `CONFLICT` is. */
      readonly retryable: boolean
    }
  }
}

/**
 * Map a `DomainError` to an HTTP response.
 *
 * 🛑 THE BODY IS AN ALLOWLIST, NOT A SPREAD.
 * Every variant's fields are named explicitly rather than `...error`. A spread
 * would ship `outerTenantId`/`innerTenantId` to the client the moment
 * `TENANT_MISMATCH` fired — leaking one operator's tenant id into another's
 * browser, from the one error whose whole meaning is that a tenant boundary was
 * crossed. It would also silently start leaking any field added to any variant
 * later, which is worse: the mistake would be made by someone editing a
 * different file.
 */
export function toHttpResponse(error: DomainError): HttpErrorResponse {
  switch (error.code) {
    case 'FORBIDDEN':
      return {
        status: 403,
        body: {
          error: {
            code: error.code,
            message: error.because ?? `You do not have permission to ${error.action}.`,
            details: { action: error.action },
            retryable: false,
          },
        },
      }

    case 'WRONG_PHASE':
      // 409, not 400: the request is well-formed and would be valid in another
      // phase. 400 would tell the client to fix its payload, which is wrong
      // advice and sends people editing the wrong thing.
      return {
        status: 409,
        body: {
          error: {
            code: error.code,
            message: `Cannot ${error.action} while ${error.actual}. Expected: ${error.expected.join(' or ')}.`,
            details: {
              action: error.action,
              actual: error.actual,
              expected: error.expected,
              ...(error.remedy ? { remedy: error.remedy } : {}),
            },
            retryable: false,
          },
        },
      }

    case 'INVARIANT':
      return {
        status: 422,
        body: {
          error: {
            code: error.code,
            message: error.detail,
            details: { invariant: error.invariant },
            retryable: false,
          },
        },
      }

    case 'REASON_REQUIRED':
      return {
        status: 400,
        body: {
          error: {
            code: error.code,
            message: reasonMessage(error),
            details: { action: error.action, problem: error.problem, minLength: error.minLength },
            retryable: false,
          },
        },
      }

    case 'NOT_ENTITLED':
      // 402 rather than 403. The distinction is load-bearing for an operator:
      // 403 means "you may never do this", 402 means "your plan does not include
      // it yet" — different screens, different next click. TENANCY.md §7 requires
      // a plan change to need no deploy, so this must be legible as a plan issue.
      return {
        status: 402,
        body: {
          error: {
            code: error.code,
            message: `Your plan (${error.planKey}) does not allow this: ${error.limit}.`,
            details: {
              limit: error.limit,
              planKey: error.planKey,
              ...(error.current === undefined ? {} : { current: error.current }),
              ...(error.allowed === undefined ? {} : { allowed: error.allowed }),
            },
            retryable: false,
          },
        },
      }

    case 'CONFLICT':
      return {
        status: 409,
        body: {
          error: {
            code: error.code,
            message: error.detail,
            details: { resource: error.resource },
            // The only retryable variant: re-reading and re-submitting can
            // legitimately succeed. Everything else would fail identically.
            retryable: true,
          },
        },
      }

    case TENANT_MISMATCH:
      // 500, and DELIBERATELY OPAQUE. This is our bug, not the caller's — there
      // is no request they could have sent that avoids it, so a 4xx would be a
      // lie that sends an operator hunting their own payload. No details field:
      // both tenant ids stay server-side. They are in the thrown error's message
      // for the log, and that is where they belong.
      return {
        status: 500,
        body: {
          error: {
            code: error.code,
            message: 'Internal error.',
            retryable: false,
          },
        },
      }

    default: {
      // Exhaustiveness. Adding a variant without a mapping fails to compile
      // here rather than falling through to a 500 at runtime.
      const unhandled: never = error
      throw new Error(`Unhandled DomainError: ${JSON.stringify(unhandled)}`)
    }
  }
}

function reasonMessage(error: ReasonRequiredError): string {
  switch (error.problem) {
    case 'MISSING':
      return `This action requires a reason (at least ${error.minLength} characters).`
    case 'TOO_SHORT':
      return `That reason is too short — at least ${error.minLength} characters.`
    case 'ECHOES_ACTION':
      return 'That reason just repeats the action. Say why.'
    case 'STOPLISTED':
      return 'That reason is a placeholder. Say why.'
  }
}
