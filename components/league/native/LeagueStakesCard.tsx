'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Flame } from 'lucide-react'
import type { BigBrotherSummary } from '@/components/big-brother/types'
import type { SurvivorSummary } from '@/components/survivor/types'
import {
  bigBrotherStakes,
  guillotineStakes,
  survivorStakes,
  type FormatStakes,
  type GuillotineSummaryLite,
} from '@/lib/league/format-stakes'

export type StakesFormat = 'survivor' | 'big_brother' | 'guillotine'

/** Which specialty format a native league is, for the stakes card; null for every other league. */
export function stakesFormatFor(league: { leagueVariant?: string | null; guillotineMode?: boolean | null }): StakesFormat | null {
  if (league.leagueVariant === 'survivor') return 'survivor'
  if (league.leagueVariant === 'big_brother') return 'big_brother'
  if (league.guillotineMode || league.leagueVariant === 'guillotine') return 'guillotine'
  return null
}

/** The summary each format already serves (no new routes); the guillotine one now defaults to the current week. */
export function stakesEndpoint(leagueId: string, format: StakesFormat): string {
  const id = encodeURIComponent(leagueId)
  if (format === 'survivor') return `/api/leagues/${id}/survivor/summary`
  if (format === 'big_brother') return `/api/leagues/${id}/big-brother/summary`
  return `/api/leagues/${id}/guillotine/summary`
}

export function stakesFromPayload(format: StakesFormat, payload: unknown): FormatStakes | null {
  if (!payload || typeof payload !== 'object') return null
  if (format === 'survivor') return survivorStakes(payload as SurvivorSummary)
  if (format === 'big_brother') return bigBrotherStakes(payload as BigBrotherSummary)
  return guillotineStakes(payload as GuillotineSummaryLite)
}

function formatDeadline(iso: string): string | null {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return null
  return date.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * "This week": what is on the line in a Survivor, Big Brother or Guillotine league — immunity and
 * who goes to council, the HOH and who is on the block, the chop line and your margin. The drama
 * that makes these formats worth playing used to be only inside their own tabs.
 *
 * Renders nothing until there are stakes (before the draft, before the first cycle) and nothing if
 * the summary fails: the home should never show an empty or broken card in its place.
 */
export function LeagueStakesCard({
  leagueId,
  format,
  onSelectTab,
}: {
  leagueId: string
  format: StakesFormat
  onSelectTab: (tab: string) => void
}) {
  const [stakes, setStakes] = useState<FormatStakes | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(stakesEndpoint(leagueId, format), { cache: 'no-store', credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled) setStakes(stakesFromPayload(format, payload))
      })
      .catch(() => {
        if (!cancelled) setStakes(null)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId, format])

  if (!stakes) return null
  const deadline = stakes.deadlineIso ? formatDeadline(stakes.deadlineIso) : null

  return (
    <section className="nl-card nl-stakes" data-format={stakes.format} aria-label="This week's stakes" data-testid="league-stakes">
      <div className="nl-card-label">
        <span>This week</span>
        <Flame size={16} aria-hidden />
      </div>
      <h2 data-testid="league-stakes-title">{stakes.title}</h2>
      {stakes.you ? (
        <p className="nl-stakes-you" data-tone={stakes.you.tone} data-testid="league-stakes-you">
          {stakes.you.text}
        </p>
      ) : null}
      <dl className="nl-stakes-lines" data-testid="league-stakes-lines">
        {stakes.lines.map((line) => (
          <div key={line.label} data-tone={line.tone ?? 'neutral'}>
            <dt>{line.label}</dt>
            <dd>{line.value}</dd>
          </div>
        ))}
      </dl>
      {deadline && stakes.deadlineLabel ? (
        <p className="nl-stakes-deadline" data-testid="league-stakes-deadline">
          {stakes.deadlineLabel} {deadline}
        </p>
      ) : null}
      <div className="nl-actions">
        <button type="button" className="nl-button nl-primary" onClick={() => onSelectTab(stakes.tab)} data-testid="league-stakes-open">
          {stakes.cta} <ArrowRight size={16} aria-hidden />
        </button>
      </div>
    </section>
  )
}
