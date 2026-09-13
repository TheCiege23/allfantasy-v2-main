'use client'

import { useState, useCallback } from 'react'
import { Sparkles, Loader2, AlertCircle } from 'lucide-react'
import type { ZombieSummary } from './types'
import { FeatureGate } from '@/components/subscription/FeatureGate'
import { useAfSubGate } from '@/hooks/useAfSubGate'

/** League Zombie AI types — must match API VALID_TYPES. */
type ZombieAIType =
  | 'survival_strategy'
  | 'zombie_strategy'
  | 'whisperer_strategy'
  | 'serum_timing_advice'
  | 'weapon_timing_advice'
  | 'ambush_planning_advice'
  | 'stay_alive_framing'
  | 'lineup_zombie_context'
  | 'weekly_zombie_recap'
  | 'most_at_risk'
  | 'chompin_block_explanation'
  | 'serum_weapon_holders_commentary'
  | 'whisperer_pressure_summary'
  | 'commissioner_review_summary'

const TYPE_LABELS: Record<ZombieAIType, string> = {
  survival_strategy: 'Survival strategy',
  zombie_strategy: 'Zombie swarm strategy',
  whisperer_strategy: 'Whisperer strategy',
  serum_timing_advice: 'Serum timing advice',
  weapon_timing_advice: 'Weapon timing advice',
  ambush_planning_advice: 'Ambush planning',
  stay_alive_framing: 'Stay alive vs risk zombie',
  lineup_zombie_context: 'Lineup zombie context',
  weekly_zombie_recap: 'Weekly zombie recap',
  most_at_risk: 'Most at risk',
  chompin_block_explanation: "On the Chompin' Block",
  serum_weapon_holders_commentary: 'Serum/weapon holders',
  whisperer_pressure_summary: 'Whisperer pressure',
  commissioner_review_summary: 'Commissioner review summary',
}

interface DeterministicSnapshot {
  whispererRosterId: string | null
  whispererHidden: boolean
  survivors: string[]
  zombies: string[]
  movementWatch: { rosterId: string; reason: string }[]
  myRosterId: string | null
  myResources: { serums: number; weapons: number; ambush: number }
  chompinBlockCandidates: string[]
  rosterDisplayNames: Record<string, string>
  collusionFlags?: { rosterIdA: string; rosterIdB: string; flagType: string }[]
  dangerousDropFlags?: { rosterId: string; playerId: string; estimatedValue: number; threshold: number }[]
}

export interface ZombieAIPanelProps {
  leagueId: string
  summary: ZombieSummary
  displayNames: Record<string, string>
}

function nameOrId(displayNames: Record<string, string>, id: string) {
  return displayNames[id] ?? id
}

export function ZombieAIPanel({ leagueId, summary }: ZombieAIPanelProps) {
  const [type, setType] = useState<ZombieAIType>('survival_strategy')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [deterministic, setDeterministic] = useState<DeterministicSnapshot | null>(null)
  const { handleApiResponse } = useAfSubGate('commissioner_ai_tools')

  const runAI = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    setDeterministic(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/zombie/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      if (!(await handleApiResponse(res))) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error ?? `Error ${res.status}`)
        return
      }
      const det = data.deterministic
      if (det) {
        setDeterministic({
          whispererRosterId: det.whispererRosterId ?? null,
          whispererHidden: det.whispererHidden === true,
          survivors: Array.isArray(det.survivors) ? det.survivors : [],
          zombies: Array.isArray(det.zombies) ? det.zombies : [],
          movementWatch: Array.isArray(det.movementWatch) ? det.movementWatch : [],
          myRosterId: det.myRosterId ?? null,
          myResources: det.myResources ?? { serums: 0, weapons: 0, ambush: 0 },
          chompinBlockCandidates: Array.isArray(det.chompinBlockCandidates) ? det.chompinBlockCandidates : [],
          rosterDisplayNames: det.rosterDisplayNames ?? {},
          collusionFlags: det.collusionFlags,
          dangerousDropFlags: det.dangerousDropFlags,
        })
      }
      setResult(typeof data.narrative === 'string' ? data.narrative : JSON.stringify(data))
    } catch {
      setError('Request failed')
    } finally {
      setLoading(false)
    }
  }, [handleApiResponse, leagueId, type])

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-cyan-500/30 bg-cyan-950/10 p-4 sm:p-6">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-cyan-200">
          <Sparkles className="h-5 w-5" />
          AI Zombie Tools
        </h2>
        <p className="mb-4 text-sm text-white/70">
          Get strategy and advice. Requires zombie AI entitlement.
        </p>

        <FeatureGate featureId="zombie_ai" featureNameOverride="Zombie AI" className="mb-3">
          <>
            <div className="mb-4">
              <label className="mb-2 block text-xs text-white/50">Topic</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ZombieAIType)}
                className="w-full rounded-xl border border-white/20 bg-white/5 py-2 pl-3 pr-8 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              >
                {(Object.keys(TYPE_LABELS) as ZombieAIType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => void runAI()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-4 py-2.5 text-sm font-medium text-cyan-200 hover:bg-cyan-950/50 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate
            </button>
          </>
        </FeatureGate>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-950/20 p-3 text-sm text-rose-200">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {deterministic && (
          <div className="mt-4 rounded-xl border border-white/20 bg-white/5 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">Deterministic data (rules-driven)</h3>
            <ul className="space-y-1 text-sm text-white/80">
              <li>Whisperer: {deterministic.whispererHidden ? 'Identity classified' : deterministic.whispererRosterId ? nameOrId(deterministic.rosterDisplayNames, deterministic.whispererRosterId) : 'None'}</li>
              <li>Survivors: {deterministic.survivors.length ? deterministic.survivors.map((id) => nameOrId(deterministic.rosterDisplayNames, id)).join(', ') : 'None'}</li>
              <li>Zombies: {deterministic.zombies.length ? deterministic.zombies.map((id) => nameOrId(deterministic.rosterDisplayNames, id)).join(', ') : 'None'}</li>
              <li>My resources: {deterministic.myResources.serums} serums, {deterministic.myResources.weapons} weapons, {deterministic.myResources.ambush} ambush</li>
              {deterministic.chompinBlockCandidates.length > 0 && (
                <li>Chompin&apos; Block: {deterministic.chompinBlockCandidates.map((id) => nameOrId(deterministic.rosterDisplayNames, id)).join(', ')}</li>
              )}
              {deterministic.movementWatch.length > 0 && (
                <li>Movement watch: {deterministic.movementWatch.map((m) => `${nameOrId(deterministic.rosterDisplayNames, m.rosterId)} (${m.reason})`).join('; ')}</li>
              )}
              {deterministic.collusionFlags?.length ? (
                <li>Collusion flags: {deterministic.collusionFlags.length} (review in commissioner summary)</li>
              ) : null}
              {deterministic.dangerousDropFlags?.length ? (
                <li>Dangerous drop flags: {deterministic.dangerousDropFlags.length}</li>
              ) : null}
            </ul>
          </div>
        )}

        {result && (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">AI narrative</h3>
            <p className="whitespace-pre-wrap text-sm text-white/80">{result}</p>
          </div>
        )}
      </section>
    </div>
  )
}
