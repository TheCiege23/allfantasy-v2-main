import { notFound } from 'next/navigation'
import RedraftCoreHomeHarnessClient from './RedraftCoreHomeHarnessClient'

/**
 * DB-free render of /core's league Home (the REAL LeagueHome inside the REAL AfCoreShell) for an
 * IMPORTED redraft league, for visual review (scripts/redraft-core-home-capture.mjs). Production is
 * refused here and by app/e2e/layout.tsx. Mode comes from the real `af_mode` cookie.
 *
 *   /e2e/redraft-core/home?sport=nba
 *   /e2e/redraft-core/home?sport=nba&identity=off        ← Home as it rendered before this batch
 *   /e2e/redraft-core/home?sport=nba&leagueType=dynasty  ← a non-redraft import: must stay default
 */
export default async function RedraftCoreHomeHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  return (
    <RedraftCoreHomeHarnessClient
      sport={(sp.sport ?? 'nfl').toLowerCase()}
      identityOff={sp.identity === 'off'}
      leagueType={sp.leagueType ?? 'redraft'}
    />
  )
}
