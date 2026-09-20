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
  /**
   * Visit this route with `?league=<the seeded NFL league>` appended.
   *
   * 🛑 WITHOUT IT, `/core/my-team` CERTIFIES THE WRONG SCREEN AND STILL PASSES.
   * `app/core/[[...screen]]/page.tsx:2037` only loads `getMyTeamData` when a
   * league is in context; with none it renders `getMyTeamPulse`, the cross-league
   * "pick a league" board. Both live at the same pathname, so the premise guard
   * cannot tell them apart — the lane would report a green My Team that had never
   * rendered a roster.
   *
   * ⚠ THE GUARD STILL COMPARES `pathname`, NOT THE FULL URL, so a query string
   * does not weaken it. `route` stays the bare path and remains the baseline key.
   */
  leagueScoped?: boolean
}

/*
 * ⚠ `/core` IS THE HOME SCREEN, AND IT WAS THE LAST ROUTE ANYONE WOULD HAVE
 * GUESSED WAS UNMEASURED. The lane certified `/core/trades` and
 * `/commissioner-os`, so "the authenticated phone gate is on" read as "the app is
 * covered" — while the screen every signed-in manager lands on first had never
 * been rendered at 390px by anything automated.
 *
 * 🛑 THE RULE IS NOT "ADD MORE ROUTES". IT IS THAT A GATE'S REACH IS ITS ROUTE
 * LIST AND NOTHING ELSE. Each entry costs a login and a page load, so this stays
 * a deliberate list rather than a crawl — but the screens on it should be the ones
 * a phone actually opens, and the home screen is the first of those.
 *
 * ⚠ AND WHAT ADDING IT FOUND IS AN HONEST "ALMOST NOTHING", RECORDED BECAUSE THE
 * FIRST DRAFT OF THIS COMMENT CLAIMED OTHERWISE. It said `/core` had been hiding
 * `.af3a-search-input` at 13px and that stripping the shell's iOS zoom floor would
 * make this route report it. Measured 2026-09-19 by actually stripping the floor
 * and re-running: `/core` still PASSED. The reason is two rules apart —
 * `Dashboard3A.tsx:553` renders `<TopSearch>` inside `.af3a-topbar`, and
 * `af-core-shell.css:822` sets `.af-content .af3a-topbar { display: none }` so the
 * embedded copy does not double the shell's own chrome. The field is in the DOM
 * and has never been visible on this route, so the probe is right to skip it.
 *
 * So this route's value is what it measured, not a bug it caught: no sideways
 * overflow, no visible sub-16px field, and two baselined help dots. That is a
 * screen certified rather than a screen rescued, and it is worth the entry.
 */
export const AUTHED_ROUTES: readonly AuthedRoute[] = [
  { route: "/core", login: "manager" },
  { route: "/core/my-team", login: "manager", leagueScoped: true },
  { route: "/core/trades", login: "manager" },
  { route: "/commissioner-os", login: "commissioner" },
] as const
