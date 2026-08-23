import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import LeagueSyncDashboard from "@/app/components/LeagueSyncDashboard"
import { buildMetadata, getSEOPageConfig } from "@/lib/seo"
import { getPublicSiteOrigin } from "@/lib/site-public-origin"

export const metadata = buildMetadata(
  getSEOPageConfig("leagues") ?? {
    title: "League Sync | AllFantasy",
    description: "Sync and manage your fantasy leagues.",
    canonical: `${getPublicSiteOrigin()}/leagues`,
  }
)

export default async function LeaguesPage() {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { email?: string | null; name?: string | null }
  } | null

  const isAuthenticated = Boolean(session?.user)

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
        Leagues workspace: sync imports, open league homes, and manage league memberships.
        {!isAuthenticated && <span className="block mt-2 text-amber-300">Sign in to connect league providers.</span>}
      </div>
      <LeagueSyncDashboard />
    </main>
  )
}
