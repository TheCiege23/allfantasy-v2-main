import { notFound } from 'next/navigation'
import RedraftSettingsHarnessClient from './RedraftSettingsHarnessClient'
import { SPORTS, type HarnessSport } from './fixtures'

/**
 * DB-free render of the native League Settings page inside the real workspace, for visual review
 * (scripts/redraft-settings-capture.mjs). Production is refused by app/e2e/layout.tsx and again here.
 *
 *   /e2e/redraft-league/settings?sport=NBA                        (commissioner: Commissioner center ≥1024px, list below)
 *   /e2e/redraft-league/settings?sport=NFL&role=member            (the read-only list)
 *   /e2e/redraft-league/settings?sport=NFL&leagueType=dynasty     (a non-redraft control)
 */
export default async function RedraftSettingsHarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  const sport = String(sp.sport ?? 'NFL').toUpperCase() as HarnessSport
  if (!SPORTS[sport]) notFound()
  return (
    <RedraftSettingsHarnessClient
      sport={sport}
      role={sp.role === 'member' ? 'member' : 'commissioner'}
      leagueType={sp.leagueType ?? 'redraft'}
      leagueVariant={sp.leagueVariant ?? null}
    />
  )
}
