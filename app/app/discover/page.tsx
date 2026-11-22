import Link from 'next/link'
import LeagueDiscoveryClientUnified from '@/components/league-discovery/LeagueDiscoveryClientUnified'
import LeagueDiscoverySuggest from '@/components/league-discovery/LeagueDiscoverySuggest'

export const metadata = {
  title: 'Discover leagues | AllFantasy',
  description: 'Find and join public leagues, orphan teams, and get AI-recommended leagues.',
}

export default function DiscoverPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="mb-1 text-2xl font-semibold text-white">Find your league</h1>
          <p className="text-sm text-white/60">
            Trending and recommended leagues, orphan teams, and filters by sport, type, and paid/free.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/orphan-teams"
            className="shrink-0 rounded-xl border border-violet-400/30 bg-violet-500/15 px-4 py-2.5 text-sm font-medium text-violet-100 hover:bg-violet-500/25 transition"
          >
            Orphan marketplace
          </Link>
          <Link
            href="/join"
            className="shrink-0 rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10 transition"
          >
            Join with code
          </Link>
        </div>
      </div>
      <LeagueDiscoveryClientUnified />
      <section className="mt-10 pt-8 border-t border-white/10">
        <h2 className="mb-4 text-lg font-semibold text-white">League Discovery Chimmy</h2>
        <p className="mb-4 text-sm text-white/60">
          Get personalized suggestions by sport, skill level, and activity—from public pools or your Sleeper leagues.
        </p>
        <LeagueDiscoverySuggest />
      </section>
    </main>
  )
}
