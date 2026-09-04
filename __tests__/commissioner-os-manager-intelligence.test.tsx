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
  it("renders every manager's name and archetype from demo data", async () => {
    const response = await demoManagerIntelligenceClient.getManagerDirectory()
    render(<ManagerIntelligenceView managers={response.data!} dataMode="demo" />)
    for (const manager of response.data!) {
      expect(screen.getByText(manager.managerName)).toBeInTheDocument()
      expect(screen.getByText(manager.archetype)).toBeInTheDocument()
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
