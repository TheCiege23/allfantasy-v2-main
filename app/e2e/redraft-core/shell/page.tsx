import RedraftCoreShellHarnessClient from './RedraftCoreShellHarnessClient'

/**
 * DB-free render of the /core shell (AfCoreShell) with a native redraft league open, for visual review
 * (scripts/redraft-core-capture.mjs). Production is refused by app/e2e/layout.tsx. Mode comes from the
 * real `af_mode` cookie the root layout reads.
 *
 *   /e2e/redraft-core/shell?sport=NBA&screen=my-team
 *   /e2e/redraft-core/shell?sport=NBA&identity=off        ← the shell as it rendered before the stamp
 *   /e2e/redraft-core/shell?sport=NBA&leagueType=dynasty  ← a non-redraft league: must stay default
 *
 * The stamp goes through the real decision (lib/core-app/coreShellRedraftIdentity.ts) on the fixture
 * league, so `platform` / `leagueType` exercise the same rule the page applies.
 */
export default async function RedraftCoreShellHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  return (
    <RedraftCoreShellHarnessClient
      sport={sp.sport ?? 'NFL'}
      platform={sp.platform ?? 'allfantasy'}
      leagueType={sp.leagueType ?? 'redraft'}
      identityOff={sp.identity === 'off'}
      screen={sp.screen ?? 'my-team'}
    />
  )
}
