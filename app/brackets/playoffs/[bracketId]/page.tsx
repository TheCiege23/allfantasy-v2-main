import { redirect } from "next/navigation"
import type { Metadata } from "next"
export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Playoff Bracket" }
}

export default async function PlayoffBracketPage(
  props: {
    params: Promise<{ bracketId: string }>
    searchParams?: Promise<{ entryId?: string }>
  }
) {
  const searchParams = await props.searchParams
  const params = await props.params
  const base = `/brackets/leagues/${encodeURIComponent(params.bracketId)}`
  const entryId = searchParams?.entryId ? String(searchParams.entryId) : ""
  const target = entryId ? `${base}?entryId=${encodeURIComponent(entryId)}` : base
  redirect(target)
}
