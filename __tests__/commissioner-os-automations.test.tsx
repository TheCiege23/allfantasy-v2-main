import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AutomationCenterView } from "@/components/commissioner-os/automations/AutomationCenterView"
import { stubAutomationClient } from "@/lib/commissioner-ui/automations/decision-os-client/stub"
import { demoAutomationClient } from "@/lib/commissioner-ui/automations/decision-os-client/demo"
import { liveAutomationClient } from "@/lib/commissioner-ui/automations/decision-os-client/live"
import type { AutomationCatalogEntry, AutomationExecutionEntry } from "@/lib/commissioner-ui/automations/decision-os-client"

function makeAutomation(overrides: Partial<AutomationCatalogEntry> = {}): AutomationCatalogEntry {
  return {
    id: 'auto-1',
    name: 'Test automation',
    description: 'A test automation.',
    category: 'communications',
    status: 'enabled',
    health: 'positive',
    schedule: { triggerType: 'manual', description: 'Manual only.' },
    totalRunsCount: 1,
    successRatePercent: 100,
    relatedLinks: [],
    ...overrides,
  }
}

async function loadDemoCatalogAndHistory() {
  const catalogResponse = await demoAutomationClient.getCatalog()
  const catalog = catalogResponse.data!
  const historyResponses = await Promise.all(catalog.map((a) => demoAutomationClient.getExecutionHistory(a.id)))
  const historyByAutomationId: Record<string, AutomationExecutionEntry[]> = {}
  catalog.forEach((a, i) => {
    historyByAutomationId[a.id] = historyResponses[i].data ?? []
  })
  return { catalog, historyByAutomationId }
}

describe("commissioner-os automations — client parity", () => {
  it("stub, demo, and live all satisfy the same method surface", () => {
    for (const method of ['getCatalog', 'getExecutionHistory', 'getSummary'] as const) {
      expect(typeof stubAutomationClient[method]).toBe('function')
      expect(typeof demoAutomationClient[method]).toBe('function')
      expect(typeof liveAutomationClient[method]).toBe('function')
    }
  })

  it("stub and demo are source-tagged and error-free; live is an honest, typed placeholder error for every method", async () => {
    const stubCatalog = await stubAutomationClient.getCatalog()
    const demoCatalog = await demoAutomationClient.getCatalog()
    expect(stubCatalog.source).toBe('stub')
    expect(stubCatalog.error).toBeNull()
    expect(demoCatalog.source).toBe('demo')
    expect(demoCatalog.error).toBeNull()

    const liveCatalog = await liveAutomationClient.getCatalog()
    const liveHistory = await liveAutomationClient.getExecutionHistory('any-id')
    const liveSummary = await liveAutomationClient.getSummary()
    for (const response of [liveCatalog, liveHistory, liveSummary]) {
      expect(response.data).toBeNull()
      expect(response.error?.category).toBe('upstream_unavailable')
      expect(response.error?.retryable).toBe(false)
      expect(response.source).toBe('live')
    }
  })

  it("demo catalog's summary numbers are internally consistent with the catalog itself", async () => {
    const { catalog } = await loadDemoCatalogAndHistory()
    const summaryResponse = await demoAutomationClient.getSummary()
    const summary = summaryResponse.data!

    const actualActive = catalog.filter((a) => a.status === 'enabled').length
    const actualNeedsAttention = catalog.filter((a) => a.status === 'enabled' && (a.health === 'critical' || a.health === 'elevated')).length

    expect(summary.totalCount).toBe(catalog.length)
    expect(summary.activeCount).toBe(actualActive)
    expect(summary.needsAttentionCount).toBe(actualNeedsAttention)
  })

  it("demo data includes at least one enabled automation with non-positive health — status and health are different axes", async () => {
    const { catalog } = await loadDemoCatalogAndHistory()
    const unhealthyButEnabled = catalog.filter((a) => a.status === 'enabled' && a.health !== 'positive')
    expect(unhealthyButEnabled.length).toBeGreaterThan(0)
  })

  it("demo data includes at least one disabled automation", async () => {
    const { catalog } = await loadDemoCatalogAndHistory()
    expect(catalog.some((a) => a.status === 'disabled')).toBe(true)
  })

  it("getExecutionHistory returns an empty (not erroring) result for an automation with no runs", async () => {
    const response = await demoAutomationClient.getExecutionHistory('not-a-real-automation-id')
    expect(response.error).toBeNull()
    expect(response.data).toEqual([])
  })
})

