import { permanentRedirect } from 'next/navigation'
import { retiredToolRedirectTarget } from '@/lib/seo-landing/toolSlugRedirects'

/**
 * /tools/matchup-simulator → /tools/simulation-lab, permanently (308).
 *
 * Owner decision 2026-10-20: the tool card was renamed Simulation Lab. A static segment wins over
 * app/tools/[tool], and a page stub matches the /matchup-simulator redirect's mechanism. The query
 * string is carried across.
 */
export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

export default async function RetiredMatchupSimulatorToolPage(
  props: {
    searchParams?: Promise<Promise<SearchParams> | SearchParams>
  }
) {
  const searchParams = await props.searchParams
  const sp = searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  permanentRedirect(retiredToolRedirectTarget('matchup-simulator', sp))
}
