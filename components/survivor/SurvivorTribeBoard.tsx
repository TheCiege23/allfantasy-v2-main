'use client'

import { Users, Shield, Trophy } from 'lucide-react'
import type { SurvivorSummary } from './types'

export interface SurvivorTribeBoardProps {
  leagueId: string
  summary: SurvivorSummary
  names: Record<string, string>
}

/**
 * Tribe Board: tribe members, names/logos, leader, tribe score, immunity status, active challenge status.
 */
export function SurvivorTribeBoard({ summary, names }: SurvivorTribeBoardProps) {
  const { tribes, council, challenges, currentWeek } = summary
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tribes.map((tribe) => {
            const hasImmunity = tribeImmunity.has(tribe.id)
            const isAttending = tribe.id === attendingTribeId
            const bonuses = tribeBonuses.get(tribe.id) ?? []
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
                      <Shield className="h-3 w-3" /> Immunity
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
                      {rosterImmunity.has(member.rosterId) && <Shield className="h-3.5 w-3.5 text-emerald-400" />}
                      {names[member.rosterId] ?? member.rosterId}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-white/50">
                  Tribe score: —{bonuses.length > 0 ? ` · Bonus: ${bonuses.join(', ')}` : ''}
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
