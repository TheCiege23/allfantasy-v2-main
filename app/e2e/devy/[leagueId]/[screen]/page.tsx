import Link from 'next/link'
import { notFound } from 'next/navigation'
import DevyLeagueLayout from '@/app/devy/[leagueId]/layout'
import { DevyRosterClient } from '@/app/devy/[leagueId]/roster/DevyRosterClient'
import { DevyPicksClient } from '@/app/devy/[leagueId]/picks/DevyPicksClient'
import { HARNESS_USER_ID } from '../../fixtures'

const SCREENS = ['roster', 'picks'] as const

/**
 * DB-free render of the Devy league screens — the REAL league layout and client for each, inside the page
 * frame its server page draws (app/devy/[leagueId]/<screen>/page.tsx), minus the session check. The capture script answers
 * `/api/devy`, `/api/devy/roster`, `/api/devy/picks` and `/api/redraft/season` from app/e2e/devy/fixtures.ts;
 * every other /api/ call gets a 503. Production is refused by app/e2e/layout.tsx; the check below is the
 * redundant second guard.
 *
 *   /e2e/devy/e2e-devy/roster        (add #devy or #taxi to open those sections, as the league header does)
 *   /e2e/devy/e2e-devy/picks
 */
export default async function DevyHarnessPage({ params }: { params: Promise<{ leagueId: string; screen: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { leagueId, screen } = await params
  if (!(SCREENS as readonly string[]).includes(screen)) notFound()
  if (screen === 'picks') {
    return (
      <DevyLeagueLayout>
        <DevyPicksClient leagueId={leagueId} userId={HARNESS_USER_ID} />
      </DevyLeagueLayout>
    )
  }
  return (
    <DevyLeagueLayout>
      <div className="min-h-screen bg-[#040915]">
        <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#0c0c1e]/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
            <Link href={`/league/${leagueId}`} className="text-[12px] font-semibold text-cyan-300/90 hover:text-cyan-200">
              ← League
            </Link>
            <span className="truncate text-[13px] font-bold text-white">Devy roster</span>
            <span className="w-12" />
          </div>
        </header>
        <DevyRosterClient leagueId={leagueId} userId={HARNESS_USER_ID} hasAfSub />
      </div>
    </DevyLeagueLayout>
  )
}
