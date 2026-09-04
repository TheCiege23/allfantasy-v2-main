import { render, screen, within, fireEvent } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RecommendationsView } from "@/components/commissioner-os/recommendations/RecommendationsView"
import { stubRecommendationsClient } from "@/lib/commissioner-ui/recommendations/decision-os-client/stub"
import { demoRecommendationsClient } from "@/lib/commissioner-ui/recommendations/decision-os-client/demo"
import { liveRecommendationsClient } from "@/lib/commissioner-ui/recommendations/decision-os-client/live"
import type { CommissionerRecommendationContract } from "@/lib/commissioner-ui/contracts"

const TERMINAL_FIXTURES: CommissionerRecommendationContract[] = [
  {
    id: 'terminal-1',
    title: 'Archived: co-commissioner invite sent',
    rationale: 'Resolved fixture.',
    severity: 'standard',
    confidence: 'high',
    expectedImpact: 'None — already resolved.',
    primaryActionLabel: 'Reopen',
    status: 'completed',
    category: 'administrative',
    sourceModuleId: 'recommendations',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'terminal-2',
    title: 'Dismissed: minor scoring anomaly',
    rationale: 'Dismissed fixture.',
    severity: 'advisory',
    confidence: 'moderate',
    expectedImpact: 'None — dismissed by commissioner.',
    primaryActionLabel: 'Reopen',
    status: 'dismissed',
    category: 'competitive_integrity',
    sourceModuleId: 'league-health',
    createdAt: new Date().toISOString(),
  },
]

describe("commissioner-os — Recommendations Center client parity", () => {
  it("stub, demo, and live all satisfy the same method surface", () => {
    expect(typeof stubRecommendationsClient.getQueue).toBe("function")
    expect(typeof demoRecommendationsClient.getQueue).toBe("function")
    expect(typeof liveRecommendationsClient.getQueue).toBe("function")
  })

  it("every response is explicitly tagged with its source", async () => {
    const [stub, demo] = await Promise.all([stubRecommendationsClient.getQueue(), demoRecommendationsClient.getQueue()])
    expect(stub.source).toBe('stub')
    expect(stub.error).toBeNull()
    expect(demo.source).toBe('demo')
    expect(demo.error).toBeNull()
  })

  it("live placeholder returns an honest error, never fixture data", async () => {
    const response = await liveRecommendationsClient.getQueue()
    expect(response.data).toBeNull()
    expect(response.error?.category).toBe("upstream_unavailable")
    expect(response.source).toBe("live")
  })

  it("demo data covers a mix of lifecycle statuses, not just 'new'", async () => {
    const response = await demoRecommendationsClient.getQueue()
    const statuses = new Set(response.data!.map((rec) => rec.status))
    expect(statuses.size).toBeGreaterThan(1)
  })
})

describe("commissioner-os — Recommendations Center view", () => {
  it("Queue tab is selected by default and shows only non-terminal recommendations", async () => {
    const response = await demoRecommendationsClient.getQueue()
    render(<RecommendationsView recommendations={response.data!} dataMode="demo" />)

    expect(screen.getByRole('tab', { name: 'Queue' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'false')
    for (const rec of response.data!) {
      expect(screen.getByText(rec.title)).toBeInTheDocument()
    }
  })

  it("sorts the queue by severity — critical/elevated first, positive last — regardless of source order", async () => {
    const response = await demoRecommendationsClient.getQueue()
    const { container } = render(<RecommendationsView recommendations={response.data!} dataMode="demo" />)

    // Demo source order is elevated, advisory, positive, standard — the view must
    // re-sort by severity rank, so rendered order is elevated, standard, advisory, positive.
    const expectedOrder = [
      'Manager engagement declining', // elevated
      'Routine waiver approvals recurring weekly', // standard
      'Trade deadline approaching', // advisory
      'Standings have tightened', // positive
    ]
    const positions = expectedOrder.map((title) => container.innerHTML.indexOf(title))
    expect(positions.every((pos) => pos >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it("switching to the History tab shows terminal recommendations and hides live ones", async () => {
    const response = await demoRecommendationsClient.getQueue()
    const allRecs = [...response.data!, ...TERMINAL_FIXTURES]
    render(<RecommendationsView recommendations={allRecs} dataMode="demo" />)

    fireEvent.click(screen.getByRole('tab', { name: 'History' }))

    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Archived: co-commissioner invite sent')).toBeInTheDocument()
    expect(screen.getByText('Dismissed: minor scoring anomaly')).toBeInTheDocument()
    expect(screen.queryByText('Manager engagement declining')).not.toBeInTheDocument()
  })

  it("renders workflow status as a neutral badge, separate from the severity badge", async () => {
    const response = await demoRecommendationsClient.getQueue()
    render(<RecommendationsView recommendations={response.data!} dataMode="demo" />)

    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('Automated')).toBeInTheDocument()
    expect(screen.getByText('Deferred')).toBeInTheDocument()
  })

  it("shows an affirmative empty state for an empty queue", () => {
    render(<RecommendationsView recommendations={[]} dataMode="demo" />)
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument()
    expect(screen.getByText('No open recommendations.')).toBeInTheDocument()
  })

  it("shows an empty state for an empty archive", () => {
    render(<RecommendationsView recommendations={[]} dataMode="demo" />)
    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    expect(screen.getByText('Nothing archived recently.')).toBeInTheDocument()
  })

  it("renders the preview data banner for stub and demo, not for live", () => {
    const { rerender } = render(<RecommendationsView recommendations={[]} dataMode="stub" />)
    expect(screen.getByRole('status')).toHaveTextContent(/preview data/i)

    rerender(<RecommendationsView recommendations={[]} dataMode="live" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe("commissioner-os — Recommendations Center card actions scoped within a card", () => {
  it("each recommendation's action button is reachable inside its own card", async () => {
    const response = await demoRecommendationsClient.getQueue()
    render(<RecommendationsView recommendations={response.data!} dataMode="demo" />)

    const card = screen.getByText('Manager engagement declining').closest('[class*="rounded-2xl"]') as HTMLElement
    expect(card).not.toBeNull()
    expect(within(card).getByRole('button', { name: 'Send Check-In' })).toBeInTheDocument()
  })
})
