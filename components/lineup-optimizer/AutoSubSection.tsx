'use client'

import {
  Lock,
  RefreshCw,
  Clock,
  HeartHandshake,
  AlertTriangle,
  Sparkles,
  ShieldCheck,
  Radio,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DecisionEngineJson } from './types'

export function AutoSubSection({
  engine,
  enabled,
  onEnabledChange,
  lineupLocked,
  /** Per playerId: true = game in progress / lineup locked for that player */
  starterLockByPlayerId,
  /** Names of starters we’re monitoring (Q/Doubtful or high volatility) — “Protected” badge */
  riskyStarterNames,
  /** All starters for lock strip (ids from optimizer result) */
  starterRows,
}: {
  engine: DecisionEngineJson | null
  enabled: boolean
  onEnabledChange: (v: boolean) => void
  lineupLocked?: boolean
  starterLockByPlayerId?: Record<string, boolean>
  riskyStarterNames?: string[]
  starterRows?: Array<{ playerId: string; playerName: string; slotCode: string }>
}) {
  const preview = engine?.autoSubPreview ?? []
  const blocked = engine?.autoSubBlocked ?? []
  const rules = engine?.autoSubRules
  const riskySet = new Set(riskyStarterNames ?? [])
  const lockMap = starterLockByPlayerId ?? {}

  return (
    <section
      className="rounded-2xl border border-emerald-400/15 bg-gradient-to-b from-emerald-500/[0.07] to-[#0a1228]/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      data-testid="lineup-optimizer-auto-sub"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-100">
            <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden />
            Injury safety net
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-emerald-100/75">
            Transparent rules — we never “upgrade” a healthy starter. Swaps only when a starter is officially unable to
            score.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle injury auto-substitution"
          disabled={lineupLocked}
          onClick={() => onEnabledChange(!enabled)}
          className={cn(
            'relative h-8 w-14 shrink-0 rounded-full border transition-colors',
            enabled ? 'border-emerald-400/50 bg-emerald-500/30' : 'border-white/15 bg-black/30',
            lineupLocked && 'cursor-not-allowed opacity-50'
          )}
          data-testid="lineup-optimizer-auto-sub-toggle"
        >
          <span
            className={cn(
              'absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform',
              enabled ? 'left-7' : 'left-1'
            )}
          />
        </button>
      </div>

      {/* Timeline — trust / not a black box */}
      <div className="mt-4 grid gap-2 rounded-xl border border-white/10 bg-black/25 p-3 sm:grid-cols-2">
        <div className="flex gap-2 text-xs text-white/75">
          <Radio className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300/90" aria-hidden />
          <div>
            <p className="font-medium text-cyan-100/90">Will monitor until game time</p>
            <p className="mt-0.5 text-[11px] text-white/50">
              Status checks stay active up to your league’s lock — we do not “guess” early swaps.
            </p>
          </div>
        </div>
        <div className="flex gap-2 text-xs text-white/75">
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300/90" aria-hidden />
          <div>
            <p className="font-medium text-emerald-100/90">Will auto-swap if OUT is confirmed</p>
            <p className="mt-0.5 text-[11px] text-white/50">
              Only inactive / zero-participation signals trigger a bench move — not projection or “gut” calls.
            </p>
          </div>
        </div>
      </div>

      <ul className="mt-3 space-y-1 text-[11px] text-emerald-100/65">
        {(rules?.notes ?? ['Only OUT / inactive triggers', 'Respects roster legality & slot rules']).map((n, i) => (
          <li key={i}>• {n}</li>
        ))}
      </ul>

      {/* Starter lock + protected strip */}
      {starterRows && starterRows.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/45">Starter lock status</p>
          <ul className="flex flex-col gap-1.5">
            {starterRows.map((s) => {
              const locked = Boolean(lockMap[s.playerId])
              const risky = riskySet.has(s.playerName)
              return (
                <li
                  key={s.playerId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-1.5 text-xs"
                >
                  <span className="font-medium text-white/85">
                    <span className="text-white/45">{s.slotCode}</span> · {s.playerName}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {risky && enabled ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium text-cyan-100">
                        <HeartHandshake className="h-3 w-3" aria-hidden />
                        Protected by Auto-Sub
                      </span>
                    ) : null}
                    {locked ? (
                      <span className="inline-flex items-center gap-1 text-amber-200/90" title="Game started or slot locked">
                        <Lock className="h-3.5 w-3.5" aria-hidden />
                        Started / locked
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-white/45" title="Not locked yet">
                        <Clock className="h-3.5 w-3.5" aria-hidden />
                        Upcoming
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {lineupLocked ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white/55">
          <Lock className="h-3.5 w-3.5" aria-hidden />
          Full lineup locked — auto-sub cannot run.
        </div>
      ) : null}

      {/* Blocked: no replacement */}
      {blocked.length > 0 ? (
        <div className="mt-4 space-y-2" data-testid="lineup-optimizer-auto-sub-blocked">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-200/90">No replacement available</p>
          {blocked.map((b, i) => (
            <div
              key={`${b.starterName}-${i}`}
              className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-50"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
              <div>
                <p className="font-medium text-white">
                  {b.starterName}{' '}
                  <span className="text-white/50">
                    ({b.slotCode}) — {b.status}
                  </span>
                </p>
                <p className="mt-1 text-xs text-amber-100/80">{b.reason}: add an eligible bench player or adjust slots.</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Preview swaps */}
      {preview.length > 0 ? (
        <div className="mt-4 space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/45">If inactive at lock — planned swap</p>
          {preview.map((p, i) => (
            <div
              key={`${p.starterToReplace}-${i}`}
              className="flex flex-col gap-2 rounded-xl border border-white/12 bg-[#0a1228]/95 p-3 text-sm shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-white/50">
                  {p.slotCode}
                </span>
                <span className="text-[11px] tabular-nums text-cyan-200/90">
                  Swap confidence{' '}
                  <span className="font-semibold text-cyan-100">{Math.min(100, Math.max(0, p.confidence))}%</span>
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-valuenow={Math.min(100, Math.max(0, p.confidence))}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Swap confidence ${p.confidence} percent`}
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500/80 to-emerald-400/70 transition-[width]"
                  style={{ width: `${Math.min(100, Math.max(0, p.confidence))}%` }}
                />
              </div>
              <div className="flex items-center gap-2 text-white/85">
                <RefreshCw className="h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden />
                <span className="font-medium text-white">{p.starterToReplace}</span>
                <span className="text-white/40">({p.ifStarterStatus})</span>
              </div>
              <div className="pl-6 text-cyan-100/90">
                → <span className="font-medium">{p.replacementPlayer}</span>
                {p.samePositionReplacement ? (
                  <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-200">
                    Same position
                  </span>
                ) : (
                  <span className="ml-2 rounded bg-slate-500/15 px-1.5 py-0.5 text-[11px] text-slate-200">
                    Best legal slot
                  </span>
                )}
              </div>
              {p.usedPreferenceTieBreaker ? (
                <div className="flex items-center gap-2 rounded-lg border border-violet-400/25 bg-violet-500/10 px-2 py-1.5 text-[11px] text-violet-100">
                  <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    Your saved preferences influenced this replacement in a <strong>close call</strong> between similar
                    projections.
                  </span>
                </div>
              ) : (
                <p className="text-[11px] text-white/45">Objective edge selected replacement — preferences not needed.</p>
              )}
              <p className="text-xs text-white/50">{p.replacementReason}</p>
            </div>
          ))}
        </div>
      ) : blocked.length === 0 ? (
        <p className="mt-3 text-xs text-white/45">
          No inactive starters in the current projection — no emergency swap queued. Monitoring stays on until game time.
        </p>
      ) : null}
    </section>
  )
}
