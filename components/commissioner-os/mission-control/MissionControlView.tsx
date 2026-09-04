'use client'

import { HeartPulse, Lightbulb, Users, Briefcase, Zap, Send, UserPlus, ListChecks, BarChart3, FileText, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { KpiCard, RecommendationCard, SummaryCard, TimelineCard, StatusCard, type TimelineEntry } from '@/components/commissioner-os/cards'
import { EmptyState } from '@/components/commissioner-os/states'
import { PreviewDataBanner } from '@/components/commissioner-os/PreviewDataBanner'
import type { CommissionerDataMode } from '@/lib/commissioner-ui/demo-mode/constants'
import type { CommissionerRecommendationContract } from '@/lib/commissioner-ui/contracts'
import type {
  LeagueHealthSummary,
  ManagerHighlight,
  MissionControlKpis,
} from '@/lib/commissioner-ui/decision-os-client'
import type { AutomationSummary } from '@/lib/commissioner-ui/automations/decision-os-client'
import type { AnalyticsSummary } from '@/lib/commissioner-ui/analytics/decision-os-client'
import type { ReportsSummary } from '@/lib/commissioner-ui/reports/decision-os-client'
import type { NotificationsSummary } from '@/lib/commissioner-ui/notifications/decision-os-client'

export interface MissionControlViewProps {
  leagueHealth: LeagueHealthSummary
  /** Sourced from Recommendations Center's own client, never a Mission-Control-local recommendation shape — see decision-os-client/types.ts. */
  recommendations: CommissionerRecommendationContract[]
  managerHighlights: ManagerHighlight[]
  kpis: MissionControlKpis
  /** A preview slice of Universal Activity Stream's own real events, mapped by the page into TimelineCard's own shape — Mission Control never owns activity data. */
  recentActivity: TimelineEntry[]
  /** Automation Center's own computed aggregate — Mission Control renders it, never recomputes it. */
  automationSummary: AutomationSummary
  /** League Analytics' own computed aggregate — Mission Control renders it, never recomputes it. */
  analyticsSummary: AnalyticsSummary
  /** Reports' own computed aggregate — Mission Control renders it, never recomputes it. */
  reportsSummary: ReportsSummary
  /** Notification Center's own computed aggregate — Mission Control renders it, never recomputes it. */
  notificationsSummary: NotificationsSummary
  dataMode: CommissionerDataMode
}

/**
 * Presentation, orchestration, prioritization, and navigation only —
 * Mission Control never computes League Health, Recommendations, or
 * Manager Intelligence itself. Every value rendered here arrives already
 * computed (currently by the Decision OS client's stub/demo/live
 * implementation, chosen by Demo Mode) as props; this component's only
 * job is arranging it per the Mission Control Blueprint's layout and
 * Decision Hierarchy.
 */
export function MissionControlView({ leagueHealth, recommendations, managerHighlights, kpis, recentActivity, automationSummary, analyticsSummary, reportsSummary, notificationsSummary, dataMode }: MissionControlViewProps) {
  return (
    <div>
      <PreviewDataBanner mode={dataMode} />

      {/* Zone 1 — Vitals & Controls */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_2fr]">
        <SummaryCard
          title="League Health"
          status={leagueHealth.tier}
          summary={`${leagueHealth.score} — ${leagueHealth.driver}`}
          icon={HeartPulse}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Open Recommendations" value={String(kpis.openRecommendations)} />
          <KpiCard label="Active Risks" value={String(kpis.activeRisks)} severity={kpis.activeRisks > 0 ? 'elevated' : 'positive'} />
          <KpiCard label="Engagement Score" value={String(kpis.engagementScore)} />
          <KpiCard label="Next Deadline" value={kpis.nextDeadlineLabel} />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary">
          <Send size={14} aria-hidden /> Send League Digest
        </Button>
        <Button size="sm" variant="outline">
          <ListChecks size={14} aria-hidden /> Review Pending Trades
        </Button>
        <Button size="sm" variant="outline">
          <UserPlus size={14} aria-hidden /> Invite Co-Commissioner
        </Button>
      </div>

      {/* Zone 2 — Primary / Secondary columns */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <section aria-labelledby="todays-priorities-heading">
            <h2 id="todays-priorities-heading" className="mb-2 text-sm font-semibold" style={{ color: 'var(--text)' }}>
              Today&rsquo;s Priorities
            </h2>
            {recommendations.length === 0 ? (
              <EmptyState icon={Lightbulb} title="Nothing needs your attention right now." description="Your league is in good shape." />
            ) : (
              <div className="space-y-3">
                {recommendations.map((rec) => (
                  <RecommendationCard
                    key={rec.id}
                    title={rec.title}
                    rationale={rec.rationale}
                    severity={rec.severity}
                    confidence={rec.confidence}
                    expectedImpact={rec.expectedImpact}
                    primaryActionLabel={rec.primaryActionLabel}
                  />
                ))}
              </div>
            )}
          </section>

          <TimelineCard title="Recent Activity" entries={recentActivity} emptyText="No recent activity to show." />
        </div>

        <div className="space-y-4">
          <SummaryCard title="Manager Intelligence" status="standard" summary={`${managerHighlights.length} highlights this week`} icon={Users} />
          {managerHighlights.length > 0 && (
            <ul className="space-y-2">
              {managerHighlights.map((highlight) => (
                <li key={highlight.id} className="text-xs" style={{ color: 'var(--muted)' }}>
                  <span className="font-medium" style={{ color: 'var(--text)' }}>
                    {highlight.managerName}
                  </span>
                  {' — '}
                  {highlight.callout}
                </li>
              ))}
            </ul>
          )}

          <SummaryCard title="Workspace" status="standard" summary="No open tasks in this preview." icon={Briefcase} />
          <StatusCard label="Automation Status" statusText={automationSummary.headline} icon={Zap} />
          <SummaryCard title="League Analytics" status="standard" summary={analyticsSummary.headline} icon={BarChart3} />
          <SummaryCard title="Reports" status="standard" summary={reportsSummary.headline} icon={FileText} />
          <SummaryCard
            title="Notifications"
            status={notificationsSummary.criticalCount > 0 ? 'critical' : 'standard'}
            summary={notificationsSummary.headline}
            icon={Bell}
          />
          <StatusCard label="System Status" statusText="Preview mode — not connected to live data" />
        </div>
      </div>
    </div>
  )
}
