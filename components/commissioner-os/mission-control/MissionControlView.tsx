'use client'

import { HeartPulse, Lightbulb, Users, Briefcase, Zap, Send, UserPlus, ListChecks, BarChart3, FileText, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { KpiCard, RecommendationCard, SummaryCard, TimelineCard, StatusCard, InfoCard, TrendLineChart, type TimelineEntry } from '@/components/commissioner-os/cards'
import type { LeagueActivityTrend } from '@/lib/commissioner-mission-control/activityTrendReads'
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
import { allClearCopy } from '@/lib/commissioner-ui/allClear'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { ageText } from '@/lib/core-app/shellCopy'
import {
  activityChartText,
  allClearText,
  calloutText,
  commissionerSectionName,
  deadlineLabelText,
  healthDriverText,
  highlightsThisWeekText,
  missionControlText,
  shellText,
  summaryHeadlineText,
  type HeadlineNames,
} from '@/lib/commissioner-os/i18n/shellCopy'
import { automationText, composedEventText } from '@/lib/commissioner-os/i18n/toolsCopy'
import { reportTemplateText } from '@/lib/commissioner-os/i18n/analyticsCopy'

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
  /** The behavioural snapshot series — Mission Control's one chart. Null when it could not be read. */
  activityTrend: LeagueActivityTrend | null
  dataMode: CommissionerDataMode
  /** Only a league's owner can add a co-commissioner, and Commissioner OS also admits co-commissioners. */
  canInviteCoCommissioner?: boolean
  /**
   * Whether `leagueHealth` is a real reading or the page's nothing-loaded fallback. Without it the
   * fallback's zero renders as a score and an empty queue reads as an all-clear. Defaults to true
   * for direct renders; the page always passes it.
   */
  leagueHealthAvailable?: boolean
  /** Whether the recommendations queue was read. A failed read arrives as `[]`, which is not "none". */
  recommendationsRead?: boolean
}

/**
 * Presentation, orchestration, prioritization, and navigation only —
 * Mission Control never computes League Health, Recommendations, or
 * Manager Intelligence itself. Every value rendered here arrives already
 * computed (currently by the Decision OS client's stub/demo/live
 * implementation, chosen by Demo Mode) as props; this component's only
 * job is arranging it per the Mission Control Blueprint's layout and
 * Decision Hierarchy.
 *
 * Spanish (2026-10-06): every word is built here at render from the reader's language
 * (lib/commissioner-os/i18n/shellCopy.ts). The loaders keep writing English; their sentences are
 * translated whole, and names inside them are left as written.
 */
