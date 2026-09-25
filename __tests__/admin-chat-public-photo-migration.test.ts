// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/admin/chat/migrate-public-photos — moving chat photos out of PUBLIC Blob storage.
 *
 * 🛑 THESE ASSERT ON WHAT HAPPENED TO THE DATA, NOT ON STATUS CODES. The route runs for real, and
 * so do `lib/chat-core/publicPhotoMigration.ts` and `lib/chat-core/privateStorage.ts`. Only the two
 * storage SDKs and prisma are replaced — by small in-memory fakes of a public Blob store, a private
 * Blob store and three message tables — so every test reads the stores and rows afterwards:
 * which objects exist, which bytes they hold, and exactly which fields of which rows changed.
 *
 * The prisma fake also cross-checks the SQL the module sends: the number of `strpos(` arms must
 * equal the number of bound needles, so the SQL builder and its parameters cannot drift apart
 * under a green suite.
 */

const PUBLIC_TOKEN = 'vercel_blob_rw_PubStore1_publicsecretvalue000'
const PRIVATE_TOKEN = 'vercel_blob_rw_PrivStore9_privatesecretvalue111'
const S3_SECRET = 's3-secret-access-key-do-not-leak'
const PUBLIC_HOST = 'pubstore1.public.blob.vercel-storage.com'
const OTHER_HOST = 'otherstore7.public.blob.vercel-storage.com'
const USER_A = 'usr7secretA'
const USER_B = 'usr7secretB'
const USER_C = 'usr7secretC'

type Obj = { bytes: Uint8Array; contentType: string }
type AnyRow = Record<string, unknown> & { id: string }

