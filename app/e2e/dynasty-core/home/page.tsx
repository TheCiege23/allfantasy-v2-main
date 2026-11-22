import { notFound } from 'next/navigation'
import DynastyCoreHomeHarnessClient from './DynastyCoreHomeHarnessClient'

/**
 * DB-free render of /core's league Home (the REAL LeagueHome inside the REAL AfCoreShell) for an
 * IMPORTED dynasty league, for visual review. Production is refused here and by app/e2e/layout.tsx.
 * Mode comes from the real `af_mode` cookie.
 *
 *   /e2e/dynasty-core/home                    ← the Dynasty Era identity and deck
 *   /e2e/dynasty-core/home?identity=off       ← Home as an imported dynasty league rendered before
 *   /e2e/dynasty-core/home?history=none       ← a league with no champions and no picks on file
 *   /e2e/dynasty-core/home?phase=offseason    ← between seasons: Year N complete, the Offseason timeline
 */
export default async function DynastyCoreHomeHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  return <DynastyCoreHomeHarnessClient identityOff={sp.identity === 'off'} sparse={sp.history === 'none'} offseason={sp.phase === 'offseason'} />
}
