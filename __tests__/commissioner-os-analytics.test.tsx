import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { LeagueAnalyticsView } from "@/components/commissioner-os/analytics/LeagueAnalyticsView"
import { stubAnalyticsClient } from "@/lib/commissioner-ui/analytics/decision-os-client/stub"
import { demoAnalyticsClient } from "@/lib/commissioner-ui/analytics/decision-os-client/demo"
import { liveAnalyticsClient } from "@/lib/commissioner-ui/analytics/decision-os-client/live"
import { buildAnalyticsCsv } from "@/lib/commissioner-ui/analytics/exportCsv"
import type { LeagueAnalyticsSnapshot } from "@/lib/commissioner-ui/analytics/decision-os-client"

describe("commissioner-os analytics — client parity", () => {
  it("stub, demo, and live all satisfy the same method surface", () => {
    expect(typeof stubAnalyticsClient.getSnapshot).toBe('function')
    expect(typeof stubAnalyticsClient.getSummary).toBe('function')
    expect(typeof demoAnalyticsClient.getSnapshot).toBe('function')
    expect(typeof demoAnalyticsClient.getSummary).toBe('function')
    expect(typeof liveAnalyticsClient.getSnapshot).toBe('function')
    expect(typeof liveAnalyticsClient.getSummary).toBe('function')
  })

  it("stub and demo are source-tagged and error-free; live is an honest, typed placeholder error", async () => {
    const stubSnapshot = await stubAnalyticsClient.getSnapshot()
    const demoSnapshot = await demoAnalyticsClient.getSnapshot()
    expect(stubSnapshot.source).toBe('stub')
    expect(stubSnapshot.error).toBeNull()
    expect(demoSnapshot.source).toBe('demo')
    expect(demoSnapshot.error).toBeNull()

    const liveSnapshot = await liveAnalyticsClient.getSnapshot()
    const liveSummary = await liveAnalyticsClient.getSummary()
    for (const response of [liveSnapshot, liveSummary]) {
      expect(response.data).toBeNull()
      expect(response.error?.category).toBe('upstream_unavailable')
      expect(response.error?.retryable).toBe(false)
      expect(response.source).toBe('live')
    }
  })

  it("demo summary's kpiCount matches the snapshot's actual kpi count", async () => {
    const snapshotResponse = await demoAnalyticsClient.getSnapshot()
    const summaryResponse = await demoAnalyticsClient.getSummary()
    expect(summaryResponse.data!.kpiCount).toBe(snapshotResponse.data!.kpis.length)
  })

  it("demo snapshot's trend series all have the same number of points", async () => {
    const response = await demoAnalyticsClient.getSnapshot()
    const lengths = new Set(response.data!.trends.map((series) => series.points.length))
    expect(lengths.size).toBe(1)
  })

  it("demo snapshot's scoring distribution, roster utilization, and season comparison are all non-empty", async () => {
    const response = await demoAnalyticsClient.getSnapshot()
    expect(response.data!.scoringDistribution.length).toBeGreaterThan(0)
    expect(response.data!.rosterUtilization.length).toBeGreaterThan(0)
    expect(response.data!.seasonComparison.length).toBeGreaterThan(0)
  })
})

