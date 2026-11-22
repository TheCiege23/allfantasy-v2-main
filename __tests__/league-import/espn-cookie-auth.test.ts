// @vitest-environment node
/**
 * ESPN "Connect ESPN" cookie save/load — exercises the real POST/GET/DELETE handlers in
 * app/api/league/auth/route.ts against a mocked prisma, and verifies the SWID/espn_s2 values are
 * genuinely encrypted at rest (decrypting the captured ciphertext recovers the exact plaintext),
 * not just that a save function was called.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { decrypt } from '@/lib/league-auth-crypto'

const { prismaMock, sessionMock, store } = vi.hoisted(() => {
  const store = new Map<string, { userId: string; platform: string; espnSwid?: string; espnS2?: string; apiKey?: string; oauthToken?: string; updatedAt: Date; createdAt: Date }>()
  const keyFor = (userId: string, platform: string) => `${userId}:${platform}`

  const prismaMock = {
    leagueAuth: {
      upsert: vi.fn(async ({ where, update, create }: any) => {
        const key = keyFor(where.userId_platform.userId, where.userId_platform.platform)
        const existing = store.get(key)
        const now = new Date()
        const row = existing
          ? { ...existing, ...update, updatedAt: now }
          : { ...create, createdAt: now, updatedAt: now }
        store.set(key, row)
        return row
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return Array.from(store.values()).filter((r) => r.userId === where.userId)
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const key = keyFor(where.userId, where.platform)
        store.delete(key)
        return { count: 1 }
      }),
    },
  }
  const sessionMock = vi.fn()
  return { prismaMock, sessionMock, store }
})

const APP_ORIGIN = 'https://www.allfantasy.ai'

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/site-public-origin', () => ({ getPublicSiteOrigin: () => APP_ORIGIN }))

import { POST, GET, DELETE } from '@/app/api/league/auth/route'

const AUTH_URL = 'http://localhost/api/league/auth'

/*
 * Synthetic values in the SHAPE of real ESPN cookies (a braced GUID; a long URL-encoded token).
 * The route format-checks both before saving, so placeholder strings like '{X}' / 'y' are now
 * refused with a 400 — which is the behaviour, not a test artefact. Never real cookies.
 */
const FAKE_SWID = '{ABCD1234-EF56-7890-ABCD-1234567890AB}'
const FAKE_S2 = `AEB${'k3Pq9ZtW1xYv%2B7mN0rLs'.repeat(14)}%3D%3D`

function postRequest(body: unknown, origin?: string) {
  return new NextRequest(AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body),
  })
}

function deleteRequest(body: unknown) {
  return new NextRequest(AUTH_URL, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
  sessionMock.mockResolvedValue({ user: { id: 'user-1' } })
  delete process.env.ESPN_EXTENSION_ID
})

