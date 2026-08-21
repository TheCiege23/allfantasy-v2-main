import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLivePageData } from '@/lib/live/liveScoresPage'
import { LiveScoresClient } from '@/components/live/LiveScoresClient'
import './live.css'

/**
 * `/live` — cross-league live scoring (handoff 15a).
 *
 * ⚠ RENDERS SIGNED OUT RATHER THAN REDIRECTING. Scores are public information and
 * the slate is worth seeing without an account; only the fantasy tie-ins need a
 * user. `getLivePageData` takes a nullable userId and simply returns no tie-ins,
 * and the UI says why instead of showing an empty panel with no explanation.
 *
 * ⚠ `force-dynamic` IS REQUIRED, NOT DEFENSIVE. Every number here is live and
 * user-specific; a cached render of this page would be actively wrong within
 * seconds of being produced.
 *
 * The client shell polls `/api/dashboard/live-scores?view=live` for refreshes —
 * folded into that existing route rather than a new one, because the repo is at
 * Vercel's route ceiling.
 */
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Live Scores · AllFantasy',
  description: 'Live scores across every sport, scoped to the players you actually roster.',
}

export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string; scope?: string }>
}) {
  const params = await searchParams
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null

  const initial = await getLivePageData({
    userId: session?.user?.id ?? null,
    sport: params.sport ?? 'NFL',
    scope: params.scope === 'all' ? 'all' : 'my',
  })

  return <LiveScoresClient initial={initial} />
}
