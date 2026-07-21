import React from "react"
import { redirect } from "next/navigation"
import { getAdminAccessState } from "@/lib/adminAuth"
import { V3WeightsPanel } from "@/components/admin/V3WeightsPanel"
import { UsageAnalyticsPanel } from "@/components/admin/UsageAnalyticsPanel"

export const dynamic = "force-dynamic"

export default async function ModelAdminPage(props: { params: { leagueId: string } }) {
  const leagueId = props.params.leagueId

  const gate = await getAdminAccessState()
  if (gate.status === "unauthenticated") {
    redirect(`/admin-login?next=${encodeURIComponent(`/leagues/${leagueId}/admin/model`)}`)
  }
  if (gate.status === "forbidden") {
    return (
      <div className="p-4">
        <div className="rounded-2xl bg-zinc-950 p-4">
          <div className="text-xl font-bold">Access denied</div>
          <div className="mt-2 text-sm opacity-70">
            You are signed in, but this account is not on the AllFantasy admin allowlist.
          </div>
        </div>
      </div>
    )
  }

  const season = new Date().getFullYear().toString()
  const defaultWeek = 1

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-2xl bg-zinc-950 p-4">
        <div className="text-xl font-bold">Model Admin</div>
        <div className="text-sm opacity-70">League {leagueId}</div>
      </div>

      <V3WeightsPanel leagueId={leagueId} season={season} defaultWeek={defaultWeek} />

      <UsageAnalyticsPanel leagueId={leagueId} />
    </div>
  )
}
