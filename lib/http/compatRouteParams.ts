/**
 * Route params for a handler that one of OUR dispatchers calls directly.
 *
 * Next 15 passes `params` to route handlers as a Promise. Three catch-all
 * routes (`app/api/legacy/[...path]`, `app/api/leagues/[leagueId]/survivor/[...path]`,
 * `app/api/leagues/[leagueId]/[section]`) forward to modules under `server/` and
 * `app/api/leagues/[leagueId]/<x>/handler.ts`, and those are MIXED: some
 * `await ctx.params`, some still destructure it synchronously. The codemod only
 * rewrites entry files under `app/`, so it could not reach them.
 *
 * This value is a resolved Promise that ALSO carries the keys as own properties —
 * the same compatibility shape Next 15 gives `params` itself — so both styles read
 * the right values. Migrate a module to `await` and it keeps working unchanged.
 */
export function compatRouteParams<T extends object>(value: T): Promise<T> & T {
  return Object.assign(Promise.resolve(value), value)
}