describe("commissioner-os analytics — CSV export", () => {
  const snapshot: LeagueAnalyticsSnapshot = {
    kpis: [{ id: 'k1', label: 'Engagement', value: '91' }],
    trends: [{ id: 't1', name: 'Engagement Trend', points: [{ label: 'Wk 1', value: 82 }, { label: 'Wk 2', value: 85 }] }],
    competitiveBalance: [{ label: 'Point differential', value: '142.3 pts', interpretation: 'Tight season.' }],
    scoringDistribution: [{ rangeLabel: '100-119', teamCount: 58 }],
    transactionsByWeek: [{ weekLabel: 'Wk 6', tradeCount: 2, waiverClaimCount: 9 }],
    rosterUtilization: [{ teamName: 'Priya Natarajan', utilizationPercent: 98 }],
    seasonComparison: [{ seasonLabel: '2025', value: 91 }],
    /*
     * 30a's four fields, left empty here on purpose: this block asserts the CSV
     * row count, and an empty section contributes no rows, so the arithmetic in
     * the test below stays about the sections it was written for. The 30a
     * sections get their own row-count assertion underneath.
     */
    healthByWeek: [],
    healthTarget: null,
    managerActivity: [],
    pointsForAgainst: [],
    generatedAt: new Date().toISOString(),
  }

  it("produces one header row plus one row per data point across every section", () => {
    const csv = buildAnalyticsCsv(snapshot)
    const rows = csv.split('\n')
    // header + 1 kpi + 2 trend points + 1 balance metric + 1 scoring bucket + 2 transaction rows (trades+waivers) + 1 roster entry + 1 season point
    expect(rows).toHaveLength(1 + 1 + 2 + 1 + 1 + 2 + 1 + 1)
    expect(rows[0]).toBe('Section,Label,Value')
  })

  it("adds a row per 30a data point when those sections are present", () => {
    const csv = buildAnalyticsCsv({
      ...snapshot,
      healthByWeek: [{ weekLabel: 'Wk 1', thisSeason: 71, lastSeason: 68 }],
      healthTarget: 75,
      managerActivity: [{ managerName: 'Sam Rivera', actionsPerWeek: 4, priorActionsPerWeek: 13 }],
      pointsForAgainst: [{ teamName: 'Sam Rivera', pointsFor: 1191.2, pointsAgainst: 1366.4 }],
    })
    // 2 health rows (this + last season) + 1 target + 2 manager rows + 2 points rows
    expect(csv.split('\n')).toHaveLength(1 + 1 + 2 + 1 + 1 + 2 + 1 + 1 + 2 + 1 + 2 + 2)
    expect(csv).toContain('League Health,Target,75')
  })

  it("omits the last-season row when a league has no comparison season", () => {
    const csv = buildAnalyticsCsv({
      ...snapshot,
      healthByWeek: [{ weekLabel: 'Wk 1', thisSeason: 71, lastSeason: null }],
    })
    expect(csv).toContain('League Health,Wk 1 — This season,71')
    expect(csv).not.toContain('Last season')
  })

  it("escapes values containing commas or quotes", () => {
    const csv = buildAnalyticsCsv({
      ...snapshot,
      competitiveBalance: [{ label: 'A label, with a comma', value: 'A "quoted" value', interpretation: '' }],
    })
    expect(csv).toContain('"A label, with a comma"')
    expect(csv).toContain('"A ""quoted"" value"')
  })
})

