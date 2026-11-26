import { notFound } from 'next/navigation'
import SgLeagueHarnessClient from '../SgLeagueHarnessClient'
import { SG_HARNESS_MOODS, type SgHarnessMood } from '../fixtures'

/**
 * DB-free Survivor Guillotine league, one moment of the season per mood:
 *   /e2e/survivor-guillotine-league/island?mood=in_season | commissioner | tribe_choice | captain_draft | viewer_chopped | finale
 * Production is refused by app/e2e/layout.tsx; the check below is the redundant second guard.
 */
export default async function SgLeagueHarnessPage({ searchParams }: { searchParams: Promise<{ mood?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { mood } = await searchParams
  const m = (SG_HARNESS_MOODS as readonly string[]).includes(mood ?? '') ? (mood as SgHarnessMood) : 'in_season'
  return <SgLeagueHarnessClient mood={m} />
}
