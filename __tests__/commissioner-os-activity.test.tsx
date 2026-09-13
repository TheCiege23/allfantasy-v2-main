import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ActivityStreamView } from "@/components/commissioner-os/activity/ActivityStreamView"
import { stubActivityClient } from "@/lib/commissioner-ui/activity/decision-os-client/stub"
import { demoActivityClient } from "@/lib/commissioner-ui/activity/decision-os-client/demo"
import { liveActivityClient } from "@/lib/commissioner-ui/activity/decision-os-client/live"
import type { CommissionerActivityEventContract } from "@/lib/commissioner-ui/contracts"

const EVENT_A: CommissionerActivityEventContract = {
  id: 'event-a', type: 'risk_detected', sourceModuleId: 'league-health', severity: 'warning', initiator: 'system',
  summary: 'A risk was detected.', evidenceHref: '/commissioner-os/league-health', timestamp: new Date().toISOString(),
}
const EVENT_B: CommissionerActivityEventContract = {
  id: 'event-b', type: 'task_completed', sourceModuleId: 'workspace', severity: 'success', initiator: 'human',
  summary: 'A task was completed.', evidenceHref: '/commissioner-os/workspace', timestamp: new Date().toISOString(),
}

describe("commissioner-os activity — client parity", () => {
  it("stub, demo, and live all satisfy the same method surface", () => {
    for (const client of [stubActivityClient, demoActivityClient, liveActivityClient]) {
      expect(typeof client.getEvents).toBe('function')
    }
  })

  it("stub and demo are source-tagged and error-free; live is an honest, typed placeholder error", async () => {
    const stubResponse = await stubActivityClient.getEvents()
    const demoResponse = await demoActivityClient.getEvents()
    expect(stubResponse.source).toBe('stub')
    expect(stubResponse.error).toBeNull()
    expect(demoResponse.source).toBe('demo')
    expect(demoResponse.error).toBeNull()

    const liveResponse = await liveActivityClient.getEvents()
    expect(liveResponse.data).toBeNull()
    expect(liveResponse.error?.category).toBe('upstream_unavailable')
    expect(liveResponse.error?.retryable).toBe(false)
    expect(liveResponse.source).toBe('live')
  })

  it("demo events span multiple source modules, severities, and initiators — a believable cross-module record, not a single-source list", async () => {
    const response = await demoActivityClient.getEvents()
    const events = response.data!
    const sourceModules = new Set(events.map((e) => e.sourceModuleId))
    const severities = new Set(events.map((e) => e.severity))
    const initiators = new Set(events.map((e) => e.initiator))
    expect(sourceModules.size).toBeGreaterThan(1)
    expect(severities.size).toBeGreaterThan(1)
    expect(initiators.has('human')).toBe(true)
    expect(initiators.has('system')).toBe(true)
  })

  it("demo events are ordered newest first", async () => {
    const response = await demoActivityClient.getEvents()
    const events = response.data!
    const timestamps = events.map((e) => new Date(e.timestamp).getTime())
    const sorted = [...timestamps].sort((a, b) => b - a)
    expect(timestamps).toEqual(sorted)
  })

  /*
   * The test above is only as reliable as the wall clock: it failed CI once
   * (2026-09-13, PR #817) with two events meant to be the same number of days
   * apart landing 1 ms out of order — `…008` then `…009`. This makes that race
   * deterministic: every argument-less `new Date()` and every `Date.now()`
   * advances the clock by 1 ms, so a timestamp built from its own clock read
   * cannot hide behind a fast machine.
   */
  it("demo events stay newest first even when the clock ticks between timestamps", async () => {
    const RealDate = Date
    const start = RealDate.UTC(2026, 8, 13, 12, 0, 0)
    let tick = start
    class TickingDate extends RealDate {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(...args: any[]) {
        if (args.length === 0) super(tick++)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        else super(...(args as [any]))
      }
      static now() {
        return tick++
      }
    }
    vi.stubGlobal("Date", TickingDate)
    let timestamps: number[]
    try {
      const response = await demoActivityClient.getEvents()
      timestamps = response.data!.map((e) => RealDate.parse(e.timestamp))
    } finally {
      vi.unstubAllGlobals()
    }
    // The stub must actually have been read, or this test proves nothing.
    expect(tick - start).toBeGreaterThanOrEqual(1)
    expect(timestamps.length).toBeGreaterThan(2)
    const sorted = [...timestamps].sort((a, b) => b - a)
    expect(timestamps).toEqual(sorted)
  })

  it("no event carries anything beyond the platform contract's own fields — never a duplicated copy of the underlying entity", async () => {
    const response = await demoActivityClient.getEvents()
    const allowedKeys = new Set(['id', 'type', 'sourceModuleId', 'severity', 'initiator', 'summary', 'evidenceHref', 'timestamp'])
    for (const event of response.data!) {
      for (const key of Object.keys(event)) {
        expect(allowedKeys.has(key)).toBe(true)
      }
      expect(event.summary.length).toBeGreaterThan(0)
    }
  })
})

describe("commissioner-os activity — stream view", () => {
  it("renders the preview data banner and every event grouped under an All tab", () => {
    render(<ActivityStreamView events={[EVENT_A, EVENT_B]} dataMode="demo" />)

    expect(screen.getByRole('status')).toHaveTextContent(/preview data/i)
    expect(screen.getByRole('tab', { name: /All \(2\)/ })).toBeInTheDocument()
    expect(screen.getByText(EVENT_A.summary)).toBeInTheDocument()
    expect(screen.getByText(EVENT_B.summary)).toBeInTheDocument()
  })

  it("shows severity, module, and initiator metadata per event", () => {
    render(<ActivityStreamView events={[EVENT_A]} dataMode="demo" />)

    expect(screen.getByText('Warning')).toBeInTheDocument()
    expect(screen.getAllByText('League Health').length).toBeGreaterThan(0)
    expect(screen.getByText('System')).toBeInTheDocument()
  })

  it("filtering by source module narrows the visible events", () => {
    render(<ActivityStreamView events={[EVENT_A, EVENT_B]} dataMode="demo" />)

    fireEvent.click(screen.getByRole('tab', { name: /Workspace/ }))

    expect(screen.getByText(EVENT_B.summary)).toBeInTheDocument()
    expect(screen.queryByText(EVENT_A.summary)).not.toBeInTheDocument()
  })

  it("an event's evidence link points back at its source module", () => {
    render(<ActivityStreamView events={[EVENT_A]} dataMode="demo" />)

    const link = screen.getByRole('link', { name: /View in League Health/ })
    expect(link).toHaveAttribute('href', '/commissioner-os/league-health')
  })

  it("shows an affirmative empty state when there are no events", () => {
    render(<ActivityStreamView events={[]} dataMode="demo" />)
    expect(screen.getByText('No activity yet.')).toBeInTheDocument()
  })

  it("renders ErrorState instead of the timeline when an error is present", () => {
    render(<ActivityStreamView events={[]} dataMode="live" errorMessage="The live Decision OS backend is not yet integrated in this environment." />)
    expect(screen.getByRole('alert')).toHaveTextContent(/not yet integrated/i)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it("hides the preview data banner in live mode", () => {
    render(<ActivityStreamView events={[]} dataMode="live" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
