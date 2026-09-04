import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { MissionControlView } from '@/components/commissioner-os/mission-control/MissionControlView'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'
import { formatRelativeTime } from '@/lib/commissioner-ui/utils/time'

const LIVE_STATUSES = new Set(['new', 'viewed', 'in_progress', 'deferred', 'automated'])
const RECENT_ACTIVITY_PREVIEW_COUNT = 5

/**
 * Server Component — fetches through the Decision OS Adapter Layer and
 * passes plain, serializable data down to the client-side view. Mission
 * Control itself computes nothing; every value here is already computed
 * by whichever stub/demo/live implementation the adapter resolved to
 * (Demo Mode-selected) and normalized — this page never touches a
 * per-module decision-os-client or Demo Mode directly.
 *
 * Recommendations come through the adapter's `recommendations` namespace,
 * not a Mission-Control-local copy — Mission Control previews the top
 * non-terminal items, it never owns recommendation data (Decision
 * Ownership Matrix). The automation status card is the same pattern:
 * `adapter.automations.getSummary()` is Automation Center's own computed
 * aggregate — Mission Control renders the headline, it never counts
 * automations itself. `adapter.analytics.getSummary()`,
 * `adapter.reports.getSummary()`, and `adapter.notifications.getSummary()`
 * follow the exact same pattern for League Analytics, Reports, and
 * Notification Center.
 *
 * "Recent Activity" is the identical "preview a real module's own list"
 * pattern as Recommendations, not a summary: `adapter.activity.getEvents()`
 * is Universal Activity Stream's real, full chronological record (Phase
 * 1.10) — this page takes the newest few and maps them into
 * `TimelineCard`'s own `TimelineEntry` shape. Mission Control's previous
 * ad hoc `getRecentActivity()`/`ActivityEntrySummary` were deleted
 * entirely once this real module existed, the same "duplicate ad hoc
 * data source" deletion Recommendations went through earlier in this
 * program.
 */
export default async function MissionControlPage() {
  const adapter = await getDecisionOSAdapter()

  const [leagueHealthResponse, recommendationsResponse, managerHighlightsResponse, kpisResponse, activityResponse, automationSummaryResponse, analyticsSummaryResponse, reportsSummaryResponse, notificationsSummaryResponse] = await Promise.all([
    adapter.missionControl.getLeagueHealthSummary(),
    adapter.recommendations.getQueue(),
    adapter.missionControl.getManagerHighlights(),
    adapter.missionControl.getMissionControlKpis(),
    adapter.activity.getEvents(),
    adapter.automations.getSummary(),
    adapter.analytics.getSummary(),
    adapter.reports.getSummary(),
    adapter.notifications.getSummary(),
  ])

  const recommendationsPreview = (recommendationsResponse.data ?? []).filter((rec) => LIVE_STATUSES.has(rec.status)).slice(0, 3)
  const recentActivityPreview = (activityResponse.data ?? []).slice(0, RECENT_ACTIVITY_PREVIEW_COUNT).map((event) => ({
    id: event.id,
    label: event.summary,
    timestamp: formatRelativeTime(event.timestamp),
  }))

  return (
    <CommissionerPageContainer>
      <MissionControlView
        dataMode={adapter.mode}
        leagueHealth={
          leagueHealthResponse.data ?? { score: 0, tier: 'standard', trendLabel: '', trendDirection: 'flat', driver: 'Unavailable' }
        }
        recommendations={recommendationsPreview}
        managerHighlights={managerHighlightsResponse.data ?? []}
        kpis={kpisResponse.data ?? { openRecommendations: 0, activeRisks: 0, engagementScore: 0, nextDeadlineLabel: 'Unavailable' }}
        recentActivity={recentActivityPreview}
        automationSummary={automationSummaryResponse.data ?? { totalCount: 0, activeCount: 0, needsAttentionCount: 0, headline: 'Unavailable' }}
        analyticsSummary={analyticsSummaryResponse.data ?? { headline: 'Unavailable', kpiCount: 0 }}
        reportsSummary={reportsSummaryResponse.data ?? { headline: 'Unavailable', scheduledCount: 0, readyCount: 0 }}
        notificationsSummary={notificationsSummaryResponse.data ?? { headline: 'Unavailable', unreadCount: 0, criticalCount: 0 }}
      />
    </CommissionerPageContainer>
  )
}