describe('ESPN cookie connect — save/load round trip', () => {
  it('saves SWID + espn_s2 encrypted, GET reports connected, DELETE clears it', async () => {
    const swid = FAKE_SWID
    const espnS2 = FAKE_S2

    const saveRes = await POST(postRequest({ platform: 'espn', espnSwid: swid, espnS2 }))
    const savePayload = await saveRes.json()
    expect(saveRes.status).toBe(200)
    expect(savePayload).toMatchObject({ success: true, platform: 'espn' })

    // Genuinely encrypted at rest — the stored row must not contain the plaintext...
    expect(prismaMock.leagueAuth.upsert).toHaveBeenCalledTimes(1)
    const stored = store.get('user-1:espn')!
    expect(stored.espnSwid).toBeDefined()
    expect(stored.espnS2).toBeDefined()
    expect(stored.espnSwid).not.toBe(swid)
    expect(stored.espnS2).not.toBe(espnS2)
    // ...but decrypting the stored ciphertext recovers it exactly (real round trip, not a mock).
    expect(decrypt(stored.espnSwid!)).toBe(swid)
    expect(decrypt(stored.espnS2!)).toBe(espnS2)

    const listRes = await GET()
    const listPayload = await listRes.json()
    expect(listRes.status).toBe(200)
    expect(listPayload.auths).toEqual([
      expect.objectContaining({ platform: 'espn', hasEspnCookies: true, hasApiKey: false, hasOauthToken: false }),
    ])

    const delRes = await DELETE(deleteRequest({ platform: 'espn' }))
    expect(delRes.status).toBe(200)
    expect(prismaMock.leagueAuth.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', platform: 'espn' } })

    const listAfterDelete = await GET()
    expect((await listAfterDelete.json()).auths).toEqual([])
  })

  it('rejects an ESPN save missing either cookie, without writing to the database', async () => {
    const res = await POST(postRequest({ platform: 'espn', espnSwid: '{only-one}' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('both') })
    expect(prismaMock.leagueAuth.upsert).not.toHaveBeenCalled()
  })

  it('requires authentication for save, list, and disconnect', async () => {
    sessionMock.mockResolvedValue(null)

    const saveRes = await POST(postRequest({ platform: 'espn', espnSwid: 'x', espnS2: 'y' }))
    expect(saveRes.status).toBe(401)

    const listRes = await GET()
    expect(listRes.status).toBe(401)

    const delRes = await DELETE(deleteRequest({ platform: 'espn' }))
    expect(delRes.status).toBe(401)

    expect(prismaMock.leagueAuth.upsert).not.toHaveBeenCalled()
    expect(prismaMock.leagueAuth.findMany).not.toHaveBeenCalled()
    expect(prismaMock.leagueAuth.deleteMany).not.toHaveBeenCalled()
  })

  it('accepts a save from the configured browser-extension origin (valid session)', async () => {
    process.env.ESPN_EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'

    const res = await POST(
      postRequest(
        { platform: 'espn', espnSwid: FAKE_SWID, espnS2: FAKE_S2 },
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
      ),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.leagueAuth.upsert).toHaveBeenCalledTimes(1)
  })

  it('rejects a save from an unrecognized cross-origin request even with a valid session', async () => {
    process.env.ESPN_EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'

    const res = await POST(
      postRequest(
        { platform: 'espn', espnSwid: '{X}', espnS2: 'y' },
        'https://evil.example.com',
      ),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.leagueAuth.upsert).not.toHaveBeenCalled()
  })

  it('rejects the extension origin when ESPN_EXTENSION_ID is not yet configured (fail-closed)', async () => {
    // ESPN_EXTENSION_ID deliberately left unset by beforeEach.
    const res = await POST(
      postRequest(
        { platform: 'espn', espnSwid: '{X}', espnS2: 'y' },
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
      ),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.leagueAuth.upsert).not.toHaveBeenCalled()
  })

  it('still allows the same-origin manual-paste-form request unaffected by the origin check', async () => {
    const res = await POST(postRequest({ platform: 'espn', espnSwid: FAKE_SWID, espnS2: FAKE_S2 }, APP_ORIGIN))
    expect(res.status).toBe(200)
  })

  it('refuses mis-copied cookies with a field-specific message and writes nothing', async () => {
    const truncated = await POST(postRequest({ platform: 'espn', espnSwid: FAKE_SWID, espnS2: FAKE_S2.slice(0, 40) }))
    expect(truncated.status).toBe(400)
    expect(await truncated.json()).toMatchObject({ code: 'INVALID_COOKIES', field: 'espnS2' })

    const swapped = await POST(postRequest({ platform: 'espn', espnSwid: FAKE_S2, espnS2: FAKE_SWID }))
    expect(swapped.status).toBe(400)
    expect((await swapped.json()).error).toMatch(/swapped/i)

    expect(prismaMock.leagueAuth.upsert).not.toHaveBeenCalled()
  })

  it('restores braces a paste dropped, and never echoes the cookies back', async () => {
    const bare = FAKE_SWID.slice(1, -1)
    const res = await POST(postRequest({ platform: 'espn', espnSwid: bare, espnS2: `espn_s2=${FAKE_S2}` }))
    expect(res.status).toBe(200)
    const body = JSON.stringify(await res.json())
    expect(body).not.toContain(bare)
    expect(body).not.toContain(FAKE_S2)
    const stored = store.get('user-1:espn')!
    expect(decrypt(stored.espnSwid!)).toBe(FAKE_SWID)
    expect(decrypt(stored.espnS2!)).toBe(FAKE_S2)
  })
})
