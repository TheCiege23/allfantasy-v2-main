/**
 * The connect callback must not invent a subscription tier.
 *
 * Spotify removed `product` from GET /v1/me for Development Mode apps in February 2026.
 * The callback used to store `product === 'premium'`, turning that absence into
 * `isPremium: false` — which told every Premium listener to buy Premium.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"

const getServerSessionMock = vi.hoisted(() => vi.fn())
const cookiesMock = vi.hoisted(() => vi.fn())
const userProfileUpsertMock = vi.hoisted(() => vi.fn())
const userProfileFindUniqueMock = vi.hoisted(() => vi.fn())
const authAccountFindFirstMock = vi.hoisted(() => vi.fn())
const authAccountUpdateMock = vi.hoisted(() => vi.fn())
const authAccountDeleteManyMock = vi.hoisted(() => vi.fn())
const authAccountCreateMock = vi.hoisted(() => vi.fn())

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("next/headers", () => ({ cookies: cookiesMock }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    userProfile: { upsert: userProfileUpsertMock, findUnique: userProfileFindUniqueMock },
    authAccount: {
      findFirst: authAccountFindFirstMock,
      update: authAccountUpdateMock,
      deleteMany: authAccountDeleteManyMock,
      create: authAccountCreateMock,
    },
  },
}))

async function runCallback(meBody: Record<string, unknown>, existingSpotifyPrefs: Record<string, unknown> = {}) {
  userProfileFindUniqueMock.mockResolvedValue({
    notificationPreferences: { other: 1, spotify: existingSpotifyPrefs },
  })
  ;(global.fetch as any)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: "streaming" }),
    })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "spotify-user-1", ...meBody }) })

  const { GET } = await import("@/app/api/auth/spotify/callback/route")
  const res = await GET(
    createMockNextRequest("http://localhost:3000/api/auth/spotify/callback?code=abc&state=s") as any
  )
  expect(res.headers.get("location")).toContain("spotify=connected")
  return userProfileUpsertMock.mock.calls[0][0].update.notificationPreferences as Record<string, any>
}

describe("Spotify callback Premium storage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.SPOTIFY_CLIENT_ID = "id"
    process.env.SPOTIFY_CLIENT_SECRET = "secret"
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } })
    cookiesMock.mockReturnValue({
      get: vi.fn((name: string) => {
        if (name === "spotify_oauth_state") return { value: "s" }
        if (name === "spotify_oauth_user_id") return { value: "u1" }
        return undefined
      }),
      delete: vi.fn(),
    })
    authAccountFindFirstMock.mockResolvedValue(null)
    vi.stubGlobal("fetch", vi.fn())
  })

  it("records nothing when Spotify omits `product` (Development Mode)", async () => {
    const prefs = await runCallback({ display_name: "Guap" })
    expect(prefs.spotify).toEqual({ displayName: "Guap" })
    expect(prefs.other).toBe(1)
  })

  it("clears a stale defaulted false left by the old callback", async () => {
    const prefs = await runCallback({ display_name: "Guap" }, { isPremium: false })
    expect(prefs.spotify).not.toHaveProperty("isPremium")
  })

  it("records the tier, with its source, when Spotify supplies it", async () => {
    expect((await runCallback({ product: "premium" })).spotify).toMatchObject({
      isPremium: true,
      premiumSource: "spotify-product",
    })
  })

  it("records a reported free tier as false", async () => {
    vi.clearAllMocks()
    expect((await runCallback({ product: "free" })).spotify).toMatchObject({
      isPremium: false,
      premiumSource: "spotify-product",
    })
  })
})
