'use client'

import { useState } from 'react'
import { Gem, Eye, EyeOff } from 'lucide-react'
import type { SurvivorSummary } from './types'
import { SurvivorIdolPlay } from './SurvivorIdolPlay'

export interface SurvivorIdolsViewProps {
  leagueId: string
  summary: SurvivorSummary
  names: Record<string, string>
}

function formatPowerLabel(value: string): string {
  return value.replace(/_/g, ' ')
}

const IDOL_ART: Record<string, string> = {
  protect_self: 'immunity', vote_shield: 'immunity', extra_vote: 'extra-vote',
  vote_nullifier: 'idol-nullifier', skip_tribal: 'safety-net',
  triple_steal: 'steal-three',
  island_raid: 'steal-three', vote_steal: 'extra-vote',
}

/**
 * Idols / Advantages View: private owned idols, status (hidden, active, used, expired), player-bound mapping, transfer history where authorized, usage eligibility.
 */
export function SurvivorIdolsView({ leagueId, summary }: SurvivorIdolsViewProps) {
  const { myIdols, myRosterId, myActiveEffects = [] } = summary
  const [selectedIdolId, setSelectedIdolId] = useState<string | null>(null)
  const [usedIds, setUsedIds] = useState<string[]>([])

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Gem className="h-5 w-5 text-amber-400" />
          Your idols & advantages
        </h2>
        {!myRosterId ? (
          <p className="text-sm text-white/50">You are not in this league as a manager.</p>
        ) : myIdols.length === 0 ? (
          <p className="text-sm text-white/50">You have no active idols. Idols are hidden until used; transfer history is visible only where authorized.</p>
        ) : (
          <ul className="space-y-3">
            {myIdols.filter(idol => !usedIds.includes(idol.id)).map((idol) => (
              <li
                key={idol.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3"
              >
                <div className="flex items-center gap-2">
                  {IDOL_ART[idol.powerType] ? <img src={`/survivor/idols/${IDOL_ART[idol.powerType]}-icon.svg`} alt="" className="h-10 w-10 object-contain" /> : <Eye className="h-4 w-4 text-amber-400" />}
                  <span className="font-medium text-white">{formatPowerLabel(idol.powerType)}</span>
                </div>
                <span className="text-xs text-white/60">
                  Player: {idol.playerId} · ID: {idol.id.slice(0, 8)}… · Eligible at Elimination Council
                </span>
                {['triple_steal', 'island_raid'].includes(idol.powerType) && <button type="button" onClick={() => setSelectedIdolId(selectedIdolId === idol.id ? null : idol.id)} aria-expanded={selectedIdolId === idol.id} className="rounded-lg border border-amber-400/50 px-3 py-2 text-xs font-bold text-amber-100">{selectedIdolId === idol.id ? 'Close' : 'Play idol'}</button>}
                {selectedIdolId === idol.id && <div className="w-full"><SurvivorIdolPlay leagueId={leagueId} idolId={idol.id} powerType={idol.powerType} onFinished={() => { setUsedIds(ids => [...ids, idol.id]); setSelectedIdolId(null) }} /></div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          Current power effects
        </h2>
        {myActiveEffects.length === 0 ? (
          <p className="text-sm text-white/50">No active Survivor power effects are applied to you this week.</p>
        ) : (
          <ul className="space-y-2">
            {myActiveEffects.map((effect, index) => (
              <li
                key={`${effect.rewardType}-${effect.week}-${index}`}
                className="rounded-lg border border-white/5 px-3 py-2 text-sm text-white/70"
              >
                {formatPowerLabel(effect.rewardType)}
                {effect.appliedMode === 'queued' ? ' (queued)' : effect.appliedMode === 'record_only' ? ' (tracked)' : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-white">
          <EyeOff className="h-5 w-5 text-white/60" />
          Idol status key
        </h2>
        <ul className="space-y-1 text-sm text-white/60">
          <li className="flex items-center gap-2"><span className="rounded bg-white/10 px-1.5">Hidden</span> — Only you see it until played</li>
          <li className="flex items-center gap-2"><span className="rounded bg-emerald-500/20 px-1.5 text-emerald-300">Active</span> — Can be played at Elimination Council</li>
          <li className="flex items-center gap-2"><span className="rounded bg-rose-500/20 px-1.5 text-rose-300">Used</span> — Already played</li>
          <li className="flex items-center gap-2"><span className="rounded bg-white/10 px-1.5 text-white/50">Expired</span> — No longer valid</li>
        </ul>
      </section>
    </div>
  )
}
