// @vitest-environment node
/**
 * The iOS app opens at /core. Signed out, it lands on the landing page (owner's
 * call, 2026-09-29), not /login — the website keeps /login?callbackUrl=, and
 * deep links keep it too. "Signed in" is the dashboard's predicate: a non-empty
 * token.id, never token.sub alone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }))
vi.mock("@/lib/geo/geoIpFetch", () => ({ fetchIpApi: vi.fn(async () => null), fetchProxycheck: vi.fn(async () => null) }))

import { getToken } from "next-auth/jwt"
import { middleware } from "@/middleware"

const IOS_UA = "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AllFantasyiOS/1.0"
const SAFARI_UA = "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1"

function request(path: string, ua: string) {
  return new NextRequest(new URL(`https://www.allfantasy.ai${path}`), {
    headers: { "user-agent": ua, "cf-ipcountry": "US", "cf-region-code": "CA", "cf-connecting-ip": "198.51.100.99" },
  })
}
const location = (res: Response) => {
  const raw = res.headers.get("location")
  return raw ? new URL(raw) : null
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXTAUTH_SECRET = "test-nextauth-secret-not-a-real-credential"
})

describe("iOS app: signed-out /core lands on the landing page", () => {
  it("signed out in the app → the landing page", async () => {
    vi.mocked(getToken).mockResolvedValue(null)
    const res = await middleware(request("/core", IOS_UA))
    expect(res.status).toBe(307)
    expect(location(res)?.pathname).toBe("/")
  })

  it("a token with sub but no id is NOT signed in (the dashboard's predicate)", async () => {
    vi.mocked(getToken).mockResolvedValue({ sub: "u1" } as never)
    expect(location(await middleware(request("/core", IOS_UA)))?.pathname).toBe("/")
  })

  it("control: signed in, the app opens straight into /core", async () => {
    vi.mocked(getToken).mockResolvedValue({ sub: "u1", id: "u1", username: "someone" } as never)
    const res = await middleware(request("/core", IOS_UA))
    expect(location(res)?.pathname ?? null).not.toBe("/")
  })

  it("control: the website is unchanged — no landing redirect for Safari", async () => {
    vi.mocked(getToken).mockResolvedValue(null)
    const res = await middleware(request("/core", SAFARI_UA))
    expect(location(res)?.pathname ?? null).not.toBe("/")
  })

  it("a deep link in the app is left to the page's /login?callbackUrl=", async () => {
    vi.mocked(getToken).mockResolvedValue(null)
    const res = await middleware(request("/core/trades", IOS_UA))
    expect(location(res)?.pathname ?? null).not.toBe("/")
  })

  it("a query deep link in the app keeps its league — /core?league= is not bare /core", async () => {
    vi.mocked(getToken).mockResolvedValue(null)
    const res = await middleware(request("/core?league=42820255-aef6-4e6b-a6f5-34f968707bc7", IOS_UA))
    expect(location(res)?.pathname ?? null).not.toBe("/")
  })
})
