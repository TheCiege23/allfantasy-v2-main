import { notFound } from "next/navigation"
import LegacyTab from "@/components/app/tabs/LegacyTab"

export default async function E2ELegacyScorePage(props: {
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
  const leagueId = resolved.leagueId?.trim() || "e2e-legacy-score-league"

  return (
    <main className="min-h-screen bg-[#0a0a0f] p-6 text-white">
      <h1 className="mb-4 text-xl font-semibold">E2E Legacy Score Harness</h1>
      <LegacyTab leagueId={leagueId} />
    </main>
  )
}
