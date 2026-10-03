// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Download my data" (2026-10-03). The export's whole secret-safety model is that every read NAMES
 * its fields — so these tests read every query the builder makes and fail on one without a
 * `select`, one that selects a forbidden or secret-shaped column, or one not scoped to the user.
 */

const USER = 'user-123'

type Call = { model: string; method: string; args: Record<string, any> }

/** A stand-in Prisma client: records every call and returns rows built from the call's `select`. */
function fakeDb(opts: { counts?: Record<string, number>; failModels?: string[]; account?: boolean } = {}) {
  const calls: Call[] = []
  const rowFrom = (select: Record<string, any> | undefined): Record<string, unknown> => {
    const row: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(select ?? {})) {
      row[k] = v && typeof v === 'object' && 'select' in v ? rowFrom(v.select) : `v:${k}`
    }
    return row
  }
  const db = new Proxy(
    {},
    {
      get(_t, model: string) {
        return new Proxy(
          {},
          {
            get(_t2, method: string) {
              return async (args: Record<string, any> = {}) => {
                calls.push({ model, method, args })
                if (opts.failModels?.includes(model)) throw new Error(`boom ${model}`)
                if (method === 'count') return opts.counts?.[model] ?? 2
                if (model === 'appUser' && opts.account === false) return null
                if (method === 'findMany') return [rowFrom(args.select), rowFrom(args.select)]
                return rowFrom(args.select)
              }
            },
          },
        )
      },
    },
  )
  return { db: db as any, calls }
}

/** Every key at any depth of a `select` (nested relation selects included). */
function selectedKeys(select: Record<string, any> | undefined, out: string[] = []): string[] {
  for (const [k, v] of Object.entries(select ?? {})) {
    out.push(k)
    if (v && typeof v === 'object' && 'select' in v) selectedKeys(v.select, out)
  }
  return out
}

function allKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k)
      allKeys(v, out)
    }
  }
  return out
}

/** delegate name (`userSubscription`) → its fields whose type is another model, from the schema. */
function relationFieldsByDelegate(): Map<string, Set<string>> {
  const schema = readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8').replace(/\r/g, '')
  const blocks = [...schema.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)]
  const models = new Set(blocks.map((b) => b[1]))
  const out = new Map<string, Set<string>>()
  for (const [, name, body] of blocks) {
    const rel = new Set<string>()
    for (const line of body.split('\n')) {
      const m = /^\s+(\w+)\s+(\w+)[?[\]]*/.exec(line)
      if (m && models.has(m[2])) rel.add(m[1])
    }
    out.set(name.charAt(0).toLowerCase() + name.slice(1), rel)
  }
  return out
}

/** Column names that look like a credential, by shape — catches a secret added to the schema later. */
const SECRET_SHAPED = /(Token$|_token$|secret|password|hash|apiKey|Swid$|S2$|p256dh|^auth$|^endpoint$)/i

import {
  buildUserDataExport,
  EXPORT_CAPS,
  EXPORT_FORBIDDEN_FIELDS,
  serializeUserDataExport,
} from '@/lib/user-data-export/buildUserDataExport'

describe('buildUserDataExport — what it reads', () => {
  it('names its fields on every read (no query without a select)', async () => {
    const { db, calls } = fakeDb()
    await buildUserDataExport(db, USER)
    const reads = calls.filter((c) => c.method !== 'count')
    expect(reads.length).toBeGreaterThan(25)
    for (const c of reads) expect(c.args.select, `${c.model}.${c.method}`).toBeTruthy()
    for (const c of reads) {
      for (const [k, v] of Object.entries(c.args.select)) {
        if (v !== true) expect(v && typeof v === 'object' && 'select' in (v as object), `${c.model}.${k}`).toBe(true)
      }
    }
  })

  it('never selects a relation as `true` (that returns every column of the related row)', async () => {
    const relations = relationFieldsByDelegate()
    const { db, calls } = fakeDb()
    await buildUserDataExport(db, USER)
    let checked = 0
    for (const c of calls.filter((x) => x.method !== 'count')) {
      const rel = relations.get(c.model)
      expect(rel, `no schema model for delegate ${c.model}`).toBeTruthy()
      for (const [k, v] of Object.entries(c.args.select)) {
        if (rel!.has(k)) {
          checked++
          expect(v, `${c.model}.${k} is a relation`).not.toBe(true)
        }
      }
    }
    expect(checked).toBeGreaterThan(0) // the subscription → plan relation, at least
  })

  it('never selects a forbidden or secret-shaped column', async () => {
    const { db, calls } = fakeDb()
    await buildUserDataExport(db, USER)
    const forbidden = new Set<string>(EXPORT_FORBIDDEN_FIELDS)
    for (const c of calls) {
      for (const key of selectedKeys(c.args.select)) {
        expect(forbidden.has(key), `${c.model} selects forbidden ${key}`).toBe(false)
        expect(SECRET_SHAPED.test(key), `${c.model} selects secret-shaped ${key}`).toBe(false)
      }
    }
  })

  it('CONTROL: the secret-shape check catches the real credential columns in the schema', () => {
    const schema = readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    for (const col of ['passwordHash', 'access_token', 'refresh_token', 'discordAccessToken', 'spotifyRefreshToken', 'apiKey', 'espnS2', 'espnSwid', 'p256dh', 'oauthSecret']) {
      expect(schema).toMatch(new RegExp(`\\n\\s+${col}\\s`))
      expect(SECRET_SHAPED.test(col) || EXPORT_FORBIDDEN_FIELDS.includes(col as never), col).toBe(true)
    }
  })

  it('scopes every query to the signed-in account', async () => {
    const { db, calls } = fakeDb()
    await buildUserDataExport(db, USER)
    for (const c of calls) {
      expect(c.args.where, `${c.model}.${c.method} has no where`).toBeTruthy()
      expect(Object.values(c.args.where), `${c.model}.${c.method}`).toContain(USER)
    }
  })

  it('caps the large tables and says how many rows exist', async () => {
    const { db, calls } = fakeDb({ counts: { leagueChatMessage: EXPORT_CAPS.messages + 7, chatHistory: 3 } })
    const out = await buildUserDataExport(db, USER)
    expect(out.messages.leagueChat).toMatchObject({ total: EXPORT_CAPS.messages + 7, truncated: true })
    expect(out.aiChat.messages).toMatchObject({ total: 3, truncated: false })
    const chat = calls.find((c) => c.model === 'leagueChatMessage' && c.method === 'findMany')!
    expect(chat.args.take).toBe(EXPORT_CAPS.messages)
    expect(chat.args.orderBy).toEqual({ createdAt: 'desc' })
  })

  it('exports only YOUR messages, never ones you received', async () => {
    const { db, calls } = fakeDb()
    await buildUserDataExport(db, USER)
    expect(calls.find((c) => c.model === 'platformChatMessage' && c.method === 'findMany')!.args.where).toEqual({ senderUserId: USER })
    expect(calls.find((c) => c.model === 'leagueChatMessage' && c.method === 'findMany')!.args.where).toEqual({ userId: USER })
  })
})

