/**
 * Commissioner OS · T-003 acceptance — "unit tests cover each `DomainError`
 * variant round-tripping to an HTTP response shape".
 *
 * The word doing the work in that criterion is EACH. A suite that maps six of
 * seven variants passes just as green as one that maps all seven, so the tests
 * below are driven off `DOMAIN_ERROR_CODES` and assert coverage explicitly
 * rather than trusting that every variant got a `describe` block.
 */

import { describe, it, expect } from 'vitest'
import {
  DOMAIN_ERROR_CODES,
  TENANT_MISMATCH,
  TenantMismatchError,
  type DomainError,
  type DomainErrorCode,
  conflict,
  forbidden,
  invariant,
  notEntitled,
  reasonRequired,
  tenantMismatch,
  toHttpResponse,
  wrongPhase,
} from '@/lib/domain/errors'

/** One specimen per variant, keyed by code so coverage is checkable. */
const SPECIMENS: Record<DomainErrorCode, DomainError> = {
  FORBIDDEN: forbidden('league.settings.update'),
  WRONG_PHASE: wrongPhase('draft.pick', 'DRAFTING', ['PAUSED'], 'draft.pause'),
  INVARIANT: invariant('roster.slotsExceeded', 'That roster already has 3 QBs; the limit is 2.'),
  REASON_REQUIRED: reasonRequired('league.rollbackWeek', 'TOO_SHORT', 12),
  NOT_ENTITLED: notEntitled('maxLeagues', 'trial', { current: 5, allowed: 5 }),
  CONFLICT: conflict('League', 'The league moved to POSTSEASON while you were editing.'),
  [TENANT_MISMATCH]: tenantMismatch('tenant-a', 'tenant-b'),
}

describe('T-003 · DomainError', () => {
  it('has a specimen for every code in the union', () => {
    // Guards the guard. If a variant is added to DOMAIN_ERROR_CODES without a
    // specimen, every data-driven test below would silently skip it.
    expect(Object.keys(SPECIMENS).sort()).toEqual([...DOMAIN_ERROR_CODES].sort())
  })

  it.each([...DOMAIN_ERROR_CODES])('%s maps to a well-formed HTTP response', (code) => {
    const res = toHttpResponse(SPECIMENS[code])

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(600)
    expect(res.body.error.code).toBe(code)
    expect(res.body.error.message.length).toBeGreaterThan(0)
    expect(typeof res.body.error.retryable).toBe('boolean')
  })

  it.each([...DOMAIN_ERROR_CODES])('%s survives JSON serialization unchanged', (code) => {
    // The body crosses a Next.js route boundary as JSON. A field that does not
    // round-trip (undefined, a Set, a BigInt) reaches the client as something
    // other than what the mapping returned, and the mapping is what the tests
    // above assert on.
    const res = toHttpResponse(SPECIMENS[code])
    expect(JSON.parse(JSON.stringify(res.body))).toEqual(res.body)
  })

  describe('status codes are chosen, not defaulted', () => {
    it.each([
      ['FORBIDDEN', 403],
      ['WRONG_PHASE', 409],
      ['INVARIANT', 422],
      ['REASON_REQUIRED', 400],
      ['NOT_ENTITLED', 402],
      ['CONFLICT', 409],
      [TENANT_MISMATCH, 500],
    ] as const)('%s → %i', (code, status) => {
      expect(toHttpResponse(SPECIMENS[code]).status).toBe(status)
    })

    it('NOT_ENTITLED is 402, not 403 — a plan problem, not a permission one', () => {
      // Different screens and a different next click for the operator: 403 says
      // "you may never", 402 says "not on this plan yet".
      expect(toHttpResponse(SPECIMENS.NOT_ENTITLED).status).not.toBe(403)
    })

    it('CONFLICT is the only retryable variant', () => {
      const retryable = DOMAIN_ERROR_CODES.filter(
        (c) => toHttpResponse(SPECIMENS[c]).body.error.retryable,
      )
      expect(retryable).toEqual(['CONFLICT'])
    })
  })

  describe('TENANT_MISMATCH does not leak tenant ids', () => {
    // The one error whose entire meaning is that a tenant boundary was crossed
    // is also the one that must not put either tenant id in a response body.
    // toHttpResponse allowlists fields rather than spreading, and this is what
    // notices if someone "simplifies" it to a spread.
    const res = toHttpResponse(SPECIMENS[TENANT_MISMATCH])
    const serialized = JSON.stringify(res.body)

    it('omits both ids from the body', () => {
      expect(serialized).not.toContain('tenant-a')
      expect(serialized).not.toContain('tenant-b')
    })

    it('carries no details object at all', () => {
      expect(res.body.error.details).toBeUndefined()
    })

    it('is a 500 — our bug, not the caller\'s', () => {
      // A 4xx would send an operator hunting their own payload for a fault
      // there is no request they could have sent to avoid.
      expect(res.status).toBe(500)
      expect(res.body.error.message).toBe('Internal error.')
    })
  })

  describe('no variant leaks an unexpected field into the body', () => {
    it.each([...DOMAIN_ERROR_CODES])('%s body has only the allowlisted keys', (code) => {
      const { error } = toHttpResponse(SPECIMENS[code]).body
      expect(Object.keys(error).sort()).toEqual(
        error.details === undefined
          ? ['code', 'message', 'retryable']
          : ['code', 'details', 'message', 'retryable'],
      )
    })
  })

  describe('actionable payloads', () => {
    it('WRONG_PHASE carries the remedy the UI turns into a button', () => {
      // CLAUDE.md: "pause the draft first" with a working Pause button, not a
      // red Forbidden toast. A caller cannot render a button from prose.
      const { body } = toHttpResponse(SPECIMENS.WRONG_PHASE)
      expect(body.error.details).toMatchObject({
        actual: 'DRAFTING',
        expected: ['PAUSED'],
        remedy: 'draft.pause',
      })
      expect(body.error.message).toContain('PAUSED')
    })

    it('REASON_REQUIRED reports which rule failed and the threshold', () => {
      const { body } = toHttpResponse(SPECIMENS.REASON_REQUIRED)
      expect(body.error.details).toMatchObject({ problem: 'TOO_SHORT', minLength: 12 })
      expect(body.error.message).toContain('12')
    })

    it('NOT_ENTITLED names the limit and the plan', () => {
      const { body } = toHttpResponse(SPECIMENS.NOT_ENTITLED)
      expect(body.error.details).toMatchObject({ limit: 'maxLeagues', planKey: 'trial' })
    })
  })

  describe('TenantMismatchError, the throwable carrier', () => {
    it('converts to the matching union member', () => {
      const thrown = new TenantMismatchError('tenant-a', 'tenant-b')
      expect(thrown.toDomainError()).toEqual(tenantMismatch('tenant-a', 'tenant-b'))
    })

    it('is a real Error, so it aborts a Prisma transaction', () => {
      // The reason this one variant is thrown rather than returned: an
      // interactive transaction commits unless its callback throws. Returning
      // would report the mismatch and commit the writes anyway.
      const thrown = new TenantMismatchError('tenant-a', 'tenant-b')
      expect(thrown).toBeInstanceOf(Error)
      expect(thrown.code).toBe(TENANT_MISMATCH)
    })

    it('keeps both ids on the error for the log', () => {
      const thrown = new TenantMismatchError('tenant-a', 'tenant-b')
      expect(thrown.message).toContain('tenant-a')
      expect(thrown.message).toContain('tenant-b')
    })
  })
})
