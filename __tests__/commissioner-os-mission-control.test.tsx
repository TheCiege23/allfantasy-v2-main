import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { MissionControlView } from "@/components/commissioner-os/mission-control/MissionControlView"
import { stubDecisionOSClient } from "@/lib/commissioner-ui/decision-os-client/stub"
import { stubRecommendationsClient } from "@/lib/commissioner-ui/recommendations/decision-os-client/stub"
import { stubAutomationClient } from "@/lib/commissioner-ui/automations/decision-os-client/stub"
import { stubAnalyticsClient } from "@/lib/commissioner-ui/analytics/decision-os-client/stub"
import { stubReportsClient } from "@/lib/commissioner-ui/reports/decision-os-client/stub"
import { stubNotificationsClient } from "@/lib/commissioner-ui/notifications/decision-os-client/stub"
import { stubActivityClient } from "@/lib/commissioner-ui/activity/decision-os-client/stub"

async function loadMissionControlData() {
  const [health, recs, highlights, kpis, activityEvents, automationSummary, analyticsSummary, reportsSummary, notificationsSummary, activityTrend] = await Promise.all([
    stubDecisionOSClient.getLeagueHealthSummary(),
    stubRecommendationsClient.getQueue(),
    stubDecisionOSClient.getManagerHighlights(),
    stubDecisionOSClient.getMissionControlKpis(),
    stubActivityClient.getEvents(),
    stubAutomationClient.getSummary(),
    stubAnalyticsClient.getSummary(),
    stubReportsClient.getSummary(),
    stubNotificationsClient.getSummary(),
    stubDecisionOSClient.getActivityTrend(),
  ])
  // Mirrors app/commissioner-os/page.tsx's own mapping from Activity Stream's real events to TimelineCard's TimelineEntry shape.
  const activity = { data: (activityEvents.data ?? []).map((event) => ({ id: event.id, label: event.summary, timestamp: event.timestamp })) }
  return { health, recs, highlights, kpis, activity, automationSummary, analyticsSummary, reportsSummary, notificationsSummary, activityTrend }
}

