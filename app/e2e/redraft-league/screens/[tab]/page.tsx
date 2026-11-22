import { notFound } from 'next/navigation'
import RedraftScreensHarnessClient, { type HarnessTab } from '../RedraftScreensHarnessClient'
import { SPORTS, type HarnessSport } from '../fixtures'

const TABS: HarnessTab[] = ['roster', 'matchups', 'waivers', 'trades', 'standings', 'players']

/**
 * DB-free render of one native league screen inside the real workspace, for visual review
 * (scripts/redraft-native-screens-capture.mjs). Production is refused by app/e2e/layout.tsx and again here.
 *
 *   /e2e/redraft-league/screens/matchups?sport=NBA
 *   /e2e/redraft-league/screens/standings?sport=NFL&stage=playoffs
 *   /e2e/redraft-league/screens/matchups?sport=NFL&leagueType=dynasty   (a non-redraft control)
 */
export default async function RedraftScreensHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ tab: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { tab } = await params
  const sp = await searchParams
  if (!TABS.includes(tab as HarnessTab)) notFound()
  const sport = String(sp.sport ?? 'NFL').toUpperCase() as HarnessSport
  if (!SPORTS[sport]) notFound()
  return (
    <RedraftScreensHarnessClient
      tab={tab as HarnessTab}
      sport={sport}
      stage={sp.stage === 'playoffs' ? 'playoffs' : 'season'}
      leagueType={sp.leagueType ?? 'redraft'}
      leagueVariant={sp.leagueVariant ?? null}
    />
  )
}
