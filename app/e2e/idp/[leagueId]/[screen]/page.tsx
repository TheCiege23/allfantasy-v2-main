import { notFound } from 'next/navigation'
import IdpHarnessClient from '../../IdpHarnessClient'

/**
 * DB-free render of the IDP salary-cap screens — the REAL Cap Room and Contracts clients — for visual review.
 * The capture script answers `/api/idp/cap` (summary, contracts, projections, dead_money),
 * `/api/redraft/season` and `/api/league/settings` from app/e2e/idp/fixtures.ts; every other /api/ call gets a
 * 503. Production is refused by app/e2e/layout.tsx; the check below is the redundant second guard.
 *
 *   /e2e/idp/e2e-idp/cap?rosterId=ckidproster00001        (the league header links with ?rosterId=)
 *   /e2e/idp/e2e-idp/contracts?rosterId=ckidproster00001
 */
export default async function IdpHarnessPage({ params }: { params: Promise<{ leagueId: string; screen: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { leagueId, screen } = await params
  if (screen !== 'cap' && screen !== 'contracts') notFound()
  return <IdpHarnessClient leagueId={leagueId} screen={screen} />
}
