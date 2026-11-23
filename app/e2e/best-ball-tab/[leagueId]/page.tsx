import { notFound } from 'next/navigation'
import { BestBallTab } from '@/app/league/[leagueId]/tabs/BestBallTab'

/**
 * The Best Ball tab on its own: the REAL `BestBallTab` the league page renders, reading the same API
 * with the viewer's own session. The whole league page is too heavy to render in a small sandbox; this
 * is the tab without the shell. Production is refused by app/e2e/layout.tsx; the check below is the
 * redundant second guard.
 *
 *   /e2e/best-ball-tab/<leagueId>?sport=NBA
 */
export default async function BestBallTabHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<{ sport?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { leagueId } = await params
  const { sport } = await searchParams
  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      <BestBallTab leagueId={leagueId} sport={String(sport ?? 'NFL').toUpperCase()} />
    </main>
  )
}