describe("commissioner-os — Mission Control", () => {
  it("renders the preview data banner unmissably", async () => {
    const { health, recs, highlights, kpis, activity, automationSummary, analyticsSummary, reportsSummary, notificationsSummary, activityTrend } = await loadMissionControlData()

    render(
      <MissionControlView
        leagueHealth={health.data!}
        recommendations={recs.data!}
        managerHighlights={highlights.data!}
        kpis={kpis.data!}
        recentActivity={activity.data!}
        automationSummary={automationSummary.data!}
        analyticsSummary={analyticsSummary.data!}
        reportsSummary={reportsSummary.data!}
        notificationsSummary={notificationsSummary.data!}
        activityTrend={activityTrend.data}
        dataMode="stub"
      />
    )

    expect(screen.getByRole("status")).toHaveTextContent(/preview data/i)
  })

  it("renders League Health, KPIs, and recommendations sourced from Recommendations Center", async () => {
    const { health, recs, highlights, kpis, activity, automationSummary, analyticsSummary, reportsSummary, notificationsSummary, activityTrend } = await loadMissionControlData()

    render(
      <MissionControlView
        leagueHealth={health.data!}
        recommendations={recs.data!}
        managerHighlights={highlights.data!}
        kpis={kpis.data!}
        recentActivity={activity.data!}
        automationSummary={automationSummary.data!}
        analyticsSummary={analyticsSummary.data!}
        reportsSummary={reportsSummary.data!}
        notificationsSummary={notificationsSummary.data!}
        activityTrend={activityTrend.data}
        dataMode="stub"
      />
    )

    expect(screen.getByText('League Health')).toBeInTheDocument()
    expect(screen.getByText(`${health.data!.score} — ${health.data!.driver}`)).toBeInTheDocument()
    expect(screen.getByText(String(kpis.data!.openRecommendations))).toBeInTheDocument()
    for (const rec of recs.data!) {
      expect(screen.getByText(rec.title)).toBeInTheDocument()
    }
  })

  it("shows the healthy empty state when there are no recommendations", () => {
    render(
      <MissionControlView
        leagueHealth={{ score: 95, tier: 'positive', trendLabel: '', trendDirection: 'flat', driver: 'No concerns' }}
        recommendations={[]}
        managerHighlights={[]}
        kpis={{ openRecommendations: 0, activeRisks: 0, engagementScore: 90, nextDeadlineLabel: 'None' }}
        recentActivity={[]}
        automationSummary={{ totalCount: 0, activeCount: 0, needsAttentionCount: 0, headline: 'No automations configured yet' }}
        analyticsSummary={{ headline: 'No analytics yet', kpiCount: 0 }}
        reportsSummary={{ headline: 'No reports yet', scheduledCount: 0, readyCount: 0 }}
        notificationsSummary={{ headline: 'No unread notifications', unreadCount: 0, criticalCount: 0 }}
        activityTrend={{ points: [], lookbackDays: null }}
        dataMode="stub"
      />
    )
    expect(screen.getByText('Nothing needs your attention right now.')).toBeInTheDocument()
  })

  /*
   * 🛑 THE EXIT CONDITION FOR THIS PHASE IS "NO CHART RENDERS AN EMPTY FRAME", AND THIS IS WHERE THAT
   * IS ASSERTED. A league with no captured history is the common case for a fresh import, and a
   * Recharts container with nothing in it reads as a broken component rather than as an absence.
   */
  it('says why there is no activity chart instead of drawing an empty one', () => {
    render(
      <MissionControlView
        leagueHealth={{ score: 0, tier: 'standard', trendLabel: '', trendDirection: 'flat', driver: 'No reading' }}
        recommendations={[]}
        managerHighlights={[]}
        kpis={{ openRecommendations: 0, activeRisks: 0, engagementScore: 0, nextDeadlineLabel: 'None' }}
        recentActivity={[]}
        automationSummary={{ totalCount: 0, activeCount: 0, needsAttentionCount: 0, headline: '' }}
        analyticsSummary={{ headline: '', kpiCount: 0 }}
        reportsSummary={{ headline: '', scheduledCount: 0, readyCount: 0 }}
        notificationsSummary={{ headline: '', unreadCount: 0, criticalCount: 0 }}
        activityTrend={{ points: [], lookbackDays: null }}
        dataMode="stub"
      />
    )
    expect(screen.getByText(/No activity history has been captured/i)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /trailing/i })).not.toBeInTheDocument()
  })

  it('will not draw a line through a single capture', () => {
    render(
      <MissionControlView
        leagueHealth={{ score: 40, tier: 'standard', trendLabel: '', trendDirection: 'flat', driver: 'x' }}
        recommendations={[]}
        managerHighlights={[]}
        kpis={{ openRecommendations: 0, activeRisks: 0, engagementScore: 40, nextDeadlineLabel: 'None' }}
        recentActivity={[]}
        automationSummary={{ totalCount: 0, activeCount: 0, needsAttentionCount: 0, headline: '' }}
        analyticsSummary={{ headline: '', kpiCount: 0 }}
        reportsSummary={{ headline: '', scheduledCount: 0, readyCount: 0 }}
        notificationsSummary={{ headline: '', unreadCount: 0, criticalCount: 0 }}
        activityTrend={{ points: [{ date: '2026-09-09', windowedEventCount: 12 }], lookbackDays: 90 }}
        dataMode="stub"
      />
    )
    // One point is not a trend. Saying so beats a chart with a single dot and no line.
    expect(screen.getByText(/Only one capture so far/i)).toBeInTheDocument()
  })

  it('draws the activity chart, and its label names the window rather than implying a daily count', async () => {
    const { health, recs, highlights, kpis, activity, automationSummary, analyticsSummary, reportsSummary, notificationsSummary, activityTrend } = await loadMissionControlData()

    render(
      <MissionControlView
        leagueHealth={health.data!}
        recommendations={recs.data!}
        managerHighlights={highlights.data!}
        kpis={kpis.data!}
        recentActivity={activity.data!}
        automationSummary={automationSummary.data!}
        analyticsSummary={analyticsSummary.data!}
        reportsSummary={reportsSummary.data!}
        notificationsSummary={notificationsSummary.data!}
        activityTrend={activityTrend.data}
        dataMode="stub"
      />
    )

    /*
     * ⚠ THE LABEL IS THE ASSERTION. Each point counts everything inside the trailing window as of that
     * capture, so the line falls when old events age out — a league can post activity every week and
     * still trend down. A chart labelled "activity per day" would invert its own meaning, which is the
     * same unqualified-window error as "0 of 9 managers active".
     */
    const chart = screen.getByRole('img', { name: /trailing 90 days/i })
    expect(chart).toBeInTheDocument()
    expect(screen.getByText(/not that day.s activity/i)).toBeInTheDocument()
  })

  it("every rendered widget corresponds to a task-required region: KPI strip, priorities, League Health, Manager Intelligence, Workspace, Recent Activity, Quick Actions", async () => {
    const { health, recs, highlights, kpis, activity, automationSummary, analyticsSummary, reportsSummary, notificationsSummary, activityTrend } = await loadMissionControlData()

    render(
      <MissionControlView
        leagueHealth={health.data!}
        recommendations={recs.data!}
        managerHighlights={highlights.data!}
        kpis={kpis.data!}
        recentActivity={activity.data!}
        automationSummary={automationSummary.data!}
        analyticsSummary={analyticsSummary.data!}
        reportsSummary={reportsSummary.data!}
        notificationsSummary={notificationsSummary.data!}
        activityTrend={activityTrend.data}
        dataMode="stub"
      />
    )

    expect(screen.getByText('League Health')).toBeInTheDocument()
    expect(screen.getByText('Manager Intelligence')).toBeInTheDocument()
    expect(screen.getByText('Workspace')).toBeInTheDocument()
    expect(screen.getByText('Recent Activity')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: "Today’s Priorities" })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Send League Digest/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Review Pending Trades/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Invite Co-Commissioner/ })).toBeInTheDocument()
  })
})

describe("commissioner-os — Decision OS client stub", () => {
  it("Mission Control's own client no longer has a recommendations method — it consumes Recommendations Center instead", () => {
    expect((stubDecisionOSClient as Record<string, unknown>).getRecommendationsPreview).toBeUndefined()
  })

  it("Mission Control's own client no longer has an activity method — it consumes Universal Activity Stream instead", () => {
    expect((stubDecisionOSClient as Record<string, unknown>).getRecentActivity).toBeUndefined()
  })

  it("every response from all seven clients is explicitly tagged source: 'stub'", async () => {
    const responses = await Promise.all([
      stubDecisionOSClient.getLeagueHealthSummary(),
      stubRecommendationsClient.getQueue(),
      stubDecisionOSClient.getManagerHighlights(),
      stubDecisionOSClient.getMissionControlKpis(),
      stubActivityClient.getEvents(),
      stubAutomationClient.getSummary(),
      stubAnalyticsClient.getSummary(),
      stubReportsClient.getSummary(),
      stubNotificationsClient.getSummary(),
    ])
    for (const response of responses) {
      expect(response.source).toBe('stub')
      expect(response.error).toBeNull()
    }
  })
})