const h = vi.hoisted(() => {
  const state = {
    stores: new Map<string, Map<string, { bytes: Uint8Array; contentType: string }>>(),
    db: {
      league_chat_messages: [] as Array<Record<string, unknown> & { id: string }>,
      platform_chat_messages: [] as Array<Record<string, unknown> & { id: string }>,
      bracket_league_messages: [] as Array<Record<string, unknown> & { id: string }>,
    },
    s3: new Map<string, { bytes: Uint8Array; contentType: string }>(),
    /** Make the private store's existence check throw (not "not found" — "could not look"). */
    privateHeadThrows: false,
    /** Force the next N updateMany calls to report no row matched. */
    failUpdates: 0,
    sqlSeen: [] as string[],
  }

  class BlobNotFoundError extends Error {
    constructor() {
      super('Vercel Blob: The requested blob does not exist')
    }
  }

  function storeId(token: string) {
    return token.split('_')[3]
  }
  function access(token: string) {
    return token.includes('PrivStore') ? 'private' : 'public'
  }
  function store(token: string) {
    const id = storeId(token)
    if (!state.stores.has(id)) state.stores.set(id, new Map())
    return state.stores.get(id)!
  }
  function urlOf(token: string, pathname: string) {
    return `https://${storeId(token).toLowerCase()}.${access(token)}.blob.vercel-storage.com/${pathname}`
  }
  /** A pathname, or a URL on THIS token's store. A URL on another store is a test failure. */
  function pathOf(token: string, urlOrPath: string) {
    if (!/^https?:\/\//.test(urlOrPath)) return urlOrPath
    const url = new URL(urlOrPath)
    if (url.hostname !== new URL(urlOf(token, 'x')).hostname) throw new Error('fake: URL is not on this token\'s store')
    return decodeURIComponent(url.pathname.slice(1))
  }

  const blob = {
    BlobNotFoundError,
    list: vi.fn(async (opts: { prefix?: string; limit?: number; cursor?: string; token: string }) => {
      const s = store(opts.token)
      const all = [...s.keys()].filter((p) => p.startsWith(opts.prefix ?? '')).sort()
      const start = opts.cursor ? Number(opts.cursor) : 0
      const page = all.slice(start, start + (opts.limit ?? 1000))
      const next = start + page.length
      return {
        blobs: page.map((p) => ({ pathname: p, url: urlOf(opts.token, p), downloadUrl: urlOf(opts.token, p) + '?download=1', size: s.get(p)!.bytes.byteLength, uploadedAt: new Date(0), etag: 'e' })),
        hasMore: next < all.length,
        cursor: next < all.length ? String(next) : undefined,
      }
    }),
    head: vi.fn(async (urlOrPath: string, opts: { token: string }) => {
      if (access(opts.token) === 'private' && state.privateHeadThrows) throw new Error(`Vercel Blob: service unavailable for ${urlOf(opts.token, urlOrPath)}`)
      const p = pathOf(opts.token, urlOrPath)
      const obj = store(opts.token).get(p)
      if (!obj) throw new BlobNotFoundError()
      return { pathname: p, url: urlOf(opts.token, p), downloadUrl: '', size: obj.bytes.byteLength, contentType: obj.contentType, contentDisposition: '', cacheControl: '', uploadedAt: new Date(0), etag: 'e' }
    }),
    get: vi.fn(async (urlOrPath: string, opts: { access: string; token: string }) => {
      if (opts.access !== access(opts.token)) throw new Error('fake: access mode does not match the store')
      const p = pathOf(opts.token, urlOrPath)
      const obj = store(opts.token).get(p)
      if (!obj) return null
      return { statusCode: 200, stream: new Blob([obj.bytes]).stream(), headers: new Headers(), blob: { url: urlOf(opts.token, p), pathname: p, contentType: obj.contentType, size: obj.bytes.byteLength } }
    }),
    put: vi.fn(async (pathname: string, body: Blob, opts: { access: string; contentType: string; token: string }) => {
      if (opts.access !== access(opts.token)) throw new Error('fake: access mode does not match the store')
      const s = store(opts.token)
      if (s.has(pathname)) throw new Error('Vercel Blob: This blob already exists')
      s.set(pathname, { bytes: new Uint8Array(await body.arrayBuffer()), contentType: opts.contentType })
      return { pathname, url: urlOf(opts.token, pathname) }
    }),
    del: vi.fn(async (urlOrPath: string | string[], opts: { token: string }) => {
      for (const u of Array.isArray(urlOrPath) ? urlOrPath : [urlOrPath]) store(opts.token).delete(pathOf(opts.token, u))
    }),
  }

  const s3 = {
    send: vi.fn(async (command: { kind: string; input: Record<string, unknown> }) => {
      const key = String(command.input.Key)
      if (command.kind === 'put') {
        state.s3.set(key, { bytes: new Uint8Array(command.input.Body as Buffer), contentType: String(command.input.ContentType) })
        return {}
      }
      if (command.kind === 'head') {
        if (state.privateHeadThrows) throw Object.assign(new Error('AccessDenied for bucket private-bucket'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })
        if (!state.s3.has(key)) throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } })
        return {}
      }
      throw new Error('fake: unexpected S3 command')
    }),
  }

  function applyUpdate(table: keyof typeof state.db, args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
    if (state.failUpdates > 0) {
      state.failUpdates--
      return { count: 0 }
    }
    const row = state.db[table].find((r) => r.id === args.where.id)
    if (!row) return { count: 0 }
    for (const [k, v] of Object.entries(args.where)) {
      if (k === 'id') continue
      if (k === 'metadata') {
        if (JSON.stringify(row.metadata) !== JSON.stringify((v as { equals: unknown }).equals)) return { count: 0 }
      } else if (row[k] !== v) return { count: 0 }
    }
    Object.assign(row, structuredClone(args.data))
    return { count: 1 }
  }

  const prisma = {
    $queryRawUnsafe: vi.fn(async (sql: string, afterId: string, ...needles: string[]) => {
      state.sqlSeen.push(sql)
      const table = /FROM "(\w+)"/.exec(sql)?.[1] as keyof typeof state.db
      const limit = Number(/LIMIT (\d+)$/.exec(sql)?.[1])
      if ((sql.match(/strpos\(/g) ?? []).length !== needles.length) throw new Error('fake: SQL arms and bound needles disagree')
      if (!state.db[table] || !Number.isInteger(limit)) throw new Error('fake: unrecognised SQL')
      const text = table === 'platform_chat_messages' ? ['body'] : ['message', 'imageUrl']
      const scope = table === 'platform_chat_messages' ? 'threadId' : 'leagueId'
      return state.db[table]
        .filter((r) => r.id > afterId)
        .filter((r) => {
          const hay = [...text.map((c) => r[c]), r.metadata == null ? null : JSON.stringify(r.metadata)]
            .filter((v) => v != null)
            .join('\n')
            .toLowerCase()
          return needles.some((n) => hay.includes(n))
        })
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          scopeId: r[scope],
          ...Object.fromEntries(text.map((c) => [c, r[c] ?? null])),
          metadata: structuredClone(r.metadata ?? null),
          ...(table === 'platform_chat_messages' ? { updatedAt: r.updatedAt } : {}),
        }))
    }),
    leagueChatMessage: { updateMany: vi.fn(async (args: never) => applyUpdate('league_chat_messages', args)) },
    platformChatMessage: { updateMany: vi.fn(async (args: never) => applyUpdate('platform_chat_messages', args)) },
    bracketLeagueMessage: { updateMany: vi.fn(async (args: never) => applyUpdate('bracket_league_messages', args)) },
  }

  return { state, blob, s3, prisma, requireAdmin: vi.fn(), logAdminAudit: vi.fn(async () => undefined) }
})

