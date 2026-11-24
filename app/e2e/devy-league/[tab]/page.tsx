import { notFound } from 'next/navigation'
import DevyLeagueHarnessClient from '../DevyLeagueHarnessClient'
import { DEVY_HARNESS_MOODS, DEVY_HARNESS_TABS, type DevyHarnessMood, type DevyHarnessTab } from '../fixtures'

/**
 * DB-free render of a native Devy dynasty league's Devy pipeline tab, for visual review: the real workspace and the
 * real DevyHome, fed by ./fixtures.ts in the browser. Production is refused by app/e2e/layout.tsx (and here, per
 * page). Mode comes from the `af_mode` cookie.
 *
 *   /e2e/devy-league/devy?mood=in_season
 *   tab: devy      mood: in_season | offseason | commissioner | empty
 */
export default async function DevyLeagueHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ tab: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { tab } = await params
  if (!(DEVY_HARNESS_TABS as readonly string[]).includes(tab)) notFound()
  const sp = await searchParams
  const mood = (DEVY_HARNESS_MOODS as readonly string[]).includes(sp.mood ?? '') ? (sp.mood as DevyHarnessMood) : 'in_season'
  return <DevyLeagueHarnessClient tab={tab as DevyHarnessTab} mood={mood} />
}
