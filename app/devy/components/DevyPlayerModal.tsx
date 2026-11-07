'use client'

import { useState } from 'react'
import { useAfSubGate } from '@/hooks/useAfSubGate'

export type NflModalPayload = {
  kind: 'nfl'
  name: string
  position: string
  team?: string | null
  taxiEligible?: boolean
  bucketLabel?: string
  scoringLabel?: string
}

export type DevyModalPayload = {
  kind: 'devy'
  playerId: string
  name: string
  position: string
  school?: string | null
  classYear?: string | null
  projectedDeclaration?: string | null
  draftEligible?: string | null
  rightsOwner?: string | null
  acquiredVia?: string | null
  acquiredAt?: string | null
  hasEnteredNfl?: boolean
  nflEntryYear?: number | null
}

export type DevyPlayerModalPayload = NflModalPayload | DevyModalPayload

export function DevyPlayerModal({
  open,
  onClose,
  payload,
  leagueId,
  hasAfSub = false,
}: {
  open: boolean
  onClose: () => void
  payload: DevyPlayerModalPayload | null
  leagueId?: string
  hasAfSub?: boolean
}) {
  const [evalBusy, setEvalBusy] = useState(false)
  const [evalErr, setEvalErr] = useState<string | null>(null)
  const [evalText, setEvalText] = useState<string | null>(null)
  const { handleApiResponse } = useAfSubGate('commissioner_devy_scouting')

  if (!open || !payload) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm md:items-center md:p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-white/[0.08] bg-[#0a1228] p-5 shadow-2xl md:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[16px] font-bold text-white">
            {payload.kind === 'devy' ? 'Devy prospect' : 'NFL player'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/[0.06] px-2 py-1 text-[12px] text-white/60"
            data-testid="devy-player-modal-close"
          >
            Close
          </button>
        </div>

        {payload.kind === 'nfl' ? (
          <div className="mt-4 space-y-3 text-[13px] text-white/80">
            <p className="text-[18px] font-bold text-white">{payload.name}</p>
            <p className="text-white/55">
              {payload.position}
              {payload.team ? ` · ${payload.team}` : ''}
            </p>
            {payload.bucketLabel ? (
              <p>
                <span className="text-white/45">Bucket: </span>
                {payload.bucketLabel}
              </p>
            ) : null}
            {payload.scoringLabel ? (
              <p>
                <span className="text-white/45">Scoring: </span>
                {payload.scoringLabel}
              </p>
            ) : null}
            {payload.taxiEligible ? (
              <span className="inline-flex rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">
                Taxi eligible
              </span>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 space-y-4 text-[13px] text-white/80">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-violet-600/40 px-3 py-1 text-[11px] font-bold uppercase text-violet-100">
                Devy
              </span>
            </div>
            <p className="text-[18px] font-bold text-white">{payload.name}</p>
            <p className="text-white/55">
              {payload.position}
              {payload.school ? ` · ${payload.school}` : ''}
            </p>
            <section className="rounded-xl border border-white/[0.06] bg-black/25 p-3 text-[12px]">
              <p>Class: {payload.classYear ?? '—'}</p>
              <p>Projected declaration: {payload.projectedDeclaration ?? 'Undeclared'}</p>
              <p>NFL draft status: {payload.draftEligible ?? '—'}</p>
              <p>Rights: {payload.rightsOwner ?? 'Your team'}</p>
            </section>
            <section className="rounded-xl border border-white/[0.06] bg-black/25 p-3 text-[12px] text-white/60">
              <p className="font-semibold text-white/80">Rights panel</p>
              <p className="mt-1">Acquired: {payload.acquiredAt ?? '—'} via {payload.acquiredVia ?? '—'}</p>
            </section>
            {hasAfSub && leagueId ? (
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={evalBusy}
                  onClick={async () => {
                    setEvalBusy(true)
                    setEvalErr(null)
                    setEvalText(null)
                    try {
                      const res = await fetch('/api/devy/ai', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                          action: 'prospect_eval',
                          leagueId,
                          playerId: payload.kind === 'devy' ? payload.playerId : '',
                        }),
                      })
                      if (!(await handleApiResponse(res))) return
                      if (!res.ok) {
                        const j = (await res.json().catch(() => ({}))) as { error?: string }
                        throw new Error(j.error || `HTTP ${res.status}`)
                      }
                      const data = (await res.json()) as {
                        ceiling: string
                        timeline: string
                        fit: string
                        grade: string
                        risks: string[]
                        verdict: string
                      }
                      setEvalText(
                        [
                          `Grade: ${data.grade}`,
                          `Ceiling: ${data.ceiling}`,
                          `Timeline: ${data.timeline}`,
                          `Fit: ${data.fit}`,
                          `Risks: ${data.risks?.join('; ') || '—'}`,
                          `Verdict: ${data.verdict}`,
                        ].join('\n\n'),
                      )
                    } catch (e) {
                      setEvalErr(e instanceof Error ? e.message : 'Request failed')
                    } finally {
                      setEvalBusy(false)
                    }
                  }}
                  className="w-full rounded-xl border border-cyan-500/35 bg-cyan-500/10 py-2.5 text-[12px] font-semibold text-cyan-100 min-h-[44px] disabled:opacity-50"
                  data-testid="devy-ai-evaluate-prospect"
                >
                  {evalBusy ? 'Analyzing…' : 'AI evaluation (Chimmy)'}
                </button>
                {evalErr ? <p className="text-[11px] text-amber-200/90">{evalErr}</p> : null}
                {evalText ? (
                  <pre className="whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-black/30 p-3 text-[11px] text-white/75">
                    {evalText}
                  </pre>
                ) : null}
              </div>
            ) : (
              <p className="text-[11px] text-white/35">AI prospect evaluation requires AF Commissioner.</p>
            )}
            {payload.hasEnteredNfl ? (
              <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-[12px]">
                <p className="font-semibold text-emerald-100">Entered NFL {payload.nflEntryYear ?? ''}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-white/[0.1] px-3 py-2 text-[11px] font-semibold text-white/80 min-h-[44px]"
                  >
                    Move to taxi
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-[11px] font-semibold text-cyan-100 min-h-[44px]"
                  >
                    Move to active
                  </button>
                </div>
              </section>
            ) : null}
            <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
              <span className="text-[11px] text-white/40">Trade rights · Drop · History (coming soon)</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
