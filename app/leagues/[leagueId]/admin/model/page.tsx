import React from "react"
import { redirect } from "next/navigation"
import { getAdminAccessState } from "@/lib/adminAuth"
import { V3WeightsPanel } from "@/components/admin/V3WeightsPanel"
import { UsageAnalyticsPanel } from "@/components/admin/UsageAnalyticsPanel"
/*
 * ⚠ EVERY af-* CLASS BELOW IS SCOPED UNDER `.af-core` — `.af-core .af-frame` is
 * (0,2,0) and beats a bare class, so the wrapper is load-bearing, not a
 * container div. Drop it and the page renders unstyled rather than merely
 * plain.
 */
import "@/components/core-app/af-core.css"

export const dynamic = "force-dynamic"

export default async function ModelAdminPage(props: { params: { leagueId: string } }) {
  const leagueId = props.params.leagueId

  const gate = await getAdminAccessState()
  if (gate.status === "unauthenticated") {
    redirect(`/admin-login?next=${encodeURIComponent(`/leagues/${leagueId}/admin/model`)}`)
  }
  if (gate.status === "forbidden") {
    return (
      <div className="af-core p-4">
        <div className="af-frame" style={{ padding: 16, maxWidth: 520 }}>
          <h1 className="af-display" style={{ margin: 0, fontSize: 22 }}>Access denied</h1>
          <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: "var(--muted)" }}>
            You are signed in, but this account is not on the AllFantasy admin allowlist.
          </p>
        </div>
      </div>
    )
  }

  const season = new Date().getFullYear().toString()
  const defaultWeek = 1

  return (
    <div className="af-core space-y-4 p-4">
      <header className="af-frame" style={{ padding: 16 }}>
        <p className="af-label" style={{ color: "var(--muted)" }}>Admin</p>
        <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: "-0.03em" }}>
          Model Admin
        </h1>
        {/* The id is rendered monospaced on purpose: it is copied and pasted, and
            a proportional font makes a mistyped or truncated UUID unnoticeable. */}
        <p className="af-num" style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
          League {leagueId}
        </p>
      </header>

      <V3WeightsPanel leagueId={leagueId} season={season} defaultWeek={defaultWeek} />

      <UsageAnalyticsPanel leagueId={leagueId} />
    </div>
  )
}