vi.mock('@vercel/blob', () => h.blob)
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = h.s3.send
    destroy() {}
  },
  PutObjectCommand: class { kind = 'put'; constructor(public input: Record<string, unknown>) {} },
  GetObjectCommand: class { kind = 'get'; constructor(public input: Record<string, unknown>) {} },
  HeadObjectCommand: class { kind = 'head'; constructor(public input: Record<string, unknown>) {} },
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/adminAuth', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/admin-audit', () => ({
  logAdminAudit: h.logAdminAudit,
  resolveAdminAuditActor: (user: { id?: string } | undefined) => user?.id ?? 'shared-secret',
}))

import { POST } from '@/app/api/admin/chat/migrate-public-photos/route'
import { parseChatUploadPath } from '@/lib/chat-core/chatUploadAccess'
import { publicBlobId, runPublicPhotoMigration } from '@/lib/chat-core/publicPhotoMigration'

// ─── fixtures ────────────────────────────────────────────────────────────────────────────────────

const P = {
  leaguePhoto: 'chat/lg1/image/0f0e-photo_one.jpg',
  leaguePhoto2: 'chat/lg1/image/1a1b-second.png',
  shared: `shared-chat/${USER_A}/2c2d.png`,
  bracket: `bracket-chat/${USER_B}/3e3f.webp`,
  orphan: `shared-chat/${USER_C}/4a4b.png`,
}
const url = (p: string, host = PUBLIC_HOST) => `https://${host}/${p}`
const bytes = (s: string) => new TextEncoder().encode(s)

function pub(): Map<string, Obj> {
  return h.state.stores.get('PubStore1') ?? new Map()
}
function priv(): Map<string, Obj> {
  return h.state.stores.get('PrivStore9') ?? new Map()
}
function row(table: keyof typeof h.state.db, id: string): AnyRow {
  return h.state.db[table].find((r) => r.id === id)!
}
function readUrl(path: string) {
  return `/api/chat/upload?path=${encodeURIComponent(path)}`
}
function target(scopePrefix: string, media: string, pathname: string, ext: string) {
  return `${scopePrefix}/${media}/${publicBlobId(pathname)}.${ext}`
}

const L1_META = {
  attachments: [{ type: 'image', url: url(P.leaguePhoto), mimeType: 'image/jpeg' }],
  alt: 'our trophy',
  reactions: { '🔥': ['someone'] },
  nested: { keep: [1, true, null, 'x'] },
}