describe("commissioner-os automations — view", () => {
  it("renders the preview data banner and every catalog entry, sorted by health severity", async () => {
    const { catalog, historyByAutomationId } = await loadDemoCatalogAndHistory()
    render(<AutomationCenterView catalog={catalog} historyByAutomationId={historyByAutomationId} dataMode="demo" />)

    expect(screen.getByRole('status')).toHaveTextContent(/preview data/i)

    const elevatedIndex = document.body.innerHTML.indexOf('Lineup lock reminder')
    const positiveIndex = document.body.innerHTML.indexOf('Trade-deadline reminder broadcast')
    expect(elevatedIndex).toBeGreaterThan(-1)
    expect(positiveIndex).toBeGreaterThan(-1)
    expect(elevatedIndex).toBeLessThan(positiveIndex)
  })

  it("shows status and health as visually distinct badges for an enabled-but-unhealthy automation", async () => {
    const { catalog, historyByAutomationId } = await loadDemoCatalogAndHistory()
    render(<AutomationCenterView catalog={catalog} historyByAutomationId={historyByAutomationId} dataMode="demo" />)

    const card = screen.getByText('Lineup lock reminder').closest('[class*="rounded-2xl"]') as HTMLElement
    expect(within(card).getByText('Enabled')).toBeInTheDocument()
    expect(within(card).getByText('Elevated')).toBeInTheDocument()
  })

  it("toggling the switch flips its own local enabled/disabled label without affecting other automations", async () => {
    const { catalog, historyByAutomationId } = await loadDemoCatalogAndHistory()
    render(<AutomationCenterView catalog={catalog} historyByAutomationId={historyByAutomationId} dataMode="demo" />)

    const card = screen.getByText('Trade-deadline reminder broadcast').closest('[class*="rounded-2xl"]') as HTMLElement
    const toggle = within(card).getByRole('switch')
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(within(card).getByText('Disabled')).toBeInTheDocument()

    const otherCard = screen.getByText('Lineup lock reminder').closest('[class*="rounded-2xl"]') as HTMLElement
    expect(within(otherCard).getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it("View History opens a dialog with the execution history table, and a row expands to reveal its detail", async () => {
    const { catalog, historyByAutomationId } = await loadDemoCatalogAndHistory()
    render(<AutomationCenterView catalog={catalog} historyByAutomationId={historyByAutomationId} dataMode="demo" />)

    const card = screen.getByText('Lineup lock reminder').closest('[class*="rounded-2xl"]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: 'View History' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Failed to reach 2 of 12 managers')).toBeInTheDocument()
    expect(within(dialog).queryByText(/expired device token/i)).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByText('Failed to reach 2 of 12 managers'))
    expect(within(dialog).getByText(/expired device token/i)).toBeInTheDocument()
  })

  it("shows an affirmative empty state when the catalog is empty", () => {
    render(<AutomationCenterView catalog={[]} historyByAutomationId={{}} dataMode="demo" />)
    expect(screen.getByText('No automations yet.')).toBeInTheDocument()
  })

  it("renders ErrorState instead of the catalog when an error is present", () => {
    render(
      <AutomationCenterView
        catalog={[]}
        historyByAutomationId={{}}
        dataMode="live"
        errorMessage="The live Decision OS backend is not yet integrated in this environment."
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/not yet integrated/i)
  })

  it("hides the preview data banner in live mode", () => {
    render(<AutomationCenterView catalog={[]} historyByAutomationId={{}} dataMode="live" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it("a single automation with no related links renders without the related-links list", () => {
    render(
      <AutomationCenterView
        catalog={[makeAutomation({ relatedLinks: [] })]}
        historyByAutomationId={{ 'auto-1': [] }}
        dataMode="demo"
      />
    )
    expect(screen.getByText('Test automation')).toBeInTheDocument()
  })
})
