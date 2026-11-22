/**
 * Sign in with a text code (2026-11-14). Only a VERIFIED phone number is a way in, the
 * start step never reveals whether a number has an account, and an unknown number is
 * never texted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const profiles = new Map<string, { userId: string; phoneVerifiedAt: Date | null }>()
const users = new Map<string, { id: string; email: string; displayName: string | null; username: string; avatarUrl: string | null }>()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: { findUnique: vi.fn(async ({ where }: { where: { phone: string } }) => profiles.get(where.phone) ?? null) },
    appUser: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null) },
  },
}))

const budget = { success: true }
vi.mock('@/lib/security/sharedRateLimit', () => ({
  consumeSharedRateLimit: vi.fn(async () => budget),
  clearSharedRateLimit: vi.fn(async () => undefined),
}))

const restricted = new Set<string>()
vi.mock('@/lib/moderation/accountSuspension', () => ({
  ACCOUNT_SUSPENDED_ERROR: 'ACCOUNT_SUSPENDED',
  activeAccountRestriction: vi.fn(async (id: string) => (restricted.has(id) ? { kind: 'ban' } : null)),
}))

const sends: { to: string }[] = []
let checkStatus = 'approved'
vi.mock('@/lib/twilio-client', () => ({
  getTwilioClient: () => ({
    verify: {
      v2: {
        services: () => ({
          verifications: { create: vi.fn(async (input: { to: string }) => { sends.push(input) }) },
          verificationChecks: { create: vi.fn(async () => ({ status: checkStatus })) },
        }),
      },
    },
  }),
}))

import { authorizePhoneCode, startPhoneCodeSignIn } from '@/lib/auth/phoneCodeSignIn'

beforeEach(() => {
  profiles.clear()
  users.clear()
  sends.length = 0
  restricted.clear()
  checkStatus = 'approved'
  budget.success = true
  process.env.TWILIO_VERIFY_SERVICE_SID = 'VA_test'
  users.set('u1', { id: 'u1', email: 'pat@example.com', displayName: 'Pat', username: 'pat', avatarUrl: null })
  profiles.set('+12015550123', { userId: 'u1', phoneVerifiedAt: new Date('2026-10-01') })
  users.set('u2', { id: 'u2', email: 'sam@example.com', displayName: null, username: 'sam', avatarUrl: null })
  profiles.set('+12015550199', { userId: 'u2', phoneVerifiedAt: null })
})

describe('startPhoneCodeSignIn', () => {
  it('texts a verified number, normalising a typed US number to the stored key', async () => {
    expect(await startPhoneCodeSignIn('(201) 555-0123')).toEqual({ ok: true })
    expect(sends).toEqual([{ to: '+12015550123', channel: 'sms' }])
  })

  it('answers the same for an unknown or unverified number, and texts neither', async () => {
    expect(await startPhoneCodeSignIn('2015550100')).toEqual({ ok: true })
    expect(await startPhoneCodeSignIn('2015550199')).toEqual({ ok: true })
    expect(sends).toEqual([])
  })

  it('rejects a malformed number and reports an unconfigured Verify service', async () => {
    expect(await startPhoneCodeSignIn('12')).toEqual({ ok: false, error: 'INVALID_PHONE' })
    delete process.env.TWILIO_VERIFY_SERVICE_SID
    expect(await startPhoneCodeSignIn('2015550123')).toEqual({ ok: false, error: 'PHONE_VERIFY_NOT_CONFIGURED' })
  })
})

describe('authorizePhoneCode', () => {
  it('signs in the verified account with a correct code', async () => {
    expect(await authorizePhoneCode('201-555-0123', '123 456')).toEqual({
      id: 'u1', email: 'pat@example.com', name: 'Pat', username: 'pat', image: null,
    })
  })

  it('refuses a wrong code, an unverified number, an unknown number and a spent budget', async () => {
    checkStatus = 'pending'
    expect(await authorizePhoneCode('2015550123', '000000')).toBeNull()
    checkStatus = 'approved'
    expect(await authorizePhoneCode('2015550199', '123456')).toBeNull()
    expect(await authorizePhoneCode('2015550100', '123456')).toBeNull()
    budget.success = false
    expect(await authorizePhoneCode('2015550123', '123456')).toBeNull()
  })

  it('refuses a code that is not digits before calling Twilio', async () => {
    expect(await authorizePhoneCode('2015550123', 'abc')).toBeNull()
  })

  it('a suspended account is told so only after the code checks out', async () => {
    restricted.add('u1')
    await expect(authorizePhoneCode('2015550123', '123456')).rejects.toThrow('ACCOUNT_SUSPENDED')
  })
})
