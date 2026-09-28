// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /messages photo privacy — `POST /api/shared/chat/upload`.
 *
 * 🛑 WHAT WAS WRONG. The route wrote every upload to PUBLIC Vercel Blob storage and checked
 * no league or thread membership, so anyone holding the link could open a photo posted in a
 * DM or a league room. The drawer's `/api/chat/upload` already did it right: private storage,
 * a membership check, served back through an authenticated reader with `nosniff`.
 *
 * These tests are BEHAVIOURAL: they run the real routes and the real `privateStorage` module,
 * with only the storage SDKs and prisma mocked, and assert on what reached storage — the
 * bucket/key/access mode — not merely on a status code.
 */

const state = vi.hoisted(() => ({
  /** The NextAuth session user, or null for an anonymous request. */
  sessionUserId: null as string | null,
  /** What the legacy Sleeper-cookie resolver would return; only the pre-fix route read it. */
  legacyUserId: null as string | null,
  threadMembers: {} as Record<string, string[]>,
  leagues: {} as Record<string, { userId: string; claimed: string[] }>,
  bracketMembers: {} as Record<string, string[]>,
}))

const mocks = vi.hoisted(() => ({
  s3Send: vi.fn(),
  s3Destroy: vi.fn(),
  blobPut: vi.fn(),
  blobGet: vi.fn(),
}))

vi.mock('@/lib/auth-guard', async () => {
  const { NextResponse } = await import('next/server')
  return {
    requireAuth: vi.fn(async () =>
      state.sessionUserId
        ? { ok: true, userId: state.sessionUserId, session: { user: { id: state.sessionUserId } } }
        : { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) },
    ),
  }
})

vi.mock('@/lib/platform/current-user', () => ({
  resolvePlatformUser: vi.fn(async () => ({
    appUserId: state.sessionUserId ?? state.legacyUserId,
    legacyUsername: state.legacyUserId ? 'legacy' : null,
  })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformChatThreadMember: {
      findFirst: vi.fn(async ({ where }: { where: { threadId: string; userId: string } }) =>
        (state.threadMembers[where.threadId] ?? []).includes(where.userId) ? { id: 'tm' } : null,
      ),
    },
    league: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        const l = state.leagues[where.id]
        return l ? { id: where.id, userId: l.userId, teams: l.claimed.map((c) => ({ claimedByUserId: c })) } : null
      }),
    },
    bracketLeagueMember: {
      findUnique: vi.fn(async ({ where }: { where: { leagueId_userId: { leagueId: string; userId: string } } }) =>
        (state.bracketMembers[where.leagueId_userId.leagueId] ?? []).includes(where.leagueId_userId.userId)
          ? { id: 'bm' }
          : null,
      ),
    },
  },
}))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = mocks.s3Send
    destroy = mocks.s3Destroy
  },
  PutObjectCommand: class { kind = 'put'; constructor(public input: Record<string, unknown>) {} },
  GetObjectCommand: class { kind = 'get'; constructor(public input: Record<string, unknown>) {} },
}))

vi.mock('@vercel/blob', () => ({ put: mocks.blobPut, get: mocks.blobGet }))

const S3_CONFIG = JSON.stringify({
  endpoint: 'https://private-storage.example.test',
  region: 'auto',
  bucketName: 'private-chat',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
})

function uploadRequest(fields: Record<string, string>, file: File | null = new File(['png-bytes'], 'photo.png', { type: 'image/png' })) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  if (file) fd.append('file', file)
  return new Request('https://example.test/api/shared/chat/upload', { method: 'POST', body: fd }) as never
}

function readRequest(url: string) {
  return { nextUrl: new URL(url, 'https://example.test') } as never
}

const s3Commands = (kind: 'put' | 'get') =>
  mocks.s3Send.mock.calls.map((c) => c[0]).filter((cmd: { kind?: string }) => cmd.kind === kind)

function nothingStored() {
  expect(s3Commands('put')).toHaveLength(0)
  expect(mocks.blobPut).not.toHaveBeenCalled()
}

