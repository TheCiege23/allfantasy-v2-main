'use client'

import { useEffect } from 'react'
import { isWeatherSensitiveSport } from '@/lib/weather/outdoorSportMetadata'
import { useSleeperPlayers } from '@/lib/hooks/useSleeperPlayers'
import { useAFProjection } from '@/components/weather/useAFProjection'

export type PlayerStatCardProps = {
  playerId: string
  leagueId: string
  sport: string
  onClose: () => void
}

/**
 * Global player modal.
 *
 * Projections: this card intentionally renders NO fabricated projection numbers. Until a real
 * per-player projection provider is wired, `realBaselineProjection` stays `null`, the card shows an
 * honest "projections unavailable" fallback, and the weather-adjusted (AF) block stays dormant (it
 * would otherwise present point totals anchored to a synthetic baseline). When a real projection is
 * available, set `realBaselineProjection` from it and the existing AF block lights up unchanged.
 */
export function PlayerStatCard({ playerId, sport, onClose }: PlayerStatCardProps) {
  const { players, loading } = useSleeperPlayers(sport)
  const known = players[playerId]
  const name = known?.name ?? (loading ? 'Loading player…' : 'Unknown player')
  const position = known?.position || '—'
  const team = known?.team || ''

  // No real projection wire yet — never fabricate a per-player baseline. Plug real projections in here.
  const realBaselineProjection: number | null = null
  const hasProjection = realBaselineProjection !== null

  const outdoor = isWeatherSensitiveSport(sport)
  const showWeather = outdoor && hasProjection

  const { loading: afLoading, data: af, fetch: fetchAf } = useAFProjection({
    playerId,
    playerName: name,
    sport,
    position,
    baselineProjection: realBaselineProjection ?? 0,
    week: 1,
    season: new Date().getFullYear(),
  })

  useEffect(() => {
    if (!showWeather) return
    void fetchAf()
  }, [showWeather, fetchAf])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="af-player-stat-title"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-[580px] overflow-y-auto rounded-3xl border border-white/[0.12] bg-[#0c0c1e] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p id="af-player-stat-title" className="text-[10px] uppercase tracking-wider text-white/40">
              Player
            </p>
            <p className="mt-1 text-lg font-semibold text-white/90">{name}</p>
            <p className="mt-2 text-xs text-white/45">
              {position}
              {team ? ` · ${team}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-lg leading-none text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {!hasProjection ? (
          <p className="mt-4 text-xs text-white/40" data-testid="player-projection-fallback">
            Detailed projections will appear here when provider data is available.
          </p>
        ) : null}

        {showWeather ? (
          <div className="mt-4 border-t border-white/[0.08] pt-4" data-testid="player-stat-weather-impact">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-white/40">Weather Impact</span>
              {af?.weatherLabel ? (
                <span className="text-[11px] text-white/45" data-testid="weather-badge">
                  {af.weatherLabel}
                </span>
              ) : null}
            </div>
            {afLoading ? (
              <p className="text-xs text-white/45">Loading AF weather-adjusted projection…</p>
            ) : af && !af.error ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <div className="text-xs text-white/40">Baseline</div>
                    <div className="text-lg font-bold text-white">{af.standard.toFixed(1)}</div>
                  </div>
                  <div className="text-white/30">→</div>
                  <div>
                    <div className="text-xs text-white/40">AF Projected</div>
                    <div
                      className={`text-lg font-bold ${
                        af.af > af.standard ? 'text-green-400' : af.af < af.standard ? 'text-red-400' : 'text-white'
                      }`}
                    >
                      {af.af.toFixed(1)}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 text-xs italic text-white/50">{af.reason}</div>
                </div>
                {Math.abs(af.delta) > 0.05 && af.factors.length > 0 ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-white/40">
                    {af.factors.map((f, idx) => (
                      <div
                        key={`${f.label}-${idx}`}
                        className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1"
                      >
                        <span
                          className={
                            f.direction === 'pos'
                              ? 'text-green-400'
                              : f.direction === 'neg'
                                ? 'text-red-400'
                                : 'text-white/50'
                          }
                        >
                          {f.direction === 'pos' ? '↑ ' : f.direction === 'neg' ? '↓ ' : ''}
                          {f.value}
                        </span>{' '}
                        {f.label}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-white/40">
                {af?.error ? af.error : 'Weather projection unavailable.'}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
