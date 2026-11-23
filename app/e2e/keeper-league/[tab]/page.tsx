import { notFound } from 'next/navigation'
import KeeperLeagueHarnessClient from '../KeeperLeagueHarnessClient'
import { KEEPER_HARNESS_TABS, type KeeperHarnessState, type KeeperHarnessTab } from '../fixtures'

/**
 * DB-free render of a native Keeper league in its keeper window, for visual review: the real workspace and the
 * real keeper components, fed by ./fixtures.ts in the browser. Production is refused by app/e2e/layout.tsx (and
 * here, per page). Mode comes from the `af_mode` cookie.
 *
 *   /e2e/keeper-league/keeper?state=open
 *   tab: keeper | war_room | commissioner | keeper_rosters      state: open | locked | none
 */
const STATES: readonly KeeperHarnessState[] = ['open', 'locked', 'none']

export default async function KeeperLeagueHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ tab: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { tab } = await params
  if (!(KEEPER_HARNESS_TABS as readonly string[]).includes(tab)) notFound()
  const sp = await searchParams
  const state = (STATES as readonly string[]).includes(sp.state ?? '') ? (sp.state as KeeperHarnessState) : 'open'
  return <KeeperLeagueHarnessClient tab={tab as KeeperHarnessTab} state={state} />
}
