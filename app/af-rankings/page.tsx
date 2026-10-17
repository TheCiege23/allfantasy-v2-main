import { redirect } from 'next/navigation'

/**
 * `/af-rankings` moved into the rankings hub (2026-10-01): the same screen — career rank, the
 * legacy import panel and its progress flow — renders as the "Career & legacy" panel at
 * `/core/rankings?scope=portfolio&panel=legacy` (components/rankings/AfRankingsClient.tsx).
 *
 * ⚠ THE QUERY STRING IS CARRIED THROUGH. The import flow lands here with `?jobId=` (and
 * `?imported=` / `?done=`), and the import-complete email links here. Dropping them would leave
 * a manager mid-import looking at a rank that has not finished calculating.
 */
export default async function AfRankingsRedirect(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}): Promise<never> {
  const sp = (await props.searchParams) ?? {}
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'scope' || k === 'panel') continue
    if (typeof v === 'string') q.set(k, v)
    else if (Array.isArray(v) && typeof v[0] === 'string') q.set(k, v[0])
  }
  q.set('scope', 'portfolio')
  q.set('panel', 'legacy')
  redirect(`/core/rankings?${q.toString()}`)
}
