'use client'

/**
 * Dynasty League home extras: championship rafters + season clock, pick capital, and pipeline.
 *
 * Mounted by `NativeLeagueHome` ONLY when `usesDynastyBackground(league)` is true, so a
 * non-dynasty league never fetches, never mounts these, and renders exactly what it did before.
 *
 * Data: one read of `/api/leagues/:id/dynasty-hub` — the same read `DynastyHome` (the Dynasty /
 * Picks tabs) already makes, now also carrying `titles` and `pipeline`. Every module hides itself
 * when its part of that read is empty or failed. Nothing here is estimated.
 */
import { useEffect, useState } from 'react'
import { ArrowRight, Trophy } from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import {
  summarizePickCapital,
  type ChampionRafters,
  type HubPick,
  type PipelineSummary,
} from '@/lib/league/dynastyHomeExtras'
import './dynasty-league-home.css'

export type DynastyHubRead = {
  picks: HubPick[]
  titles: ChampionRafters | null
  pipeline: PipelineSummary | null
}

/** Reads the dynasty hub once. `enabled: false` makes no request and returns null. */
export function useDynastyHubRead(leagueId: string, enabled: boolean): DynastyHubRead | null {
  const [data, setData] = useState<DynastyHubRead | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/dynasty-hub`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: Partial<DynastyHubRead> | null) => {
        if (cancelled || !json) return
        setData({
          picks: Array.isArray(json.picks) ? json.picks : [],
          titles: json.titles ?? null,
          pipeline: json.pipeline ?? null,
        })
      })
      .catch(() => {
        // Non-fatal: every module hides itself.
      })
    return () => {
      cancelled = true
    }
  }, [leagueId, enabled])
  return enabled ? data : null
}

type TabLink = { onSelectTab: (id: string) => void; availableTabIds?: readonly string[] }

function canOpen(tab: string, { availableTabIds }: TabLink) {
  return !!availableTabIds && availableTabIds.includes(tab)
}

/** Rafters band: past champions as pennants (gold = the viewer's) and the season clock. */
export function DynastyRafters({
  league,
  titles,
  ...links
}: {
  league: { season?: number | string | null; settings?: Record<string, unknown> | null }
} & { titles: ChampionRafters | null } & TabLink) {
  const { t, tInterpolate } = useOptionalLanguage()
  // The "Year N · YYYY" clock lives in the league header (dynastyEra.seasonClock), which sits
  // directly above this page, so it is not repeated here.
  if (!titles) return null
  const historyTab = canOpen('history', links) ? 'history' : canOpen('legacy', links) ? 'legacy' : null
  return (
    <section className="dyn-home-rafters" data-testid="dynasty-home-rafters" aria-label={t('dynastyHome.rafters.label')}>
      {titles && (
        <ol className="dyn-home-pennants" data-testid="dynasty-home-pennants">
          {titles.pennants.map((p) => {
            const name = p.mine ? t('dynastyHome.rafters.you') : p.label ?? t('dynastyHome.rafters.unnamed')
            return (
              <li
                key={p.season}
                className="dyn-home-pennant"
                data-mine={p.mine ? 'true' : undefined}
                aria-label={tInterpolate('dynastyHome.rafters.pennantAria', { season: p.season, name })}
              >
                <span className="dyn-home-pennant-year">{p.season}</span>
                <span className="dyn-home-pennant-name">{name}</span>
              </li>
            )
          })}
          {titles.openSeason != null && (
            <li
              className="dyn-home-pennant"
              data-open="true"
              aria-label={tInterpolate('dynastyHome.rafters.openAria', { season: titles.openSeason })}
            >
              <span className="dyn-home-pennant-year">{titles.openSeason}</span>
              <span className="dyn-home-pennant-name">{t('dynastyHome.rafters.open')}</span>
            </li>
          )}
        </ol>
      )}
      <div className="dyn-home-rafters-meta">
        {titles && titles.myTitles > 0 && (
          <span className="dyn-home-mytitles" data-testid="dynasty-home-my-titles">
            <Trophy size={14} aria-hidden />
            {tInterpolate('dynastyHome.rafters.myTitles', { count: titles.myTitles })}
          </span>
        )}
        {titles && historyTab && (
          <button type="button" className="nl-text-link" onClick={() => links.onSelectTab(historyTab)}>
            {t('dynastyHome.rafters.history')} <ArrowRight size={14} aria-hidden />
          </button>
        )}
      </div>
    </section>
  )
}

/** The viewer's held future picks as chips. Hidden when they hold none. */
export function DynastyPickCapitalCard({ picks, ...links }: { picks: HubPick[] } & TabLink) {
  const { t, tInterpolate } = useOptionalLanguage()
  const summary = summarizePickCapital(picks)
  if (!summary) return null
  const unit = summary.total === 1 ? t('dynastyHome.picks.unit.one') : t('dynastyHome.picks.unit.other')
  const years = summary.years === 1 ? t('dynastyHome.picks.years.one') : tInterpolate('dynastyHome.picks.years.other', { count: summary.years })
  return (
    <section className="nl-card dyn-home-card" data-testid="dynasty-home-pick-capital">
      <div className="nl-card-label">
        <span>{t('dynastyHome.picks.title')}</span>
        {canOpen('dynasty_picks', links) && (
          <button type="button" className="nl-text-link" onClick={() => links.onSelectTab('dynasty_picks')}>
            {t('dynastyHome.picks.open')}
          </button>
        )}
      </div>
      <p className="dyn-home-total"><strong>{summary.total}</strong> <span>{unit} {years}</span></p>
      <ul className="dyn-home-chips">
        {summary.chips.map((pick) => (
          <li key={pick.id} className="dyn-home-chip" data-round={pick.round === 1 ? '1' : 'later'}>
            {tInterpolate('dynastyHome.picks.chip', { year: pick.year, round: pick.round })}
            {pick.type === 'incoming' && pick.fromTeam && <> · {tInterpolate('dynastyHome.picks.via', { team: pick.fromTeam })}</>}
          </li>
        ))}
        {summary.more > 0 && <li className="dyn-home-chip" data-more="true">{tInterpolate('dynastyHome.picks.more', { count: summary.more })}</li>}
      </ul>
    </section>
  )
}

/** Taxi / devy / rookie counts from the viewer's roster. Hidden when there is nothing to count. */
export function DynastyPipelineCard({ pipeline, ...links }: { pipeline: PipelineSummary | null } & TabLink) {
  const { t, tInterpolate } = useOptionalLanguage()
  if (!pipeline) return null
  const rows: Array<{ key: string; kind: 'taxi' | 'devy' | 'rookie'; label: string; detail: string; note?: string }> = []
  if (pipeline.taxi) {
    rows.push({
      key: 'taxi',
      kind: 'taxi',
      label: t('dynastyHome.pipeline.taxi'),
      detail: pipeline.taxi.slots > 0
        ? tInterpolate('dynastyHome.pipeline.taxiSlots', { count: pipeline.taxi.count, slots: pipeline.taxi.slots })
        : tInterpolate('dynastyHome.pipeline.onRoster', { count: pipeline.taxi.count }),
    })
  }
  if (pipeline.devy) {
    rows.push({ key: 'devy', kind: 'devy', label: t('dynastyHome.pipeline.devy'), detail: tInterpolate('dynastyHome.pipeline.onRoster', { count: pipeline.devy.count }) })
  }
  if (pipeline.rookies) {
    rows.push({
      key: 'rookie',
      kind: 'rookie',
      label: t('dynastyHome.pipeline.rookie'),
      detail: tInterpolate('dynastyHome.pipeline.onRoster', { count: pipeline.rookies.count }),
      note: pipeline.rookies.unknown > 0 ? tInterpolate('dynastyHome.pipeline.unknownExp', { count: pipeline.rookies.unknown }) : undefined,
    })
  }
  return (
    <section className="nl-card dyn-home-card" data-testid="dynasty-home-pipeline">
      <div className="nl-card-label">
        <span>{t('dynastyHome.pipeline.title')}</span>
        {pipeline.taxi && canOpen('dynasty_taxi', links) && (
          <button type="button" className="nl-text-link" onClick={() => links.onSelectTab('dynasty_taxi')}>
            {t('dynastyHome.pipeline.open')}
          </button>
        )}
      </div>
      <ul className="dyn-home-pipeline">
        {rows.map((row) => (
          <li key={row.key} data-testid={`dynasty-home-pipeline-${row.kind}`}>
            <span className="dyn-home-badge" data-kind={row.kind}>{row.label}</span>
            <span className="dyn-home-pipeline-detail">{row.detail}</span>
            {row.note && <span className="dyn-home-pipeline-note">{row.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}
