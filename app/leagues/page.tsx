import { redirect } from "next/navigation"

/**
 * /leagues — forwards to /core/leagues.
 *
 * ⚠ MY LEAGUES (21a) NOW RENDERS INSIDE THE CORE SHELL. It used to render here, inside
 * `ProductShellLayout` (the global site header and right rail), so the core nav's own
 * "My Leagues" entry dropped the reader out of the app: the league rail, the core nav and
 * the core topbar all vanished, and the page sat as a dark island on the global surface.
 * The screen, its data read and its empty state moved to the `leagues` segment of
 * app/core/(shell)/[[...screen]]/page.tsx unchanged.
 *
 * This route stays as a redirect because dozens of links, nudges and deep-link lists still
 * name /leagues. The query string is carried over. Signed-out visitors are sent to sign-in
 * by /core itself, with this destination as the callback.
 *
 * `app/leagues/layout.tsx` is unchanged: /leagues/[leagueId] and /leagues/create still use it.
 */
export default async function LeaguesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") qs.set(key, value)
  }
  const query = qs.toString()
  redirect(query ? `/core/leagues?${query}` : "/core/leagues")
}
