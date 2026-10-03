// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Recording terms / disclaimer / privacy acceptance (owner's call, 2026-10-03). Until then sign-up
 * required the boxes but stored nothing, so "when did this user agree, and to which version?" had
 * no answer. These pin: what is written, that a failure never blocks the flow that called it, and
 * that the record reaches "Download my data".
 */

import { recordLegalAcceptances } from '@/lib/legal/recordLegalAcceptance'
import { LEGAL_LAST_UPDATED_BY_PAGE } from '@/lib/legal/legalVersions'

const NOW = new Date('2026-10-03T12:00:00Z')

function fakeDb(fail?: Error & { code?: string }) {
  const createMany = vi.fn(async (_args: { data: Array<Record<string, unknown>> }) => {
    if (fail) throw fail
    return { count: _args.data.length }
  })
  return { db: { legalAcceptance: { createMany } } as never, createMany }
}

let errors: string[] = []
beforeEach(() => {
  errors = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  })
})
afterEach(() => vi.restoreAllMocks())

describe('recordLegalAcceptances', () => {
  it('writes one row per document, stamped with the version the user saw', async () => {
    const { db, createMany } = fakeDb()
    expect(await recordLegalAcceptances('u-1', ['terms', 'disclaimer'], 'signup', { db, now: NOW })).toBe(true)
    expect(createMany.mock.calls[0][0].data).toEqual([
      { userId: 'u-1', document: 'terms', documentVersion: LEGAL_LAST_UPDATED_BY_PAGE.terms, source: 'signup', acceptedAt: NOW },
      {
        userId: 'u-1',
        document: 'disclaimer',
        documentVersion: LEGAL_LAST_UPDATED_BY_PAGE.disclaimer,
        source: 'signup',
        acceptedAt: NOW,
      },
    ])
  })

  it('a repeated document is one row, and nothing at all is written for no documents', async () => {
    const { db, createMany } = fakeDb()
    await recordLegalAcceptances('u-1', ['terms', 'terms'], 'age_prompt', { db, now: NOW })
    expect(createMany.mock.calls[0][0].data).toHaveLength(1)
    expect(await recordLegalAcceptances('u-1', [], 'signup', { db })).toBe(false)
    expect(await recordLegalAcceptances('', ['terms'], 'signup', { db })).toBe(false)
    expect(createMany).toHaveBeenCalledTimes(1)
  })

  it('NEVER throws — a missing table (migration not yet applied) returns false and logs the code only', async () => {
    const err = Object.assign(new Error('Invalid `prisma.legalAcceptance.createMany()` invocation: userId "u-secret-1"'), {
      code: 'P2021',
    })
    const { db } = fakeDb(err)
    await expect(recordLegalAcceptances('u-secret-1', ['terms'], 'signup', { db })).resolves.toBe(false)
    expect(errors.join('\n')).toMatch(/code=P2021/)
    // Prisma's message echoes the arguments; the log line must not.
    expect(errors.join('\n')).not.toContain('u-secret-1')
  })
})

// ── the age prompt's route ────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  userId: 'u-age' as string | null,
  upserts: 0,
  createMany: vi.fn(async () => ({ count: 2 })),
}))
vi.mock('next-auth', () => ({ getServerSession: async () => (h.userId ? { user: { id: h.userId } } : null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: {
      upsert: async () => {
        h.upserts++
        return {}
      },
    },
    legalAcceptance: { createMany: h.createMany },
  },
}))

import { POST as confirmAge } from '@/app/api/auth/confirm-age/route'

describe('POST /api/auth/confirm-age', () => {
  beforeEach(() => {
    h.userId = 'u-age'
    h.upserts = 0
    h.createMany.mockClear()
    h.createMany.mockImplementation(async () => ({ count: 2 }))
  })

  it('records the Terms and Privacy Policy the prompt asks the user to agree to', async () => {
    const res = await confirmAge()
    expect(res.status).toBe(200)
    expect(h.upserts).toBe(1)
    const data = (h.createMany.mock.calls[0] as unknown as [{ data: Array<{ document: string; source: string }> }])[0].data
    expect(data.map((r) => r.document)).toEqual(['terms', 'privacy'])
    expect(data.every((r) => r.source === 'age_prompt')).toBe(true)
  })

  it('a failed record does not turn a confirmed age into an error', async () => {
    h.createMany.mockImplementation(async () => {
      throw Object.assign(new Error('relation "legal_acceptances" does not exist'), { code: 'P2021' })
    })
    const res = await confirmAge()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('records nothing for a signed-out caller', async () => {
    h.userId = null
    expect((await confirmAge()).status).toBe(401)
    expect(h.createMany).not.toHaveBeenCalled()
  })
})

// ── sign-up (the route is source-checked here, as the other register tests do) ─────────────

describe('sign-up records the agreements it requires', () => {
  const src = readFileSync(path.join(process.cwd(), 'app/api/auth/register/route.ts'), 'utf8')

  it('records terms + disclaimer as "signup"', () => {
    expect(src).toMatch(/recordLegalAcceptances\(user\.id, \["terms", "disclaimer"\], "signup"\)/)
  })

  it('only AFTER the boxes were validated and the account exists', () => {
    const at = src.indexOf('recordLegalAcceptances(user.id')
    expect(src.indexOf('validateAgreementAcceptance({')).toBeGreaterThan(-1)
    expect(at).toBeGreaterThan(src.indexOf('validateAgreementAcceptance({'))
    expect(at).toBeGreaterThan(src.indexOf('const createAccountOnce'))
  })
})

describe('the version a user agrees to is the version the page shows', () => {
  it('LegalPageShell reads its stamps from the same table the recorder stamps with', () => {
    const shell = readFileSync(path.join(process.cwd(), 'components/legal/LegalPageShell.tsx'), 'utf8')
    expect(shell).toMatch(/from "@\/lib\/legal\/legalVersions"/)
    // No second copy of the table left behind in the component.
    expect(shell).not.toMatch(/terms:\s*"[A-Z][a-z]+ \d{4}"/)
  })
})
