import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * `/leagues/[leagueId]/admin/model` — REDIRECT CONTRACT.
 *
 * ⚠ THIS FILE USED TO ASSERT THE GATE LIVED HERE, AND IT NO LONGER DOES.
 *
 * The screen moved onto the core shell (`b2ffe5dfc`) and this path became a redirect
 * stub to `/core/model-admin?league=<id>`. The four render tests that used to live here
 * — unauthenticated redirect, access-denied for non-admins, commissioner denial, panels
 * for admins — were asserting behaviour that deliberately moved, so they failed on every
 * run after the move and sat red on main because vitest does not run in CI.
 *
 * They are NOT deleted, they are RELOCATED: the gate itself is now covered by
 * `model-admin-authorization-policy.test.ts`, which exercises the real `lib/adminAuth`
 * predicate and pins the core page's gate expression. What belongs HERE is the one thing
 * this file still owns — that the old path forwards correctly and leaks nothing on the
 * way.
 *
 * Verified against production on 2026-08-28 before rewriting, so this encodes observed
 * behaviour rather than intent:
 *   /leagues/abc/admin/model      -> 307 /core/model-admin?league=abc
 *   /core/model-admin?league=abc  -> 307 /login?callbackUrl=%2Fcore%2Fmodel-admin
 */

const mocks = vi.hoisted(() => ({
  getAdminAccessState: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
}))

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/adminAuth", () => ({ getAdminAccessState: mocks.getAdminAccessState }))

async function loadPage() {
  const mod = await import("@/app/leagues/[leagueId]/admin/model/page")
  return mod.default
}

describe("league model-admin path forwards to the core shell", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("redirects to the core model-admin screen, carrying the league", async () => {
    const ModelAdminPage = await loadPage()

    await expect(ModelAdminPage({ params: { leagueId: "league-1" } })).rejects.toThrow(
      "redirect:/core/model-admin?league=league-1",
    )
  })

  it("awaits a promised params object (Next 15 passes it async)", async () => {
    const ModelAdminPage = await loadPage()

    await expect(
      ModelAdminPage({ params: Promise.resolve({ leagueId: "league-2" }) }),
    ).rejects.toThrow("redirect:/core/model-admin?league=league-2")
  })

  it("encodes the league id rather than splicing it into the query raw", async () => {
    // A league id is caller-controlled. Unencoded, `a&admin=1` would forge a second
    // query parameter on the destination.
    const ModelAdminPage = await loadPage()

    await expect(
      ModelAdminPage({ params: { leagueId: "a&admin=1 b/c" } }),
    ).rejects.toThrow("redirect:/core/model-admin?league=a%26admin%3D1%20b%2Fc")
  })

  it("does NOT evaluate the admin gate here — the destination owns it", async () => {
    /*
     * Deliberate, and the reason this assertion exists rather than a second gate:
     * duplicating `getAdminAccessState` on the stub would create a second predicate to
     * drift out of step with the real one. If someone adds a gate here, they must also
     * decide what happens when the two disagree — so make that a conscious change.
     */
    const ModelAdminPage = await loadPage()

    await expect(ModelAdminPage({ params: { leagueId: "league-3" } })).rejects.toThrow(
      /^redirect:/,
    )
    expect(mocks.getAdminAccessState).not.toHaveBeenCalled()
  })

  it("redirects before doing anything else, for every caller", async () => {
    const ModelAdminPage = await loadPage()

    for (const leagueId of ["league-a", "league-b"]) {
      await expect(ModelAdminPage({ params: { leagueId } })).rejects.toThrow(
        `redirect:/core/model-admin?league=${leagueId}`,
      )
    }
    expect(mocks.redirect).toHaveBeenCalledTimes(2)
  })
})
