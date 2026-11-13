/**
 * Commissioner OS · Result. T-003.
 *
 * `CLAUDE.md`: "Errors are typed, not thrown. Domain methods return
 * `Result<T, DomainError>`."
 *
 * ⚠ THE ONE PLACE THIS RULE DOES NOT APPLY IS INSIDE `withTenant`.
 * A Prisma interactive transaction commits unless the callback THROWS. A domain
 * method that returns `err(...)` from inside one has described a failure and
 * committed it anyway. So a mutation that must not persist has to throw across
 * the transaction boundary (T-004's wrapper owns that translation), and only
 * then become a `Result` on the way out.
 *
 * That is not a wart in the convention, it is where the convention meets a
 * database, and it is worth stating because "return errors, never throw" read
 * literally produces silent data corruption exactly once.
 */

export type Ok<T> = { readonly ok: true; readonly value: T }
export type Err<E> = { readonly ok: false; readonly error: E }

/**
 * Defaulted to `DomainError` so call sites read `Result<League>` rather than
 * `Result<League, DomainError>`. Widening E is possible but should be rare — an
 * error that is not a `DomainError` has no HTTP mapping and no audit shape.
 */
export type Result<T, E = import('./errors').DomainError> = Ok<T> | Err<E>

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error }
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok
}

