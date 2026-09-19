import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  leagueFindFirst: vi.fn(),
  threadMemberFindFirst: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@vercel/blob', () => ({ put: mocks.put, get: mocks.get }))
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
    vi.stubEnv('CHAT_PRIVATE_BLOB_READ_WRITE_TOKEN', 'test-token')
    mocks.requireAuth.mockResolvedValue({ ok: true, userId: 'me' })
    mocks.threadMemberFindFirst.mockResolvedValue({ id: 'm1' })
    mocks.put.mockResolvedValue({ url: 'https://blob/a.png', pathname: 'chat/thread/t1/image/a.png' })
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
    expect(mocks.put).toHaveBeenCalledWith(expect.any(String), expect.anything(), expect.objectContaining({ access: 'private' }))
    expect((await res.json()).url).toMatch(/^\/api\/chat\/upload\?path=/)
    expect(mocks.threadMemberFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { threadId: 't1', userId: 'me', isBlocked: false } }),
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

  it('rechecks membership when an attachment is opened', async () => {
    mocks.threadMemberFindFirst.mockResolvedValue(null)
    const { GET } = await import('@/app/api/chat/upload/route')
    const res = await GET({ nextUrl: new URL('https://example.test/api/chat/upload?path=chat/thread/t1/image/a.png') } as never)
    expect(res.status).toBe(403)
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('does not publicly cache an authorized download', async () => {
    mocks.get.mockResolvedValue({ statusCode: 200, stream: new ReadableStream({ start(c) { c.close() } }), blob: { contentType: 'image/png' } })
    const { GET } = await import('@/app/api/chat/upload/route')
    const res = await GET({ nextUrl: new URL('https://example.test/api/chat/upload?path=chat/thread/t1/image/a.png') } as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('rejects traversal before accessing storage', async () => {
    const { GET } = await import('@/app/api/chat/upload/route')
    const res = await GET({ nextUrl: new URL('https://example.test/api/chat/upload?path=chat/thread/t1/image/../secret') } as never)
    expect(res.status).toBe(400)
    expect(mocks.get).not.toHaveBeenCalled()
  })
})
