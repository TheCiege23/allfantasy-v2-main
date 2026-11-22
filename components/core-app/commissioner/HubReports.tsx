import type { CommissionerHubData } from '@/lib/core-app/commissionerHub'
import type { ActivityCharts } from '@/lib/core-app/commissioner/reports'
import type { SectionState } from '@/lib/core-app/leagueHome'
import { TIMELINE_KIND_LABEL, recentChanges, type TimelineEntry } from '@/lib/core-app/commissioner/timeline'
import { HubBars, HubSection } from './HubSections'
import { TimelineList } from './TimelineList'
import { hubCopy, hubDateLocale } from '@/lib/core-app/commissionerHubCopy'
import { commissionerScreensMessages } from '@/lib/core-app/messages/commissionerScreens'
import { commissionerHealthChartsMessages } from '@/lib/core-app/messages/commissionerHealthCharts'
import { messagesFor } from '@/lib/i18n/messages'
import {
  engagementMix,
  healthComponents,
  managerActivityRows,
  type HealthComponent,
  type Participation,
} from '@/lib/core-app/commissioner/healthCharts'
import { LeagueHealthCharts } from './LeagueHealthCharts'

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
  return messagesFor(commissionerScreensMessages, language).reportsNewestMove(day)
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
  const hm = messagesFor(commissionerHealthChartsMessages, language)
  const loaded = await activity
  const { scoring, balance, engagement } = data.charts
  // The weekly line, the per-manager stacks and the two pies replace the old activity, trades,
  // waiver-participation and engagement bars; balance and scoring keep their bars.
  const charts = [balance, scoring].filter((c): c is NonNullable<typeof c> => c != null)
  const stale = data.activityStale ?? null
  const members = data.members.available ? data.members.data.rows : null
  const health = loaded.available ? loaded.data.health : null
  const managerRows =
    health && health.managers.length > 0 && !stale ? managerActivityRows(health.seasonRows, health.managers, members) : null
  const managersReason = stale ? stale.reason : health && !health.hasMoves ? hm.noMovesImported : hm.noNamedManagers

  return (
    <HubSection
      id="ch-reports"
      title={t('League at a glance')}
      note={loaded.available ? newestLabel(loaded.data.newest, language) : t(loaded.reason)}
    >
      {health ? (
        <LeagueHealthCharts
          language={language}
          weeks={health.weeks}
          managers={managerRows}
          managersReason={managerRows ? null : managersReason}
          mix={health.mix}
          engagement={members && !stale ? engagementMix(members) : null}
          engagementReason={stale ? stale.reason : data.members.available ? null : data.members.reason}
        />
      ) : null}
      {charts.length > 0 ? (
        <div className="af-ch-charts">
          {charts.map((c) => (
            <HubBars key={c.key} chart={c} language={language} />
          ))}
        </div>
      ) : !health ? (
        <p className="af-ch-muted">{t('There isn’t enough played or imported data to chart yet.')}</p>
      ) : null}
      {!scoring || !data.charts.balance ? (
        <p className="af-ch-muted">
          {t('Scoring and competitive balance appear once this season has a played week on file.')}
        </p>
      ) : null}
      {!engagement && !health && data.members.available === false ? (
        <p className="af-ch-muted">{t('Manager engagement is left out while the league’s data is out of date.')}</p>
      ) : null}
    </HubSection>
  )
}

/** The five component bars under the health score — the drawing, given the numbers. */
export function HealthComponentBars({ components, language = 'en' }: { components: HealthComponent[]; language?: string }) {
  const m = messagesFor(commissionerHealthChartsMessages, language)
  const name: Record<HealthComponent['key'], string> = {
    lineups: m.componentLineups,
    waivers: m.componentWaivers,
    trades: m.componentTrades,
    dues: m.componentDues,
    chat: m.componentChat,
  }
  const basis = (c: HealthComponent): string => {
    if (c.part == null || c.whole == null) return ''
    if (c.key === 'lineups') return m.basisLineups(c.part, c.whole)
    if (c.key === 'waivers') return m.basisWaivers(c.part, c.whole)
    if (c.key === 'trades') return m.basisTrades(c.part, c.whole)
    if (c.key === 'dues') return m.basisDues(c.part, c.whole)
    return m.basisChat(c.part, c.whole)
  }
  return (
    <div className="af-ch-hb" data-testid="health-breakdown">
      <p className="af-label af-ch-hb-title">{m.breakdownTitle}</p>
      <ul className="af-ch-hb-list" aria-label={m.breakdownAria}>
        {components.map((c) => (
          <li key={c.key} data-measured={c.value != null}>
            <span className="af-ch-hb-name">{name[c.key]}</span>
            {c.value != null ? (
              <>
                <span className="af-ch-hb-track" aria-hidden>
                  <span className="af-ch-hb-fill" style={{ width: `${Math.max(2, c.value)}%` }} />
                </span>
                <span className="af-ch-hb-value af-num">{c.value}</span>
                <span className="af-ch-hb-basis">{basis(c)}</span>
              </>
            ) : (
              <>
                <span className="af-ch-hb-track af-ch-hb-track-empty" aria-hidden />
                <span className="af-ch-hb-value">{m.notMeasured}</span>
                <span className="af-ch-hb-basis">{c.reason || m.notMeasured}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function breakdownFor(
  data: CommissionerHubData,
  activity: { waivers: Participation; trades: Participation; chat: Participation },
  language: string,
): HealthComponent[] {
  const m = messagesFor(commissionerHealthChartsMessages, language)
  const stale = data.activityStale ?? null
  const staled = (p: Participation): Participation => (stale ? { unmeasured: m.staleReason(stale.days) } : p)
  return healthComponents(
    {
      teamCount: data.grant.teams?.length ?? 0,
      flags: data.health.flags,
      waivers: staled(activity.waivers),
      trades: staled(activity.trades),
      chat: activity.chat,
    },
    m.noTeams,
  )
}

/**
 * The breakdown before the activity read lands, or for a viewer without commissioner depth:
 * lineups and dues come from the hub's own flags; the three activity bars say why they are empty.
 */
export function HealthBreakdownStatic({
  data,
  reason,
  language = 'en',
}: {
  data: CommissionerHubData
  reason: 'locked' | 'loading'
  language?: string
}) {
  const m = messagesFor(commissionerHealthChartsMessages, language)
  const why: Participation = { unmeasured: reason === 'locked' ? m.lockedReason : m.loadingReason }
  return <HealthComponentBars components={breakdownFor(data, { waivers: why, trades: why, chat: why }, language)} language={language} />
}

/** The breakdown once the activity read lands — the same promise the charts await. */
export async function HealthBreakdown({
  data,
  activity,
  language = 'en',
}: {
  data: CommissionerHubData
  activity: Promise<ActivityCharts>
  language?: string
}) {
  const loaded = await activity
  if (!loaded.available) {
    const why: Participation = { unmeasured: hubCopy(loaded.reason, language) }
    return <HealthComponentBars components={breakdownFor(data, { waivers: why, trades: why, chat: why }, language)} language={language} />
  }
  return <HealthComponentBars components={breakdownFor(data, loaded.data.health, language)} language={language} />
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