async function sharedPOST() {
  return (await import('@/app/api/shared/chat/upload/route')).POST
}
async function readerGET() {
  return (await import('@/app/api/chat/upload/route')).GET
}

beforeEach(() => {
  vi.clearAllMocks()
  state.sessionUserId = 'member'
  state.legacyUserId = null
  state.threadMembers = { t1: ['member'] }
  state.leagues = { lg1: { userId: 'owner', claimed: ['member'] } }
  state.bracketMembers = { bk1: ['member'] }
  // Production's backend. The public Blob token is ALSO set, so a route that still wrote
  // publicly would succeed here rather than 503 — which is what makes "nothing stored" mean it.
  vi.stubEnv('CHAT_PRIVATE_S3_CONFIG', S3_CONFIG)
  vi.stubEnv('CHAT_PRIVATE_BLOB_READ_WRITE_TOKEN', '')
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_public_test')
  mocks.s3Send.mockImplementation(async (cmd: { kind: string }) =>
    cmd.kind === 'get'
      ? { ContentType: 'image/png', Body: { transformToWebStream: () => new Blob(['png-bytes']).stream() } }
      : {},
  )
  mocks.blobPut.mockImplementation(async (key: string) => ({ url: `https://public.blob.example.test/${key}`, pathname: key }))
})

afterEach(() => vi.unstubAllEnvs())

describe('who may upload', () => {
  it('refuses a signed-in user who is not in the thread, and stores nothing', async () => {
    state.sessionUserId = 'stranger'
    const res = await (await sharedPOST())(uploadRequest({ threadId: 't1' }))
    expect(res.status).toBe(403)
    nothingStored()
  })

  it('refuses a non-member of a league room, and stores nothing', async () => {
    state.sessionUserId = 'stranger'
    const res = await (await sharedPOST())(uploadRequest({ threadId: 'league:lg1' }))
    expect(res.status).toBe(403)
    nothingStored()
  })

  it('refuses an anonymous upload, and stores nothing', async () => {
    state.sessionUserId = null
    const res = await (await sharedPOST())(uploadRequest({ threadId: 't1' }))
    expect(res.status).toBe(401)
    nothingStored()
  })

  it('refuses an upload carried only by the legacy Sleeper cookie — the reader requires a session', async () => {
    state.sessionUserId = null
    state.legacyUserId = 'member'
    const res = await (await sharedPOST())(uploadRequest({ threadId: 't1' }))
    expect(res.status).toBe(401)
    nothingStored()
  })

  it('refuses an upload that names no chat at all', async () => {
    const res = await (await sharedPOST())(uploadRequest({}))
    expect(res.status).toBe(400)
    nothingStored()
  })

  it.each([
    ['SVG', new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })],
    ['HTML', new File(['<html></html>'], 'x.html', { type: 'text/html' })],
  ])('still refuses %s from a member', async (_label, file) => {
    const res = await (await sharedPOST())(uploadRequest({ threadId: 't1' }, file))
    expect(res.status).toBe(400)
    nothingStored()
  })

  it('still refuses an image over 5MB', async () => {
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })
    const res = await (await sharedPOST())(uploadRequest({ threadId: 't1' }, big))
    expect(res.status).toBe(400)
    nothingStored()
  })
})

