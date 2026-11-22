import { notFound } from 'next/navigation'
import DynastyCoreStandingsHarnessClient from './DynastyCoreStandingsHarnessClient'

/**
 * DB-free render of /core's Standings (the REAL Standings screen inside the REAL AfCoreShell) for a
 * dynasty league, for visual review. Production is refused here and by app/e2e/layout.tsx. Mode comes
 * from the real `af_mode` cookie.
 *
 *   /e2e/dynasty-core/standings                   ← rafters + the Dynasty table (five seasons on file)
 *   /e2e/dynasty-core/standings?identity=off      ← Standings as a dynasty league rendered before
 *   /e2e/dynasty-core/standings?history=titles    ← champions on file but no per-team records
 *   /e2e/dynasty-core/standings?history=none      ← a dynasty league with no history at all
 */
export default async function DynastyCoreStandingsHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  const history = sp.history === 'none' ? 'none' : sp.history === 'titles' ? 'titles' : 'full'
  return <DynastyCoreStandingsHarnessClient identityOff={sp.identity === 'off'} history={history} />
}
