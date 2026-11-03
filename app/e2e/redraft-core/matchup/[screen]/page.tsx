import { notFound } from 'next/navigation'
import RedraftCoreMatchupHarnessClient from '../RedraftCoreMatchupHarnessClient'

/**
 * DB-free render of the REAL /core Matchup and Live scores screens inside the real AfCoreShell, with a
 * native redraft league open, for visual review (scripts/redraft-core-matchup-capture.mjs). Batch B3.
 * Production is refused by app/e2e/layout.tsx; the redundant guard below keeps that true if this page
 * is ever moved out from under it.
 *
 *   /e2e/redraft-core/matchup/matchup?sport=NBA&state=live      ← live | final | upcoming
 *   /e2e/redraft-core/matchup/live?sport=NHL
 *   …&identity=off          ← the shell without the stamp: the screens exactly as before
 *   …&leagueType=dynasty    ← a non-redraft league: must stay the default look
 *
 * Every number on the page is FIXTURE data (./fixtures.ts) in the screens' real shapes.
 */
const SCREENS = ['matchup', 'live'] as const

export default async function RedraftCoreMatchupHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ screen: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { screen } = await params
  if (!(SCREENS as readonly string[]).includes(screen)) notFound()
  const sp = await searchParams
  return (
    <RedraftCoreMatchupHarnessClient
      screen={screen as (typeof SCREENS)[number]}
      sport={sp.sport ?? 'NFL'}
      state={sp.state === 'final' || sp.state === 'upcoming' ? sp.state : 'live'}
      leagueType={sp.leagueType ?? 'redraft'}
      identityOff={sp.identity === 'off'}
    />
  )
}
