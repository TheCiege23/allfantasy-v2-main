import { notFound } from 'next/navigation'
import BestBallHarnessClient from '../BestBallHarnessClient'
import { BEST_BALL_SCREENS, type BestBallHarnessScreen } from '../fixtures'

/**
 * DB-free render of a hosted NFL best ball league — the REAL league workspace around the REAL Best Ball tab
 * (Optimized Lineups, Roster, Contest, History) and the REAL War Room tab with its Best Ball panel — for visual
 * review. Reads are answered in the browser from app/e2e/best-ball/fixtures.ts; any other /api/ call gets a 503.
 * Production is refused by app/e2e/layout.tsx; the check below is the redundant second guard.
 *
 *   /e2e/best-ball/lineup     /e2e/best-ball/roster     /e2e/best-ball/contest
 *   /e2e/best-ball/history    /e2e/best-ball/war_room
 */
export default async function BestBallHarnessPage({ params }: { params: Promise<{ screen: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { screen } = await params
  if (!(BEST_BALL_SCREENS as readonly string[]).includes(screen)) notFound()
  return <BestBallHarnessClient screen={screen as BestBallHarnessScreen} />
}