describe('buildUserDataExport — the document', () => {
  it('contains no forbidden key anywhere and says what it leaves out', async () => {
    const { db } = fakeDb()
    const out = await buildUserDataExport(db, USER, new Date('2026-10-03T12:00:00Z'))
    const keys = allKeys(out)
    for (const f of EXPORT_FORBIDDEN_FIELDS) expect(keys.has(f), f).toBe(false)
    expect(out.exportedAt).toBe('2026-10-03T12:00:00.000Z')
    expect(out.notIncluded.length).toBeGreaterThan(0)
    expect(out.unavailableSections).toEqual([])
  })

  it('names a section that failed instead of failing the whole file', async () => {
    const { db } = fakeDb({ failModels: ['tokenLedger', 'chatHistory'] })
    const out = await buildUserDataExport(db, USER)
    expect(out.unavailableSections.sort()).toEqual(['aiMessages', 'tokenLedger'])
    expect(out.billing.tokenLedger).toBeNull()
    expect(out.account).not.toBeNull()
    expect(out.billing.subscriptions).toHaveLength(2)
  })

  it('serializes BigInt columns (xpTotal) instead of throwing', () => {
    expect(JSON.parse(serializeUserDataExport({ xp: BigInt('9007199254740993') }))).toEqual({ xp: '9007199254740993' })
  })
})

// ── the route ───────────────────────────────────────────────────────────────────────────────

const routeMocks = vi.hoisted(() => ({ auth: null as null | string, db: null as any }))
vi.mock('@/lib/auth-guard', () => ({
  requireAuth: async () =>
    routeMocks.auth
      ? { ok: true, userId: routeMocks.auth, session: {} }
      : { ok: false, response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) },
}))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return routeMocks.db
  },
}))

import { GET } from '@/app/api/user/export/route'

describe('GET /api/user/export', () => {
  let n = 0
  beforeEach(() => {
    // A fresh user per test, so the in-memory rate limiter never carries over between tests.
    routeMocks.auth = `route-user-${++n}`
    routeMocks.db = fakeDb().db
  })

  it('refuses without a session', async () => {
    routeMocks.auth = null
    expect((await GET()).status).toBe(401)
  })

  it('downloads a dated JSON attachment that is never cached', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="allfantasy-data-\d{4}-\d{2}-\d{2}\.json"$/)
    expect(res.headers.get('Cache-Control')).toContain('no-store')
    const body = JSON.parse(await res.text())
    expect(body.version).toBe(2)
    expect(body.account).toBeTruthy()
  })

  it('404s for a deleted account and 503s when the account read itself failed', async () => {
    routeMocks.db = fakeDb({ account: false }).db
    expect((await GET()).status).toBe(404)
    routeMocks.db = fakeDb({ failModels: ['appUser'] }).db
    expect((await GET()).status).toBe(503)
  })

  it('rate-limits after five downloads an hour', async () => {
    for (let i = 0; i < 5; i++) expect((await GET()).status).toBe(200)
    const res = await GET()
    expect(res.status).toBe(429)
    expect((await res.json()).message).toMatch(/try again/i)
  })
})
