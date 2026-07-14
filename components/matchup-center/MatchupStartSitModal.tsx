'use client'

import { Loader2, Scale, X } from 'lucide-react'
import type { MatchupPlayerSlot } from '@/lib/matchup-center/types'
import type { StartSitAiResult } from '@/lib/ai-matchup-engine/types'

export function MatchupStartSitModal({
  open,
  onClose,
  loading,
  result,
  error,
  left,
  right,
}: {
  open: boolean
  onClose: () => void
  loading: boolean
  result: StartSitAiResult | null
  error: string | null
  left: MatchupPlayerSlot
  right: MatchupPlayerSlot
}) {
  if (!open) return null

  const pickName =
    result?.recommendation === 'playerA' ? left.name : result?.recommendation === 'playerB' ? right.name : 'Toss-up'

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-3 sm:items-center" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" aria-label="Close" onClick={onClose} />
      <div className="relative z-10 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-subtle bg-surface p-4 shadow-popover">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-cyan-300/90" />
            <h2 className="text-sm font-bold text-primary">Start / sit - AI</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted hover:bg-surface-hover hover:text-primary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-[11px] text-muted">
          {left.name} vs {right.name}
        </p>

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-cyan-300/90">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">Running multi-model analysis…</span>
          </div>
        ) : null}

        {error ? <p className="mt-3 text-[13px] text-red-200/90">{error}</p> : null}

        {result && !loading ? (
          <div className="mt-3 space-y-2 text-[12px] leading-snug text-secondary">
            <p>
              <span className="font-semibold text-cyan-200/90">Pick: </span>
              {pickName}{' '}
              <span className="text-muted">
                ({result.confidencePct}% confidence · {result.recommendation})
              </span>
            </p>
            <div className="rounded-lg border border-subtle bg-surface-muted p-2 text-[11px]">
              <p>
                <span className="text-muted">Matchup: </span>
                {result.reasoning.matchup || '—'}
              </p>
              <p>
                <span className="text-muted">Usage: </span>
                {result.reasoning.usage || '—'}
              </p>
              <p>
                <span className="text-muted">Injuries: </span>
                {result.reasoning.injuries || '—'}
              </p>
              <p>
                <span className="text-muted">Weather: </span>
                {result.reasoning.weather || '—'}
              </p>
            </div>
            <p>
              <span className="font-semibold text-emerald-200/85">If you need floor → </span>
              {result.scenarios.ifNeedFloor}
            </p>
            <p>
              <span className="font-semibold text-amber-200/85">If you need upside → </span>
              {result.scenarios.ifNeedUpside}
            </p>
            <p>
              <span className="font-semibold text-muted">Win prob influence: </span>
              {result.winProbabilityInfluence}
            </p>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg border border-subtle bg-surface-muted p-2">
                <div className="font-semibold text-secondary">{left.name}</div>
                <div className="text-muted">
                  {result.playerOutlook.playerA.volatility} vol · {result.playerOutlook.playerA.trend}
                </div>
                <p className="mt-1 text-secondary">{result.playerOutlook.playerA.restOfGame}</p>
              </div>
              <div className="rounded-lg border border-subtle bg-surface-muted p-2">
                <div className="font-semibold text-secondary">{right.name}</div>
                <div className="text-muted">
                  {result.playerOutlook.playerB.volatility} vol · {result.playerOutlook.playerB.trend}
                </div>
                <p className="mt-1 text-secondary">{result.playerOutlook.playerB.restOfGame}</p>
              </div>
            </div>
            <p className="text-[10px] text-muted">
              OA {result.providers.openai} · DS {result.providers.deepseek} · Grok {result.providers.grok}. {result.dataNotes}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
