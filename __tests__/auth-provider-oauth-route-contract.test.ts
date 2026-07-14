import { beforeEach, describe, expect, it, vi } from "vitest"

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"

const getServerSessionMock = vi.hoisted(() => vi.fn())
const cookiesMock = vi.hoisted(() => vi.fn())
const encryptMock = vi.hoisted(() => vi.fn((value: string) => `enc:${value}`))
const decryptMock = vi.hoisted(() => vi.fn())

const yahooConnectionUpsertMock = vi.hoisted(() => vi.fn())
const leagueAuthUpsertMock = vi.hoisted(() => vi.fn())
const userProfileUpsertMock = vi.hoisted(() => vi.fn())
const userProfileFindUniqueMock = vi.hoisted(() => vi.fn())
const userProfileUpdateMock = vi.hoisted(() => vi.fn())
const authAccountFindFirstMock = vi.hoisted(() => vi.fn())
const authAccountUpdateMock = vi.hoisted(() => vi.fn())
const authAccountDeleteManyMock = vi.hoisted(() => vi.fn())
const authAccountCreateMock = vi.hoisted(() => vi.fn())

vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}))

vi.mock("@/lib/telemetry/usage", () => ({
  withApiUsage:
    () =>
    <T extends (...args: any[]) => any>(handler: T) =>
      handler,
}))

vi.mock("@/lib/league-auth-crypto", () => ({
  encrypt: encryptMock,
  decrypt: decryptMock,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    yahooConnection: {
      upsert: yahooConnectionUpsertMock,
    },
    leagueAuth: {
      upsert: leagueAuthUpsertMock,
    },
    userProfile: {
      upsert: userProfileUpsertMock,
      findUnique: userProfileFindUniqueMock,
      update: userProfileUpdateMock,
    },
    authAccount: {
      findFirst: authAccountFindFirstMock,
      update: authAccountUpdateMock,
      deleteMany: authAccountDeleteManyMock,
      create: authAccountCreateMock,
    },
  },
}))

