import { redirect } from 'next/navigation'

/**
 * `/power-rankings` moved into the rankings hub (2026-10-01): the same panel now renders at
 * `/core/rankings?scope=league&panel=power` (components/core-app/rankings/power/). Kept as a
 * redirect so bookmarks, e2e links and the advantage dashboard keep working. A `leagueId` (or
 * `league`) query param carries through as the hub's selected league.
 */
export default async function PowerRankingsRedirect(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}): Promise<never> {
  const sp = (await props.searchParams) ?? {}
  const pick = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : null)
  const league = pick('league') ?? pick('leagueId')
  const q = new URLSearchParams({ scope: 'league', panel: 'power' })
  if (league) q.set('league', league)
  redirect(`/core/rankings?${q.toString()}`)
}
