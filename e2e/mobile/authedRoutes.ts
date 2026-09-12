/**
 * The authenticated routes the phone gate certifies, and which seeded role each
 * one needs.
 *
 * 🛑 IT LIVES IN ITS OWN MODULE SO THE BASELINE PIN CAN BE REAL. The coverage
 * test previously asserted the baseline's route keys against a HARDCODED LIST:
 *
 *     expect(Object.keys(authed.routes).sort()).toEqual(["/core/trades"])
 *
 * which catches BASELINE drift and is blind to SPEC drift. Adding
 * `/commissioner-os` to the spec without baselining it changed nothing — 29 tests
 * still passed. The invariant everyone assumed was in force ("baseline covers
 * exactly the routes the spec visits") was really "baseline equals this literal",
 * and the two diverge silently the moment a route is added.
 *
 * ⚠ The spec cannot be imported by the test to derive this — importing a
 * Playwright spec executes its `test()` registrations. A constants module is the
 * same shape as `seed-redraft-trade-walkthrough.constants.ts`, and for the same
 * reason: the thing both sides need is data, so it should not live inside
 * something with side effects.
 *
 * ⚠ THE ROLE IS PART OF THE ROUTE, NOT A DETAIL. `/commissioner-os` gates on
 * COMMISSIONING a league — `app/commissioner-os/layout.tsx:65` redirects to
 * `/login` without a session, and its own comment describes the commissioner
 * check as a side effect of `listActiveLeaguesForUser`: "no leagues IS not a
 * commissioner". A seeded MANAGER lands on `/login` there, which the spec's
 * premise guard reports as a redirect rather than measuring the wrong page.
 */
export type AuthedRole = "manager" | "commissioner"

export type AuthedRoute = {
  route: string
  login: AuthedRole
}

export const AUTHED_ROUTES: readonly AuthedRoute[] = [
  { route: "/core/trades", login: "manager" },
  { route: "/commissioner-os", login: "commissioner" },
] as const
