/**
 * `resolveActiveLeagueId` — the league-selector cookie override, and the two very
 * different things `cookies()` can throw.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────
 *
 * The cookie override shipped in `6104959ef` with no direct coverage at all, and it
 * took `main` red on five files across three shards: `resolveActiveLeagueId()` called
 * `cookies()` unconditionally, a vitest run has no request scope, so every live.ts
 * suite that reached it died on `next-dynamic-api-wrong-context` — 44 failed / 20
 * passed across the five Commissioner OS live-integration suites. With `strict: true`
 * and four required unit shards, that blocked every PR in the repo, not just its own.
 *
 * 🛑 THE FIX IS A NARROW `catch`, AND THE NARROWNESS IS THE WHOLE POINT — SO IT IS
 * WHAT THIS FILE PINS. `cookies()` throws two things that must be handled OPPOSITELY:
 *
 *   - a PLAIN `Error` with no `digest`, outside a request scope. Safe to swallow:
 *     with no request there is no user cookie, so there is no override, and the
 *     default is the correct answer.
 *   - Next's `DynamicServerError`, carrying `digest: 'DYNAMIC_SERVER_USAGE'`, during
 *     prerendering. This is a SIGNAL, not a failure — it is how Next learns the route
 *     is dynamic. Swallowing it would let a page that reads a per-user cookie be
 *     statically cached and serve one commissioner's league to everyone.
 *
 * A bare `catch {}` passes the first four tests here and silently causes that
 * production bug. The digest test is the one that would catch it, so it is written
 * as a real assertion rather than left to review.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const getServerSessionMock = vi.hoisted(() => vi.fn())
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

const prismaMock = vi.hoisted(() => ({
  roster: { findMany: vi.fn() },
}))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

const cookiesMock = vi.hoisted(() => vi.fn())
vi.mock("next/headers", () => ({ cookies: cookiesMock }))

import { resolveActiveLeagueId } from "@/lib/commissioner-ui/resolveActiveLeagueId"
import { ACTIVE_LEAGUE_COOKIE_KEY } from "@/lib/commissioner-ui/activeLeague/constants"

/** Two leagues this user genuinely owns, most-recent-roster first. */
function withOwnedLeagues() {
  getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } })
  prismaMock.roster.findMany.mockResolvedValue([
    { league: { id: "lg-newest", status: "active", name: "Newest" } },
    { league: { id: "lg-older", status: "active", name: "Older" } },
  ])
}

/** A cookie jar holding one value, in the shape `cookies()` returns. */
function cookieJar(value: string | undefined) {
  cookiesMock.mockResolvedValue({
    get: (key: string) => (key === ACTIVE_LEAGUE_COOKIE_KEY && value ? { value } : undefined),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("resolveActiveLeagueId — cookie override", () => {
  it("honours a cookie naming a league this user owns", async () => {
    withOwnedLeagues()
    cookieJar("lg-older")
    // Not the most-recent roster — proving the cookie actually decided it.
    await expect(resolveActiveLeagueId()).resolves.toBe("lg-older")
  })

  it("falls back to the most recent roster when no cookie is set", async () => {
    withOwnedLeagues()
    cookieJar(undefined)
    await expect(resolveActiveLeagueId()).resolves.toBe("lg-newest")
  })

  it("🛑 ignores a cookie naming a league this user does NOT own", async () => {
    withOwnedLeagues()
    cookieJar("lg-someone-elses")
    // The security property: a tampered or stale cookie can only ever resolve to a
    // league this session already owns, never someone else's.
    await expect(resolveActiveLeagueId()).resolves.toBe("lg-newest")
  })
})

describe("resolveActiveLeagueId — what cookies() throws", () => {
  it("degrades to the default outside a request scope, rather than throwing", async () => {
    withOwnedLeagues()
    // Byte-for-byte the error Next 14 throws from `getExpectedRequestStore`: a plain
    // Error, no digest. This is the one that took main red.
    cookiesMock.mockRejectedValue(
      new Error(
        "`cookies` was called outside a request scope. Read more: https://nextjs.org/docs/messages/next-dynamic-api-wrong-context",
      ),
    )
    await expect(resolveActiveLeagueId()).resolves.toBe("lg-newest")
  })

  it("🛑 RETHROWS Next's DynamicServerError instead of swallowing it", async () => {
    withOwnedLeagues()
    // Next signals "this route is dynamic" by throwing this during prerendering. If it
    // is swallowed, a page reading a per-user cookie can be statically cached and serve
    // one commissioner's league to every visitor. A bare `catch {}` fails exactly here.
    const dynamicError = Object.assign(new Error("Dynamic server usage: cookies"), {
      digest: "DYNAMIC_SERVER_USAGE",
    })
    cookiesMock.mockRejectedValue(dynamicError)
    await expect(resolveActiveLeagueId()).rejects.toBe(dynamicError)
  })

  it("🛑 RETHROWS other digest-carrying control-flow signals (redirect / notFound)", async () => {
    withOwnedLeagues()
    // `redirect()` and `notFound()` are implemented as thrown digest-carrying errors
    // too. Swallowing one would strand the user on the page it was meant to leave.
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" })
    cookiesMock.mockRejectedValue(redirect)
    await expect(resolveActiveLeagueId()).rejects.toBe(redirect)
  })

  it("never reads the cookie at all when the user owns no leagues", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } })
    prismaMock.roster.findMany.mockResolvedValue([])
    await expect(resolveActiveLeagueId()).resolves.toBeNull()
    // The early return runs first, so a scopeless context cannot even be reached here.
    expect(cookiesMock).not.toHaveBeenCalled()
  })
})
