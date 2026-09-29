import { permanentRedirect } from 'next/navigation'
import { matchupSimulatorRedirectTarget } from '@/lib/matchup-simulator/coreMatchupRedirect'

/**
 * /matchup-simulator → /core/matchup, permanently (308).
 *
 * Owner decision 2026-09-29. The page this replaces asked an LLM (`/api/sim-matchup`, now deleted)
 * for a win percentage without handing it the rosters — a number with nothing under it. /core
 * Matchup is the one matchup surface and reads the real league. A page stub rather than a
 * next.config redirect so the league hand-off (see the helper) survives. Auth is /core's job now.
 */
export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

export default async function MatchupSimulatorPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams> | SearchParams
}) {
  const sp = searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  permanentRedirect(matchupSimulatorRedirectTarget(sp))
}
