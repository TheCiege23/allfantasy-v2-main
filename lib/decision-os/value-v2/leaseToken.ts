import { randomBytes as nodeRandomBytes } from 'node:crypto'

/**
 * Lease tokens for the window checkpoint work queue.
 *
 * ⚠ A STABLE WORKER ID CANNOT BE THE LEASE IDENTITY. With one, this sequence silently
 * corrupts state: worker A claims, A stalls, the lease expires, A (or B) re-claims, and A's
 * in-flight COMPLETE still matches `lease_owner = 'worker-A'` against a lease it no longer
 * holds. Every claim ATTEMPT therefore mints a new token, and 128 bits of randomness make
 * an old token unable to match a newly acquired lease.
 *
 * The worker id survives only as a diagnostic prefix. It is never the identity.
 */

/** `lease_owner VARCHAR(64)` in the checkpoint table. */
export const LEASE_TOKEN_MAX_LENGTH = 64
export const LEASE_WORKER_PREFIX_MAX_LENGTH = 8
export const LEASE_TOKEN_RANDOM_BYTES = 16 // 128 bits

/** base64url plus the separator — safe in SQL, URLs and logs. */
export const LEASE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,8}-[0-9a-z]+-[A-Za-z0-9_-]{22}$/

export interface LeaseTokenDeps {
  /** Injected for deterministic tests. Production uses `node:crypto`. */
  randomBytes: (size: number) => Uint8Array
  /** Epoch milliseconds. Injected for deterministic tests. */
  now: () => number
}

export const defaultLeaseTokenDeps: LeaseTokenDeps = {
  randomBytes: (size) => nodeRandomBytes(size),
  now: () => Date.now(),
}

export class InvalidWorkerIdError extends Error {
  constructor(readonly workerId: string, reason: string) {
    super(`Invalid lease worker id ${JSON.stringify(workerId)}: ${reason}`)
    this.name = 'InvalidWorkerIdError'
  }
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Normalizes a worker id to the diagnostic prefix.
 *
 * Rejects rather than silently mangling: an id that normalizes to nothing would produce a
 * token whose prefix is empty, and a malformed token is worse than a refused claim.
 */
export function normalizeWorkerId(workerId: string): string {
  if (typeof workerId !== 'string') throw new InvalidWorkerIdError(String(workerId), 'not a string')
  const trimmed = workerId.trim()
  if (!trimmed) throw new InvalidWorkerIdError(workerId, 'empty')
  const cleaned = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!cleaned) throw new InvalidWorkerIdError(workerId, 'contains no alphanumeric characters')
  return cleaned.slice(0, LEASE_WORKER_PREFIX_MAX_LENGTH)
}

/**
 * A fresh token for one claim invocation.
 *
 * Every row claimed by a single CLAIM shares this token; a LATER claim by the same worker
 * gets a new one. That is what makes an expired-then-reacquired lease a different identity.
 */
export function newLeaseToken(workerId: string, deps: LeaseTokenDeps = defaultLeaseTokenDeps): string {
  const prefix = normalizeWorkerId(workerId)
  const when = Math.floor(deps.now()).toString(36)
  const random = deps.randomBytes(LEASE_TOKEN_RANDOM_BYTES)
  if (random.length !== LEASE_TOKEN_RANDOM_BYTES) {
    throw new Error(`lease token requires ${LEASE_TOKEN_RANDOM_BYTES} random bytes, received ${random.length}`)
  }
  const token = `${prefix}-${when}-${toBase64Url(random)}`
  if (token.length > LEASE_TOKEN_MAX_LENGTH) {
    throw new Error(`lease token length ${token.length} exceeds ${LEASE_TOKEN_MAX_LENGTH}`)
  }
  return token
}

export function isLeaseToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= LEASE_TOKEN_MAX_LENGTH
    && LEASE_TOKEN_PATTERN.test(value)
}

/**
 * ⚠ NEVER LOG A FULL LEASE TOKEN in ordinary application logs. A logged token is a
 * transferable claim on a checkpoint row: anything that can read the log can write a
 * transition as that worker. Log this instead — the prefix identifies the worker, and the
 * suffix is enough to correlate two lines without reconstructing the token.
 */
export function redactLeaseToken(token: string): string {
  if (typeof token !== 'string' || !token) return '<invalid>'
  const prefix = token.split('-')[0] ?? '<none>'
  return `${prefix}-…${token.slice(-4)}`
}
