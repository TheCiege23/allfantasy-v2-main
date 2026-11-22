/**
 * Spotify connect is gated to the tester allowlist while the Spotify app is in
 * Development Mode — where any account not allowlisted on Spotify's dashboard is
 * stopped on Spotify's own developer-facing 403 page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const getServerSessionMock = vi.hoisted(() => vi.fn())
const cookiesSetMock = vi.hoisted(() => vi.fn())
const appUserFindUniqueMock = vi.hoisted(() => vi.fn())
const userProfileFindUniqueMock = vi.hoisted(() => vi.fn())
const authAccountFindFirstMock = vi.hoisted(() => vi.fn())

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookiesSetMock }) }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appUser: { findUnique: appUserFindUniqueMock },
    userProfile: { findUnique: userProfileFindUniqueMock },
    authAccount: { findFirst: authAccountFindFirstMock },
  },
}))

import { canConnectSpotify, parseSpotifyAllowlist } from "@/lib/spotify/connectAccess"

describe("canConnectSpotify", () => {
  const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv

  it("lets nobody new connect when nothing is configured", () => {
    expect(canConnectSpotify({ email: "a@b.com", alreadyConnected: false }, env({}))).toBe(false)
  })

  it("lets an allowlisted email connect, ignoring case and spacing", () => {
    const e = env({ SPOTIFY_CONNECT_ALLOWLIST: " Owner@AllFantasy.ai, tester@x.com ;friend@y.com\n" })
    expect(canConnectSpotify({ email: "owner@allfantasy.ai", alreadyConnected: false }, e)).toBe(true)
    expect(canConnectSpotify({ email: "FRIEND@Y.COM", alreadyConnected: false }, e)).toBe(true)
    expect(canConnectSpotify({ email: "stranger@z.com", alreadyConnected: false }, e)).toBe(false)
    expect(canConnectSpotify({ email: null, alreadyConnected: false }, e)).toBe(false)
  })

  it("opens to everyone once SPOTIFY_CONNECT_OPEN is set", () => {
    expect(canConnectSpotify({ email: "stranger@z.com", alreadyConnected: false }, env({ SPOTIFY_CONNECT_OPEN: "1" }))).toBe(true)
    expect(canConnectSpotify({ email: "stranger@z.com", alreadyConnected: false }, env({ SPOTIFY_CONNECT_OPEN: "true" }))).toBe(true)
    expect(canConnectSpotify({ email: "stranger@z.com", alreadyConnected: false }, env({ SPOTIFY_CONNECT_OPEN: "0" }))).toBe(false)
  })

  it("always lets an already-connected account reconnect for new scopes", () => {
    expect(canConnectSpotify({ email: "stranger@z.com", alreadyConnected: true }, env({}))).toBe(true)
  })

  it("ignores entries that are not email addresses", () => {
    expect([...parseSpotifyAllowlist("owner@x.com, , *, everyone")]).toEqual(["owner@x.com"])
  })
})

describe("GET /api/auth/spotify enforces the same gate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.SPOTIFY_CLIENT_ID = "spotify-client"
    process.env.NEXTAUTH_URL = "https://allfantasy.test"
    delete process.env.SPOTIFY_CONNECT_OPEN
    process.env.SPOTIFY_CONNECT_ALLOWLIST = "tester@allfantasy.test"
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } })
    userProfileFindUniqueMock.mockResolvedValue({ spotifyConnectedAt: null })
    authAccountFindFirstMock.mockResolvedValue(null)
  })

  async function start() {
    const { GET } = await import("@/app/api/auth/spotify/route")
    const res = await GET()
    return new URL(res.headers.get("location") ?? "")
  }

  it("sends an allowlisted account to Spotify", async () => {
    appUserFindUniqueMock.mockResolvedValue({ email: "Tester@AllFantasy.test" })
    const loc = await start()
    expect(loc.host).toBe("accounts.spotify.com")
    expect(loc.searchParams.get("scope")).toContain("playlist-read-private")
    expect(cookiesSetMock).toHaveBeenCalled()
  })

  it("keeps everyone else in AllFantasy with an explanation, never at Spotify's 403", async () => {
    appUserFindUniqueMock.mockResolvedValue({ email: "stranger@x.com" })
    const loc = await start()
    expect(loc.host).toBe("allfantasy.test")
    expect(loc.pathname).toBe("/settings")
    expect(loc.searchParams.get("spotify")).toBe("not-available")
    expect(cookiesSetMock).not.toHaveBeenCalled()
  })

  it("lets an already-connected account reconnect", async () => {
    appUserFindUniqueMock.mockResolvedValue({ email: "stranger@x.com" })
    authAccountFindFirstMock.mockResolvedValue({ id: "acct1" })
    expect((await start()).host).toBe("accounts.spotify.com")
  })
})