export function MissionControlView({ leagueHealth, recommendations, managerHighlights, kpis, recentActivity, automationSummary, analyticsSummary, reportsSummary, notificationsSummary, activityTrend, dataMode, canInviteCoCommissioner = false, leagueHealthAvailable = true, recommendationsRead = true }: MissionControlViewProps) {
  const { language } = useOptionalLanguage()
  const t = (english: string) => missionControlText(english, language)
  const section = (english: string) => commissionerSectionName(english, language)
  // Our automation and report-template names inside the module headlines, through the catalogs' own translators.
  const names: HeadlineNames = { automation: (name) => automationText(name, language), report: (name) => reportTemplateText(name, language) }
  const headline = (english: string) => summaryHeadlineText(english, language, names)
  const trendPoints = activityTrend?.points ?? []
  const lookbackDays = activityTrend?.lookbackDays ?? 90
  const allClearEnglish = allClearCopy({
    emptyTitle: 'Nothing needs your attention right now.',
    healthyDescription: 'Your league is in good shape.',
    listName: 'recommendations',
    listRead: recommendationsRead,
    healthTier: leagueHealthAvailable ? leagueHealth.tier : null,
  })
  const ownAllClear = {
    'Nothing needs your attention right now.': t('Nothing needs your attention right now.'),
    'Your league is in good shape.': t('Your league is in good shape.'),
  }
  const allClear = {
    title: allClearText(allClearEnglish.title, language, ownAllClear),
    description: allClearText(allClearEnglish.description, language, ownAllClear),
  }
  const chartNote = activityChartText.note(lookbackDays, language)
  return (
    <div>
      <PreviewDataBanner mode={dataMode} />

      {/* Zone 1 — Vitals & Controls */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_2fr]">
        <SummaryCard
          title={section('League Health')}
          status={leagueHealthAvailable ? leagueHealth.tier : 'standard'}
          summary={
            leagueHealthAvailable
              ? `${leagueHealth.score} — ${healthDriverText(leagueHealth.driver, language)}`
              : t('Not available yet — there is no reading for this league.')
          }
          icon={HeartPulse}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label={t('Open Recommendations')} value={String(kpis.openRecommendations)} />
          <KpiCard label={t('Active Risks')} value={String(kpis.activeRisks)} severity={kpis.activeRisks > 0 ? 'elevated' : 'positive'} />
          <KpiCard label={t('Engagement Score')} value={String(kpis.engagementScore)} />
          <KpiCard label={t('Next Deadline')} value={deadlineLabelText(kpis.nextDeadlineLabel, language)} />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" className="h-11 min-h-11 sm:h-9 sm:min-h-[36px]">
          <Send size={14} aria-hidden /> {t('Send League Digest')}
        </Button>
        <Button size="sm" variant="outline" className="h-11 min-h-11 sm:h-9 sm:min-h-[36px]">
          <ListChecks size={14} aria-hidden /> {t('Review Pending Trades')}
        </Button>
        {canInviteCoCommissioner && (
          <Button size="sm" variant="outline" className="h-11 min-h-11 sm:h-9 sm:min-h-[36px]">
            <UserPlus size={14} aria-hidden /> {t('Invite Co-Commissioner')}
          </Button>
        )}
      </div>

      {/*
        * The activity chart. Sits above the two columns because it is context for everything in them:
        * a falling line explains a falling engagement score, and it is the difference between "this
        * league is quiet" and "we stopped receiving its data".
        */}
      <div className="mb-6">
        <InfoCard
          title={
            activityTrend?.lookbackDays
              ? activityChartText.title(activityTrend.lookbackDays, language)
              : t('Activity over time')
          }
        >
          {trendPoints.length < 2 ? (
            /*
             * One point is not a trend and zero points is not a chart. Both say so rather than
             * rendering an empty frame, which reads as a broken component.
             */
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              {trendPoints.length === 0
                ? t('No activity history has been captured for this league yet. A capture runs daily; the first two give this chart a line.')
                : t('Only one capture so far — one more gives this chart a line.')}
            </p>
          ) : (
            <>
              <TrendLineChart
                height={220}
                ariaLabel={activityChartText.ariaLabel(lookbackDays, trendPoints.length, language)}
                series={[
                  {
                    id: 'windowed-activity',
                    name: activityChartText.seriesName(lookbackDays, language),
                    points: trendPoints.map((point) => ({ label: point.date, value: point.windowedEventCount })),
                  },
                ]}
              />
              {/*
                * 🛑 THIS SENTENCE IS LOAD-BEARING, NOT A CAPTION. Each point counts everything inside
                * the trailing window as of that capture, so the line falls whenever old events age out
                * faster than new ones arrive — a league can post activity every week and still trend
                * down. Without saying so, a declining line reads as "your league is dying", which is
                * the same unqualified-window error as "0 of 9 managers active".
                */}
              <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                {chartNote ?? (
                  <>
                    Each point counts every event inside the trailing{' '}
                    {lookbackDays} days as of that day — not that day&apos;s activity.
                    A steady decline through the offseason is normal: older events leave the window faster
                    than new ones arrive.
                  </>
                )}
              </p>
            </>
          )}
        </InfoCard>
      </div>

      {/* Zone 2 — Primary / Secondary columns */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <section aria-labelledby="todays-priorities-heading">
            <h2 id="todays-priorities-heading" className="mb-2 text-sm font-semibold" style={{ color: 'var(--text)' }}>
              {t('Today’s Priorities')}
            </h2>
            {recommendations.length === 0 ? (
              <EmptyState icon={Lightbulb} title={allClear.title} description={allClear.description} />
            ) : (
              <div className="space-y-3">
                {recommendations.map((rec) => (
                  <RecommendationCard
                    key={rec.id}
                    // English as the loader wrote it — the card translates its own fields (cosLoaderText).
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

          <TimelineCard
            title={t('Recent Activity')}
            // The summary is the activity stream's own sentence, through the Activity page's own translator;
            // the age is page.tsx's `formatRelativeTime`.
            entries={recentActivity.map((entry) => ({
              ...entry,
              label: composedEventText(entry.label, language),
              timestamp: ageText(entry.timestamp, language),
            }))}
            emptyText={t('No recent activity to show.')}
          />
        </div>

        <div className="space-y-4">
          <SummaryCard
            title={section('Manager Intelligence')}
            status="standard"
            summary={highlightsThisWeekText(managerHighlights.length, language)}
            icon={Users}
          />
          {managerHighlights.length > 0 && (
            <ul className="space-y-2">
              {managerHighlights.map((highlight) => (
                <li key={highlight.id} className="text-xs" style={{ color: 'var(--muted)' }}>
                  <span className="font-medium" style={{ color: 'var(--text)' }}>
                    {highlight.managerName}
                  </span>
                  {' — '}
                  {calloutText(highlight.callout, language)}
                </li>
              ))}
            </ul>
          )}

          <SummaryCard title={section('Workspace')} status="standard" summary={t('No open tasks in this preview.')} icon={Briefcase} />
          <StatusCard label={t('Automation Status')} statusText={headline(automationSummary.headline)} icon={Zap} />
          <SummaryCard
            title={section('League Analytics')}
            status="standard"
            summary={headline(analyticsSummary.headline)}
            icon={BarChart3}
          />
          <SummaryCard title={section('Reports')} status="standard" summary={headline(reportsSummary.headline)} icon={FileText} />
          <SummaryCard
            title={shellText('Notifications', language)}
            status={notificationsSummary.criticalCount > 0 ? 'critical' : 'standard'}
            summary={headline(notificationsSummary.headline)}
            icon={Bell}
          />
          <StatusCard label={t('System Status')} statusText={t('Preview mode — not connected to live data')} />
        </div>
      </div>
    </div>
  )
}
