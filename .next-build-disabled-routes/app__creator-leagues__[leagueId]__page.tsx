import { redirect } from "next/navigation"

export default async function CreatorLeaguesJoinAliasPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { leagueId } = await params
  const query = await searchParams
  const sp = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") sp.set(key, value)
    if (Array.isArray(value) && value.length > 0) sp.set(key, value[0] ?? "")
  }

  const suffix = sp.toString() ? `?${sp.toString()}` : ""
  redirect(`/creator/leagues/${encodeURIComponent(leagueId)}${suffix}`)
}

