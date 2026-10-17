'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Clock, Repeat, Swords } from 'lucide-react'
import { buildYourWeek, type LineupIssue, type YourWeek } from '@/lib/league/your-week'
import type { MatchupCenterPayload } from '@/lib/matchup-center/types'

async function getJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, { cache: 'no-store', credentials: 'include' })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

/**
 * Loads the four existing sources in parallel (no new routes) and degrades item by item: the
 * matchup from the Matchup tab's own `matchup-center`, empty and injured starters from the redraft
 * roster's lineup validation, waivers from the waiver-wire state, and the next kickoff from the
 * matchup's NFL game evidence when the server includes it.
 */
export async function loadYourWeek(leagueId: string, week: number | null, now: () => string = () => new Date().toISOString()): Promise<YourWeek> {
  const id = encodeURIComponent(leagueId)
  const weekQuery = week != null ? `?week=${week}` : ''
  const [rosterRes, waiverRes] = await Promise.all([
    getJson(`/api/redraft/roster?leagueId=${id}${week != null ? `&week=${week}` : ''}`),
    getJson(`/api/waiver-wire/leagues/${id}/state`),
  ])
  // With no week from the shell, matchup-center falls back to a settings field that is not kept
  // current (measured: it served week 1 / "No opponent" while the roster resolved week 6). The
  // redraft roster resolves the real week, so ask the matchup for that one.
  const rosterWeek = (rosterRes as { week?: unknown } | null)?.week
  const matchupWeek = week ?? (typeof rosterWeek === 'number' ? rosterWeek : null)
  const matchupRes = await getJson(`/api/leagues/${id}/matchup-center${matchupWeek != null ? `?week=${matchupWeek}` : weekQuery}`)
  const m = matchupRes as { payload?: MatchupCenterPayload; sportsContext?: { games?: { scheduledStart: string; final?: boolean }[] } } | null
  const r = rosterRes as { roster?: { lineupValidation?: { issues?: LineupIssue[] } } } | null
  const w = waiverRes as { settings?: { nextRunAt?: string | null } } | null
  return buildYourWeek({
    matchup: m?.payload ?? null,
    games: m?.sportsContext?.games ?? null,
    lineupIssues: r?.roster?.lineupValidation?.issues ?? null,
    waiverNextRunAt: w?.settings?.nextRunAt ?? null,
    now: now(),
  })
}

/**
 * "Your week": the reason to open the league during the season — your score against this week's
 * opponent, when your lineup locks, what is wrong with your starters, when waivers run. Each tile
 * opens the tab that fixes it. Renders nothing until something real loads.
 */
export function LeagueYourWeekStrip({ leagueId, week, onSelectTab }: { leagueId: string; week: number | null; onSelectTab: (tab: string) => void }) {
  const [data, setData] = useState<YourWeek | null>(null)

  useEffect(() => {
    let cancelled = false
    loadYourWeek(leagueId, week).then((result) => {
      if (!cancelled) setData(result)
    })
    return () => {
      cancelled = true
    }
  }, [leagueId, week])

  if (!data || data.empty) return null
  const problems = data.emptySlots + data.onBye.length + data.otherErrors + data.injured.length

  return (
    <section className="nl-card nl-yourweek" aria-label="Your week" data-testid="your-week">
      <div className="nl-card-label">
        <span>Your week{data.week != null ? ` · Week ${data.week}` : ''}</span>
      </div>
      <div className="nl-yourweek-grid">
        {data.matchup ? (
          <button type="button" className="nl-yw-tile" onClick={() => onSelectTab('matchups')} data-testid="your-week-matchup">
            <span className="nl-yw-label"><Swords size={14} aria-hidden /> {data.matchup.them ? `vs ${data.matchup.them.name}` : 'This week'}</span>
            <strong data-testid="your-week-score">
              {data.matchup.you.points.toFixed(1)}
              {data.matchup.them ? ` – ${data.matchup.them.points.toFixed(1)}` : ''}
            </strong>
            <small>
              {data.matchup.headline}
              {data.matchup.status === 'live' && data.matchup.yetToPlay > 0 ? ` · ${data.matchup.yetToPlay} yet to play` : ''}
            </small>
          </button>
        ) : null}
        {data.lock ? (
          <button type="button" className="nl-yw-tile" data-state={data.lock.state} onClick={() => onSelectTab('roster')} data-testid="your-week-lock">
            <span className="nl-yw-label"><Clock size={14} aria-hidden /> Lineup</span>
            <strong>{data.lock.state === 'locked' ? 'Games underway' : data.lock.label.replace(/^locks/, 'Locks')}</strong>
            <small>{data.lock.state === 'locked' ? 'Later games can still change' : 'Next kickoff'}</small>
          </button>
        ) : null}
        {problems > 0 ? (
          <button type="button" className="nl-yw-tile" data-state="warn" onClick={() => onSelectTab('roster')} data-testid="your-week-problems">
            <span className="nl-yw-label"><AlertTriangle size={14} aria-hidden /> Fix your lineup</span>
            <strong>
              {[
                data.emptySlots ? `${data.emptySlots} empty ${data.emptySlots === 1 ? 'slot' : 'slots'}` : null,
                data.onBye.length ? `${data.onBye.length} on bye` : null,
                data.injured.length ? `${data.injured.length} injured` : null,
                data.otherErrors ? `${data.otherErrors} ${data.otherErrors === 1 ? 'lineup error' : 'lineup errors'}` : null,
              ].filter(Boolean).join(' · ')}
            </strong>
            <small>
              {[...data.injured.map((p) => `${p.name} (${p.status})`), ...data.onBye.map((p) => `${p.name} (bye)`)].slice(0, 2).join(', ') ||
                (data.emptySlots ? 'Fill your starting lineup' : 'Your lineup has slots that need fixing')}
            </small>
          </button>
        ) : null}
        {data.waivers ? (
          <button type="button" className="nl-yw-tile" onClick={() => onSelectTab('players')} data-testid="your-week-waivers">
            <span className="nl-yw-label"><Repeat size={14} aria-hidden /> Waivers</span>
            <strong>{fmtWhen(data.waivers.at)}</strong>
            <small>Claims process then</small>
          </button>
        ) : null}
      </div>
    </section>
  )
}
