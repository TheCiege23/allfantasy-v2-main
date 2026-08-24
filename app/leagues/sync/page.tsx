import { getServerSession } from "next-auth"
import Link from "next/link"
import { authOptions } from "@/lib/auth"
import LeagueSyncDashboard from "@/app/components/LeagueSyncDashboard"
import { buildMetadata } from "@/lib/seo"

/**
 * League Sync — the surface that used to be /leagues.
 *
 * ⚠ THIS IS A MOVE, NOT A REWRITE. /leagues became the 21a "My Leagues" view,
 * which is a browsing surface and carries none of the connect/re-sync tooling
 * this component provides: the add-league discovery modal (Sleeper by username,
 * ESPN by league id, Yahoo OAuth via /api/league/yahoo-auth), the per-league
 * re-sync, and "Sync & Open" for rows with no unified record yet. Deleting the
 * old page would have taken all of that with it — those are the only entry
 * points to some of it — so it lives here and 21a links to it from the header
 * and from its empty state. `LeagueSyncDashboard` itself is unchanged.
 */
export const metadata = buildMetadata({
  title: "League Sync | AllFantasy",
  description: "Connect fantasy platforms, re-sync imported leagues, and open a league.",
  canonical: "https://allfantasy.ai/leagues/sync",
})

export default async function LeagueSyncPage() {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { email?: string | null; name?: string | null }
  } | null

  const isAuthenticated = Boolean(session?.user)

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
        <span>
          Connect providers, re-sync imports, and open a league.
          {!isAuthenticated && (
            <span className="mt-2 block text-amber-300">Sign in to connect league providers.</span>
          )}
        </span>
        <Link
          href="/leagues"
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
        >
          ← Back to my leagues
        </Link>
      </div>
      <LeagueSyncDashboard />
    </main>
  )
}
