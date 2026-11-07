import { notFound } from 'next/navigation'
import ZombieHarnessClient from '../../ZombieHarnessClient'
import { ZOMBIE_HARNESS_SCREENS } from '../../screens'

/**
 * DB-free render of the Zombie league app — the REAL ZombieLeagueShell around the REAL page component for
 * each screen — for visual review. The capture script answers `/api/zombie/league`, `event-feed`,
 * `matchups` and `inventory` from app/e2e/zombie/fixtures.ts; every other /api/ call gets a 503 so each
 * widget shows its own state. Production is refused by app/e2e/layout.tsx; the check below is the
 * redundant second guard.
 *
 *   /e2e/zombie/e2e-zombie/home
 *   /e2e/zombie/e2e-zombie/matchups      ← week 10, one bashing and one mauling on pace
 */
export default async function ZombieHarnessPage({ params }: { params: Promise<{ leagueId: string; screen: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { leagueId, screen } = await params
  if (!(ZOMBIE_HARNESS_SCREENS as readonly string[]).includes(screen)) notFound()
  return <ZombieHarnessClient leagueId={leagueId} screen={screen as (typeof ZOMBIE_HARNESS_SCREENS)[number]} />
}
