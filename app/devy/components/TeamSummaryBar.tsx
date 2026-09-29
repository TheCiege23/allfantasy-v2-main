'use client'

import { useState } from 'react'
import { useAfSubGate } from '@/hooks/useAfSubGate'

type Props = {
  leagueId?: string
  rosterId?: string | null
  hasAfSub?: boolean
  activeCount: number
  taxiCount: number
  devyCount: number
  rookiePickCount: number
  devyPickCount: number
  maxDevySlots: number
}

export function TeamSummaryBar({
  leagueId,
  rosterId,
  hasAfSub = false,
  activeCount,
  taxiCount,
  devyCount,
  rookiePickCount,
  devyPickCount,
  maxDevySlots,
}: Props) {
  const [pipeBusy, setPipeBusy] = useState(false)
  const [pipeText, setPipeText] = useState<string | null>(null)
  const [pipeErr, setPipeErr] = useState<string | null>(null)
  const { handleApiResponse } = useAfSubGate('commissioner_devy_scouting')

  const pipeline = devyCount + taxiCount
  const ratio = maxDevySlots > 0 ? Math.min(1, pipeline / maxDevySlots) : 0
  const label = ratio >= 0.66 ? 'Strong' : ratio >= 0.33 ? 'Average' : 'Thin'

  return (
    <div className="border-b border-white/[0.06] bg-[color:var(--devy-panel)] px-4 py-3">
      <div className="scrollbar-none flex gap-2 overflow-x-auto pb-2">
        <Chip emoji="🏈" label="NFL Players" value={activeCount} color="var(--devy-active)" />
        <Chip emoji="🚕" label="Taxi" value={taxiCount} color="var(--devy-taxi)" />
        <Chip emoji="🎓" label="Devy" value={devyCount} color="var(--devy-devy)" />
        <Chip emoji="📋" label="Rookie picks" value={rookiePickCount} color="var(--devy-rookie)" />
        <Chip emoji="🎓" label="Devy picks" value={devyPickCount} color="var(--devy-devy)" />
      </div>
      <div className="mt-2">
        <div className="flex items-center justify-between gap-2 text-[11px] text-white/55">
          <span>
            Pipeline: <span className="font-semibold text-white/80">{pipeline}</span> prospects in system
          </span>
          <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[11px] uppercase tracking-wide text-white/60">
            {label}
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${ratio * 100}%`,
              background: 'linear-gradient(90deg, var(--devy-devy), var(--devy-taxi))',
            }}
          />
        </div>
        {hasAfSub && leagueId && rosterId ? (
          <div className="mt-2 space-y-1">
            <button
              type="button"
              disabled={pipeBusy}
              onClick={async () => {
                setPipeBusy(true)
                setPipeErr(null)
                setPipeText(null)
                try {
                  const res = await fetch('/api/devy/ai', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                      action: 'pipeline_health',
                      leagueId,
                      rosterId,
                    }),
                  })
                  if (!(await handleApiResponse(res))) return
                  if (!res.ok) {
                    const j = (await res.json().catch(() => ({}))) as { error?: string }
                    throw new Error(j.error || `HTTP ${res.status}`)
                  }
                  const data = (await res.json()) as {
                    mode: string
                    pipelineScore: number
                    concerns: string[]
                    recommendations: string[]
                  }
                  setPipeText(
                    [
                      `Mode: ${data.mode} · Pipeline score: ${data.pipelineScore}/100`,
                      data.concerns?.length ? `Concerns: ${data.concerns.join('; ')}` : '',
                      `Tips: ${data.recommendations?.join(' ') ?? '—'}`,
                    ]
                      .filter(Boolean)
                      .join('\n'),
                  )
                } catch (e) {
                  setPipeErr(e instanceof Error ? e.message : 'Failed')
                } finally {
                  setPipeBusy(false)
                }
              }}
              className="w-full rounded-lg border border-cyan-500/30 bg-cyan-500/10 py-2 text-[11px] font-semibold text-cyan-100 min-h-[40px] disabled:opacity-50"
              data-testid="devy-pipeline-ai"
            >
              {pipeBusy ? 'Analyzing pipeline…' : 'AI pipeline health'}
            </button>
            {pipeErr ? <p className="text-[11px] text-amber-200/90">{pipeErr}</p> : null}
            {pipeText ? (
              <p className="text-[11px] leading-snug text-white/55">{pipeText}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Chip({
  emoji,
  label,
  value,
  color,
}: {
  emoji: string
  label: string
  value: number
  color: string
}) {
  return (
    <div
      className="flex min-w-[120px] flex-shrink-0 items-center gap-2 rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2"
      style={{ borderColor: `${color}33` }}
    >
      <span className="text-[16px]">{emoji}</span>
      <div className="min-w-0">
        <p className="truncate text-[11px] uppercase tracking-wide text-white/45">{label}</p>
        <p className="text-[15px] font-bold tabular-nums" style={{ color }}>
          {value}
        </p>
      </div>
    </div>
  )
}
