import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireVerifiedUser: vi.fn(),
  leagueFindFirst: vi.fn(),
  threadMemberFindFirst: vi.fn(),
  put: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: mocks.requireVerifiedUser }))
vi.mock('@vercel/blob', () => ({ put: mocks.put }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: mocks.leagueFindFirst },
    platformChatThreadMember: { findFirst: mocks.threadMemberFindFirst },
  },
}))

function upload(fields: Record<string, string>) {
  const fd = new Map<string, unknown>(Object.entries(fields))
  fd.set('file', new File(['x'], 'a.png', { type: 'image/png' }))
  return { formData: async () => ({ get: (k: string) => fd.get(k) ?? null }) } as never
}

describe('POST /api/chat/upload — DM and huddle attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The route 503s without it; uploads need this set in production too.
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-token')
    mocks.requireVerifiedUser.mockResolvedValue({ ok: true, userId: 'me' })
    mocks.threadMemberFindFirst.mockResolvedValue({ id: 'm1' })
    mocks.put.mockResolvedValue({ url: 'https://blob/a.png' })
  })

  /*
   * The route required a leagueId and 400'd without one, so attaching an image
   * in a DM failed with "leagueId required" — a message about a concept that
   * chat does not have.
   */
  it('accepts an upload authorised by thread membership', async () => {
    const { POST } = await import('@/app/api/chat/upload/route')
    const res = await POST(upload({ type: 'image', threadId: 't1' }))

    expect(res.status).toBe(200)
    expect(mocks.threadMemberFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { threadId: 't1', userId: 'me' } }),
    )
  })

  /* Prove membership, never merely that the thread exists. */
  it('refuses a thread the caller is not in', async () => {
    mocks.threadMemberFindFirst.mockResolvedValue(null)
    const { POST } = await import('@/app/api/chat/upload/route')
    const res = await POST(upload({ type: 'image', threadId: 't1' }))

    expect(res.status).toBe(403)
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it('still requires one of the two scopes', async () => {
    const { POST } = await import('@/app/api/chat/upload/route')
    const res = await POST(upload({ type: 'image' }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/leagueId or threadId required/i)
  })

  it('leaves league uploads gated on league access', async () => {
    mocks.leagueFindFirst.mockResolvedValue(null)
    const { POST } = await import('@/app/api/chat/upload/route')
    const res = await POST(upload({ type: 'image', leagueId: 'lg1' }))

    expect(res.status).toBe(403)
    expect(mocks.threadMemberFindFirst).not.toHaveBeenCalled()
  })
})
