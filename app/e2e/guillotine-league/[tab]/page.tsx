import { notFound } from 'next/navigation'
import GuillotineLeagueHarnessClient from '../GuillotineLeagueHarnessClient'
import { GUILLOTINE_HARNESS_TABS, type GuillotineHarnessMood, type GuillotineHarnessTab } from '../fixtures'

/**
 * DB-free render of a native Guillotine league for visual review: the real workspace with the guillotine
 * banner and ember atmosphere, and the real tab components, fed by ./fixtures.ts in the browser.
 * Production is refused by app/e2e/layout.tsx (and here, per page). Mode comes from the `af_mode` cookie.
 *
 *   /e2e/guillotine-league/guillotine?mood=calm
 *   tab: guillotine | war_room      mood: calm | chop_week | final | eliminated
 */
const MOODS: readonly GuillotineHarnessMood[] = ['calm', 'chop_week', 'final', 'eliminated']

export default async function GuillotineLeagueHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ tab: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { tab } = await params
  if (!(GUILLOTINE_HARNESS_TABS as readonly string[]).includes(tab)) notFound()
  const sp = await searchParams
  const mood = (MOODS as readonly string[]).includes(sp.mood ?? '') ? (sp.mood as GuillotineHarnessMood) : 'calm'
  return <GuillotineLeagueHarnessClient tab={tab as GuillotineHarnessTab} mood={mood} />
}
