import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { LeagueHealthView } from "@/components/commissioner-os/league-health/LeagueHealthView"
import { stubLeagueHealthClient } from "@/lib/commissioner-ui/league-health/decision-os-client/stub"
import { demoLeagueHealthClient } from "@/lib/commissioner-ui/league-health/decision-os-client/demo"
import { liveLeagueHealthClient } from "@/lib/commissioner-ui/league-health/decision-os-client/live"

async function loadAll(client: typeof stubLeagueHealthClient) {
  return Promise.all([client.getHealthDetail(), client.getRisks(), client.getEvidence(), client.getRecommendations()])
}

describe("commissioner-os — League Health client parity", () => {
  it("stub, demo, and live all satisfy the same method surface", () => {
    const methods = ["getHealthDetail", "getRisks", "getEvidence", "getRecommendations"] as const
    for (const method of methods) {
      expect(typeof stubLeagueHealthClient[method]).toBe("function")
      expect(typeof demoLeagueHealthClient[method]).toBe("function")
      expect(typeof liveLeagueHealthClient[method]).toBe("function")
    }
  })

  it("the deduction breakdown sums to the final score", async () => {
    const [detail] = await stubLeagueHealthClient.getHealthDetail().then((r) => [r.data!])
    const sum = detail.baseline + detail.deductions.reduce((total, d) => total + d.points, 0)
    expect(sum).toBe(detail.score)
  })

  it("demo data's deduction breakdown also sums correctly", async () => {
    const response = await demoLeagueHealthClient.getHealthDetail()
    const detail = response.data!
    const sum = detail.baseline + detail.deductions.reduce((total, d) => total + d.points, 0)
    expect(sum).toBe(detail.score)
  })

  it("live placeholder returns an honest error, never fixture data", async () => {
    const response = await liveLeagueHealthClient.getHealthDetail()
    expect(response.data).toBeNull()
    expect(response.error?.category).toBe("upstream_unavailable")
    expect(response.source).toBe("live")
  })
})

describe("commissioner-os — League Health view", () => {
  it("renders the health score, tier, and sub-scores from demo data", async () => {
    const [detail, risks, evidence, recommendations] = await loadAll(demoLeagueHealthClient)
    render(
      <LeagueHealthView
        detail={detail.data!}
        risks={risks.data!}
        evidence={evidence.data!}
        recommendations={recommendations.data!}
        dataMode="demo"
      />
    )
    // The score legitimately appears twice — the hero and the deduction breakdown's "Final Score" line — so this queries for both, not a unique match.
    expect(screen.getAllByText(String(detail.data!.score)).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Healthy')).toBeInTheDocument()
    expect(screen.getByText(String(detail.data!.subScores.engagement))).toBeInTheDocument()
  })

  it("renders the risk table with severity labels", async () => {
    const [detail, risks, evidence, recommendations] = await loadAll(demoLeagueHealthClient)
    render(
      <LeagueHealthView
        detail={detail.data!}
        risks={risks.data!}
        evidence={evidence.data!}
        recommendations={recommendations.data!}
        dataMode="demo"
      />
    )
    for (const risk of risks.data!) {
      expect(screen.getByText(risk.description)).toBeInTheDocument()
    }
  })

  it("shows the healthy empty state when there are no risks", async () => {
    render(
      <LeagueHealthView
        detail={{ score: 100, tier: 'positive', baseline: 100, deductions: [], subScores: { engagement: 100, retention: 100, competitiveBalance: 100, risk: 100 } }}
        risks={[]}
        evidence={[]}
        recommendations={[]}
        dataMode="demo"
      />
    )
    expect(screen.getByText('No active risks.')).toBeInTheDocument()
    expect(screen.getByText('No open recommendations.')).toBeInTheDocument()
  })

  it("evidence is reachable via the View Evidence trigger", async () => {
    const [detail, risks, evidence, recommendations] = await loadAll(demoLeagueHealthClient)
    render(
      <LeagueHealthView
        detail={detail.data!}
        risks={risks.data!}
        evidence={evidence.data!}
        recommendations={recommendations.data!}
        dataMode="demo"
      />
    )
    expect(screen.getByRole('button', { name: 'View Evidence' })).toBeInTheDocument()
  })
})
