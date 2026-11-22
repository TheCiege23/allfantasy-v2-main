import { notFound } from 'next/navigation'
import BigBrotherHarnessClient from '../../BigBrotherHarnessClient'

const VIEWS = ['house', 'hoh', 'veto', 'twists', 'history', 'ceremony', 'voting', 'jury', 'commissioner'] as const

/**
 * DB-free render of the Big Brother league home — the REAL `BigBrotherHome` with each of its views — for visual
 * review. In the app it sits inside the league shell's tab body; here it is mounted alone on the same page ground.
 * The capture script answers `/api/leagues/[id]/big-brother/summary`, `/audit` and `/config` from
 * app/e2e/big-brother/fixtures.ts; every other /api/ call gets a 503. Production is refused by app/e2e/layout.tsx;
 * the check below is the redundant second guard.
 *
 *   /e2e/big-brother/e2e-bb/house       ← week 5, eviction vote open, the viewer safe and voting
 */
export default async function BigBrotherHarnessPage({ params }: { params: Promise<{ leagueId: string; view: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { leagueId, view } = await params
  if (!(VIEWS as readonly string[]).includes(view)) notFound()
  return <BigBrotherHarnessClient leagueId={leagueId} view={view as (typeof VIEWS)[number]} />
}
