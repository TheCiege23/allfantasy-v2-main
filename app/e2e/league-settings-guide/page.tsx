import { notFound } from 'next/navigation'
import { LeagueSettingsGuideClient } from './LeagueSettingsGuideClient'

/**
 * DB-free preview of the League settings tab in the real /core shell (2026-11-15). `?source=native`
 * shows an AllFantasy-run league; the default is an imported Sleeper league's read-only mirror.
 * `?tab=my|setup|members|record`. Production is refused by app/e2e/layout.tsx; this check is the
 * redundant second guard.
 */
export default async function LeagueSettingsGuidePage(props: { searchParams?: Promise<{ source?: string; tab?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = (await props.searchParams) ?? {}
  return <LeagueSettingsGuideClient native={sp.source === 'native'} tab={sp.tab ?? 'setup'} />
}
