'use client'

import { useEffect, useState } from 'react'
import {
  fetchRedraftSchedule,
  fetchRedraftSeason,
  type RedraftScheduleClient,
} from '@/lib/redraft/client'
import { ScheduleView } from './ScheduleView'
import { WeekControlPanel } from './WeekControlPanel'
import { ScheduleRegeneratePanel } from './ScheduleRegeneratePanel'
import { LeagueSurfaceState } from '@/components/league/LeagueSurfaceState'
import '../redraft-tailwind-tabs.css'

/**
 * Canonical NFL/NCAAF redraft Schedule destination.
 *
 * This is intentionally a small data-loading adapter around the existing
 * ScheduleView. It keeps the full-season schedule implementation shared with
 * the legacy Season Hub while making it reachable through the core league tab.
 */
export function CanonicalRedraftScheduleTab({
  leagueId,
  isCommissioner = false,
  tradeDeadlineWeek = null,
}: {
  leagueId: string
  isCommissioner?: boolean
  /** League.tradeDeadlineWeek — marked on the season calendar; unset means no marker. */
  tradeDeadlineWeek?: number | null
}) {
  const [schedule, setSchedule] = useState<RedraftScheduleClient | null>(null)
  const [seasonId, setSeasonId] = useState<string | null>(null)
  /** RedraftSeason.totalWeeks: the only source for the calendar's playoff weeks. */
  const [totalWeeks, setTotalWeeks] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [noSeason, setNoSeason] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setNoSeason(false)
      setError(null)
      try {
        const season = await fetchRedraftSeason(leagueId)
        if (cancelled) return
        if (!season?.id) {
          setSchedule(null)
          setSeasonId(null)
          setNoSeason(true)
          return
        }
        setSeasonId(season.id)
        setTotalWeeks(typeof season.totalWeeks === 'number' ? season.totalWeeks : null)
        const nextSchedule = await fetchRedraftSchedule(leagueId, season.id)
        if (!cancelled) setSchedule(nextSchedule)
      } catch (cause) {
        if (!cancelled) {
          setSchedule(null)
          setError(cause instanceof Error ? cause.message : 'Unable to load the league schedule.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId, reloadToken])

  if (loading) {
    return (
      <div className="rdt rdt-bridge p-4">
        <LeagueSurfaceState
          kind="loading"
          title="Loading schedule"
          description="Preparing regular-season and playoff weeks for this league."
          testId="redraft-schedule-loading"
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rdt rdt-bridge p-4">
        <LeagueSurfaceState
          kind="error"
          title="Schedule unavailable"
          description="We could not load this league's schedule. Refresh the page and try again."
          actionLabel="Retry schedule"
          onAction={() => window.location.reload()}
          testId="redraft-schedule-error"
        />
      </div>
    )
  }

  if (noSeason) {
    return (
      <div className="rdt rdt-bridge p-4">
        <LeagueSurfaceState
          kind="empty"
          title="Schedule starts after the draft"
          description="The full-season schedule appears after the draft is finalized. Draft setup remains available from the Draft tab."
          testId="redraft-schedule-preseason"
        />
      </div>
    )
  }

  return (
    <div className="rdt min-w-0 p-1 sm:p-4" data-testid="canonical-redraft-schedule-tab">
      {isCommissioner && seasonId && schedule ? (
        <WeekControlPanel
          seasonId={seasonId}
          schedule={schedule}
          onChanged={() => setReloadToken((n) => n + 1)}
        />
      ) : null}
      {isCommissioner && seasonId ? (
        <ScheduleRegeneratePanel seasonId={seasonId} onChanged={() => setReloadToken((n) => n + 1)} />
      ) : null}
      <ScheduleView schedule={schedule} totalWeeks={totalWeeks} tradeDeadlineWeek={tradeDeadlineWeek} />
    </div>
  )
}
