import { notFound } from 'next/navigation'
import BigBrotherLeagueHarnessClient from '../BigBrotherLeagueHarnessClient'
import { BIG_BROTHER_HARNESS_MOODS, BIG_BROTHER_HARNESS_TABS, type BigBrotherHarnessMood } from '../fixtures'

/**
 * DB-free render of a Big Brother league's house tabs, for visual review: the real workspace, the real BigBrotherHome
 * and BigBrotherCommandDashboard, fed by ./fixtures.ts in the browser. Production is refused by app/e2e/layout.tsx
 * (and here, per page).
 *
 *   /e2e/big-brother-league/big_brother?mood=eviction_vote
 *   tab:  big_brother | bb_hoh | bb_veto | bb_voting | bb_jury | bb_twists | bb_history | bb_command
 *   mood: hoh_comp | nominations | veto | eviction_vote | jury_finale | evicted_viewer | commissioner | empty
 */
export default async function BigBrotherLeagueHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ tab: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { tab } = await params
  if (!(BIG_BROTHER_HARNESS_TABS as readonly string[]).includes(tab)) notFound()
  const sp = await searchParams
  const mood = (BIG_BROTHER_HARNESS_MOODS as readonly string[]).includes(sp.mood ?? '') ? (sp.mood as BigBrotherHarnessMood) : 'eviction_vote'
  return <BigBrotherLeagueHarnessClient tab={tab} mood={mood} />
}
