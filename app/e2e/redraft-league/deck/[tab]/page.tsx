import { notFound } from 'next/navigation'
import RedraftDeckHarnessClient, { type DeckTab } from '../RedraftDeckHarnessClient'
import { DECK_SPORTS, type DeckSport, type DeckState } from '../fixtures'

const TABS: DeckTab[] = ['decide', 'draft_intel', 'legacy', 'commissioner']

/**
 * DB-free render of the redraft broadcast deck (Decision OS, Live Intel, Legacy, Commissioner) inside
 * the real workspace chrome, for visual review (scripts/redraft-deck-capture.mjs). Production is refused
 * by app/e2e/layout.tsx; this page refuses too. Mode comes from the real `af_mode` cookie.
 *
 *   /e2e/redraft-league/deck/commissioner?sport=NBA&state=season&view=commissioner
 *
 * `view` pins the tab (the workspace otherwise restores the last-open section from localStorage).
 * `leagueType=dynasty` renders a non-redraft league through the same harness, for the gate check.
 */
export default async function RedraftDeckHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ tab: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { tab } = await params
  const sp = await searchParams
  const pinned = (sp.view ?? tab) as DeckTab
  if (!TABS.includes(pinned)) notFound()
  const sport = String(sp.sport ?? 'NFL').toUpperCase() as DeckSport
  if (!(sport in DECK_SPORTS)) notFound()
  const state: DeckState = sp.state === 'empty' ? 'empty' : 'season'
  return <RedraftDeckHarnessClient tab={pinned} sport={sport} state={state} leagueType={sp.leagueType ?? 'redraft'} />
}
