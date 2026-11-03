import RedraftIdentityHarnessClient from './RedraftIdentityHarnessClient'

/**
 * DB-free render of the native redraft workspace for visual review (scripts/redraft-visual-capture.mjs).
 * Production is refused by app/e2e/layout.tsx. Mode comes from the real `af_mode` cookie the root
 * layout reads, so light/dark/af render through the same path a user's page does.
 *
 *   /e2e/redraft-identity?sport=NBA&phase=in_season&week=4&total=21&playoffs=19&deadline=16
 *
 * Every season number is a query parameter so a capture can show a marker missing as well as present.
 */
export default async function RedraftIdentityHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const int = (v?: string) => (v != null && /^\d+$/.test(v) ? Number(v) : null)
  return (
    <RedraftIdentityHarnessClient
      sport={sp.sport ?? 'NFL'}
      lifecycleState={sp.phase ?? 'in_season'}
      currentWeek={int(sp.week)}
      totalWeeks={int(sp.total)}
      playoffStartWeek={int(sp.playoffs)}
      tradeDeadlineWeek={int(sp.deadline)}
      platform={sp.platform ?? 'allfantasy'}
      leagueType={sp.leagueType ?? 'redraft'}
      tab={sp.tab ?? 'native_home'}
    />
  )
}
