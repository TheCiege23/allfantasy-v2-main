import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { LeagueTypeSkinsHarnessClient } from './LeagueTypeSkinsHarnessClient'

/** Dev-only: the league page's header, tabs, sync strip and type hero in every league-type skin. */
export default function LeagueTypeSkinsHarnessPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <Suspense fallback={null}>
      <LeagueTypeSkinsHarnessClient />
    </Suspense>
  )
}
