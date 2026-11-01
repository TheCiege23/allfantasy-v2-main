import { notFound } from 'next/navigation'
import RedraftLeagueTabsHarnessClient from '../RedraftLeagueTabsHarnessClient'
import { HARNESS_TABS, type HarnessTab } from '../fixtures'

/**
 * DB-free render of one of the four Tailwind tabs (batch A6) inside the real native workspace, for
 * visual review (scripts/redraft-tabs-visual-capture.mjs). Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/redraft-league/scores?sport=NBA&format=redraft
 *   tab: war_room | scores | ai_coaching | schedule      format: redraft | dynasty | guillotine
 */
export default async function RedraftLeagueTabsHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ tab: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { tab } = await params
  if (!(HARNESS_TABS as readonly string[]).includes(tab)) notFound()
  const sp = await searchParams
  const format = sp.format === 'dynasty' || sp.format === 'guillotine' ? sp.format : 'redraft'
  return <RedraftLeagueTabsHarnessClient tab={tab as HarnessTab} sport={sp.sport ?? 'NFL'} format={format} />
}
