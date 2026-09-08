import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/*
 * `ReportsView` calls `useRouter` so a live generation can re-read the server's history rather than
 * guessing what it now contains. The App Router page supplies that context; a bare render does not.
 */
const routerRefresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: routerRefresh }) }))

/*
 * The live client is now really wired, so it reads `platform_config` for its readiness flag. The
 * vitest db-guard pins the database to 127.0.0.1:1, so that read is stubbed here — the flag's own
 * behaviour is not what this suite is about.
 */
const isLiveReady = vi.hoisted(() => vi.fn(async () => false))
vi.mock('@/lib/commissioner-ui/liveReadiness', () => ({ isLiveReady, setLiveReady: vi.fn() }))
import { ReportsView } from "@/components/commissioner-os/reports/ReportsView"
import { stubReportsClient } from "@/lib/commissioner-ui/reports/decision-os-client/stub"
import { demoReportsClient } from "@/lib/commissioner-ui/reports/decision-os-client/demo"
import { liveReportsClient } from "@/lib/commissioner-ui/reports/decision-os-client/live"
import { buildReportCsv } from "@/lib/commissioner-ui/reports/exportUtils"
import type { GeneratedReport } from "@/lib/commissioner-ui/reports/decision-os-client"

function makeReport(overrides: Partial<GeneratedReport> = {}): GeneratedReport {
  return {
    id: 'report-x',
    templateId: 'template-x',
    templateName: 'Test Report',
    status: 'ready',
    format: 'pdf',
    generatedAt: new Date().toISOString(),
    generatedByLabel: 'Test User',
    summary: 'A test report summary.',
    sizeLabel: '10 KB',
    shareStatus: 'private',
    relatedLinks: [],
    ...overrides,
  }
}

describe("commissioner-os reports — client parity", () => {
  it("stub, demo, and live all satisfy the same method surface", () => {
    for (const method of ['getTemplates', 'getHistory', 'getSummary'] as const) {
      expect(typeof stubReportsClient[method]).toBe('function')
      expect(typeof demoReportsClient[method]).toBe('function')
      expect(typeof liveReportsClient[method]).toBe('function')
    }
  })

  it("stub and demo are source-tagged and error-free; live returns an honest, typed error while the module is not enabled", async () => {
    const stubTemplates = await stubReportsClient.getTemplates()
    const demoTemplates = await demoReportsClient.getTemplates()
    expect(stubTemplates.source).toBe('stub')
    expect(stubTemplates.error).toBeNull()
    expect(demoTemplates.source).toBe('demo')
    expect(demoTemplates.error).toBeNull()

    // 🛑 THIS USED TO ASSERT A PERMANENT PLACEHOLDER, and that claim is no longer true — Reports is
    // wired to a real catalog and artifact store. What is still true, and worth guarding, is that a
    // module which is not switched on says so rather than returning an empty list that would read
    // as "you have generated zero reports".
    isLiveReady.mockResolvedValue(false)
    const liveTemplates = await liveReportsClient.getTemplates()
    const liveHistory = await liveReportsClient.getHistory()
    const liveSummary = await liveReportsClient.getSummary()
    for (const response of [liveTemplates, liveHistory, liveSummary]) {
      expect(response.data).toBeNull()
      expect(response.error?.category).toBe('upstream_unavailable')
      expect(response.error?.retryable).toBe(false)
      expect(response.source).toBe('live')
    }
  })

  it("demo summary's readyCount and scheduledCount match the actual history/templates", async () => {
    const historyResponse = await demoReportsClient.getHistory()
    const templatesResponse = await demoReportsClient.getTemplates()
    const summaryResponse = await demoReportsClient.getSummary()

    const actualReady = historyResponse.data!.filter((r) => r.status === 'ready').length
    const actualScheduled = templatesResponse.data!.filter((t) => t.schedule.frequency !== 'manual').length

    expect(summaryResponse.data!.readyCount).toBe(actualReady)
    expect(summaryResponse.data!.scheduledCount).toBe(actualScheduled)
  })

  it("demo history includes every status — ready, generating, and failed", async () => {
    const response = await demoReportsClient.getHistory()
    const statuses = new Set(response.data!.map((r) => r.status))
    expect(statuses.has('ready')).toBe(true)
    expect(statuses.has('generating')).toBe(true)
    expect(statuses.has('failed')).toBe(true)
  })

  it("no GeneratedReport embeds raw source-module data — only a summary string and related links", async () => {
    const response = await demoReportsClient.getHistory()
    for (const report of response.data!) {
      expect(typeof report.summary).toBe('string')
      expect(Array.isArray(report.relatedLinks)).toBe(true)
    }
  })
})

