import { notFound } from 'next/navigation'
import RedraftCoreMyTeamHarnessClient from '../RedraftCoreMyTeamHarnessClient'
import { HARNESS_SCREENS, type HarnessScreen } from '../fixtures'

/**
 * DB-free render of /core batch B2 — My team, Your week, Defense Hub — inside the real AfCoreShell, for
 * visual review (scripts/redraft-core-myteam-capture.mjs). Production is refused by app/e2e/layout.tsx;
 * the per-page check below is the redundant second guard that file describes. Mode comes from the real
 * `af_mode` cookie the root layout reads.
 *
 *   /e2e/redraft-core/myteam/my-team?sport=NBA
 *   /e2e/redraft-core/myteam/week?sport=MLB&identity=off            ← the same screen, stamp removed
 *   /e2e/redraft-core/myteam/defense-hub?sport=NFL&leagueType=dynasty ← a non-redraft league: default look
 *
 * The stamp goes through the real decision (lib/core-app/coreShellRedraftIdentity.ts) on the fixture league.
 */
export default async function RedraftCoreMyTeamHarnessPage({
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
    <RedraftCoreMyTeamHarnessClient
      screen={screen as HarnessScreen}
      sport={sp.sport ?? 'NFL'}
      platform={sp.platform ?? 'allfantasy'}
      leagueType={sp.leagueType ?? 'redraft'}
      identityOff={sp.identity === 'off'}
    />
  )
}
