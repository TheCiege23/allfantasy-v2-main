// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bracket pool photo privacy — `POST /api/bracket/chat-upload`.
 *
 * 🛑 WHAT WAS WRONG. The route wrote every pool-chat photo to PUBLIC Vercel Blob storage under
 * `bracket-chat/<userId>/`, and checked only that the caller was signed in — not that they were
 * in the pool. Anyone holding the link could open the photo. It now matches the other two chat
 * upload routes: pool membership (`canAccessBracketLeague`) before anything is stored, private
 * storage under `chat/bracket/<leagueId>/`, served only through `/api/chat/upload?path=…`.
 *
 * BEHAVIOURAL: the real routes and the real `privateStorage` module run; only the storage SDKs,
 * the session and prisma are mocked, and the assertions read what reached storage.
 */

const state = vi.hoisted(() => ({
  sessionUserId: null as string | null,
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
// The pre-fix route read the session directly; give it the same identity so a base run is a fair one.
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => (state.sessionUserId ? { user: { id: state.sessionUserId } } : null)),
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bracketLeagueMember: {
      findUnique: vi.fn(async ({ where }: { where: { leagueId_userId: { leagueId: string; userId: string } } }) =>
        (state.bracketMembers[where.leagueId_userId.leagueId] ?? []).includes(where.leagueId_userId.userId)
          ? { id: 'bm' }
          : null,
      ),
    },
    league: { findFirst: vi.fn(async () => null) },
    platformChatThreadMember: { findFirst: vi.fn(async () => null) },
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

const png = (name = 'photo.png') => new File(['png-bytes'], name, { type: 'image/png' })

function uploadRequest(fields: Record<string, string>, file: File | null = png()) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  if (file) fd.append('file', file)
  return new Request('https://example.test/api/bracket/chat-upload', { method: 'POST', body: fd }) as never
}

const readRequest = (url: string) => ({ nextUrl: new URL(url, 'https://example.test') }) as never

const s3Commands = (kind: 'put' | 'get') =>
  mocks.s3Send.mock.calls.map((c) => c[0]).filter((cmd: { kind?: string }) => cmd.kind === kind)

function nothingStored() {
  expect(s3Commands('put')).toHaveLength(0)
  expect(mocks.blobPut).not.toHaveBeenCalled()
}

const bracketPOST = async () => (await import('@/app/api/bracket/chat-upload/route')).POST
const readerGET = async () => (await import('@/app/api/chat/upload/route')).GET

beforeEach(() => {
  vi.clearAllMocks()
  state.sessionUserId = 'member'
  state.bracketMembers = { bk1: ['member'] }
  // Production's backend, AND the public token — so a route that still wrote publicly would
  // succeed rather than 503, which is what makes "nothing stored" mean something.
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

describe('who may upload a pool photo', () => {
  it('refuses a signed-in user who is not in the pool, and stores nothing', async () => {
    state.sessionUserId = 'stranger'
    const res = await (await bracketPOST())(uploadRequest({ leagueId: 'bk1' }))
    expect(res.status).toBe(403)
    nothingStored()
  })

  it('refuses an anonymous upload, and stores nothing', async () => {
    state.sessionUserId = null
    const res = await (await bracketPOST())(uploadRequest({ leagueId: 'bk1' }))
    expect(res.status).toBe(401)
    nothingStored()
  })

  it('refuses an upload that names no pool', async () => {
    const res = await (await bracketPOST())(uploadRequest({}))
    expect(res.status).toBe(400)
    nothingStored()
  })

  it.each([
    ['SVG', new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })],
    ['HTML', new File(['<html></html>'], 'x.html', { type: 'text/html' })],
    ['an image over 5MB', new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })],
  ])('still refuses %s from a member', async (_label, file) => {
    const res = await (await bracketPOST())(uploadRequest({ leagueId: 'bk1' }, file))
    expect(res.status).toBe(400)
    nothingStored()
  })
})

