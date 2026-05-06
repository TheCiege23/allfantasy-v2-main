'use client'

import { HelpCircle } from 'lucide-react'

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
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-gradient-to-b from-[#0a1228] to-[#070a14] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)] sm:p-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-400/80">
              Building your legacy
            </p>
            <h2 className="mt-1 text-xl font-bold text-white sm:text-2xl">{platformLabel}</h2>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-500/25 bg-cyan-500/10 text-2xl">
            ✨
          </div>
        </div>

        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-[width] duration-500 ease-out"
            style={{ width: `${Math.max(4, progress)}%` }}
            data-testid="legacy-import-progress-bar"
          />
        </div>
        <p className="mb-6 text-center text-sm font-semibold text-white/90">{Math.round(progress)}%</p>

        <ul className="space-y-2">
          {STEPS.map((step, i) => {
            const done = i < active
            const current = i === active
            return (
              <li
                key={step.id}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                  current
                    ? 'border-cyan-500/40 bg-cyan-500/10 text-white'
                    : done
                      ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-100/90'
                      : 'border-white/5 bg-white/[0.02] text-white/35'
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold">
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
