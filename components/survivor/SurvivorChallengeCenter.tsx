'use client'

import { Lock, Unlock, Trophy, History } from 'lucide-react'
import { getMinigameDef } from '@/lib/survivor/SurvivorMiniGameRegistry'
import type { SurvivorSummary, SurvivorSummaryChallenge } from './types'
import { useUserTimezone } from '@/hooks/useUserTimezone'

export interface SurvivorChallengeCenterProps {
  leagueId: string
  summary: SurvivorSummary
  names: Record<string, string>
}

function getChallengeDetails(challenge: SurvivorSummaryChallenge, names: Record<string, string>, tribeNames: Record<string, string>) {
  if (challenge.submissionMode === 'automatic') {
    const winnerLabel = challenge.scope === 'tribe'
      ? challenge.winnerTribeId ? `Winning tribe: ${tribeNames[challenge.winnerTribeId] ?? 'Tribe'}` : 'Awaiting verified scores'
      : challenge.winnerUserNames?.length ? `Winner: ${challenge.winnerUserNames.join(', ')}` : 'Awaiting verified scores'
    return { scopeLabel: 'Scores automatically from finalized lineups', rewardLabel: 'Weekly slate result', winnerLabel }
  }
  const definition = getMinigameDef(challenge.challengeType as any)
  const config =
    challenge.configJson && typeof challenge.configJson === 'object' && !Array.isArray(challenge.configJson)
      ? (challenge.configJson as Record<string, unknown>)
      : null
  const result =
    challenge.resultJson && typeof challenge.resultJson === 'object' && !Array.isArray(challenge.resultJson)
      ? (challenge.resultJson as Record<string, unknown>)
      : null

  const scopeLabel =
    definition?.submissionScope === 'tribe'
      ? 'Tribe submission'
      : definition?.submissionScope === 'both'
        ? 'Roster or tribe submission'
        : 'Roster submission'

  const rewardLabel =
    Array.isArray(result?.appliedRewards)
      ? result.appliedRewards
          .map((reward) => {
            if (reward && typeof reward === 'object' && !Array.isArray(reward)) {
              const json = reward as Record<string, unknown>
              const rewardType = typeof json.rewardType === 'string' ? json.rewardType : 'reward'
              const appliedMode = typeof json.appliedMode === 'string' ? json.appliedMode : 'full'
              return appliedMode === 'record_only' ? `${rewardType} (tracked)` : rewardType
            }
            return String(reward)
          })
          .join(', ')
      : typeof config?.rewardType === 'string'
        ? config.rewardType
        : Array.isArray(config?.rewards)
          ? config.rewards.map((reward) => String(reward)).join(', ')
          : definition?.rewardTypes.join(', ') ?? 'No reward configured'

  const winnerLabel =
    typeof result?.winnerRosterId === 'string'
      ? `Winner: ${names[result.winnerRosterId] ?? result.winnerRosterId}`
      : typeof result?.winnerTribeId === 'string'
        ? `Winning tribe: ${result.winnerTribeId}`
        : 'Resolved'

  return { scopeLabel, rewardLabel, winnerLabel }
}

/**
 * Challenge Center: active mini-game, submission windows, locked state, tribe result history, reward/advantage outputs.
 */
export function SurvivorChallengeCenter({ summary, names }: SurvivorChallengeCenterProps) {
  const { formatInTimezone } = useUserTimezone()
  const { challenges, currentWeek } = summary
  const tribeNames = Object.fromEntries(summary.tribes.map(tribe => [tribe.id, tribe.name]))
  const weekChallenges = challenges.filter((challenge) => challenge.week === currentWeek)
  const locked = weekChallenges.filter((challenge) => challenge.lockAt && new Date(challenge.lockAt) < new Date())
  const open = weekChallenges.filter((challenge) => !challenge.resultJson && (!challenge.lockAt || new Date(challenge.lockAt) >= new Date()))
  const completed = challenges.filter((challenge) => challenge.resultJson)

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Trophy className="h-5 w-5 text-amber-400" />
          Active challenges · Week {currentWeek}
        </h2>
        {open.length === 0 && locked.length === 0 ? (
          <p className="text-sm text-white/50">No challenges this week yet.</p>
        ) : (
          <div className="space-y-3">
            {open.map((challenge) => {
              const details = getChallengeDetails(challenge, names, tribeNames)
              return (
                <div
                  key={challenge.id}
                  className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Unlock className="h-4 w-4 text-emerald-400" />
                      <span className="font-medium text-white">{challenge.title || challenge.challengeType}</span>
                    </div>
                    <span className="text-xs text-white/60">
                      {challenge.submissionMode === 'automatic' ? 'Settles after all fantasy scores are final' : `Submissions: ${challenge.submissionCount} · Lock: ${challenge.lockAt ? formatInTimezone(challenge.lockAt) : '—'}`}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-white/60">
                    {details.scopeLabel} · Reward: {details.rewardLabel}
                  </div>
                </div>
              )
            })}
            {locked.map((challenge) => {
              const details = getChallengeDetails(challenge, names, tribeNames)
              return (
                <div
                  key={challenge.id}
                  className="rounded-xl border border-white/10 bg-black/20 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Lock className="h-4 w-4 text-white/50" />
                      <span className="font-medium text-white/80">{challenge.title || challenge.challengeType}</span>
                    </div>
                    <span className="text-xs text-white/50">{challenge.submissionMode === 'automatic' ? 'Awaiting verified scores' : `Locked · ${challenge.submissionCount} submission(s)`}</span>
                  </div>
                  <div className="mt-2 text-xs text-white/50">
                    {details.scopeLabel} · Reward: {details.rewardLabel}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <History className="h-5 w-5 text-white/60" />
          Challenge result history
        </h2>
        {completed.length === 0 ? (
          <p className="text-sm text-white/50">No completed challenges yet.</p>
        ) : (
          <ul className="space-y-2">
            {completed.slice(0, 20).map((challenge) => {
              const details = getChallengeDetails(challenge, names, tribeNames)
              return (
                <li
                  key={challenge.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 px-3 py-2 text-sm"
                >
                  <span className="text-white/80">Week {challenge.week} · {challenge.title || challenge.challengeType}</span>
                  <span className="text-white/50">{details.winnerLabel}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
