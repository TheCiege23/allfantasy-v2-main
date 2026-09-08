/**
 * The convention that keeps a scheduled job out of an FK-constrained user column.
 *
 * 🛑 THIS PINS A BUG THAT ONLY A REAL DATABASE COULD SHOW. Measured 2026-09-07
 * in the first end-to-end season run this repo has done: the scheduled
 * postseason roller crowned a champion, then `enterRedraftOffseason` died on
 * `audit_logs_userId_fkey` because it wrote `system:week-roller` into
 * `audit_logs.userId`. The league was left at `completed` — no `LeagueSeason`
 * archive, no `FranchiseSeason` rows, no offseason — and the failure was
 * swallowed, because the archive step is deliberately non-fatal so a crowned
 * champion is never lost to it.
 *
 * Every unit suite covering that path mocks Prisma, and a mock has no foreign
 * keys. So these tests cannot reproduce the failure; what they CAN do is pin the
 * rule that prevents it, cheaply, on every ordinary run.
 */
import { describe, expect, it } from 'vitest'

import { SYSTEM_ACTOR_PREFIX, auditUserId, isSystemActor } from '@/lib/league/systemActor'

describe('isSystemActor', () => {
  it('recognises the scheduled actors this repo actually uses', () => {
    expect(isSystemActor('system:week-roller')).toBe(true)
    expect(isSystemActor(`${SYSTEM_ACTOR_PREFIX}anything`)).toBe(true)
  })

  it('does not claim a real user id', () => {
    // A cuid/uuid must pass through — narrowing a real commissioner to null
    // would silently erase attribution on every manual action.
    expect(isSystemActor('cmtrufkxh000mxdchicj8hef2')).toBe(false)
    expect(isSystemActor('e9199460-42f6-46e8-84b9-2644bb096238')).toBe(false)
    expect(isSystemActor(null)).toBe(false)
    expect(isSystemActor(undefined)).toBe(false)
  })
})

describe('auditUserId', () => {
  it('nulls a system actor, which is what the nullable column means', () => {
    expect(auditUserId('system:week-roller')).toBeNull()
  })

  it('passes a real user through untouched', () => {
    expect(auditUserId('cmtrufkxh000mxdchicj8hef2')).toBe('cmtrufkxh000mxdchicj8hef2')
  })

  it('treats absent and empty as null rather than writing a blank string', () => {
    // '' is not a valid AppUser id either — it would violate the same FK.
    expect(auditUserId(null)).toBeNull()
    expect(auditUserId(undefined)).toBeNull()
    expect(auditUserId('')).toBeNull()
  })
})
