/**
 * Spotify playlist picker + playback: the listener's own playlists, started on the
 * AllFantasy in-browser player.
 *
 * Every Spotify response here is a hand-built double — no live call. Shapes follow
 * Spotify's Web API reference as of the February 2026 Development Mode changes, which
 * renamed the playlist's `tracks` field to `items` and removed `product` from GET /v1/me.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const getServerSessionMock = vi.hoisted(() => vi.fn())
const userProfileFindUniqueMock = vi.hoisted(() => vi.fn())
const userProfileUpdateManyMock = vi.hoisted(() => vi.fn())
const authAccountFindFirstMock = vi.hoisted(() => vi.fn())
const authAccountUpdateMock = vi.hoisted(() => vi.fn())

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    userProfile: { findUnique: userProfileFindUniqueMock, updateMany: userProfileUpdateManyMock },
    authAccount: { findFirst: authAccountFindFirstMock, update: authAccountUpdateMock },
  },
}))

import {
  describePlaybackGap,
  inspectPlaybackScopes,
  inspectPlaylistScopes,
  PREMIUM_REQUIRED_MESSAGE,
} from "@/lib/spotify/playbackCapability"
import { SPOTIFY_SCOPE_LIST } from "@/lib/spotify/scopes"
import { readStoredPremium } from "@/lib/spotify/userAccess"
import {
  isValidContextUri,
  isValidDeviceId,
  listMyPlaylists,
  normalizePlaylist,
  startPlaylistPlayback,
} from "@/lib/spotify/webApi"

const PLAYLIST_ID = "37i9dQZF1DXcBWIGoYBM5M"
const PLAYLIST_URI = `spotify:playlist:${PLAYLIST_ID}`
const DEVICE_ID = "0d1841b0976bae2a3a310dd74c0f3df354899bc8"
const FULL_SCOPE = SPOTIFY_SCOPE_LIST.join(" ")

function jsonResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function fetchMock() {
  return global.fetch as unknown as ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  process.env.SPOTIFY_CLIENT_ID = "spotify-client"
  process.env.SPOTIFY_CLIENT_SECRET = "spotify-secret"
  getServerSessionMock.mockResolvedValue({ user: { id: "u1" } })
  vi.stubGlobal("fetch", vi.fn())
})

function connectedAccount(scope: string | null = FULL_SCOPE, prefs: Record<string, unknown> = {}) {
  userProfileFindUniqueMock.mockResolvedValue({
    notificationPreferences: { spotify: prefs },
    spotifyAccessToken: null,
    spotifyRefreshToken: null,
    spotifyExpiresAt: null,
    spotifyDisplayName: "Founder",
    spotifyConnectedAt: new Date(),
  })
  authAccountFindFirstMock.mockResolvedValue({
    id: "acct1",
    access_token: "live-access",
    refresh_token: "live-refresh",
    expires_at: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
    scope,
  })
}

describe("scopes", () => {
  it("requests the playlist scopes so private playlists are listed", () => {
    expect(SPOTIFY_SCOPE_LIST).toContain("playlist-read-private")
    expect(SPOTIFY_SCOPE_LIST).toContain("playlist-read-collaborative")
  })

  it("flags a grant made before the playlist scopes as public-only", () => {
    const old = "user-read-email user-read-private streaming user-read-playback-state user-modify-playback-state"
    expect(inspectPlaylistScopes(old)).toEqual({
      canListPrivate: false,
      missing: ["playlist-read-private", "playlist-read-collaborative"],
    })
    expect(inspectPlaylistScopes(FULL_SCOPE).canListPrivate).toBe(true)
    expect(inspectPlaylistScopes(null).canListPrivate).toBe(false)
  })
})

describe("Premium is three-valued: unknown is not free", () => {
  const playable = inspectPlaybackScopes(FULL_SCOPE)

  it("does not block playback when Spotify did not report the tier", () => {
    expect(describePlaybackGap(playable, null)).toBeNull()
  })

  it("still blocks a tier Spotify reported as free", () => {
    expect(describePlaybackGap(playable, false)).toBe(PREMIUM_REQUIRED_MESSAGE)
  })

  it("distrusts a stored false that Spotify did not supply", () => {
    // The pre-fix callback wrote `product === 'premium'`, so an absent product became false.
    expect(readStoredPremium({ isPremium: false })).toBeNull()
    expect(readStoredPremium({ isPremium: true })).toBeNull()
    expect(readStoredPremium({ isPremium: false, premiumSource: "spotify-product" })).toBe(false)
    expect(readStoredPremium({ isPremium: true, premiumSource: "spotify-product" })).toBe(true)
  })
})

describe("normalizePlaylist", () => {
  const base = {
    id: PLAYLIST_ID,
    name: "Draft Night",
    uri: PLAYLIST_URI,
    owner: { display_name: "Guap" },
    images: [
      { url: "https://i.scdn.co/image/large", width: 640 },
      { url: "https://i.scdn.co/image/small", width: 60 },
    ],
  }

  it("reads the count from `items` (Development Mode, after Feb 2026)", () => {
    expect(normalizePlaylist({ ...base, items: { total: 42 } })).toEqual({
      id: PLAYLIST_ID,
      name: "Draft Night",
      uri: PLAYLIST_URI,
      imageUrl: "https://i.scdn.co/image/small",
      trackCount: 42,
      ownerName: "Guap",
    })
  })

  it("reads the count from `tracks` (extended quota apps)", () => {
    expect(normalizePlaylist({ ...base, tracks: { total: 7 } })?.trackCount).toBe(7)
  })

  it("reports null, never 0, when Spotify omits the contents", () => {
    expect(normalizePlaylist(base)?.trackCount).toBeNull()
  })

  it("drops entries whose id is not a Spotify id", () => {
    expect(normalizePlaylist({ ...base, id: "../../me" })).toBeNull()
    expect(normalizePlaylist(null)).toBeNull()
  })

  it("rebuilds the uri from the id when the uri is malformed", () => {
    expect(normalizePlaylist({ ...base, uri: "javascript:alert(1)" })?.uri).toBe(PLAYLIST_URI)
  })
})

describe("input validation", () => {
  it("accepts only Spotify context uris", () => {
    expect(isValidContextUri(PLAYLIST_URI)).toBe(true)
    expect(isValidContextUri(`${PLAYLIST_URI}?x=1`)).toBe(false)
    expect(isValidContextUri("spotify:user:abc")).toBe(false)
    expect(isValidContextUri(42)).toBe(false)
  })

  it("accepts only alphanumeric device ids", () => {
    expect(isValidDeviceId(DEVICE_ID)).toBe(true)
    expect(isValidDeviceId("abc&device_id=other")).toBe(false)
    expect(isValidDeviceId("")).toBe(false)
  })
})

describe("listMyPlaylists", () => {
  it("follows `next` across pages", async () => {
    fetchMock()
      .mockResolvedValueOnce(jsonResponse(200, { items: [{ id: PLAYLIST_ID, name: "A" }], next: "page2" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { items: [{ id: "1A2B3C4D5E6F7G8H9I0J1K", name: "B" }], next: null })
      )
    const result = await listMyPlaylists("tok")
    expect(result).toMatchObject({ ok: true, truncated: false })
    if (result.ok) expect(result.playlists.map((p) => p.name)).toEqual(["A", "B"])
    expect(fetchMock().mock.calls[1][0]).toContain("offset=50")
  })

  it("keeps the first page when a later page fails", async () => {
    fetchMock()
      .mockResolvedValueOnce(jsonResponse(200, { items: [{ id: PLAYLIST_ID, name: "A" }], next: "page2" }))
      .mockResolvedValueOnce(jsonResponse(500))
    const result = await listMyPlaylists("tok")
    expect(result).toMatchObject({ ok: true, truncated: true })
  })

  it("reports the status when the first page fails", async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse(401))
    expect(await listMyPlaylists("tok")).toEqual({ ok: false, status: 401 })
  })
})

describe("startPlaylistPlayback", () => {
  it("plays the playlist on the given device", async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse(204))
    expect(await startPlaylistPlayback("tok", DEVICE_ID, PLAYLIST_URI)).toEqual({ ok: true })
    const [url, init] = fetchMock().mock.calls[0]
    expect(url).toBe(`https://api.spotify.com/v1/me/player/play?device_id=${DEVICE_ID}`)
    expect(init.method).toBe("PUT")
    expect(JSON.parse(init.body)).toEqual({ context_uri: PLAYLIST_URI })
  })

  it("transfers to a just-registered device on 404, then retries exactly once", async () => {
    fetchMock()
      .mockResolvedValueOnce(jsonResponse(404, { error: { reason: "NO_ACTIVE_DEVICE" } }))
      .mockResolvedValueOnce(jsonResponse(204))
      .mockResolvedValueOnce(jsonResponse(204))
    expect(await startPlaylistPlayback("tok", DEVICE_ID, PLAYLIST_URI)).toEqual({ ok: true })
    expect(fetchMock()).toHaveBeenCalledTimes(3)
    const [transferUrl, transferInit] = fetchMock().mock.calls[1]
    expect(transferUrl).toBe("https://api.spotify.com/v1/me/player")
    expect(JSON.parse(transferInit.body)).toEqual({ device_ids: [DEVICE_ID], play: false })
  })

  it("gives up after one retry", async () => {
    fetchMock()
      .mockResolvedValueOnce(jsonResponse(404))
      .mockResolvedValueOnce(jsonResponse(204))
      .mockResolvedValueOnce(jsonResponse(404))
    expect(await startPlaylistPlayback("tok", DEVICE_ID, PLAYLIST_URI)).toMatchObject({
      ok: false,
      reason: "device_not_found",
    })
    expect(fetchMock()).toHaveBeenCalledTimes(3)
  })

  it("separates a Premium refusal from a missing-permission 403", async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse(403, { error: { reason: "PREMIUM_REQUIRED" } }))
    expect(await startPlaylistPlayback("tok", DEVICE_ID, PLAYLIST_URI)).toMatchObject({
      reason: "premium_required",
    })
    fetchMock().mockResolvedValueOnce(jsonResponse(403, { error: { message: "Insufficient client scope" } }))
    expect(await startPlaylistPlayback("tok", DEVICE_ID, PLAYLIST_URI)).toMatchObject({
      reason: "forbidden",
    })
  })
})

describe("POST /api/spotify/play", () => {
  async function post(body: unknown) {
    const { POST } = await import("@/app/api/spotify/play/route")
    return POST({ json: async () => body } as any)
  }

  it("rejects a malformed device id before touching Spotify", async () => {
    connectedAccount()
    const res = await post({ deviceId: "x&y", contextUri: PLAYLIST_URI })
    expect(res.status).toBe(400)
    expect(fetchMock()).not.toHaveBeenCalled()
  })

  it("rejects a non-Spotify uri before touching Spotify", async () => {
    connectedAccount()
    const res = await post({ deviceId: DEVICE_ID, contextUri: "https://evil.example" })
    expect(res.status).toBe(400)
    expect(fetchMock()).not.toHaveBeenCalled()
  })

  it("starts playback with the listener's own token", async () => {
    connectedAccount()
    fetchMock().mockResolvedValueOnce(jsonResponse(204))
    const res = await post({ deviceId: DEVICE_ID, contextUri: PLAYLIST_URI })
    expect(res.status).toBe(200)
    expect(fetchMock().mock.calls[0][1].headers.Authorization).toBe("Bearer live-access")
  })

  it("says Premium only when Spotify said Premium", async () => {
    connectedAccount()
    fetchMock().mockResolvedValueOnce(jsonResponse(403, { error: { reason: "PREMIUM_REQUIRED" } }))
    const res = await post({ deviceId: DEVICE_ID, contextUri: PLAYLIST_URI })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe(PREMIUM_REQUIRED_MESSAGE)
  })

  it("requires a session", async () => {
    getServerSessionMock.mockResolvedValueOnce(null)
    const res = await post({ deviceId: DEVICE_ID, contextUri: PLAYLIST_URI })
    expect(res.status).toBe(401)
  })
})

describe("GET /api/spotify/playlists", () => {
  it("returns playlists and no notice for a full grant", async () => {
    connectedAccount()
    fetchMock().mockResolvedValueOnce(
      jsonResponse(200, { items: [{ id: PLAYLIST_ID, name: "Draft Night", items: { total: 3 } }], next: null })
    )
    const { GET } = await import("@/app/api/spotify/playlists/route")
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.playlists).toHaveLength(1)
    expect(body.notice).toBeNull()
    expect(res.headers.get("Cache-Control")).toContain("no-store")
  })

  it("tells an old grant it is only seeing public playlists", async () => {
    connectedAccount("user-read-email user-read-private streaming user-read-playback-state user-modify-playback-state")
    fetchMock().mockResolvedValueOnce(jsonResponse(200, { items: [], next: null }))
    const { GET } = await import("@/app/api/spotify/playlists/route")
    const body = await (await GET()).json()
    expect(body.canListPrivate).toBe(false)
    expect(body.notice).toMatch(/Reconnect Spotify/)
  })

  it("is 404 when Spotify is not connected", async () => {
    userProfileFindUniqueMock.mockResolvedValue(null)
    authAccountFindFirstMock.mockResolvedValue(null)
    const { GET } = await import("@/app/api/spotify/playlists/route")
    expect((await GET()).status).toBe(404)
    expect(fetchMock()).not.toHaveBeenCalled()
  })
})

describe("GET /api/spotify/token after the refactor", () => {
  it("no longer tells a Premium-unknown listener to buy Premium", async () => {
    // isPremium:false WITHOUT premiumSource is exactly what the old callback wrote.
    connectedAccount(FULL_SCOPE, { isPremium: false })
    const { GET } = await import("@/app/api/spotify/token/route")
    const body = await (await GET()).json()
    expect(body.isPremium).toBeNull()
    expect(body.playbackMessage).toBeNull()
    expect(body.canPlay).toBe(true)
    expect(body.canListPrivatePlaylists).toBe(true)
  })

  it("reports the scope gap on the refresh path too", async () => {
    userProfileFindUniqueMock.mockResolvedValue({ notificationPreferences: {}, spotifyConnectedAt: new Date() })
    authAccountFindFirstMock.mockResolvedValue({
      id: "acct1",
      access_token: "stale",
      refresh_token: "r",
      expires_at: Math.floor((Date.now() - 60_000) / 1000),
      scope: "user-read-email",
    })
    fetchMock().mockResolvedValueOnce(jsonResponse(200, { access_token: "fresh", expires_in: 3600 }))
    const { GET } = await import("@/app/api/spotify/token/route")
    const body = await (await GET()).json()
    expect(body.token).toBe("fresh")
    expect(body.needsReauthorization).toBe(true)
    expect(body.playbackMessage).toMatch(/Reconnect/)
    expect(authAccountUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "acct1" }, data: expect.objectContaining({ access_token: "fresh" }) })
    )
  })
})
