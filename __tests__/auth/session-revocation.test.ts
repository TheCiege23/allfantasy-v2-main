// @vitest-environment node
/**
 * Sign-out must end the session on the SERVER, not only in the device's cookie jar.
 *
 * Found 2026-09-29 in the iOS app: sign out, close the app, reopen — signed in again. The
 * WebView restored the old cookie, and a stateless JWT session has nothing server-side that
 * says it ended. These tests drive next-auth's REAL session handler with a REAL encrypted
 * session cookie, so they prove the behaviour that matters — the resurrected cookie is
 * refused AND next-auth answers by clearing it — not just that a helper returns true.
 *
 * Redis is Upstash over REST in production; here `fetch` stands in for it, keeping the SET
 * and MGET semantics the module relies on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { encode } from "next-auth/jwt"

const SECRET = "test-nextauth-secret-not-a-real-credential"

/** A tiny Upstash: SET key value [EX n] / GET / MGET, over the REST shape the module uses. */
const store = new Map<string, string>()
let redisDown = false
const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
  if (redisDown) throw new Error("ECONNREFUSED")
  const args = JSON.parse(String(init?.body)) as string[]
  const [cmd, ...rest] = args
  let result: unknown = null
  if (cmd === "SET") {
    store.set(rest[0], String(rest[1]))
    result = "OK"
  } else if (cmd === "GET") result = store.get(rest[0]) ?? null
  else if (cmd === "MGET") result = rest.map((k) => store.get(k) ?? null)
  return new Response(JSON.stringify({ result }), { status: 200 })
})

const ENV = ["NEXTAUTH_SECRET", "NEXTAUTH_URL", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))

beforeEach(() => {
  store.clear()
  redisDown = false
  fetchSpy.mockClear()
  vi.stubGlobal("fetch", fetchSpy)
  process.env.NEXTAUTH_SECRET = SECRET
  process.env.NEXTAUTH_URL = "https://www.allfantasy.ai"
  process.env.UPSTASH_REDIS_REST_URL = "https://upstash.test"
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-upstash-token-not-real"
})

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  const { __resetSessionRevocationCache } = await import("@/lib/auth/sessionRevocation")
  __resetSessionRevocationCache()
})

const COOKIE = "__Secure-next-auth.session-token"

async function sessionRequest(cookieValue: string) {
  const { AuthHandler } = await import("../../node_modules/next-auth/core/index.js")
  const { authOptions } = await import("@/lib/auth")
  return AuthHandler({
    req: {
      action: "session",
      method: "GET",
      host: "https://www.allfantasy.ai",
      cookies: { [COOKIE]: cookieValue },
      headers: {},
      query: {},
      body: {},
    },
    options: authOptions,
  }) as Promise<{ body?: Record<string, unknown>; cookies?: Array<{ name: string; value: string; options?: { maxAge?: number; expires?: Date } }> }>
}

const cookieFor = (token: Record<string, unknown>) => encode({ token, secret: SECRET, maxAge: 30 * 24 * 60 * 60 })
const USER = { id: "u-1", sub: "u-1", email: "a@b.test", name: "A", username: "a" }

describe("sign-out ends the session on the server", () => {
  it("control: a live session is served, and the cookie is re-issued (not cleared)", async () => {
    const res = await sessionRequest(await cookieFor({ ...USER, sid: "sid-live" }))
    expect((res.body as { user?: { id?: string } })?.user?.id).toBe("u-1")
    const sessionCookie = res.cookies?.find((c) => c.name === COOKIE)
    expect(sessionCookie?.value).toBeTruthy()
  })

  it("a cookie that comes back after sign-out is refused AND cleared by next-auth", async () => {
    const { authOptions } = await import("@/lib/auth")
    const token = { ...USER, sid: "sid-phone" }
    const cookie = await cookieFor(token)

    // Sign out: next-auth calls events.signOut with the decoded token.
    await authOptions.events!.signOut!({ token } as never)
    expect(store.get("af:auth:revoked-sid:sid-phone")).toBe("1")

    // The device kept (or restored) the old cookie and sends it again.
    const res = await sessionRequest(cookie)
    expect(res.body?.user).toBeUndefined()
    const cleared = res.cookies?.find((c) => c.name === COOKIE)
    expect(cleared?.value).toBe("")
  })

  it("signing out on one device does not sign out another", async () => {
    const { authOptions } = await import("@/lib/auth")
    await authOptions.events!.signOut!({ token: { ...USER, sid: "sid-phone" } } as never)
    const res = await sessionRequest(await cookieFor({ ...USER, sid: "sid-laptop" }))
    expect((res.body as { user?: { id?: string } })?.user?.id).toBe("u-1")
  })

  it("a session from before sids existed: sign-out revokes that user's sessions issued up to now", async () => {
    const { authOptions } = await import("@/lib/auth")
    const oldIat = Math.floor(Date.now() / 1000) - 3600
    const legacy = { ...USER, iat: oldIat }
    await authOptions.events!.signOut!({ token: legacy } as never)
    const { isSessionRevoked, __resetSessionRevocationCache } = await import("@/lib/auth/sessionRevocation")
    __resetSessionRevocationCache()
    expect(await isSessionRevoked(legacy)).toBe(true)
    // A new sign-in afterwards (later iat, own sid) is unaffected.
    expect(await isSessionRevoked({ ...USER, sid: "sid-new", iat: Math.floor(Date.now() / 1000) + 5 })).toBe(false)
  })

  it("sign-in stamps a fresh sid, so each login is revocable on its own", async () => {
    const { authOptions } = await import("@/lib/auth")
    const a = await authOptions.callbacks!.jwt!({ token: { sub: "u-1" }, user: { id: "u-1", email: "a@b.test" } } as never)
    const b = await authOptions.callbacks!.jwt!({ token: { sub: "u-1" }, user: { id: "u-1", email: "a@b.test" } } as never)
    expect(typeof a.sid).toBe("string")
    expect(a.sid).not.toBe(b.sid)
  })

  it("fails OPEN when Redis is unreachable: nobody is signed out by an outage", async () => {
    redisDown = true
    const res = await sessionRequest(await cookieFor({ ...USER, sid: "sid-any" }))
    expect((res.body as { user?: { id?: string } })?.user?.id).toBe("u-1")
  })

  it("account deletion revokes every session the user holds", async () => {
    const { revokeAllSessionsForUser, isSessionRevoked, __resetSessionRevocationCache } = await import("@/lib/auth/sessionRevocation")
    const iat = Math.floor(Date.now() / 1000) - 10
    await revokeAllSessionsForUser("u-1")
    __resetSessionRevocationCache()
    expect(await isSessionRevoked({ ...USER, sid: "sid-a", iat })).toBe(true)
    expect(await isSessionRevoked({ ...USER, sid: "sid-b", iat })).toBe(true)
    expect(await isSessionRevoked({ id: "u-2", sid: "sid-c", iat })).toBe(false)
  })
})