function seed() {
  h.state.stores.clear()
  h.state.s3.clear()
  h.state.privateHeadThrows = false
  h.state.failUpdates = 0
  h.state.sqlSeen = []
  const p = new Map<string, Obj>([
    [P.leaguePhoto, { bytes: bytes('JPEG-ONE'), contentType: 'image/jpeg' }],
    [P.leaguePhoto2, { bytes: bytes('PNG-TWO'), contentType: 'image/png' }],
    [P.shared, { bytes: bytes('PNG-SHARED'), contentType: 'image/png' }],
    [P.bracket, { bytes: bytes('WEBP-BRACKET'), contentType: 'image/webp' }],
    [P.orphan, { bytes: bytes('PNG-ORPHAN'), contentType: 'image/png' }],
  ])
  h.state.stores.set('PubStore1', p)
  h.state.stores.set('PrivStore9', new Map())
  h.state.db.league_chat_messages = [
    { id: 'L1', leagueId: 'lg1', message: 'check this', imageUrl: null, metadata: structuredClone(L1_META) },
    {
      id: 'L2',
      leagueId: 'lg1',
      message: 'second',
      imageUrl: null,
      metadata: { attachments: [{ type: 'image', url: url(P.leaguePhoto2) }], poll: { question: 'q', options: [{ id: 'a', text: 'A', votes: [] }] } },
    },
    // Same league, a URL on somebody ELSE'S Blob store: reported, never fetched, never rewritten.
    { id: 'L3', leagueId: 'lg1', message: 'foreign', imageUrl: null, metadata: { attachments: [{ type: 'image', url: url('chat/lg1/image/zz.jpg', OTHER_HOST) }] } },
    { id: 'L4', leagueId: 'lg1', message: 'plain text, no photo', imageUrl: null, metadata: { alt: 'nothing' } },
  ]
  h.state.db.platform_chat_messages = [
    { id: 'P1', threadId: 'th1', body: `look ${url(P.shared)}. nice`, metadata: { contentType: 'image/png' }, updatedAt: new Date('2026-09-01T00:00:00Z') },
  ]
  h.state.db.bracket_league_messages = [
    { id: 'B1', leagueId: 'bl1', message: 'bracket pic', imageUrl: url(P.bracket), metadata: { kept: 'yes' } },
  ]
}

function snapshot() {
  return {
    db: structuredClone(h.state.db),
    pub: new Map([...pub()].map(([k, v]) => [k, { ...v }])),
    priv: new Map([...priv()].map(([k, v]) => [k, { ...v }])),
  }
}

async function call(body?: unknown, contentType = 'application/json') {
  const init: RequestInit = { method: 'POST' }
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
    init.headers = { 'content-type': contentType }
  }
  const res = await POST(new Request('http://localhost/api/admin/chat/migrate-public-photos', init))
  const text = await res.text()
  return { status: res.status, text, json: JSON.parse(text) as Record<string, any> }
}

const TOUCHERS = () => [h.blob.put, h.blob.del, h.prisma.leagueChatMessage.updateMany, h.prisma.platformChatMessage.updateMany, h.prisma.bracketLeagueMessage.updateMany]

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', PUBLIC_TOKEN)
  vi.stubEnv('BLOB1_READ_WRITE_TOKEN', '')
  vi.stubEnv('CHAT_PRIVATE_BLOB_READ_WRITE_TOKEN', PRIVATE_TOKEN)
  vi.stubEnv('CHAT_PRIVATE_S3_CONFIG', '')
  h.requireAdmin.mockResolvedValue({ ok: true, user: { id: 'admin-1', email: 'owner@example.test' } })
  seed()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// ─── the gate ───────────────────────────────────────────────────────────────────────────────────

describe('gate', () => {
  it.each(['dry-run', 'apply', 'delete-public'])('refuses a non-admin for %s and touches nothing', async (mode) => {
    const { NextResponse } = await import('next/server')
    h.requireAdmin.mockResolvedValue({ ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })
    const before = snapshot()

    const res = await call({ mode })

    expect(res.status).toBe(403)
    // The load-bearing half: a 403 that did the work anyway would pass a status-only test.
    expect(h.prisma.$queryRawUnsafe).not.toHaveBeenCalled()
    for (const fn of [h.blob.list, h.blob.head, h.blob.get, ...TOUCHERS()]) expect(fn).not.toHaveBeenCalled()
    expect(h.logAdminAudit).not.toHaveBeenCalled()
    expect(snapshot()).toEqual(before)
  })
})

// ─── dry-run ────────────────────────────────────────────────────────────────────────────────────

