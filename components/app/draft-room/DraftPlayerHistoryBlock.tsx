'use client'

/**
 * Compact player career-history block for the draft-room selected-player
 * panel. Fetches from /api/player-card-analytics on demand, renders
 * meta-trends + career projection + recent-season lines. Non-blocking:
 * shows a tiny spinner while loading, a tight error line on failure.
 */

import { useEffect, useState } from 'react'
import { TrendingUp, History, Sparkles } from 'lucide-react'

interface AnalyticsResponse {
  aiInsights?: { summary?: string; bullets?: string[] } | null
  metaTrends?: Array<{ label: string; value: string | number; direction?: 'up' | 'down' | 'flat' }> | null
  careerProjection?: { summary?: string; seasons?: Array<{ season: string; points: number; games?: number }> } | null
  matchupPrediction?: { summary?: string } | null
}

export interface DraftPlayerHistoryBlockProps {
  playerId?: string | null
  playerName: string
  position?: string | null
  team?: string | null
  sport?: string | null
}

export function DraftPlayerHistoryBlock(props: DraftPlayerHistoryBlockProps) {
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!props.playerName) return
    let alive = true
    setLoading(true)
    setError(null)
    setData(null)
    fetch('/api/player-card-analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: props.playerId ?? null,
        playerName: props.playerName,
        position: props.position ?? null,
        team: props.team ?? null,
        sport: props.sport ?? null,
      }),
    })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as AnalyticsResponse & { error?: string }
        if (!alive) return
        if (!r.ok) {
          setError(body.error ?? 'Could not load career history')
          return
        }
        setData(body)
      })
      .catch((e) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'Could not load career history')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [props.playerId, props.playerName, props.position, props.team, props.sport])

  if (loading) {
    return (
      <div className="border-t border-white/8 bg-black/20 px-2.5 py-2 text-[11px] text-white/55">
        Loading history…
      </div>
    )
  }
  if (error) {
    return (
      <div className="border-t border-white/8 bg-rose-500/[0.06] px-2.5 py-2 text-[11px] text-rose-200/80">
        {error}
      </div>
    )
  }
  if (!data) return null

  const seasons = (data.careerProjection?.seasons ?? []).slice(0, 4)
  const trends = (data.metaTrends ?? []).slice(0, 4)
  const bullets = (data.aiInsights?.bullets ?? []).slice(0, 3)

  if (seasons.length === 0 && trends.length === 0 && bullets.length === 0 && !data.aiInsights?.summary) {
    return null
  }

  return (
    <div
      className="border-t border-white/8 bg-black/20 px-2.5 py-2 text-[11px] text-white/75"
      data-testid="draft-selected-player-history"
    >
      {seasons.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">
            <History className="h-3 w-3" />
            Recent seasons
          </div>
          <div className="grid grid-cols-4 gap-1 text-center">
            {seasons.map((s) => (
              <div key={s.season} className="rounded border border-white/8 bg-white/[0.02] px-1 py-1">
                <div className="text-[11px] text-white/50">{s.season}</div>
                <div className="text-[11px] font-semibold text-white/90">{s.points.toFixed(1)}</div>
                {typeof s.games === 'number' ? (
                  <div className="text-[11px] text-white/40">{s.games} GP</div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {trends.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">
            <TrendingUp className="h-3 w-3" />
            Meta trends
          </div>
          <ul className="space-y-0.5">
            {trends.map((t) => (
              <li key={t.label} className="flex items-center justify-between gap-2">
                <span className="text-white/60">{t.label}</span>
                <span
                  className={`tabular-nums ${
                    t.direction === 'up'
                      ? 'text-emerald-300'
                      : t.direction === 'down'
                        ? 'text-rose-300'
                        : 'text-white/75'
                  }`}
                >
                  {t.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(bullets.length > 0 || data.aiInsights?.summary) && (
        <div>
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">
            <Sparkles className="h-3 w-3" />
            AI insight
          </div>
          {data.aiInsights?.summary ? (
            <p className="mb-1 text-white/70">{data.aiInsights.summary}</p>
          ) : null}
          {bullets.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-white/65">
              {bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
