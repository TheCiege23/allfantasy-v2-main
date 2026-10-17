'use client'

import { Brain, TrendingDown, TrendingUp, Minus, Sparkles, ShieldAlert } from 'lucide-react'
import type { LiveDraftBrainEnvelope } from '@/lib/live-draft-brain/schemas'

function TrendIcon({ arrow }: { arrow: 'up' | 'down' | 'flat' }) {
  if (arrow === 'up') return <TrendingUp className="h-3 w-3 text-emerald-300" aria-hidden />
  if (arrow === 'down') return <TrendingDown className="h-3 w-3 text-rose-300" aria-hidden />
  return <Minus className="h-3 w-3 text-white/40" aria-hidden />
}

const BADGE = {
  0: { label: 'Best value', className: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100' },
  1: { label: 'Best fit', className: 'border-cyan-400/40 bg-cyan-500/15 text-cyan-100' },
  2: { label: 'Upside', className: 'border-violet-400/40 bg-violet-500/15 text-violet-100' },
} as const

export type DraftLiveBrainPremiumBlockProps = {
  liveBrain: LiveDraftBrainEnvelope
  onPlayerClick?: (player: { name: string; position: string; team?: string | null }) => void
}

/**
 * Premium Live Draft Brain strip: hero recommendation, top 3, next picks, combined ADP sample.
 */
export function DraftLiveBrainPremiumBlock({ liveBrain, onPlayerClick }: DraftLiveBrainPremiumBlockProps) {
  const primary = liveBrain.pickRecommendationsTop3[0] ?? liveBrain.pickRecommendation
  const rows = liveBrain.combinedAdp?.slice(0, 6) ?? []

  return (
    <div className="space-y-3" data-testid="draft-live-brain-panel">
      <div className="relative overflow-hidden rounded-xl border border-cyan-400/25 bg-gradient-to-br from-cyan-500/10 via-[#0a1228] to-[#040915] p-3 shadow-[0_0_24px_rgba(34,211,238,0.08)]">
        <div className="absolute right-2 top-2 opacity-30">
          <Brain className="h-10 w-10 text-cyan-300" aria-hidden />
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200/80">AI recommendation</p>
        <button
          type="button"
          className="mt-1 w-full text-left"
          onClick={() =>
            onPlayerClick?.({
              name: primary.playerName,
              position: primary.position,
              team: primary.team || null,
            })
          }
        >
          <p className="text-lg font-bold text-white leading-tight">{primary.playerName}</p>
          <p className="text-xs text-white/60">
            {primary.position}
            {primary.team ? ` · ${primary.team}` : ''} · ADP {primary.combinedAdp.toFixed(1)} · Score {Math.round(primary.pickScore)}
          </p>
        </button>
        <p className="mt-2 inline-flex items-center gap-1 rounded border border-white/10 bg-black/30 px-2 py-0.5 text-[11px] text-white/70">
          <Sparkles className="h-3 w-3 text-amber-200" />
          {primary.recommendationType.replace(/-/g, ' ')}
        </p>
        {primary.reasoning?.length ? (
          <ul className="mt-2 space-y-1 border-t border-white/10 pt-2">
            {primary.reasoning.slice(0, 3).map((r, i) => (
              <li key={i} className="flex gap-1.5 text-[11px] text-white/75">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-cyan-400/80" />
                {r}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/45">Top 3 scores</p>
        <div className="grid gap-2">
          {liveBrain.pickRecommendationsTop3.slice(0, 3).map((row, i) => (
            <button
              key={`${row.playerName}-${i}`}
              type="button"
              onClick={() => onPlayerClick?.({ name: row.playerName, position: row.position, team: row.team || null })}
              className={`flex flex-col rounded-lg border px-2.5 py-2 text-left transition hover:bg-white/5 ${BADGE[i as 0 | 1 | 2]?.className ?? 'border-white/10 bg-black/25'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-white">{row.playerName}</span>
                <span className="rounded bg-black/30 px-1.5 py-0.5 text-[11px] text-white/70">{BADGE[i as 0 | 1 | 2]?.label ?? 'Option'}</span>
              </div>
              <span className="text-[11px] text-white/55">
                {row.position} · {Math.round(row.pickScore)} pts · {row.waitOrTakeNow.replace(/_/g, ' ')}
              </span>
              {row.riskNotes?.length ? (
                <span className="mt-1 flex items-start gap-1 text-[11px] text-amber-200/85">
                  <ShieldAlert className="h-3 w-3 shrink-0" />
                  {row.riskNotes[0]}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {liveBrain.nextPickPredictions.length > 0 ? (
        <div className="rounded-lg border border-white/10 bg-black/20 p-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">Likely next picks</p>
          <ul className="space-y-1.5">
            {liveBrain.nextPickPredictions.slice(0, 4).map((n, i) => (
              <li key={i} className="text-[11px] text-white/80">
                <span className="text-cyan-200/90">{n.manager}</span> → {n.predictedPlayer}{' '}
                <span className="text-white/45">({n.predictedPosition})</span>{' '}
                <span className="tabular-nums text-emerald-200/90">{Math.round(n.probability * 100)}%</span>
                <span className="block text-[11px] text-white/40">{n.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="rounded-lg border border-emerald-400/20 bg-[#0a1228]/80 p-2">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-200/70">Combined AI ADP</p>
          <p className="mb-2 text-[11px] text-white/40">{rows[0]?.contextLabel}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-white/40">
                  <th className="pb-1 pr-2">Player</th>
                  <th className="pb-1 pr-2">Comb</th>
                  <th className="pb-1 pr-2">Ext</th>
                  <th className="pb-1 pr-2">Site</th>
                  <th className="pb-1">Trend</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.playerKey} className="border-t border-white/5 text-white/85">
                    <td className="max-w-[120px] truncate py-1 pr-2 font-medium">{r.playerName}</td>
                    <td className="tabular-nums text-emerald-200/95">{r.combinedAdp.toFixed(1)}</td>
                    <td className="tabular-nums text-white/55">{r.externalAdp != null ? r.externalAdp.toFixed(1) : '—'}</td>
                    <td className="tabular-nums text-white/55">{r.siteAdp != null ? r.siteAdp.toFixed(1) : '—'}</td>
                    <td className="py-1">
                      <div className="flex items-center gap-0.5">
                        <TrendIcon arrow={r.trendArrow} />
                        <span className="max-w-[100px] truncate text-white/50" title={r.trend}>
                          {r.confidence}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {(liveBrain.positionalRunSignals.length > 0 || liveBrain.tierCliffWarnings.length > 0) && (
        <div className="rounded-lg border border-amber-400/25 bg-amber-500/5 px-2 py-1.5">
          <p className="mb-1 text-[11px] font-semibold uppercase text-amber-200/80">Board radar</p>
          <ul className="space-y-0.5 text-[11px] text-amber-100/80">
            {liveBrain.positionalRunSignals.slice(0, 2).map((s, i) => (
              <li key={`run-${i}`}>{s}</li>
            ))}
            {liveBrain.tierCliffWarnings.slice(0, 2).map((s, i) => (
              <li key={`tier-${i}`}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
