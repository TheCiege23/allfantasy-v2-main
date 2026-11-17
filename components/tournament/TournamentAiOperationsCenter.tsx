'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bot, Shield, Zap } from 'lucide-react'
import { WarRoomPanel } from '@/components/tournament/TournamentWarRoomPrimitives'
import { PremiumFeatureLock } from '@/components/tournament/PremiumFeatureLock'
import type { AiAutomationV1State } from '@/lib/tournament/ai-automation-hub'
import { hasAfCommissionerTier } from '@/lib/tournament/resolve-af-plan-from-subscription'
import type { AfPlanId } from '@/lib/tournament/af-premium-plans'

const ROWS: { id: keyof AiAutomationV1State; label: string; hint: string; icon: typeof Bot }[] = [
  { id: 'balance', label: 'Auto-balance league fills', hint: 'Keep feeder sizes even as users join.', icon: Zap },
  { id: 'standings', label: 'Auto-calculate universal standings', hint: 'W–L first, points for second.', icon: Bot },
  { id: 'transitions', label: 'Auto-post phase transitions', hint: 'Pinned hub + optional league echoes.', icon: Zap },
  { id: 'fairness', label: 'Fairness recommendations', hint: 'Flags unusual patterns for review.', icon: Shield },
  { id: 'collusion', label: 'Anti-collusion monitoring', hint: 'Heuristic signals — commissioner review.', icon: Shield },
  { id: 'tank', label: 'Anti-tanking alerts', hint: 'Lineup / motivation heuristics by sport.', icon: Shield },
]

export function TournamentAiOperationsCenter({
  tournamentId,
  canEdit,
  afPlan,
  initialAutomation,
  onSaved,
}: {
  tournamentId: string
  canEdit: boolean
  afPlan: AfPlanId | null
  initialAutomation: AiAutomationV1State
  onSaved?: () => void
}) {
  const [local, setLocal] = useState<AiAutomationV1State>(initialAutomation)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setLocal(initialAutomation)
  }, [initialAutomation])

  const persist = useCallback(
    async (next: AiAutomationV1State) => {
      setSaveError(null)
      setSavingKey('all')
      try {
        const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/legacy-settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hubSettings: { aiAutomationV1: next } }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setSaveError(typeof j.error === 'string' ? j.error : 'Could not save automation settings')
          return
        }
        onSaved?.()
      } catch {
        setSaveError('Network error while saving')
      } finally {
        setSavingKey(null)
      }
    },
    [onSaved, tournamentId],
  )

  const showCommissionerLock = !hasAfCommissionerTier(afPlan)

  return (
    <div className="space-y-6">
      <WarRoomPanel
        title="AI operations center"
        subtitle="Turn on the automations you want running across the tournament. Changes save to the tournament settings."
      >
        {showCommissionerLock ? (
          <div className="mb-4">
            <PremiumFeatureLock requiredPlan="af_commissioner" featureLabel="Commissioner automation suite" />
          </div>
        ) : null}
        {saveError ? (
          <p className="mb-3 text-sm text-rose-300/95" role="alert">
            {saveError}
          </p>
        ) : null}
        <ul className="space-y-2">
          {ROWS.map((r) => {
            const Icon = r.icon
            const on = Boolean(local[r.id])
            const disabled = !canEdit || savingKey !== null || showCommissionerLock
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/25 px-4 py-3"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-200/90 ring-1 ring-cyan-400/20">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="font-semibold text-white/90">{r.label}</p>
                    <p className="text-xs text-white/45">{r.hint}</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  role="switch"
                  aria-checked={on}
                  onClick={() => {
                    if (disabled) return
                    const next = { ...local, [r.id]: !on }
                    setLocal(next)
                    void persist(next)
                  }}
                  className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${
                    on ? 'bg-cyan-500/40' : 'bg-white/10'
                  } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <span
                    className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                      on ? 'translate-x-6' : ''
                    }`}
                  />
                </button>
              </li>
            )
          })}
        </ul>
        <p className="mt-4 text-xs text-white/40">
          Operations console in <strong className="text-white/60">Leagues</strong> runs invites, announcements, and
          round tools. This panel persists commissioner automation preferences for this tournament hub.
        </p>
      </WarRoomPanel>
    </div>
  )
}