describe('where a member pool photo goes', () => {
  it('stores it PRIVATELY under the pool and hands back only the authenticated reader URL', async () => {
    const res = await (await bracketPOST())(uploadRequest({ leagueId: 'bk1' }))
    expect(res.status).toBe(200)

    const puts = s3Commands('put')
    expect(puts).toHaveLength(1)
    const input = puts[0].input as { Bucket: string; Key: string; ContentType: string; CacheControl: string }
    expect(input.Bucket).toBe('private-chat')
    expect(input.Key).toMatch(/^chat\/bracket\/bk1\/image\/[0-9a-f-]{36}\.png$/)
    expect(input.ContentType).toBe('image/png')
    expect(input.CacheControl).toBe('private, no-store')
    expect(mocks.blobPut).not.toHaveBeenCalled()

    const { url } = await res.json()
    expect(url).toBe(`/api/chat/upload?path=${encodeURIComponent(input.Key)}`)
  })

  it('on the private-Blob fallback, writes with access "private", never "public"', async () => {
    vi.stubEnv('CHAT_PRIVATE_S3_CONFIG', '')
    vi.stubEnv('CHAT_PRIVATE_BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_private_test')
    const res = await (await bracketPOST())(uploadRequest({ leagueId: 'bk1' }))
    expect(res.status).toBe(200)
    expect(mocks.blobPut).toHaveBeenCalledTimes(1)
    const [key, , options] = mocks.blobPut.mock.calls[0]
    expect(key).toMatch(/^chat\/bracket\/bk1\/image\//)
    expect(options).toMatchObject({ access: 'private', token: 'vercel_blob_rw_private_test' })
  })

  /* The old route used the client's filename extension verbatim; the reader only serves a clean one. */
  it('names the object from its content type, not the client filename', async () => {
    const res = await (await bracketPOST())(uploadRequest({ leagueId: 'bk1' }, png('my holiday pic')))
    expect(res.status).toBe(200)
    expect((s3Commands('put')[0].input as { Key: string }).Key).toMatch(/^chat\/bracket\/bk1\/image\/[0-9a-f-]{36}\.png$/)
  })
})

describe('who may open a pool photo', () => {
  async function uploadAsMember() {
    state.sessionUserId = 'member'
    const res = await (await bracketPOST())(uploadRequest({ leagueId: 'bk1' }))
    expect(res.status).toBe(200)
    const { url } = await res.json()
    expect(url).toMatch(/^\/api\/chat\/upload\?path=/)
    mocks.s3Send.mockClear()
    return url as string
  }

  it('refuses it to a signed-in user outside the pool without touching storage', async () => {
    const url = await uploadAsMember()
    state.sessionUserId = 'stranger'
    const res = await (await readerGET())(readRequest(url))
    expect(res.status).toBe(403)
    expect(s3Commands('get')).toHaveLength(0)
  })

  it('refuses it to an anonymous request', async () => {
    const url = await uploadAsMember()
    state.sessionUserId = null
    const res = await (await readerGET())(readRequest(url))
    expect(res.status).toBe(401)
    expect(s3Commands('get')).toHaveLength(0)
  })

  it('serves it to a pool member, privately and with nosniff', async () => {
    const url = await uploadAsMember()
    const res = await (await readerGET())(readRequest(url))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(await res.text()).toBe('png-bytes')
  })
})

describe('the pool chat names its pool when it uploads', () => {
  /*
   * Source-level: PoolChat is a large client component. Comments are stripped and only the
   * code between `new FormData()` and the POST is read, so prose cannot satisfy it.
   */
  it('PoolChat sends leagueId with its upload', () => {
    const src = readFileSync(join(process.cwd(), 'components/bracket/PoolChat.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => (l.includes('//') && !l.includes('://') ? l.slice(0, l.indexOf('//')) : l))
      .join('\n')
    const post = src.indexOf('"/api/bracket/chat-upload"')
    expect(post).toBeGreaterThan(-1)
    const block = src.slice(src.lastIndexOf('new FormData()', post), post)
    expect(block).toMatch(/formData\.append\("leagueId", leagueId\)/)
  })
})