describe('dry-run', () => {
  it('is the default, reports every reference and blob, and changes nothing', async () => {
    const before = snapshot()

    const res = await call() // no body at all → dry-run

    expect(res.status).toBe(200)
    expect(res.json.mode).toBe('dry-run')
    const refs = res.json.references
    expect(refs.total).toBe(5)
    expect(refs.wouldMove).toBe(4)
    expect(refs.byTableField).toMatchObject({
      'league_chat_messages.metadata': 3,
      'league_chat_messages.message': 0,
      'league_chat_messages.imageUrl': 0,
      'platform_chat_messages.body': 1,
      'platform_chat_messages.metadata': 0,
      'bracket_league_messages.imageUrl': 1,
    })
    expect(refs.byReason).toEqual({ not_our_store: 1 })
    const targets = Object.fromEntries(refs.items.filter((i: any) => i.targetPath).map((i: any) => [i.rowId, i.targetPath]))
    expect(targets).toEqual({
      L1: target('chat/lg1', 'image', P.leaguePhoto, 'jpg'),
      L2: target('chat/lg1', 'image', P.leaguePhoto2, 'png'),
      P1: target('chat/thread/th1', 'image', P.shared, 'png'),
      B1: target('chat/bracket/bl1', 'image', P.bracket, 'webp'),
    })
    expect(refs.items.find((i: any) => i.rowId === 'L1')).toMatchObject({ field: 'metadata', jsonPath: 'attachments[0].url', status: 'would_move', privateCopy: 'absent' })

    const blobs = res.json.blobs
    expect(blobs.listed).toBe(5)
    expect(blobs.byPrefix['chat/']).toEqual({ listed: 2, referenced: 2, movedByApply: 0, orphans: 0 })
    expect(blobs.byPrefix['shared-chat/']).toEqual({ listed: 2, referenced: 1, movedByApply: 0, orphans: 1 })
    expect(blobs.byPrefix['bracket-chat/']).toEqual({ listed: 1, referenced: 1, movedByApply: 0, orphans: 0 })
    expect(blobs.wouldDelete).toBe(1)
    expect(blobs.items.find((b: any) => b.blobId === publicBlobId(P.orphan))).toMatchObject({ verdict: 'orphan', action: 'would_delete' })

    for (const fn of TOUCHERS()) expect(fn).not.toHaveBeenCalled()
    expect(h.blob.get).not.toHaveBeenCalled() // metadata only — nothing downloaded
    expect(h.logAdminAudit).not.toHaveBeenCalled()
    expect(snapshot()).toEqual(before)
  })

  it('a non-JSON request cannot reach a mutating mode: it runs the read-only default', async () => {
    const before = snapshot()
    const res = await call(JSON.stringify({ mode: 'delete-public' }), 'text/plain')
    expect(res.json.mode).toBe('dry-run')
    for (const fn of TOUCHERS()) expect(fn).not.toHaveBeenCalled()
    expect(snapshot()).toEqual(before)
  })

  it('rejects an unknown mode rather than guessing', async () => {
    const res = await call({ mode: 'delete' })
    expect(res.status).toBe(400)
    expect(h.prisma.$queryRawUnsafe).not.toHaveBeenCalled()
  })
})

// ─── apply ──────────────────────────────────────────────────────────────────────────────────────

