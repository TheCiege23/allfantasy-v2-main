import { notFound } from 'next/navigation'
import { SurvivorGuillotineLeague } from '@/components/survivor-guillotine/SurvivorGuillotineLeague'

/**
 * DB-free render of the Survivor Guillotine league island — the REAL `SurvivorGuillotineLeague`, which is all
 * app/survivor-guillotine/[leagueId]/page.tsx renders. The capture script answers
 * GET /api/leagues/[id]/survivor-guillotine and …/operations from app/e2e/survivor-guillotine/fixtures.ts; every
 * other /api/ call gets a 503. Production is refused by app/e2e/layout.tsx; the check below is the redundant
 * second guard.
 *
 *   /e2e/survivor-guillotine/e2e-guil     ← period 4, two chopped, the viewer holding a power
 */
export default async function SurvivorGuillotineHarnessPage({ params }: { params: Promise<{ leagueId: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { leagueId } = await params
  return <SurvivorGuillotineLeague leagueId={leagueId} />
}
