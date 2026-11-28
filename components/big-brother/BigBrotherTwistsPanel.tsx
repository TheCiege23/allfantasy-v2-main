'use client'

import { useEffect, useState } from 'react'
import { parseBigBrotherPremiumEngineSpec, type BigBrotherTwistKey } from '@/lib/big-brother/big-brother-premium-engine-spec'

const TWIST_LABELS: Record<BigBrotherTwistKey, string> = {
  double_eviction: 'Double eviction',
  triple_eviction: 'Triple eviction',
  battle_back: 'Battle back',
  secret_hoh: 'Secret HOH',
  americas_vote: 'America’s vote',
  hidden_powers: 'Hidden powers',
  safety_pass: 'Safety pass',
}

export function BigBrotherTwistsPanel({ leagueId }: { leagueId: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enabled, setEnabled] = useState<BigBrotherTwistKey[]>([])
  const [weeks, setWeeks] = useState<number[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/config`, {
          cache: 'no-store',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data.error ?? `Error ${res.status}`)
          return
        }
        const raw = data.config?.premiumEngineSpec
        const spec = parseBigBrotherPremiumEngineSpec(raw)
        if (!cancelled) {
          setEnabled(spec.twists.enabledKeys)
          setWeeks(spec.twists.scheduledTwistWeeks)
        }
      } catch {
        if (!cancelled) setError('Failed to load twists')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId])

  if (loading) {
    return (
      <div className="rounded-2xl border border-[var(--accent-line)] bg-[var(--accent-soft)] p-6 text-sm text-[var(--text2)]">
        Loading twists…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[var(--line2)] bg-[var(--warn-soft)] p-4 text-sm text-[var(--warn)]">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--accent-line)] bg-gradient-to-b from-violet-950/25 to-[#07071a]/90 p-5 shadow-[0_12px_48px_rgba(80,40,120,0.18)]">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">Twists · coming soon</h3>
        {/*
          🛑 THIS SAID "Enabled for this league. Execution is driven by the phase engine…" AND NO TWIST HAS EVER RUN.
          Nothing in lib/big-brother performs a double eviction, battle back, secret HOH, hidden power or safety pass;
          the list was the spec's defaults, written at league creation. Until a twist really runs, the panel says so.
        */}
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          Twists aren’t live yet. Every week plays as a classic week: HOH, nominations, veto and an eviction vote.
        </p>
      </div>
      {enabled.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Twists planned for this league">
          {enabled.map((k) => (
            <li
              key={k}
              className="rounded-full border border-[var(--line)] bg-white/[0.04] px-3 py-1 text-[12px] font-medium text-[var(--muted)]"
            >
              {TWIST_LABELS[k] ?? k} · coming soon
            </li>
          ))}
        </ul>
      ) : null}
      {weeks.length > 0 ? (
        <p className="text-[12px] text-[var(--muted)]">
          Planned twist weeks (not active yet): <span className="text-[var(--text2)]">{weeks.join(', ')}</span>
        </p>
      ) : null}
    </div>
  )
}
