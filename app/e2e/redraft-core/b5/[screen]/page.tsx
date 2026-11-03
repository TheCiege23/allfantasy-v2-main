import { notFound } from 'next/navigation'
import RedraftCoreB5HarnessClient from '../RedraftCoreB5HarnessClient'
import { HARNESS_SCREENS, type HarnessScreen } from '../fixtures'

/**
 * DB-free render of /core batch B5 — Waivers, Player Finder, Draft HQ — inside the real AfCoreShell, for
 * visual review (scripts/redraft-core-b5-capture.mjs). Production is refused by app/e2e/layout.tsx; the
 * per-page check below is the redundant second guard that file describes. Mode comes from the real
 * `af_mode` cookie the root layout reads.
 *
 *   /e2e/redraft-core/b5/waivers?sport=NBA
 *   /e2e/redraft-core/b5/players?sport=MLB&identity=off             ← the same screen, stamp removed
 *   /e2e/redraft-core/b5/draft-hq?sport=NFL&leagueType=dynasty       ← a dynasty league: default look
 */
export default async function RedraftCoreB5HarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ screen: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { screen } = await params
  if (!(HARNESS_SCREENS as readonly string[]).includes(screen)) notFound()
  const sp = await searchParams
  return (
    <RedraftCoreB5HarnessClient
      screen={screen as HarnessScreen}
      sport={sp.sport ?? 'NFL'}
      platform={sp.platform ?? 'sleeper'}
      leagueType={sp.leagueType ?? 'redraft'}
      identityOff={sp.identity === 'off'}
    />
  )
}