describe("Auth provider OAuth route contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.YAHOO_CLIENT_ID = "test-yahoo-client-id"
    process.env.YAHOO_CLIENT_SECRET = "test-yahoo-client-secret"
    process.env.DISCORD_CLIENT_SECRET = "test-discord-client-secret"

    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } })
    cookiesMock.mockReturnValue({
      get: vi.fn((name: string) => {
        if (name === "discord_oauth_state") return { value: "expected-state" }
        if (name === "discord_oauth_user_id") return { value: "u1" }
        return undefined
      }),
      delete: vi.fn(),
    })

    userProfileFindUniqueMock.mockResolvedValue({ discordAccessToken: null })
    userProfileUpdateMock.mockResolvedValue({})
    authAccountFindFirstMock.mockResolvedValue(null)
    authAccountUpdateMock.mockResolvedValue({})
    authAccountDeleteManyMock.mockResolvedValue({ count: 0 })
    authAccountCreateMock.mockResolvedValue({})
    yahooConnectionUpsertMock.mockResolvedValue({})
    leagueAuthUpsertMock.mockResolvedValue({})
    userProfileUpsertMock.mockResolvedValue({})

    vi.stubGlobal("fetch", vi.fn())
  })

  it("Discord callback redirects to login when session is missing", async () => {
    getServerSessionMock.mockResolvedValueOnce(null)

    const { GET } = await import("@/app/api/auth/discord/callback/route")
    const res = await GET(
      createMockNextRequest("http://localhost:3000/api/auth/discord/callback?code=abc&state=expected-state") as any
    )

    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login?callbackUrl=%2Fsettings%3Ftab%3Dconnected")
  })

  it("Discord callback rejects invalid state/user binding", async () => {
    const deleteMock = vi.fn()
    cookiesMock.mockReturnValueOnce({
      get: vi.fn((name: string) => {
        if (name === "discord_oauth_state") return { value: "expected-state" }
        if (name === "discord_oauth_user_id") return { value: "different-user" }
        return undefined
      }),
      delete: deleteMock,
    })

    const { GET } = await import("@/app/api/auth/discord/callback/route")
    const res = await GET(
      createMockNextRequest("http://localhost:3000/api/auth/discord/callback?code=abc&state=expected-state") as any
    )

    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/settings?tab=connected&discord=error")
    expect(deleteMock).toHaveBeenCalledWith("discord_oauth_state")
    expect(deleteMock).toHaveBeenCalledWith("discord_oauth_user_id")
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("Yahoo callback rejects invalid OAuth state/user binding", async () => {
    const { GET } = await import("@/app/api/auth/yahoo/callback/route")
    const req = createMockNextRequest(
      "http://localhost:3000/api/auth/yahoo/callback?code=abc&state=expected-state",
      {
        headers: {
          cookie: "yahoo_oauth_state=expected-state; yahoo_oauth_user_id=different-user",
        },
      }
    )

    const res = await GET(req as any)

    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/af-legacy?yahoo_error=invalid_state")
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("Yahoo callback rejects missing code before token exchange", async () => {
    const { GET } = await import("@/app/api/auth/yahoo/callback/route")
    const req = createMockNextRequest("http://localhost:3000/api/auth/yahoo/callback?state=expected-state", {
      headers: {
        cookie: "yahoo_oauth_state=expected-state; yahoo_oauth_user_id=u1",
      },
    })

    const res = await GET(req as any)

    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/af-legacy?yahoo_error=no_code")
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("Yahoo callback bridges the real token into LeagueAuth so the commissioner-import pipeline can see it (Yahoo certification phase)", async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "real-access-token", refresh_token: "real-refresh-token", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          fantasy_content: { users: [{ user: [{ guid: "yahoo-guid-1", profile: { display_name: "Real User" } }] }] },
        }),
      })

    const { GET } = await import("@/app/api/auth/yahoo/callback/route")
    const req = createMockNextRequest(
      "http://localhost:3000/api/auth/yahoo/callback?code=abc&state=expected-state",
      { headers: { cookie: "yahoo_oauth_state=expected-state; yahoo_oauth_user_id=u1" } }
    )

    const res = await GET(req as any)

    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("yahoo_connected=1")
    expect(yahooConnectionUpsertMock).toHaveBeenCalled()
    expect(leagueAuthUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_platform: { userId: "u1", platform: "yahoo" } },
        create: expect.objectContaining({ userId: "u1", platform: "yahoo", oauthToken: "enc:real-access-token" }),
      })
    )
  })

  it("Discord disconnect keeps compatibility with legacy plaintext token", async () => {
    userProfileFindUniqueMock.mockResolvedValueOnce({ discordAccessToken: "legacy-plain-token" })
    decryptMock.mockImplementationOnce(() => {
      throw new Error("legacy token")
    })
    ;(global.fetch as any).mockResolvedValue({ ok: true })

    const { POST } = await import("@/app/api/auth/discord/disconnect/route")
    const res = await POST()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ success: true })
    expect(global.fetch).toHaveBeenCalled()
    const revokeBody = ((global.fetch as any).mock.calls[0]?.[1]?.body as URLSearchParams).get("token")
    expect(revokeBody).toBe("legacy-plain-token")
    expect(userProfileUpdateMock).toHaveBeenCalled()
  })

  it("Spotify callback upserts profile connection and returns to connected settings tab", async () => {
    process.env.SPOTIFY_CLIENT_ID = "spotify-client-id"
    process.env.SPOTIFY_CLIENT_SECRET = "spotify-client-secret"
    cookiesMock.mockReturnValueOnce({
      get: vi.fn((name: string) => {
        if (name === "spotify_oauth_state") return { value: "spotify-state" }
        if (name === "spotify_oauth_user_id") return { value: "u1" }
        return undefined
      }),
      delete: vi.fn(),
    })
    ;(global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "spotify-access",
          refresh_token: "spotify-refresh",
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "spotify-user-1", display_name: "Founder Spotify" }),
      })

    const { GET } = await import("@/app/api/auth/spotify/callback/route")
    const res = await GET(
      createMockNextRequest("http://localhost:3000/api/auth/spotify/callback?code=abc&state=spotify-state") as any
    )

    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/settings?tab=connected&spotify=connected")
    expect(userProfileUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1" },
        create: expect.objectContaining({
          userId: "u1",
          spotifyAccessToken: "spotify-access",
          spotifyRefreshToken: "spotify-refresh",
          spotifyDisplayName: "Founder Spotify",
        }),
        update: expect.objectContaining({
          spotifyAccessToken: "spotify-access",
          spotifyRefreshToken: "spotify-refresh",
          spotifyDisplayName: "Founder Spotify",
        }),
      })
    )
    expect(authAccountCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u1",
          provider: "spotify",
          providerAccountId: "spotify-user-1",
          access_token: "spotify-access",
          refresh_token: "spotify-refresh",
        }),
      })
    )
  })
})
