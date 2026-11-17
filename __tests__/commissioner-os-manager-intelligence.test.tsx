import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ManagerIntelligenceView, summaryLine } from "@/components/commissioner-os/managers/ManagerIntelligenceView"
import { stubManagerIntelligenceClient } from "@/lib/commissioner-ui/managers/decision-os-client/stub"
import { demoManagerIntelligenceClient } from "@/lib/commissioner-ui/managers/decision-os-client/demo"
import { liveManagerIntelligenceClient } from "@/lib/commissioner-ui/managers/decision-os-client/live"

/**
 * The commissioner's Managers screen is every manager's record as FACTS (2026-11-16, re-score item 11).
 * It used to show Manager DNA profiles (archetype, reliability score, engagement trend), retired in
 * Milestone 32. These pin the replacement: counts, no label, no score.
 */
describe("commissioner-os — Manager directory client parity", () => {
  it("stub, demo, and live all satisfy the same method surface", () => {
    expect(typeof stubManagerIntelligenceClient.getManagerDirectory).toBe("function")
    expect(typeof demoManagerIntelligenceClient.getManagerDirectory).toBe("function")
    expect(typeof liveManagerIntelligenceClient.getManagerDirectory).toBe("function")
  })

  it("the preview is built by the real record builder — facts, never a profile", async () => {
    for (const client of [demoManagerIntelligenceClient, stubManagerIntelligenceClient]) {
      const response = await client.getManagerDirectory()
      expect(response.data!.length).toBeGreaterThan(0)
      for (const m of response.data!) {
        expect(m.record.manager.teamExternalId).toBe(m.id)
        for (const legacy of ["archetype", "reliabilityScore", "engagementTrend", "engagementReliability", "riskFlag", "recognition", "tenureSeasons"]) {
          expect(m).not.toHaveProperty(legacy)
        }
      }
    }
  })
})

describe("commissioner-os — Managers view", () => {
  it("draws every manager with a counts summary and their full record", async () => {
    const response = await demoManagerIntelligenceClient.getManagerDirectory()
    const { container } = render(<ManagerIntelligenceView managers={response.data!} dataMode="demo" />)
    for (const m of response.data!) expect(screen.getByText(m.managerName)).toBeInTheDocument()
    expect(container.textContent).toContain("4 trades · 3 waiver claims won this season · $41 FAAB left · 2 drafts on file")
    expect(container.textContent).toContain("Priya Natarajan took on a WR in 3 of their 4 trades and sent one away in 1.")
    expect(screen.getAllByText("Full record").length).toBe(response.data!.length)
  })

  it("never draws a label, a score or a prediction", async () => {
    const response = await demoManagerIntelligenceClient.getManagerDirectory()
    const { container } = render(<ManagerIntelligenceView managers={response.data!} dataMode="demo" />)
    expect(container.textContent).not.toMatch(/Reliability|Score:|Active Trader|Quiet Participant|will likely|tends to|aggressive|shark/i)
  })

  it("an error is an error, and only a real empty league is the empty state", () => {
    const { container, rerender } = render(<ManagerIntelligenceView managers={[]} dataMode="live" errorMessage="Manager records could not be read right now." />)
    expect(screen.getByRole("alert")).toHaveTextContent("Manager records could not be read right now.")
    expect(container.textContent).not.toContain("No managers in this league yet.")
    rerender(<ManagerIntelligenceView managers={[]} dataMode="live" />)
    expect(screen.getByText("No managers in this league yet.")).toBeInTheDocument()
  })

  it("summaryLine leaves out a section that could not be read rather than printing a zero", async () => {
    const [first] = (await demoManagerIntelligenceClient.getManagerDirectory()).data!
    const r = { ...first!.record, waivers: { available: false as const, reason: "x" } }
    expect(summaryLine(r, "en")).toBe("4 trades · 2 drafts on file")
  })
})