describe('apply', () => {
  it('copies each referenced blob privately and rewrites exactly the fields that held it', async () => {
    const before = snapshot()

    const res = await call({ mode: 'apply' })

    expect(res.status).toBe(200)
    expect(res.json.counts).toMatchObject({ moved: 4, skipped: 1, failed: 0, rowsUpdated: 4, privateCopiesCreated: 4, privateCopiesReused: 0 })
    expect(res.json.skippedByReason).toEqual({ not_our_store: 1 })

    const tL1 = target('chat/lg1', 'image', P.leaguePhoto, 'jpg')
    const tL2 = target('chat/lg1', 'image', P.leaguePhoto2, 'png')
    const tP1 = target('chat/thread/th1', 'image', P.shared, 'png')
    const tB1 = target('chat/bracket/bl1', 'image', P.bracket, 'webp')

    // Private copies hold the same bytes and type as the originals.
    for (const [t, p] of [[tL1, P.leaguePhoto], [tL2, P.leaguePhoto2], [tP1, P.shared], [tB1, P.bracket]] as const) {
      expect(priv().get(t)?.contentType).toBe(before.pub.get(p)!.contentType)
      expect(Buffer.from(priv().get(t)!.bytes).equals(Buffer.from(before.pub.get(p)!.bytes))).toBe(true)
      // …and the rewritten URL is one the private reader accepts, for the row's own chat.
      expect(parseChatUploadPath(t)).not.toBeNull()
    }
    expect(parseChatUploadPath(tP1)?.scope).toEqual({ kind: 'thread', id: 'th1' })
    expect(parseChatUploadPath(tB1)?.scope).toEqual({ kind: 'bracket', id: 'bl1' })

    // L1: only attachments[0].url changed; every other metadata key and the text columns are intact.
    const L1 = row('league_chat_messages', 'L1')
    const expectedL1 = structuredClone(L1_META)
    expectedL1.attachments[0].url = readUrl(tL1)
    expect(L1.metadata).toEqual(expectedL1)
    expect(L1.message).toBe('check this')
    expect(L1.imageUrl).toBeNull()

    const L2 = row('league_chat_messages', 'L2')
    expect(L2.metadata).toEqual({ attachments: [{ type: 'image', url: readUrl(tL2) }], poll: { question: 'q', options: [{ id: 'a', text: 'A', votes: [] }] } })

    // P1: the URL inside the body text is replaced in place; the sentence around it survives.
    const P1 = row('platform_chat_messages', 'P1')
    expect(P1.body).toBe(`look ${readUrl(tP1)}. nice`)
    expect(P1.metadata).toEqual({ contentType: 'image/png' })
    expect(P1.updatedAt).toEqual(new Date('2026-09-01T00:00:00Z')) // a storage move is not an edit

    const B1 = row('bracket_league_messages', 'B1')
    expect(B1.imageUrl).toBe(readUrl(tB1))
    expect(B1.message).toBe('bracket pic')
    expect(B1.metadata).toEqual({ kept: 'yes' })

    // Untouched rows are untouched, including the foreign-store one.
    expect(row('league_chat_messages', 'L3')).toEqual(before.db.league_chat_messages[2])
    expect(row('league_chat_messages', 'L4')).toEqual(before.db.league_chat_messages[3])

    // Each write names only the field it rewrites (plus updatedAt, held at its old value).
    const writes = [
      ...h.prisma.leagueChatMessage.updateMany.mock.calls,
      ...h.prisma.platformChatMessage.updateMany.mock.calls,
      ...h.prisma.bracketLeagueMessage.updateMany.mock.calls,
    ].map(([args]) => Object.keys((args as { data: object }).data).sort())
    expect(writes).toEqual([['metadata'], ['metadata'], ['body', 'updatedAt'], ['imageUrl']])

    // Nothing deleted, public store byte-identical.
    expect(h.blob.del).not.toHaveBeenCalled()
    expect(pub()).toEqual(before.pub)
    expect(h.logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ adminUserId: 'admin-1', action: 'chat_public_photo_migration', targetId: 'apply' }))
  })

  it('is idempotent: a second run moves nothing, writes nothing, uploads nothing', async () => {
    await call({ mode: 'apply' })
    const afterFirst = snapshot()
    const puts = h.blob.put.mock.calls.length
    const writes = h.prisma.leagueChatMessage.updateMany.mock.calls.length

    const res = await call({ mode: 'apply' })

    expect(res.json.counts).toMatchObject({ moved: 0, failed: 0, rowsUpdated: 0 })
    expect(h.blob.put.mock.calls.length).toBe(puts)
    expect(h.prisma.leagueChatMessage.updateMany.mock.calls.length).toBe(writes)
    expect(snapshot()).toEqual(afterFirst)
  })

  it('a copy whose rewrite failed is reused on the next run, never duplicated', async () => {
    h.state.failUpdates = 1 // the first row write (L1) reports that the row changed underneath it

    const first = await call({ mode: 'apply' })
    expect(first.json.failedByReason).toEqual({ row_changed: 1 })
    const tL1 = target('chat/lg1', 'image', P.leaguePhoto, 'jpg')
    expect(priv().has(tL1)).toBe(true) // the copy exists…
    expect(JSON.stringify(row('league_chat_messages', 'L1').metadata)).toContain(PUBLIC_HOST) // …the row is still public

    const putsBefore = h.blob.put.mock.calls.length
    const second = await call({ mode: 'apply' })

    expect(second.json.counts).toMatchObject({ moved: 1, failed: 0, privateCopiesReused: 1, privateCopiesCreated: 0 })
    expect(h.blob.put.mock.calls.length).toBe(putsBefore)
    expect((row('league_chat_messages', 'L1').metadata as any).attachments[0].url).toBe(readUrl(tL1))
  })

  it('works in batches: limit bounds the rows per call and the cursor continues', async () => {
    const one = await call({ mode: 'apply', limit: 1 })
    expect(one.json.counts.rowsProcessed).toBe(1)
    expect(one.json.hasMore).toBe(true)
    expect(typeof one.json.nextCursor).toBe('string')

    let cursor = one.json.nextCursor
    let guard = 0
    while (cursor && guard++ < 10) {
      const next = await call({ mode: 'apply', limit: 1, cursor })
      cursor = next.json.hasMore ? next.json.nextCursor : null
    }
    expect(JSON.stringify(h.state.db)).not.toContain(PUBLIC_HOST)
    expect(JSON.stringify(h.state.db)).toContain(OTHER_HOST) // the foreign reference is never touched
  })

  it('stops starting new rows when the time budget runs out, and says so', async () => {
    let t = 0
    const res = await runPublicPhotoMigration({ mode: 'apply', budgetMs: 10, now: () => (t += 6) })
    expect(res.body.hasMore).toBe(true)
    expect((res.body.counts as any).rowsProcessed).toBeLessThan(4)
  })

  it('refuses to run with no private storage configured', async () => {
    vi.stubEnv('CHAT_PRIVATE_BLOB_READ_WRITE_TOKEN', '')
    const before = snapshot()
    const res = await call({ mode: 'apply' })
    expect(res.status).toBe(503)
    expect(res.json.error).toBe('private_storage_unconfigured')
    expect(snapshot()).toEqual(before)
  })
})

