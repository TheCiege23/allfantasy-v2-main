import { redirect } from 'next/navigation'

/** Legacy URL: `/app/tournament/[id]` → canonical `/tournament/[id]` */
export default async function AppTournamentLegacyRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ tournamentId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ tournamentId }, sp] = await Promise.all([params, searchParams])
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
  redirect(`/tournament/${tournamentId}${suffix}`)
}
