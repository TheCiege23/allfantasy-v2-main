import { notFound } from "next/navigation"
import { HallOfFameSection } from "@/components/rankings/HallOfFameSection"

export default async function E2EHallOfFamePage(props: {
  searchParams?: Promise<{ leagueId?: string }> | { leagueId?: string }
}) {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  const sp = props.searchParams ?? {}
  const resolved =
    typeof (sp as Promise<{ leagueId?: string }>).then === "function"
      ? await (sp as Promise<{ leagueId?: string }>)
      : (sp as { leagueId?: string })
  const leagueId = resolved.leagueId?.trim() || "e2e-hall-of-fame-league"
  const year = new Date().getUTCFullYear()
  const seasons = [String(year), String(year - 1), String(year - 2), String(year - 3)]

  return (
    <main className="min-h-screen bg-[#0a0a0f] p-6 text-white">
      <h1 className="mb-4 text-xl font-semibold">E2E Hall of Fame Harness</h1>
      <HallOfFameSection leagueId={leagueId} seasons={seasons} defaultSeason={seasons[0]} />
    </main>
  )
}
