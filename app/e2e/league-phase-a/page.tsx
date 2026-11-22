import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { LeaguePhaseAHarnessClient } from './LeaguePhaseAHarnessClient'

/**
 * Dev-only: the league page's Phase A surfaces (matchup, team banner + roster rows, trade block,
 * history rafters) with sample data. Network reads are answered by the capture script's route mocks.
 */
export default function LeaguePhaseAHarnessPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <Suspense fallback={null}>
      <LeaguePhaseAHarnessClient />
    </Suspense>
  )
}
