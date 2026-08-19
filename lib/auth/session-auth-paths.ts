/**
 * Which app paths require a signed-in session.
 *
 * Extracted from middleware.ts so the rule can be tested directly. It decides
 * who can open 15 league pages, and it carries one deliberate exception, which
 * is exactly the kind of rule that should not live as an untested local
 * function. Kept dependency-free: middleware runs on every request.
 */

/**
 * League article pages are deliberately shareable.
 *
 * The news page builds a share URL pointing at ITSELF
 * (`/app/league/<id>/news/<articleId>`) and offers it through a Share button, so
 * gating it would bounce every recipient to a login screen and read as the share
 * feature being broken rather than as a policy.
 */
export const SHAREABLE_APP_LEAGUE_PATH = /^\/app\/league\/[^/]+\/news\//

export function requiresSessionAuth(pathname: string): boolean {
  if (pathname.startsWith('/af-rankings')) return true
  if (pathname.startsWith('/dashboard/rankings')) return true
  if (pathname.startsWith('/league/')) return true

  // `/app/league/*` mirrors the same league surface as `/league/*` and was never
  // gated: 15 pages — psychological profiles, drama, relationship insights,
  // legacy breakdown — answered 200 to anonymous callers while the identical
  // league at `/league/<id>` redirected to login.
  //
  // Nothing leaked through the pages themselves, because they fetch client-side
  // and their APIs enforce auth. That is why this is defence in depth rather than
  // the fix: it holds only as long as EVERY API those pages call checks its
  // caller, which is not a property anyone was maintaining.
  if (pathname.startsWith('/app/league/')) {
    return !SHAREABLE_APP_LEAGUE_PATH.test(pathname)
  }

  return false
}
