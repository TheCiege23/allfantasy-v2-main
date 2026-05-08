'use client'

import { useEffect, useMemo, useState } from 'react'
import { Calendar } from 'lucide-react'
import type { PlayerIdentity } from '../PlayerProfileClient'
import { toSeasonRows, pickStatNum, type GameLogSeasonRow as SeasonRow } from './seasonRows'

export function GameLogTab({ player }: { player: PlayerIdentity }) {
  const [seasons, setSeasons] = useState<SeasonRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/player-card-analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: player.name, sport: player.sport }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        const rows = toSeasonRows(d)
        setSeasons(rows)
        setSelectedSeason(rows[0]?.season ?? null)
      })
      .catch(() => {
        if (!cancelled) setSeasons([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [player.name, player.sport])

  const active = useMemo(
    () => seasons.find((s) => s.season === selectedSeason) ?? seasons[0] ?? null,
    [seasons, selectedSeason]
  )

  if (loading) {
    return (
      <div className="space-y-2" data-testid="game-log-tab-loading">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-white/[0.04]" />
        ))}
      </div>
    )
  }

  if (seasons.length === 0 || !active) {
    return (
      <div
        className="flex flex-col items-center py-12 text-center"
        data-testid="game-log-tab-empty"
      >
        <Calendar className="h-8 w-8 text-white/10" />
        <p className="mt-3 text-sm text-white/40">No game log data available for {player.name}.</p>
        <p className="mt-1 text-xs text-white/25">
          Game logs are populated after your league imports player stats.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="game-log-tab">
      <div
        className="flex flex-wrap gap-1.5"
        role="tablist"
        aria-label="Season selector"
        data-testid="season-selector"
      >
        {seasons.map((s) => {
          const isActive = s.season === active.season
          return (
            <button
              key={s.season}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={`season-tab-${s.season}`}
              onClick={() => setSelectedSeason(s.season)}
              className={
                'rounded-full px-3 py-1 text-[11px] font-semibold transition ' +
                (isActive
                  ? 'bg-white/[0.12] text-white'
                  : 'bg-white/[0.03] text-white/50 hover:bg-white/[0.06] hover:text-white/80')
              }
            >
              {s.season}
            </button>
          )
        })}
      </div>

      <SeasonStatsCard row={active} />
    </div>
  )
}

function SeasonStatsCard({ row }: { row: SeasonRow }) {
  const st = row.stats
  return (
    <div
      className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4"
      data-testid={`season-stats-${row.season}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] font-bold text-white">{row.season} Season</p>
        <div className="flex items-center gap-2">
          {row.team && <span className="text-[11px] text-white/50">{row.team}</span>}
          {row.gamesPlayed != null && (
            <span className="text-[11px] text-white/40">{row.gamesPlayed} GP</span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        {row.fantasyPoints != null && (
          <LogStat label="Fantasy Pts" value={row.fantasyPoints.toFixed(1)} />
        )}
        {row.fantasyPointsPerGame != null && (
          <LogStat label="Pts/Game" value={row.fantasyPointsPerGame.toFixed(1)} />
        )}
        {pickStatNum(st, 'passing_yards') != null && (
          <LogStat label="Pass Yds" value={String(pickStatNum(st, 'passing_yards'))} />
        )}
        {pickStatNum(st, 'passing_touchdowns') != null && (
          <LogStat label="Pass TD" value={String(pickStatNum(st, 'passing_touchdowns'))} />
        )}
        {pickStatNum(st, 'passing_interceptions', 'interceptions') != null && (
          <LogStat
            label="INT"
            value={String(pickStatNum(st, 'passing_interceptions', 'interceptions'))}
          />
        )}
        {pickStatNum(st, 'rushing_yards') != null && (
          <LogStat label="Rush Yds" value={String(pickStatNum(st, 'rushing_yards'))} />
        )}
        {pickStatNum(st, 'rushing_touchdowns') != null && (
          <LogStat label="Rush TD" value={String(pickStatNum(st, 'rushing_touchdowns'))} />
        )}
        {pickStatNum(st, 'receptions') != null && (
          <LogStat label="Rec" value={String(pickStatNum(st, 'receptions'))} />
        )}
        {pickStatNum(st, 'targets') != null && (
          <LogStat label="Targets" value={String(pickStatNum(st, 'targets'))} />
        )}
        {pickStatNum(st, 'receiving_yards') != null && (
          <LogStat label="Rec Yds" value={String(pickStatNum(st, 'receiving_yards'))} />
        )}
        {pickStatNum(st, 'receiving_touchdowns') != null && (
          <LogStat label="Rec TD" value={String(pickStatNum(st, 'receiving_touchdowns'))} />
        )}
        {pickStatNum(st, 'fumbles') != null && (
          <LogStat label="Fum" value={String(pickStatNum(st, 'fumbles'))} />
        )}
      </div>
    </div>
  )
}

function LogStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-0.5">
      <span className="text-[9px] uppercase text-white/30">{label}: </span>
      <span className="text-[12px] font-semibold text-white/70">{value}</span>
    </div>
  )
}
