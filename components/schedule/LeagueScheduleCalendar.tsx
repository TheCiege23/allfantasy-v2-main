'use client'

/**
 * [NEW] components/schedule/LeagueScheduleCalendar.tsx
 * Sport-agnostic schedule calendar for any league.
 * Auto-detects sport and league type, shows real games + fantasy events.
 * Uses the generic /api/schedule/calendar endpoint.
 */

import { useEffect, useState } from 'react'
import { NbaGameVolumeBar } from './NbaGameVolumeBar'

interface FantasyDayEvent {
  date: string
  role: string
  label: string
  description?: string
}

interface DayVolume {
  date: string
  dayOfWeek: number
  gameCount: number
  classification: 'heavy' | 'moderate' | 'light' | 'off'
}

interface WeekPlan {
  sport: string
  season: number
  week: number
  scoringDays: string[]
  ceremonyDay: string | null
  adminDay: string | null
  transitionDay: string | null
  eliminationDay: string | null
  statusUpdateDay: string | null
  events: FantasyDayEvent[]
  nonScoringDays: string[]
  volumeProfile: { days: DayVolume[] }
}

function roleColor(role: string): string {
  switch (role) {
    case 'scoring': return 'border-emerald-500/30 bg-emerald-500/10'
    case 'ceremony': return 'border-purple-500/30 bg-purple-500/10'
    case 'admin': return 'border-amber-500/30 bg-amber-500/10'
    case 'transition': return 'border-blue-500/30 bg-blue-500/10'
    case 'elimination': return 'border-red-500/30 bg-red-500/10'
    case 'status_update': return 'border-cyan-500/30 bg-cyan-500/10'
    default: return 'border-white/10 bg-white/5'
  }
}

function roleIcon(role: string): string {
  switch (role) {
    case 'scoring': return '🏟'
    case 'ceremony': return '🔥'
    case 'admin': return '⚙'
    case 'transition': return '🔄'
    case 'elimination': return '✂️'
    case 'status_update': return '🧟'
    default: return '📅'
  }
}

export function LeagueScheduleCalendar({
  leagueId,
  season,
  startWeek = 1,
  endWeek = 4,
}: {
  leagueId: string
  season?: number
  startWeek?: number
  endWeek?: number
}) {
  const [weeks, setWeeks] = useState<WeekPlan[]>([])
  const [sport, setSport] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      try {
        const s = season ?? new Date().getFullYear()
        const res = await fetch(
          `/api/schedule/calendar?leagueId=${encodeURIComponent(leagueId)}&season=${s}&startWeek=${startWeek}&endWeek=${endWeek}`,
          { cache: 'no-store' }
        )
        if (!active) return
        if (!res.ok) throw new Error('Failed to load')
        const data = await res.json()
        setWeeks(data.weeks ?? [])
        setSport(data.sport ?? '')
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [leagueId, season, startWeek, endWeek])

  if (loading) return <div className="py-8 text-center text-sm text-white/50">Loading schedule...</div>
  if (error) return <div className="py-4 text-center text-sm text-red-300">{error}</div>
  if (weeks.length === 0) return <div className="py-4 text-center text-sm text-white/50">No schedule data available</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-white/40">
        <span className="rounded bg-white/10 px-2 py-0.5 font-medium text-white/60">{sport}</span>
        <span>Fantasy Schedule</span>
      </div>

      {weeks.map((week) => (
        <div key={week.week} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <button
            type="button"
            onClick={() => setExpandedWeek(expandedWeek === week.week ? null : week.week)}
            className="flex w-full items-center justify-between text-left"
          >
            <div>
              <span className="text-sm font-medium text-white">Week {week.week}</span>
              <span className="ml-2 text-[11px] text-white/40">
                {week.scoringDays.length} scoring · {week.events.length} events
              </span>
            </div>
            <span className="text-[11px] text-white/30">{expandedWeek === week.week ? '▼' : '▶'}</span>
          </button>

          <div className="mt-2">
            <NbaGameVolumeBar
              days={week.volumeProfile.days}
              highlightDate={week.ceremonyDay ?? week.eliminationDay ?? week.statusUpdateDay ?? week.transitionDay}
              highlightRole={
                week.ceremonyDay ? 'Ceremony' :
                week.eliminationDay ? 'Elimination' :
                week.statusUpdateDay ? 'Status' :
                week.transitionDay ? 'Transition' : null
              }
            />
          </div>

          {expandedWeek === week.week && (
            <div className="mt-3 space-y-1.5">
              {week.events.map((event, i) => (
                <div
                  key={`${event.date}-${i}`}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] ${roleColor(event.role)}`}
                >
                  <span>{roleIcon(event.role)}</span>
                  <div className="flex-1">
                    <span className="font-medium text-white/90">{event.label}</span>
                    <span className="ml-2 text-white/40">{event.date}</span>
                    {event.description && <p className="mt-0.5 text-[11px] text-white/50">{event.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
