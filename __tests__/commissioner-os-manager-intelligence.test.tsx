import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ManagerIntelligenceView } from "@/components/commissioner-os/managers/ManagerIntelligenceView"
import { stubManagerIntelligenceClient } from "@/lib/commissioner-ui/managers/decision-os-client/stub"
import { demoManagerIntelligenceClient } from "@/lib/commissioner-ui/managers/decision-os-client/demo"
import { liveManagerIntelligenceClient } from "@/lib/commissioner-ui/managers/decision-os-client/live"

describe("commissioner-os — Manager Intelligence client parity", () => {
  it("stub, demo, and live all satisfy the same method surface", () => {
    expect(typeof stubManagerIntelligenceClient.getManagerDirectory).toBe("function")
    expect(typeof demoManagerIntelligenceClient.getManagerDirectory).toBe("function")
    expect(typeof liveManagerIntelligenceClient.getManagerDirectory).toBe("function")
  })

  it("live placeholder returns an honest error, never fixture data", async () => {
    const response = await liveManagerIntelligenceClient.getManagerDirectory()
    expect(response.data).toBeNull()
    expect(response.error?.category).toBe("upstream_unavailable")
  })

  it("demo data includes both recognition and risk — never all-negative or all-positive", async () => {
    const response = await demoManagerIntelligenceClient.getManagerDirectory()
    const managers = response.data!
    expect(managers.some((m) => m.recognition)).toBe(true)
    expect(managers.some((m) => m.riskFlag)).toBe(true)
  })
})

describe("commissioner-os — Manager Intelligence view", () => {
  it("renders every manager's name from demo data", async () => {
    const response = await demoManagerIntelligenceClient.getManagerDirectory()
    render(<ManagerIntelligenceView managers={response.data!} dataMode="demo" />)
    for (const manager of response.data!) {
      expect(screen.getByText(manager.managerName)).toBeInTheDocument()
    }
  })

  /*
   * Milestone 32: a characterisation label of a named manager is shown to NOBODY, commissioners
   * included. The card used to render `manager.archetype` as a badge ("Active Trader", "Quiet
   * Participant"…). Fixtures and the live client no longer carry one; this pins the VIEW too, by
   * handing it a profile that still does (an older payload) and checking it is not drawn.
   */
  it("never renders a manager archetype label, even when a payload still carries one", async () => {
    const response = await demoManagerIntelligenceClient.getManagerDirectory()
    const withLegacyLabels = response.data!.map((m, i) => ({
      ...m,
      archetype: ["Active Trader", "Quiet Participant", "Steady Operator", "Connector"][i % 4],
    }))
    const { container } = render(<ManagerIntelligenceView managers={withLegacyLabels as never} dataMode="demo" />)
    // Positive control: the cards rendered, with their facts.
    expect(screen.getByText(response.data![0].managerName)).toBeInTheDocument()
    expect(screen.getAllByText(/Reliability:/).length).toBeGreaterThan(0)
    expect(container.textContent).not.toMatch(/Active Trader|Quiet Participant|Steady Operator|Connector/)
  })

  it("the demo and stub fixtures carry no archetype", async () => {
    for (const client of [demoManagerIntelligenceClient, stubManagerIntelligenceClient]) {
      const response = await client.getManagerDirectory()
      expect(response.data!.length).toBeGreaterThan(0)
      for (const m of response.data!) expect(m).not.toHaveProperty("archetype")
    }
  })

  it("never renders a single collapsed overall score — reliability is shown as one specific, labeled trait", async () => {
    const response = await demoManagerIntelligenceClient.getManagerDirectory()
    render(<ManagerIntelligenceView managers={response.data!} dataMode="demo" />)
    expect(screen.queryByText(/^Score:/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/Reliability:/).length).toBeGreaterThan(0)
  })

  it("shows an empty state, not an error, when there is no manager history yet", () => {
    render(<ManagerIntelligenceView managers={[]} dataMode="demo" />)
    expect(screen.getByText('No manager history yet.')).toBeInTheDocument()
  })
})
