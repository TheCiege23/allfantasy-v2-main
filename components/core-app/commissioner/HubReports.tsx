import type { CommissionerHubData } from '@/lib/core-app/commissionerHub'
import type { ActivityCharts } from '@/lib/core-app/commissioner/reports'
import type { SectionState } from '@/lib/core-app/leagueHome'
import { TIMELINE_KIND_LABEL, type TimelineEntry } from '@/lib/core-app/commissioner/timeline'
import { HubBars, HubSection } from './HubSections'
import { TimelineList } from './TimelineList'

/**
 * The streamed half of the hub: the activity charts and the audit log.
 *
 * Each is an async server component that awaits a promise the page started, so
 * it renders inside its own Suspense boundary and never holds up the task cards.
 * The timeline promise is shared by "Recent changes" in the cockpit and the full
 * log at the bottom — one read, two views.
 */

function newestLabel(iso: string | null): string {
  if (!iso) return 'no moves imported yet'
  return `newest move ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}`
}

export async function OperationalCharts({
  data,
  activity,
}: {
  data: CommissionerHubData
  activity: Promise<ActivityCharts>
}) {
  const loaded = await activity
  const { scoring, balance, engagement } = data.charts
  const charts = [
    loaded.available ? loaded.data.activity : null,
    balance,
    loaded.available ? loaded.data.waivers : null,
    loaded.available ? loaded.data.trades : null,
    scoring,
    engagement,
  ].filter((c): c is NonNullable<typeof c> => c != null)

  return (
    <HubSection
      id="ch-reports"
      title="League at a glance"
      note={loaded.available ? newestLabel(loaded.data.newest) : loaded.reason}
    >
      {charts.length > 0 ? (
        <div className="af-ch-charts">
          {charts.map((c) => (
            <HubBars key={c.key} chart={c} />
          ))}
        </div>
      ) : (
        <p className="af-ch-muted">There isn’t enough played or imported data to chart yet.</p>
      )}
      {!scoring ? (
        <p className="af-ch-muted">Scoring appears once this season has a played week on file.</p>
      ) : null}
    </HubSection>
  )
}

export function ChartsFallback() {
  return (
    <HubSection id="ch-reports" title="League at a glance" note="Loading…">
      <div className="af-ch-charts" aria-busy="true">
        {[0, 1].map((i) => (
          <div key={i} className="af-ch-chart af-ch-skeleton" />
        ))}
      </div>
    </HubSection>
  )
}

export async function RecentChanges({ timeline }: { timeline: Promise<SectionState<TimelineEntry[]>> }) {
  const loaded = await timeline
  return (
    <HubSection id="ch-recent" title="Recent changes" note={<a href="#ch-timeline">Full audit log</a>}>
      {loaded.available ? (
        loaded.data.length > 0 ? (
          <ol className="af-ch-recent">
            {loaded.data.slice(0, 5).map((e) => (
              <li key={e.id} data-tone={e.tone}>
                <span className="af-label">{TIMELINE_KIND_LABEL[e.kind]}</span>
                <span className="af-ch-recent-title">{e.title}</span>
                <time dateTime={e.at} className="af-num">
                  {new Date(e.at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'America/New_York',
                  })}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="af-ch-muted">Nothing has been recorded for this league yet.</p>
        )
      ) : (
        <p className="af-ch-muted">{loaded.reason}</p>
      )}
    </HubSection>
  )
}

export function RecentChangesFallback() {
  return (
    <HubSection id="ch-recent" title="Recent changes" note="Loading…">
      <div className="af-ch-skeleton af-ch-skeleton-list" aria-busy="true" />
    </HubSection>
  )
}

export async function AuditTimeline({ timeline }: { timeline: Promise<SectionState<TimelineEntry[]>> }) {
  const loaded = await timeline
  return (
    <HubSection
      id="ch-timeline"
      title="Audit log"
      note={loaded.available ? `${loaded.data.length} most recent` : undefined}
    >
      {loaded.available ? (
        loaded.data.length > 0 ? (
          <TimelineList entries={loaded.data} />
        ) : (
          <p className="af-ch-muted">
            Nothing has been recorded for this league yet. Imports, syncs, settings changes, announcements and
            automation runs will appear here as they happen.
          </p>
        )
      ) : (
        <p className="af-ch-muted">{loaded.reason}</p>
      )}
      <p className="af-ch-muted">
        Changes made directly on the league’s platform appear here only as the sync that picked them up.
      </p>
    </HubSection>
  )
}

export function AuditTimelineFallback() {
  return (
    <HubSection id="ch-timeline" title="Audit log" note="Loading…">
      <div className="af-ch-skeleton af-ch-skeleton-list" aria-busy="true" />
    </HubSection>
  )
}
