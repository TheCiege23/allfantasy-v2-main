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
  const [health, recs, highlights, kpis, activityEvents, automationSummary, analyticsSummary, reportsSummary, notificationsSummary] = await Promise.all([
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
  // Mirrors app/commissioner-os/page.tsx's own mapping from Activity Stream's real events to TimelineCard's TimelineEntry shape.
  const activity = { data: (activityEvents.data ?? []).map((event) => ({ id: event.id, label: event.summary, timestamp: event.timestamp })) }
  return { health, recs, highlights, kpis, activity, automationSummary, analyticsSummary, reportsSummary, notificationsSummary }
}

describe("commissioner-os — Mission Control", () => {
  it("renders the preview data banner unmissably", async () => {
    const { health, recs, highlights, kpis, activity, automationSummary, analyticsSummary, reportsSummary, notificationsSummary } = await loadMissionControlData()

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
        dataMode="stub"
      />
    )

    expect(screen.getByRole("status")).toHaveTextContent(/preview data/i)
  })

  it("renders League Health, KPIs, and recommendations sourced from Recommendations Center", async () => {
    const { health, recs, highlights, kpis, activity, automationSummary, analyticsSummary, reportsSummary, notificationsSummary } = await loadMissionControlData()

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
        dataMode="stub"
      />
    )
    expect(screen.getByText('Nothing needs your attention right now.')).toBeInTheDocument()
  })

  it("every rendered widget corresponds to a task-required region: KPI strip, priorities, League Health, Manager Intelligence, Workspace, Recent Activity, Quick Actions", async () => {
    const { health, recs, highlights, kpis, activity, automationSummary, analyticsSummary, reportsSummary, notificationsSummary } = await loadMissionControlData()

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
