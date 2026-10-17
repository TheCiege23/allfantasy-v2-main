'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Users, Trophy } from 'lucide-react'
import type { SurvivorSummary } from './types'

export interface SurvivorTribeBoardProps {
  leagueId: string
  summary: SurvivorSummary
  names: Record<string, string>
  onRefresh?: () => Promise<void>
}

/**
 * Tribe Board: tribe members, names/logos, leader, tribe score, immunity status, active challenge status.
 */
export function SurvivorTribeBoard({ leagueId, summary, names, onRefresh }: SurvivorTribeBoardProps) {
  const [responding, setResponding] = useState(false)
  const [sitOutError, setSitOutError] = useState<string | null>(null)
  const { tribes, council, challenges, currentWeek } = summary
  const sitOuts = summary.sitOuts
  const myNomination = sitOuts?.myPendingResponse?.sitOutId

  async function answerSitOut(decision: 'yes' | 'no') {
    if (!myNomination || responding) return
    setResponding(true)
    setSitOutError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/sit-outs/${encodeURIComponent(myNomination)}/respond`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'The sit-out response could not be saved.')
      await onRefresh?.()
    } catch (error) {
      setSitOutError(error instanceof Error ? error.message : 'The sit-out response could not be saved.')
    } finally {
      setResponding(false)
    }
  }
  const attendingTribeId = council?.attendingTribeId ?? null
  const activeChallenges = challenges.filter((challenge) => !challenge.resultJson)
  const weekResults = challenges.filter((challenge) => challenge.week === currentWeek && challenge.resultJson)

  const tribeImmunity = new Set<string>()
  const rosterImmunity = new Set<string>()
  const tribeBonuses = new Map<string, string[]>()

  for (const challenge of weekResults) {
    const result =
      challenge.resultJson && typeof challenge.resultJson === 'object' && !Array.isArray(challenge.resultJson)
        ? (challenge.resultJson as Record<string, unknown>)
        : null
    if (!result) continue

    if (typeof result.winnerTribeId === 'string' && result.winnerTribeId) {
      tribeImmunity.add(result.winnerTribeId)
    }
    if (typeof result.winnerRosterId === 'string' && result.winnerRosterId) {
      rosterImmunity.add(result.winnerRosterId)
    }

    if (Array.isArray(result.rewards)) {
      for (const reward of result.rewards) {
        if (!reward || typeof reward !== 'object' || Array.isArray(reward)) continue
        const rewardRecord = reward as Record<string, unknown>
        const rewardType = String(rewardRecord.type ?? rewardRecord.rewardType ?? '').trim()
        if ((rewardType === 'tribe_immunity' || rewardType === 'immunity') && typeof rewardRecord.tribeId === 'string') {
          tribeImmunity.add(rewardRecord.tribeId)
        }
        if (rewardType === 'immunity' && typeof rewardRecord.rosterId === 'string') {
          rosterImmunity.add(rewardRecord.rosterId)
        }
        if ((rewardType === 'score_boost' || rewardType === 'bonus') && typeof rewardRecord.tribeId === 'string') {
          const current = tribeBonuses.get(rewardRecord.tribeId) ?? []
          current.push(String(rewardRecord.label ?? rewardRecord.amount ?? 'Score bonus'))
          tribeBonuses.set(rewardRecord.tribeId, current)
        }
      }
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Users className="h-5 w-5 text-amber-400" />
          Tribe overview
        </h2>
        <p className="mb-4 text-sm text-white/50">Week {currentWeek}</p>
        {!summary.merged && summary.tribeBalance && tribes.some(tribe => (summary.tribeBalance?.requiredSitOuts[tribe.id] ?? 0) > 0) && (
          <div className="mb-4 rounded-xl border border-cyan-500/25 bg-cyan-950/20 p-3 text-sm text-cyan-100">
            <p className="font-semibold">Balance this week’s tribe totals</p>
            <p className="mt-1 text-cyan-100/75">Each tribe counts the same number of managers. Sit-outs still earn individual points, play individual challenges, and vote. No manager can sit out in consecutive weeks. Name a nominee in your tribe huddle with <strong>@Chimmy sit out [manager name]</strong>; Chimmy fills open spots at the first NBA tipoff.</p>
            {myNomination && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span>Your tribe nominated you to sit out of its total.</span>
                <button type="button" disabled={responding} onClick={() => void answerSitOut('yes')} className="rounded-lg border border-cyan-400/50 px-3 py-1.5 disabled:opacity-50">Accept</button>
                <button type="button" disabled={responding} onClick={() => void answerSitOut('no')} className="rounded-lg border border-white/20 px-3 py-1.5 disabled:opacity-50">Decline</button>
              </div>
            )}
            {sitOutError && <p role="alert" className="mt-2 text-amber-200">{sitOutError}</p>}
            {summary.myTribeSource && <Link href={`/league/${leagueId}?tab=Chat&source=${encodeURIComponent(summary.myTribeSource)}`} className="mt-2 inline-block text-cyan-300 underline">Open tribe huddle</Link>}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tribes.map((tribe) => {
            const hasImmunity = tribeImmunity.has(tribe.id)
            const isAttending = tribe.id === attendingTribeId
            const bonuses = tribeBonuses.get(tribe.id) ?? []
            const required = summary.tribeBalance?.requiredSitOuts[tribe.id] ?? 0
            const accepted = sitOuts?.accepted.filter(row => row.targetTribeId === tribe.id).length ?? 0
            return (
              <div
                key={tribe.id}
                className={`rounded-xl border p-4 ${
                  isAttending
                    ? 'border-amber-500/40 bg-amber-950/20'
                    : 'border-white/10 bg-black/20'
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 font-semibold text-white">{tribe.logoUrl && <img src={tribe.logoUrl} alt="" width={64} height={64} className="h-16 w-16 object-contain" />}{tribe.name}</h3>
                  {hasImmunity && (
                    <span className="flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs text-emerald-300">
                      <img src="/survivor/weekly/immunity-necklace-icon.svg" alt="" className="h-5 w-5 object-contain" /> Immunity
                    </span>
                  )}
                  {isAttending && (
                    <span className="text-xs text-amber-300">Attending Elimination Council</span>
                  )}
                </div>
                <ul className="space-y-1">
                  {tribe.members.map((member) => (
                    <li
                      key={member.rosterId}
                      className="flex items-center gap-2 text-sm text-white/80"
                    >
                      {member.isLeader && <Trophy className="h-3.5 w-3.5 text-amber-400" />}
                      {rosterImmunity.has(member.rosterId) && <img src="/survivor/weekly/immunity-necklace-icon.svg" alt="Immunity" className="h-5 w-5 object-contain" />}
                      {names[member.rosterId] ?? member.rosterId}
                    </li>
                  ))}
                </ul>
                {required > 0 && <p className="mt-2 text-xs text-cyan-200">Sit-outs: {accepted} of {required} confirmed. Chimmy selects the rest at first tipoff.</p>}
                <p className="mt-2 text-xs text-white/50">
                  Tribe score: {summary.tribeScores?.[tribe.id] != null ? `${summary.tribeScores[tribe.id].toFixed(1)}${summary.scoresFinalized ? ' final' : ' provisional'}` : 'No score yet'}{bonuses.length > 0 ? ` · Bonus: ${bonuses.join(', ')}` : ''}
                </p>
              </div>
            )
          })}
        </div>
      </section>

      {activeChallenges.length > 0 && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
          <h2 className="mb-2 text-lg font-semibold text-white">Active challenge status</h2>
          <p className="mb-3 text-sm text-white/50">
            {activeChallenges.length} challenge(s) open this week. Go to Challenge Center to submit.
          </p>
          <ul className="space-y-1 text-sm text-white/70">
            {activeChallenges.map((challenge) => (
              <li key={challenge.id}>
                {challenge.challengeType} · {challenge.submissionCount} submission(s)
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
