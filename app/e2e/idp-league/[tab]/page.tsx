import { notFound } from 'next/navigation'
import IdpLeagueHarnessClient from '../IdpLeagueHarnessClient'
import { IDP_LEAGUE_HARNESS_MOODS, IDP_LEAGUE_HARNESS_TABS, type IdpLeagueHarnessMood, type IdpLeagueHarnessTab } from '../fixtures'

/**
 * DB-free render of an IDP league's IDP-specific tabs, for visual review: the real workspace, the real IDPHome,
 * IDPTeamDashboard and IDPMatchupView, fed by ./fixtures.ts in the browser. Production is refused by
 * app/e2e/layout.tsx (and here, per page).
 *
 *   /e2e/idp-league/idp?mood=in_season
 *   tab:  idp | team | scores
 *   mood: in_season | preseason | big_play_scoring | tackle_heavy | empty
 */
export default async function IdpLeagueHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ tab: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { tab } = await params
  if (!(IDP_LEAGUE_HARNESS_TABS as readonly string[]).includes(tab)) notFound()
  const sp = await searchParams
  const mood = (IDP_LEAGUE_HARNESS_MOODS as readonly string[]).includes(sp.mood ?? '') ? (sp.mood as IdpLeagueHarnessMood) : 'in_season'
  return <IdpLeagueHarnessClient tab={tab as IdpLeagueHarnessTab} mood={mood} />
}