// ─── delete-public ──────────────────────────────────────────────────────────────────────────────

describe('delete-public', () => {
  it('before apply: deletes only the orphan, keeps every still-referenced blob', async () => {
    const res = await call({ mode: 'delete-public' })

    expect(res.json.counts).toMatchObject({ listed: 5, deleted: 1, deletedOrphans: 1, deletedMoved: 0, kept: 4 })
    expect(res.json.keptByReason).toEqual({ still_referenced: 4 })
    expect([...pub().keys()].sort()).toEqual([P.bracket, P.leaguePhoto, P.leaguePhoto2, P.shared].sort())
    expect(h.blob.del).toHaveBeenCalledTimes(1)
    expect(h.logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'delete-public' }))
  })

  it('after apply: deletes moved originals only when the private copy is confirmed, keeps the one whose copy is missing', async () => {
    await call({ mode: 'apply' })
    // Lose one private copy after the rewrite (the row now points at a path with nothing behind it).
    priv().delete(target('chat/lg1', 'image', P.leaguePhoto2, 'png'))

    const res = await call({ mode: 'delete-public' })

    expect(res.json.counts).toMatchObject({ deleted: 4, deletedMoved: 3, deletedOrphans: 1, kept: 1 })
    expect(res.json.keptByReason).toEqual({ private_copy_missing: 1 })
    expect([...pub().keys()]).toEqual([P.leaguePhoto2])
  })

  it('"could not look" is never "absent": a failing private check keeps the original', async () => {
    await call({ mode: 'apply' })
    h.state.privateHeadThrows = true

    const res = await call({ mode: 'delete-public' })

    expect(res.json.counts).toMatchObject({ deleted: 1, deletedOrphans: 1, deletedMoved: 0 })
    expect(res.json.keptByReason).toEqual({ private_check_failed: 4 })
    expect(pub().size).toBe(4)
  })

  it('a reference the URL parser cannot see still keeps the blob (second, literal search)', async () => {
    // Not a URL at all — just the pathname quoted in text. Still a reference; still kept.
    h.state.db.league_chat_messages.push({ id: 'L9', leagueId: 'lg1', message: `old link ${P.orphan}`, imageUrl: null, metadata: null })

    const res = await call({ mode: 'delete-public' })

    expect(res.json.counts.deleted).toBe(0)
    expect(pub().has(P.orphan)).toBe(true)
  })

  it('never deletes an object that is not on the public host, even when listing returns it', async () => {
    const realList = h.blob.list.getMockImplementation()!
    h.blob.list.mockImplementation(async (opts: any) => {
      const res = await realList(opts)
      return { ...res, blobs: res.blobs.map((b: any) => (b.pathname === P.orphan ? { ...b, url: b.url.replace('.public.', '.private.') } : b)) }
    })
    try {
      const res = await call({ mode: 'delete-public' })

      expect(res.json.counts.deleted).toBe(0)
      expect(res.json.keptByReason).toMatchObject({ not_public_store: 1 })
      expect(pub().has(P.orphan)).toBe(true)
    } finally {
      h.blob.list.mockImplementation(realList)
    }
  })
})