describe("commissioner-os analytics — view", () => {
  it("renders the preview data banner, KPIs, and the export button", async () => {
    const response = await demoAnalyticsClient.getSnapshot()
    render(<LeagueAnalyticsView snapshot={response.data} dataMode="demo" />)

    expect(screen.getByRole('status')).toHaveTextContent(/preview data/i)
    for (const kpi of response.data!.kpis) {
      expect(screen.getByText(kpi.label)).toBeInTheDocument()
      expect(screen.getByText(kpi.value)).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeInTheDocument()
  })

  it("renders each chart with an accessible role and label", async () => {
    const response = await demoAnalyticsClient.getSnapshot()
    render(<LeagueAnalyticsView snapshot={response.data} dataMode="demo" />)

    const labels = screen.getAllByRole('img').map((img) => img.getAttribute('aria-label') ?? '')

    /*
     * ⚠ NAMED ENTRIES, NOT A COUNT. This asserted `images.length === 3` and went red the moment
     * three more charts were added — a true failure that says nothing about whether the charts it
     * cares about are still labelled. A count also passes if one chart is swapped for another.
     * Manager activity is a ranked bar LIST, not an SVG, so it is asserted separately below.
     */
    for (const expected of [
      'League health by week',
      'Weekly transactions',
      'Points for and against',
      'Share of league actions by type',
      'All-time records',
      'Behavioural fingerprints',
    ]) {
      expect(labels.some((l) => l.includes(expected)), `no chart labelled "${expected}"`).toBe(true)
    }

    // Every chart carries a real description, not an empty one that satisfies the role alone.
    expect(labels.every((l) => l.trim().length > 10)).toBe(true)
  })

  it("renders the transaction analytics table and competitive balance metrics", async () => {
    const response = await demoAnalyticsClient.getSnapshot()
    render(<LeagueAnalyticsView snapshot={response.data} dataMode="demo" />)

    for (const week of response.data!.transactionsByWeek) {
      /*
       * getAllByText, not getByText: 30a puts league health and transactions on
       * the same weekly axis, so a week label legitimately appears on both
       * charts. One match would mean a chart is missing.
       */
      expect(screen.getAllByText(week.weekLabel).length).toBeGreaterThan(0)
    }
    for (const metric of response.data!.competitiveBalance) {
      expect(screen.getByText(metric.label)).toBeInTheDocument()
      expect(screen.getByText(metric.interpretation)).toBeInTheDocument()
    }
  })

  it("renders ErrorState when there is no snapshot", () => {
    render(<LeagueAnalyticsView snapshot={null} dataMode="live" errorMessage="The live Decision OS backend is not yet integrated in this environment." />)
    expect(screen.getByRole('alert')).toHaveTextContent(/not yet integrated/i)
  })

  it("renders ErrorState with a default message when snapshot is null but no explicit error is set", () => {
    render(<LeagueAnalyticsView snapshot={null} dataMode="stub" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it("names the drop comparatively rather than just ranking managers", async () => {
    const response = await demoAnalyticsClient.getSnapshot()
    render(<LeagueAnalyticsView snapshot={response.data} dataMode="demo" />)
    /*
     * The copy contract: the call-out must state the actual drop, not a bare
     * ranking. Two demo managers sit below the threshold and both were well
     * above it earlier, so the sentence has to carry both numbers.
     */
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent(/2 managers are below 5 actions a week/i)
    /*
     * "earlier", not "earlier this season". The comparison is against the previous rolling
     * lookback window, which for a dynasty league read in August is last spring — not this
     * season at all. The copy was corrected when this panel was wired to real data; the
     * assertion follows the correction rather than pinning the older, less accurate wording.
     */
    expect(note).toHaveTextContent(/above 12 earlier/i)
    expect(note).not.toHaveTextContent(/earlier this season/i)
  })

  it("labels the target on the chart itself, not only in the legend", async () => {
    const response = await demoAnalyticsClient.getSnapshot()
    render(<LeagueAnalyticsView snapshot={response.data} dataMode="demo" />)
    expect(screen.getByText(/TARGET 75/)).toBeInTheDocument()
  })

  it("says a section is unwired rather than drawing an empty chart", async () => {
    const response = await demoAnalyticsClient.getSnapshot()
    render(
      <LeagueAnalyticsView
        snapshot={{ ...response.data!, pointsForAgainst: [], managerActivity: [] }}
        dataMode="live"
      />,
    )
    /*
     * An empty chart frame reads as "this league has no activity". The view must
     * say the section is not wired instead.
     */
    expect(screen.getByText(/No scoring totals for this league yet/i)).toBeInTheDocument()
    expect(screen.getByText(/No per-manager activity for this league yet/i)).toBeInTheDocument()
  })

  it("narrows every week-indexed section together when the range changes", async () => {
    const response = await demoAnalyticsClient.getSnapshot()
    render(<LeagueAnalyticsView snapshot={response.data} dataMode="demo" />)

    // Eleven weeks of health data to start.
    expect(screen.getAllByText('Wk 1').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Last 4 weeks' }))

    /*
     * The filter is applied once to the whole snapshot, so the early weeks must
     * disappear from every week-indexed chart at once — this is the same object
     * the CSV export receives. Week 11 survives on both charts, hence getAll.
     */
    expect(screen.queryByText('Wk 1')).not.toBeInTheDocument()
    expect(screen.getAllByText('Wk 11').length).toBeGreaterThan(0)
  })

  it("hides the preview data banner in live mode", async () => {
    const response = await demoAnalyticsClient.getSnapshot()
    render(<LeagueAnalyticsView snapshot={response.data} dataMode="live" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
