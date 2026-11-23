import { notFound } from 'next/navigation'
import PirateLeagueHarnessClient from '../PirateLeagueHarnessClient'
import { PIRATE_HARNESS_STATES, PIRATE_HARNESS_TABS, type PirateHarnessState, type PirateHarnessTab } from '../fixtures'

/**
 * DB-free render of a hosted Pirate league, for visual review: the real workspace and the real Pirate Deck, fed by
 * ./fixtures.ts in the browser. Production is refused by app/e2e/layout.tsx (and here, per page).
 *
 *   /e2e/pirate-league/pirate?state=winner&commish=1
 *   tab: pirate | rules      state: winner | loser | quiet | locked      commish: 1 (default) | 0
 */
export default async function PirateLeagueHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ tab: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { tab } = await params
  if (!(PIRATE_HARNESS_TABS as readonly string[]).includes(tab)) notFound()
  const sp = await searchParams
  const state = (PIRATE_HARNESS_STATES as readonly string[]).includes(sp.state ?? '') ? (sp.state as PirateHarnessState) : 'quiet'
  return <PirateLeagueHarnessClient tab={tab as PirateHarnessTab} state={state} commissioner={sp.commish !== '0'} />
}