describe("commissioner-os reports — CSV export", () => {
  it("produces a Field,Value row per metadata field", () => {
    const csv = buildReportCsv(makeReport())
    const rows = csv.split('\n')
    expect(rows[0]).toBe('Field,Value')
    expect(rows).toHaveLength(7) // header + Report/Status/Format/Generated At/Generated By/Summary
  })

  it("includes an extra row for failureReason only when present", () => {
    const withFailure = buildReportCsv(makeReport({ status: 'failed', failureReason: 'It broke.' }))
    const withoutFailure = buildReportCsv(makeReport())
    expect(withFailure.split('\n')).toHaveLength(8)
    expect(withoutFailure.split('\n')).toHaveLength(7)
  })

  it("escapes commas and quotes in the summary", () => {
    const csv = buildReportCsv(makeReport({ summary: 'Contains, a comma and a "quote".' }))
    expect(csv).toContain('"Contains, a comma and a ""quote""."')
  })
})

describe("commissioner-os reports — view", () => {
  it("renders the preview data banner and every template with a Generate button", async () => {
    const templatesResponse = await demoReportsClient.getTemplates()
    const historyResponse = await demoReportsClient.getHistory()
    render(<ReportsView templates={templatesResponse.data!} history={historyResponse.data!} dataMode="demo" />)

    expect(screen.getByRole('status')).toHaveTextContent(/preview data/i)
    for (const template of templatesResponse.data!) {
      expect(screen.getAllByText(template.name).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByRole('button', { name: 'Generate Report' }).length).toBe(templatesResponse.data!.length)
  })

  it("renders history rows with their status label", async () => {
    const templatesResponse = await demoReportsClient.getTemplates()
    const historyResponse = await demoReportsClient.getHistory()
    render(<ReportsView templates={templatesResponse.data!} history={historyResponse.data!} dataMode="demo" />)

    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0)
    expect(screen.getByText('Generating').closest('td')).toBeInTheDocument()
    expect(screen.getByText('Failed').closest('td')).toBeInTheDocument()
  })

  it("Generate Report adds a generating entry that becomes ready after the simulated delay", async () => {
    vi.useFakeTimers()
    try {
      const templatesResponse = await demoReportsClient.getTemplates()
      render(<ReportsView templates={templatesResponse.data!} history={[]} dataMode="demo" />)

      const template = templatesResponse.data![0]
      fireEvent.click(screen.getAllByRole('button', { name: 'Generate Report' })[0])

      const table = screen.getByRole('table')
      expect(within(table).getByText(template.name).closest('tr')).toHaveTextContent('Generating')

      await vi.advanceTimersByTimeAsync(2000)

      expect(within(table).getByText(template.name).closest('tr')).toHaveTextContent('Ready')
    } finally {
      vi.useRealTimers()
    }
  })

  it("View opens the detail dialog with summary, related links, and export/share actions for a ready report", async () => {
    const report = makeReport({ relatedLinks: [{ moduleId: 'league-health', label: 'League Health', href: '/commissioner-os/league-health' }] })
    render(<ReportsView templates={[]} history={[report]} dataMode="demo" />)

    fireEvent.click(screen.getByRole('button', { name: 'View' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(report.summary)).toBeInTheDocument()
    expect(within(dialog).getByText('League Health')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Download PDF/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Download CSV/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Share' })).toBeInTheDocument()
  })

  it("Share reveals a link, and Unshare removes it", async () => {
    const report = makeReport()
    render(<ReportsView templates={[]} history={[report]} dataMode="demo" />)

    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Share' }))
    expect(within(dialog).getByText(`https://allfantasy.ai/r/${report.id}`)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Unshare' })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Unshare' }))
    expect(within(dialog).queryByText(`https://allfantasy.ai/r/${report.id}`)).not.toBeInTheDocument()
  })

  it("shows the failure reason for a failed report instead of export/share actions", async () => {
    const report = makeReport({ status: 'failed', failureReason: 'Timed out while aggregating data.' })
    render(<ReportsView templates={[]} history={[report]} dataMode="demo" />)

    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Timed out while aggregating data.')
    expect(within(dialog).queryByRole('button', { name: /Download PDF/ })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it("shows an affirmative empty state when there is no history", () => {
    render(<ReportsView templates={[]} history={[]} dataMode="demo" />)
    expect(screen.getByText('No reports yet.')).toBeInTheDocument()
  })

  it("renders ErrorState instead of templates/history when an error is present", () => {
    render(<ReportsView templates={[]} history={[]} dataMode="live" errorMessage="The live Decision OS backend is not yet integrated in this environment." />)
    expect(screen.getByRole('alert')).toHaveTextContent(/not yet integrated/i)
    expect(screen.queryByText('Report Templates')).not.toBeInTheDocument()
  })

  it("hides the preview data banner in live mode", () => {
    render(<ReportsView templates={[]} history={[]} dataMode="live" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('commissioner-os reports — Generate in LIVE mode', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    routerRefresh.mockClear()
  })

  const template = { id: 'weekly-commissioner-digest', name: 'Weekly Digest', description: 'd', category: 'commissioner_digest' as const, sourceModuleIds: [], schedule: { frequency: 'weekly' as const } }

  it('🛑 CALLS THE REAL GENERATOR AND DOES NOT FABRICATE A ROW', async () => {
    /*
     * The whole point of the live branch. The stub/demo path invents a `generating` row that flips
     * to ready with a hard-coded "128 KB"; beside a real history that row is indistinguishable from
     * a genuine artifact. In live mode nothing may be invented — the server is asked, and the
     * server's history is re-read.
     */
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'r1', templateId: template.id, status: 'ready', sizeBytes: 2048 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ReportsView templates={[template]} history={[]} dataMode="live" />)
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/commissioner-os/reports/generate')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ templateId: template.id })

    // No invented row, and the server's history is what gets re-read.
    expect(screen.queryByText('128 KB')).toBeNull()
    await waitFor(() => expect(routerRefresh).toHaveBeenCalled())
  })

  it('surfaces a recorded failure instead of reporting success over a report that does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'r2', templateId: template.id, status: 'failed', failureReason: 'warehouse unreachable' }), { status: 200 })))

    render(<ReportsView templates={[template]} history={[]} dataMode="live" />)
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('warehouse unreachable')
  })

  it('surfaces a refusal from the server rather than failing silently', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'No commissioned league for this session.' }), { status: 403 })))

    render(<ReportsView templates={[template]} history={[]} dataMode="live" />)
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No commissioned league')
  })

  it('⚠ keeps the SIMULATION in demo mode, where every row on the page is a fixture anyway', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<ReportsView templates={[template]} history={[]} dataMode="demo" />)
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))

    expect(fetchMock).not.toHaveBeenCalled()
    /*
     * The status label is the assertion, not the template name — the name also appears on the
     * template card above the table, so matching it would pass without any row being added at all.
     */
    expect(await screen.findByText('Generating')).toBeTruthy()
    expect(routerRefresh).not.toHaveBeenCalled()
  })
})
