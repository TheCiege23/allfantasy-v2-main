import type { CommissionerHubData } from '@/lib/core-app/commissionerHub'
import type { ActivityCharts } from '@/lib/core-app/commissioner/reports'
import type { SectionState } from '@/lib/core-app/leagueHome'
import { TIMELINE_KIND_LABEL, recentChanges, type TimelineEntry } from '@/lib/core-app/commissioner/timeline'
import { HubBars, HubSection } from './HubSections'
import { TimelineList } from './TimelineList'
import { hubCopy, hubDateLocale } from '@/lib/core-app/commissionerHubCopy'

/**
 * The streamed half of the hub: the activity charts and the audit log.
 *
 * Each is an async server component that awaits a promise the page started, so
 * it renders inside its own Suspense boundary and never holds up the task cards.
 * The timeline promise is shared by "Recent changes" in the cockpit and the full
 * log at the bottom — one read, two views.
 */

function newestLabel(iso: string | null, language: string): string {
  if (!iso) return hubCopy('no moves imported yet', language)
  const day = new Date(iso).toLocaleDateString(hubDateLocale(language), { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
  return language === 'es' ? `último movimiento: ${day}` : `newest move ${day}`
}

export async function OperationalCharts({
  data,
  activity,
  language = 'en',
}: {
  data: CommissionerHubData
  activity: Promise<ActivityCharts>
  language?: string
}) {
  const t = (english: string | null | undefined) => hubCopy(english, language)
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
      title={t('League at a glance')}
      note={loaded.available ? newestLabel(loaded.data.newest, language) : t(loaded.reason)}
    >
      {charts.length > 0 ? (
        <div className="af-ch-charts">
          {charts.map((c) => (
            <HubBars key={c.key} chart={c} language={language} />
          ))}
        </div>
      ) : (
        <p className="af-ch-muted">{t('There isn’t enough played or imported data to chart yet.')}</p>
      )}
      {!scoring || !data.charts.balance ? (
        <p className="af-ch-muted">
          {t('Scoring and competitive balance appear once this season has a played week on file.')}
        </p>
      ) : null}
      {!engagement && data.members.available === false ? (
        <p className="af-ch-muted">{t('Manager engagement is left out while the league’s data is out of date.')}</p>
      ) : null}
    </HubSection>
  )
}

export function ChartsFallback({ language = 'en' }: { language?: string } = {}) {
  return (
    <HubSection id="ch-reports" title={hubCopy('League at a glance', language)} note={hubCopy('Loading…', language)}>
      <div className="af-ch-charts" aria-busy="true">
        {[0, 1].map((i) => (
          <div key={i} className="af-ch-chart af-ch-skeleton" />
        ))}
      </div>
    </HubSection>
  )
}

export async function RecentChanges({
  timeline,
  language = 'en',
}: {
  timeline: Promise<SectionState<TimelineEntry[]>>
  language?: string
}) {
  const t = (english: string | null | undefined) => hubCopy(english, language)
  const loaded = await timeline
  return (
    <HubSection id="ch-recent" title={t('Recent changes')} note={<a href="#ch-timeline">{t('Full audit log')}</a>}>
      {loaded.available ? (
        loaded.data.length > 0 ? (
          <ol className="af-ch-recent">
            {recentChanges(loaded.data).map((e) => (
              <li key={e.id} data-tone={e.tone}>
                <span className="af-label">{t(TIMELINE_KIND_LABEL[e.kind])}</span>
                <span className="af-ch-recent-title">{t(e.title)}</span>
                <time dateTime={e.at} className="af-num">
                  {new Date(e.at).toLocaleDateString(hubDateLocale(language), {
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'America/New_York',
                  })}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="af-ch-muted">{t('Nothing has been recorded for this league yet.')}</p>
        )
      ) : (
        <p className="af-ch-muted">{t(loaded.reason)}</p>
      )}
    </HubSection>
  )
}

export function RecentChangesFallback({ language = 'en' }: { language?: string } = {}) {
  return (
    <HubSection id="ch-recent" title={hubCopy('Recent changes', language)} note={hubCopy('Loading…', language)}>
      <div className="af-ch-skeleton af-ch-skeleton-list" aria-busy="true" />
    </HubSection>
  )
}

export async function AuditTimeline({
  timeline,
  language = 'en',
}: {
  timeline: Promise<SectionState<TimelineEntry[]>>
  language?: string
}) {
  const t = (english: string | null | undefined) => hubCopy(english, language)
  const loaded = await timeline
  return (
    <HubSection
      id="ch-timeline"
      title={t('Audit log')}
      note={loaded.available ? t(`${loaded.data.length} most recent`) : undefined}
    >
      {loaded.available ? (
        loaded.data.length > 0 ? (
          <TimelineList entries={loaded.data} />
        ) : (
          <p className="af-ch-muted">
            {t(
              'Nothing has been recorded for this league yet. Imports, syncs, settings changes, announcements and automation runs will appear here as they happen.',
            )}
          </p>
        )
      ) : (
        <p className="af-ch-muted">{t(loaded.reason)}</p>
      )}
      <p className="af-ch-muted">
        {t('Changes made directly on the league’s platform appear here only as the sync that picked them up.')}
      </p>
    </HubSection>
  )
}

export function AuditTimelineFallback({ language = 'en' }: { language?: string } = {}) {
  return (
    <HubSection id="ch-timeline" title={hubCopy('Audit log', language)} note={hubCopy('Loading…', language)}>
      <div className="af-ch-skeleton af-ch-skeleton-list" aria-busy="true" />
    </HubSection>
  )
}
