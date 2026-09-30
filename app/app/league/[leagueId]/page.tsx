import { redirect } from 'next/navigation'

/** Legacy URL: `/app/league/[id]` → canonical `/league/[id]` */
export default async function AppLeagueLegacyRedirect(
  props: {
    params: Promise<{ leagueId: string }>
    searchParams: Promise<Record<string, string | string[] | undefined>>
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const [{ leagueId }, sp] = await Promise.all([params, searchParams])
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) q.append(key, v)
    } else {
      q.append(key, value)
    }
  }
  const suffix = q.toString() ? `?${q.toString()}` : ''
  redirect(`/league/${leagueId}${suffix}`)
}