// ─── S3 private storage ─────────────────────────────────────────────────────────────────────────

describe('with S3 as private storage', () => {
  beforeEach(() => {
    vi.stubEnv('CHAT_PRIVATE_BLOB_READ_WRITE_TOKEN', '')
    vi.stubEnv(
      'CHAT_PRIVATE_S3_CONFIG',
      JSON.stringify({ endpoint: 'https://s3.example.test', region: 'auto', bucketName: 'private-bucket', accessKeyId: 'AK-test', secretAccessKey: S3_SECRET }),
    )
  })

  it('writes the copy to S3 and verifies it there before deleting the original', async () => {
    await call({ mode: 'apply' })
    const tL1 = target('chat/lg1', 'image', P.leaguePhoto, 'jpg')
    expect(h.state.s3.get(tL1)?.contentType).toBe('image/jpeg')
    expect(priv().size).toBe(0)

    h.state.s3.delete(tL1)
    const res = await call({ mode: 'delete-public' })

    expect(res.json.keptByReason).toEqual({ private_copy_missing: 1 })
    expect([...pub().keys()]).toEqual([P.leaguePhoto])
  })
})

// ─── nothing sensitive leaves ───────────────────────────────────────────────────────────────────

describe('no URL, pathname, user id or credential in any response or log line', () => {
  const FORBIDDEN = [
    'blob.vercel-storage.com',
    'http://',
    'https://',
    PUBLIC_TOKEN,
    PRIVATE_TOKEN,
    'publicsecretvalue',
    'privatesecretvalue',
    S3_SECRET,
    'private-bucket',
    USER_A,
    USER_B,
    USER_C,
    'photo_one', // an original filename
    'owner@example.test',
  ]

  it('holds across every mode, a refusal and a storage failure', async () => {
    const logs: string[] = []
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')))
    }
    const bodies: string[] = []
    // The positive control: every forbidden identifier really is in play in the fixtures.
    const fixtures = JSON.stringify(h.state.db) + [...pub().keys()].join()
    for (const id of [USER_A, USER_B, USER_C, 'photo_one', PUBLIC_HOST]) expect(fixtures).toContain(id)

    bodies.push((await call({ mode: 'dry-run' })).text)
    h.state.failUpdates = 1
    bodies.push((await call({ mode: 'apply' })).text)
    bodies.push((await call({ mode: 'apply' })).text)
    bodies.push((await call({ mode: 'delete-public' })).text)
    // A storage error whose MESSAGE carries a URL and a token must not surface either.
    h.blob.list.mockRejectedValueOnce(new Error(`list failed for ${url(P.shared)} with ${PUBLIC_TOKEN}`))
    const failed = await call({ mode: 'dry-run' })
    expect(failed.status).toBe(500)
    bodies.push(failed.text)
    h.state.privateHeadThrows = true
    bodies.push((await call({ mode: 'dry-run' })).text)
    vi.stubEnv('CHAT_PRIVATE_BLOB_READ_WRITE_TOKEN', '')
    bodies.push((await call({ mode: 'apply' })).text)

    for (const text of [...bodies, ...logs]) {
      for (const bad of FORBIDDEN) expect(text, `leaked ${bad}`).not.toContain(bad)
    }
  })
})
