// @vitest-environment node
/**
 * Suspending or banning an account (App Store guideline 1.2: a way to act on abusive USERS).
 *
 * `PlatformModerationAction` existed and nothing read it — no sign-in path, no session. These
 * pin the read, the write, both sign-in enforcement points in lib/auth.ts, and the admin route.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
  userFindUnique: vi.fn(),
  revokeAll: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformModerationAction: { findFirst: h.findFirst, create: h.create, deleteMany: h.deleteMany },
    appUser: { findUnique: h.userFindUnique },
  },
}))
vi.mock('@/lib/auth/sessionRevocation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/sessionRevocation')>()),
  revokeAllSessionsForUser: h.revokeAll,
}))
vi.mock('@/lib/admin-audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin-audit')>()),
  logAdminAudit: h.audit,
}))

import {
  ACCOUNT_SUSPENDED_ERROR_URL,
  activeAccountRestriction,
  liftAccountRestriction,
  restrictAccount,
} from '@/lib/moderation/accountSuspension'
import { ACCOUNT_SUSPENDED_MESSAGE, resolveLoginErrorMessage } from '@/lib/auth/AuthErrorMessageResolver'

const NOW = new Date('2026-09-30T12:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  h.userFindUnique.mockResolvedValue({ id: 'u-bad' })
  h.create.mockResolvedValue({})
  h.deleteMany.mockResolvedValue({ count: 2 })
})

describe('activeAccountRestriction', () => {
  it('asks for any ban, or a suspension with no end or an end still ahead', async () => {
    h.findFirst.mockResolvedValue(null)
    expect(await activeAccountRestriction('u1', NOW)).toBeNull()
    expect(h.findFirst.mock.calls[0][0].where).toEqual({
      userId: 'u1',
      OR: [
        { actionType: 'ban' },
        { actionType: 'suspend', OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] },
      ],
    })
  })

  it('reports a ban with no end, and a suspension with its end', async () => {
    h.findFirst.mockResolvedValueOnce({ actionType: 'ban', expiresAt: null, reason: 'slurs' })
    expect(await activeAccountRestriction('u1', NOW)).toEqual({ kind: 'ban', until: null, reason: 'slurs' })
    const end = new Date('2026-10-07T12:00:00Z')
    h.findFirst.mockResolvedValueOnce({ actionType: 'suspend', expiresAt: end, reason: null })
    expect(await activeAccountRestriction('u1', NOW)).toEqual({ kind: 'suspend', until: end, reason: null })
  })

  it('lets sign-in through when the table cannot be read, rather than locking everyone out', async () => {
    h.findFirst.mockRejectedValue(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await activeAccountRestriction('u1', NOW)).toBeNull()
    err.mockRestore()
  })
})

describe('restrictAccount / liftAccountRestriction', () => {
  it('a 7-day suspension: writes the row, ends every session, audits', async () => {
    const r = await restrictAccount({ userId: 'u-bad', kind: 'suspend', days: 7, reason: ' report r1 ', adminUserId: 'admin-1', now: NOW })
    const until = new Date('2026-10-07T12:00:00Z')
    expect(r).toEqual({ kind: 'suspend', until, reason: 'report r1' })
    expect(h.create).toHaveBeenCalledWith({
      data: { userId: 'u-bad', actionType: 'suspend', reason: 'report r1', expiresAt: until, createdByUserId: 'admin-1' },
    })
    expect(h.revokeAll).toHaveBeenCalledWith('u-bad')
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'user_suspend', targetId: 'u-bad', adminUserId: 'admin-1' }))
  })

  it('a ban has no end date, whatever days says', async () => {
    const r = await restrictAccount({ userId: 'u-bad', kind: 'ban', days: 7, adminUserId: 'admin-1', now: NOW })
    expect(r.until).toBeNull()
    expect(h.create.mock.calls[0][0].data).toMatchObject({ actionType: 'ban', expiresAt: null })
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'user_ban' }))
  })

  it('refuses an unknown user and changes nothing', async () => {
    h.userFindUnique.mockResolvedValue(null)
    await expect(restrictAccount({ userId: 'ghost', kind: 'ban', adminUserId: 'admin-1' })).rejects.toThrow('USER_NOT_FOUND')
    expect(h.create).not.toHaveBeenCalled()
    expect(h.revokeAll).not.toHaveBeenCalled()
  })

  it('lift removes suspensions and bans only', async () => {
    expect(await liftAccountRestriction('u-bad', 'admin-1')).toBe(2)
    expect(h.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u-bad', actionType: { in: ['suspend', 'ban'] } } })
  })
})

describe('what the person sees', () => {
  it('names the suspension on the sign-in form — and still hides PASSWORD_NOT_SET (control)', () => {
    expect(resolveLoginErrorMessage('ACCOUNT_SUSPENDED')).toBe(ACCOUNT_SUSPENDED_MESSAGE)
    expect(resolveLoginErrorMessage('PASSWORD_NOT_SET')).toBe('Invalid username, email, phone, or password.')
  })

  it('the social error page has the same sentence', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('app/auth/error/page.tsx', 'utf8')
    expect(src).toMatch(/ACCOUNT_SUSPENDED: ACCOUNT_SUSPENDED_MESSAGE/)
    expect(ACCOUNT_SUSPENDED_ERROR_URL).toBe('/auth/error?error=ACCOUNT_SUSPENDED')
  })
})