describe('where a member upload goes', () => {
  it('stores a DM photo PRIVATELY (S3 bucket, thread-scoped key) and hands back only the authenticated reader URL', async () => {
    const res = await (await sharedPOST())(uploadRequest({ threadId: 't1' }))
    expect(res.status).toBe(200)

    const puts = s3Commands('put')
    expect(puts).toHaveLength(1)
    const input = puts[0].input as { Bucket: string; Key: string; ContentType: string; CacheControl: string }
    expect(input.Bucket).toBe('private-chat')
    expect(input.Key).toMatch(/^chat\/thread\/t1\/image\/[0-9a-f-]{36}\.png$/)
    expect(input.ContentType).toBe('image/png')
    expect(input.CacheControl).toBe('private, no-store')
    // Never the public store.
    expect(mocks.blobPut).not.toHaveBeenCalled()

    const body = await res.json()
    expect(body.url).toBe(`/api/chat/upload?path=${encodeURIComponent(input.Key)}`)
    expect(body.url).not.toMatch(/^https?:/)
  })

  it('on the private-Blob fallback, writes with access "private", never "public"', async () => {
    vi.stubEnv('CHAT_PRIVATE_S3_CONFIG', '')
    vi.stubEnv('CHAT_PRIVATE_BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_private_test')
    const res = await (await sharedPOST())(uploadRequest({ threadId: 't1' }))
    expect(res.status).toBe(200)
    expect(mocks.blobPut).toHaveBeenCalledTimes(1)
    const [key, , options] = mocks.blobPut.mock.calls[0]
    expect(key).toMatch(/^chat\/thread\/t1\/image\//)
    expect(options).toMatchObject({ access: 'private', token: 'vercel_blob_rw_private_test' })
  })

  it('scopes a main-league room photo to the league, the same prefix the drawer uses', async () => {
    const res = await (await sharedPOST())(uploadRequest({ threadId: 'league:lg1' }))
    expect(res.status).toBe(200)
    expect((s3Commands('put')[0].input as { Key: string }).Key).toMatch(/^chat\/lg1\/image\//)
  })

  it('scopes a bracket-pool room photo to the bracket league', async () => {
    const res = await (await sharedPOST())(uploadRequest({ threadId: 'league:bk1' }))
    expect(res.status).toBe(200)
    expect((s3Commands('put')[0].input as { Key: string }).Key).toMatch(/^chat\/bracket\/bk1\/image\//)
  })
})

describe('who may open it', () => {
  async function uploadAsMember(threadId: string, file?: File) {
    state.sessionUserId = 'member'
    const res = await (await sharedPOST())(uploadRequest({ threadId }, file))
    expect(res.status).toBe(200)
    const { url } = await res.json()
    expect(url).toMatch(/^\/api\/chat\/upload\?path=/)
    mocks.s3Send.mockClear()
    return url as string
  }

  it('refuses a DM photo to a signed-in non-member without touching storage', async () => {
    const url = await uploadAsMember('t1')
    state.sessionUserId = 'stranger'
    const res = await (await readerGET())(readRequest(url))
    expect(res.status).toBe(403)
    expect(s3Commands('get')).toHaveLength(0)
  })

  it('refuses it to an anonymous request', async () => {
    const url = await uploadAsMember('t1')
    state.sessionUserId = null
    const res = await (await readerGET())(readRequest(url))
    expect(res.status).toBe(401)
    expect(s3Commands('get')).toHaveLength(0)
  })

  it('refuses a league-room photo to someone outside the league', async () => {
    const url = await uploadAsMember('league:lg1')
    state.sessionUserId = 'stranger'
    const res = await (await readerGET())(readRequest(url))
    expect(res.status).toBe(403)
  })

  it('refuses a bracket-room photo to someone outside the pool, and serves it to a member', async () => {
    const url = await uploadAsMember('league:bk1')
    state.sessionUserId = 'stranger'
    expect((await (await readerGET())(readRequest(url))).status).toBe(403)
    state.sessionUserId = 'member'
    expect((await (await readerGET())(readRequest(url))).status).toBe(200)
  })

  it('serves it to a member, privately and with nosniff', async () => {
    const url = await uploadAsMember('t1')
    const res = await (await readerGET())(readRequest(url))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Disposition')).toBe('inline')
    expect(await res.text()).toBe('png-bytes')
  })

  it('serves a document attachment as a download, not inline', async () => {
    const url = await uploadAsMember('t1', new File(['%PDF-1.4'], 'notes.pdf', { type: 'application/pdf' }))
    expect(decodeURIComponent(url)).toMatch(/chat\/thread\/t1\/file\/[0-9a-f-]{36}\.pdf$/)
    const res = await (await readerGET())(readRequest(url))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toBe('attachment')
  })
})
