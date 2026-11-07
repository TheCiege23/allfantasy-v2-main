import { notFound } from 'next/navigation'
import SurvivorHarnessClient from '../../SurvivorHarnessClient'
import { SURVIVOR_HARNESS_SCREENS } from '../../screens'

/**
 * DB-free render of the Survivor league app — the REAL SurvivorAppShell (its provider, nav and hub banner)
 * around the REAL page component for each screen — for visual review. The provider's two reads,
 * `/api/survivor/season` and `/api/league/settings`, are answered by the capture script from
 * app/e2e/survivor/fixture.json; every other /api/ call gets a 503 so each widget shows its own state.
 * Production is refused by app/e2e/layout.tsx; the check below is the redundant second guard.
 *
 *   /e2e/survivor/e2e-survivor/home
 *   /e2e/survivor/e2e-survivor/tribal       ← voting open, week 9
 */
export default async function SurvivorHarnessPage({ params }: { params: Promise<{ leagueId: string; screen: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { leagueId, screen } = await params
  if (!(SURVIVOR_HARNESS_SCREENS as readonly string[]).includes(screen)) notFound()
  return <SurvivorHarnessClient leagueId={leagueId} screen={screen as (typeof SURVIVOR_HARNESS_SCREENS)[number]} />
}
