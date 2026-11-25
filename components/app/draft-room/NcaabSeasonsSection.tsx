'use client'

/**
 * College basketball seasons and game log for the player detail modal, in place of the year tabs and
 * NFL game-log table. Reads `/api/players/ncaab-seasons` (our own stored box scores).
 */

import { useEffect, useState } from 'react'
import type { NcaabGameLine, NcaabPlayerSeasons, NcaabSeasonSummary } from '@/lib/players/ncaabPlayerSeasons'

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: NcaabPlayerSeasons }

const pctText = (value: number | null): string => (value == null ? '—' : `${(value * 100).toFixed(1)}%`)

/** "Nov 20" from YYYY-MM-DD, without a timezone shift. */
export function formatNcaabGameDate(date: string | null): string {
  if (!date) return '—'
  const [, month, day] = date.split('-').map(Number)
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return names[(month ?? 0) - 1] && day ? `${names[month - 1]} ${day}` : '—'
}

/** "12 games" / "34 games, 3 in the postseason". */
export function ncaabGamesNote(season: Pick<NcaabSeasonSummary, 'games' | 'postseasonGames'>): string {
  const games = `${season.games} ${season.games === 1 ? 'game' : 'games'}`
  return season.postseasonGames > 0 ? `${games}, ${season.postseasonGames} in the postseason` : games
}

function seasonCells(season: NcaabSeasonSummary): Array<[string, string]> {
  const p = season.perGame
  return [
    ['MIN', p.minutes == null ? '—' : p.minutes.toFixed(1)],
    ['PTS', p.points.toFixed(1)],
    ['REB', p.rebounds.toFixed(1)],
    ['AST', p.assists.toFixed(1)],
    ['STL', p.steals.toFixed(1)],
    ['BLK', p.blocks.toFixed(1)],
    ['3PM', p.threesMade.toFixed(1)],
    ['TO', p.turnovers.toFixed(1)],
    ['FG%', pctText(season.fieldGoalPct)],
    ['3P%', pctText(season.threePointPct)],
    ['FT%', pctText(season.freeThrowPct)],
  ]
}

export function NcaabSeasonsView({ data }: { data: NcaabPlayerSeasons }) {
  const [activeSeason, setActiveSeason] = useState<number | null>(data.seasons[0]?.season ?? null)
  const season = data.seasons.find((s) => s.season === activeSeason) ?? data.seasons[0] ?? null

  if (!season) {
    return (
      <p className="px-6 py-6 text-center text-[12px] text-white/45" data-testid="ncaab-seasons-empty">
        No games are stored for this player yet.
      </p>
    )
  }
  const games = data.games.filter((g) => g.season === season.season)

  return (
    <div data-testid="ncaab-seasons">
      <div className="flex items-center gap-2 border-b border-white/8 px-6 pt-4">
        <p className="pb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-white/50">Season stats</p>
        <div className="ml-auto flex items-center gap-1 pb-3">
          {data.seasons.map((s) => {
            const active = s.season === season.season
            return (
              <button
                key={s.season}
                type="button"
                onClick={() => setActiveSeason(s.season)}
                aria-pressed={active}
                data-testid={`ncaab-season-tab-${s.season}`}
                className={`min-h-[36px] rounded-full px-3 py-1 text-[11px] font-semibold transition sm:min-h-0 ${
                  active ? 'bg-cyan-500 text-black shadow' : 'bg-white/5 text-white/65 hover:bg-white/10'
                }`}
              >
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="border-b border-white/8 bg-white/[0.015] px-6 py-4" data-testid="ncaab-season-summary">
        <p className="mb-2 text-[12px] text-white/60">
          Per game{season.team ? ` for ${season.team}` : ''} · {ncaabGamesNote(season)}
        </p>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-11">
          {seasonCells(season).map(([label, value]) => (
            <div key={label} className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">{label}</p>
              <p className="mt-0.5 text-sm font-bold tabular-nums text-white">{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="px-6 pb-6 pt-3">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white/50">Game log</p>
        <NcaabGameLogTable rows={games} />
      </div>
    </div>
  )
}

function NcaabGameLogTable({ rows }: { rows: NcaabGameLine[] }) {
  const head = ['Date', 'Opp', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG', 'FT', 'TO']
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[12px] tabular-nums" data-testid="ncaab-game-log">
        <thead>
          <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.12em] text-white/45">
            {head.map((h, i) => (
              <th key={h} scope="col" className={`px-2 py-1.5 font-semibold ${i < 2 ? '' : 'text-right'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((g, i) => (
            <tr key={`${g.date}-${g.opponent}-${i}`} className="border-b border-white/[0.05] text-white/85">
              <td className="whitespace-nowrap px-2 py-1.5 text-white/70">{formatNcaabGameDate(g.date)}</td>
              <td className="whitespace-nowrap px-2 py-1.5 font-semibold">
                {g.opponent ?? '—'}
                {g.postseason ? <span className="ml-1.5 text-[11px] font-normal text-amber-200/80">Postseason</span> : null}
              </td>
              <td className="px-2 py-1.5 text-right">{g.minutes > 0 ? g.minutes : '—'}</td>
              <td className="px-2 py-1.5 text-right font-bold text-white">{g.points}</td>
              <td className="px-2 py-1.5 text-right">{g.rebounds}</td>
              <td className="px-2 py-1.5 text-right">{g.assists}</td>
              <td className="px-2 py-1.5 text-right">{g.steals}</td>
              <td className="px-2 py-1.5 text-right">{g.blocks}</td>
              <td className="px-2 py-1.5 text-right">{g.threesMade}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right">{g.fieldGoalsMade}-{g.fieldGoalsAttempted}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right">{g.freeThrowsMade}-{g.freeThrowsAttempted}</td>
              <td className="px-2 py-1.5 text-right">{g.turnovers}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Fetching wrapper: one read per open card. */
export function NcaabSeasonsSection({ playerId, open }: { playerId: string | null | undefined; open: boolean }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    if (!open || !playerId) return
    let alive = true
    setState({ status: 'loading' })
    fetch(`/api/players/ncaab-seasons?playerId=${encodeURIComponent(playerId)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as NcaabPlayerSeasons) : null))
      .then((body) => {
        if (!alive) return
        setState(body && Array.isArray(body.seasons) && Array.isArray(body.games) ? { status: 'ready', data: body } : { status: 'error' })
      })
      .catch(() => {
        if (alive) setState({ status: 'error' })
      })
    return () => {
      alive = false
    }
  }, [open, playerId])

  if (!playerId) return <NcaabSeasonsView data={{ seasons: [], games: [] }} />
  if (state.status === 'loading') {
    return <p className="px-6 py-6 text-center text-[12px] text-white/50" data-testid="ncaab-seasons-loading">Loading season stats…</p>
  }
  if (state.status === 'error') {
    return <p className="px-6 py-6 text-center text-[12px] text-rose-200/80" data-testid="ncaab-seasons-error">Season stats could not be loaded. Close and reopen this card to try again.</p>
  }
  return <NcaabSeasonsView key={playerId} data={state.data} />
}
