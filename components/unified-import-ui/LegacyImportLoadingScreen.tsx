'use client'

import { HelpCircle, Sparkles } from 'lucide-react'

const STEPS = [
  { id: 'connect', label: 'Connecting to provider' },
  { id: 'leagues', label: 'Loading leagues' },
  { id: 'history', label: 'Importing teams & history' },
  { id: 'stats', label: 'Calculating legacy stats' },
  { id: 'insights', label: 'Generating ranking insights' },
  { id: 'dash', label: 'Preparing dashboard' },
] as const

function activeStepIndex(progress: number): number {
  const p = Math.max(0, Math.min(100, progress))
  const idx = Math.floor((p / 100) * STEPS.length)
  return Math.min(idx, STEPS.length - 1)
}

export type LegacyImportLoadingScreenProps = {
  /** 0–100 from import job */
  progress: number
  platformLabel: string
  /** Optional server message */
  statusMessage?: string | null
  /** Estimated seasons from user selection — informational only */
  seasonSpan?: number | null
}

export function LegacyImportLoadingScreen({
  progress,
  platformLabel,
  statusMessage,
  seasonSpan,
}: LegacyImportLoadingScreenProps) {
  const active = activeStepIndex(progress)

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#040915]/95 px-4 backdrop-blur-md"
      data-testid="legacy-import-loading-screen"
    >
      {/*
        Phase 4.1 visual upgrade — Dashboard V2 language: shared motion tokens
        (`warroom-card` depth + `warroom-fade-in-stagger` entrance + `--dash-ease`
        for progress width transitions), and the color grammar's Predict blue /
        Recommend emerald tones for step states (matches PlatformPulseCard).
      */}
      <div className="warroom-card warroom-fade-in-stagger w-full max-w-lg rounded-3xl border border-white/10 bg-gradient-to-b from-[#0a1228] to-[#070a14] p-6 sm:p-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#ff9ec0]/80">
              Building your legacy
            </p>
            <h2 className="mt-1 text-xl font-bold text-white sm:text-2xl">{platformLabel}</h2>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#ff3d81]/25 bg-[#ff3d81]/10">
            <Sparkles className="h-5 w-5 text-[#ff9ec0]" aria-hidden />
          </div>
        </div>

        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#ff3d81] to-blue-500"
            style={{
              width: `${Math.max(4, progress)}%`,
              transition: 'width var(--dash-dur, 200ms) var(--dash-ease, ease-out)',
            }}
            data-testid="legacy-import-progress-bar"
          />
        </div>
        <p className="mb-6 text-center text-sm font-black tabular-nums text-white/90">{Math.round(progress)}%</p>

        <ul className="space-y-2">
          {STEPS.map((step, i) => {
            const done = i < active
            const current = i === active
            return (
              <li
                key={step.id}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${
                  current
                    ? 'border-blue-500/40 bg-blue-500/10 text-white'
                    : done
                      ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-100/90'
                      : 'border-white/5 bg-white/[0.02] text-white/35'
                }`}
                style={{
                  transition: 'background-color var(--dash-dur, 200ms) var(--dash-ease, ease-out), border-color var(--dash-dur, 200ms) var(--dash-ease, ease-out), color var(--dash-dur, 200ms) var(--dash-ease, ease-out)',
                }}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    done
                      ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30'
                      : current
                        ? 'bg-blue-500/25 text-blue-300 ring-2 ring-blue-400/40 animate-pulse'
                        : 'bg-white/5 text-white/30'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </span>
                <span>{step.label}</span>
              </li>
            )
          })}
        </ul>

        {statusMessage ? (
          <p className="mt-4 text-center text-xs text-white/55">{statusMessage}</p>
        ) : null}

        {seasonSpan != null && seasonSpan > 6 ? (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[12px] text-amber-100/90">
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400/90" />
            <span>
              Multi-season imports can take longer while we sync full history. You can leave this page — progress
              continues on the server.
            </span>
          </div>
        ) : (
          <p className="mt-4 text-center text-[11px] text-white/35">
            Progress updates from your import job — no artificial delays.
          </p>
        )}
      </div>
    </div>
  )
}
