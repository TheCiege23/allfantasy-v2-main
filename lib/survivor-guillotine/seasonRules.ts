import type { SGChallenge, SGConfig, SGSelectionStage, SGTeam } from './types'

/** Public challenges are distinct from the concealed random reward calendar. */
export function resolveSGChallenge(challenge: SGChallenge, teams: SGTeam[],
  matchups: { team1: string; team2: string }[], tieWinnerId?: string) {
  if (!teams.length || teams.some(t => !Number.isFinite(t.points))) throw new Error('Final challenge scores are required.')
  if (challenge.kind === 'highest_score_idol' || challenge.kind === 'highest_score_swap') {
    const ranked = [...teams].sort((a, b) => b.points - a.points ||
      (a.previousPoints !== null && b.previousPoints !== null ? b.previousPoints - a.previousPoints : 0))
    let [a, b] = ranked
    if (b && a.points === b.points && (a.previousPoints === null || b.previousPoints === null || a.previousPoints === b.previousPoints)) {
      const tied = ranked.filter(t => t.points === a.points && (a.previousPoints === null || t.previousPoints === null || t.previousPoints === a.previousPoints))
      const selected = tied.find(t => t.id === tieWinnerId)
      if (!selected) throw new Error('Reward challenge tie requires commissioner resolution.')
      a = selected
    }
    return { kind: challenge.kind, rosterIds: [a.id], amount: 0 }
  }
  const margins = new Map<string, number>()
  for (const pair of matchups) {
    const a = teams.find(t => t.id === pair.team1), b = teams.find(t => t.id === pair.team2)
    if (!a || !b || a.tribeId === b.tribeId) throw new Error('Valid cross-tribe matchups are required for the blowout reward.')
    if (a.points === b.points) continue
    const winner = a.points > b.points ? a : b
    const margin = Math.round(Math.abs(a.points - b.points) * 100) / 100
    margins.set(winner.tribeId, Math.max(margins.get(winner.tribeId) ?? 0, margin))
  }
  const ranked = [...margins].sort((a, b) => b[1] - a[1])
  if (!ranked.length) throw new Error('Biggest blowout reward tie requires commissioner resolution.')
  let winner = ranked[0][0]
  if (ranked[0][1] === ranked[1]?.[1]) {
    const tied = ranked.filter(row => row[1] === ranked[0][1])
    if (!tied.some(row => row[0] === tieWinnerId)) throw new Error('Biggest blowout reward tie requires commissioner resolution.')
    winner = tieWinnerId!
  }
  return { kind: challenge.kind, rosterIds: teams.filter(t => t.tribeId === winner).map(t => t.id), amount: challenge.amount }
}

export function sgMatchupStage(stages: SGSelectionStage[] | undefined, selected: number) {
  let end = 0
  for (const stage of stages ?? []) {
    end += stage.count
    if (selected < end) return { ...stage, remaining: end - selected }
  }
  return null
}

export function validateSGSelectionStages(stages: SGSelectionStage[] | undefined, mode: string,
  cutoff?: string | null): void {
  if (stages === undefined) return
  if (!Array.isArray(stages) || stages.length > 64 || !['match_play', 'tribe_champion'].includes(mode)) {
    throw new Error('Selection stages apply only to tribal competition.')
  }
  let previous = -Infinity
  const tribes = new Set<string>()
  for (const stage of stages) {
    const time = Date.parse(stage?.deadlineAt)
    if (!stage || typeof stage.tribeId !== 'string' || !stage.tribeId.trim() ||
        !Number.isInteger(stage.count) || stage.count < 1 || stage.count > 32 || !Number.isFinite(time) || time < previous ||
        (cutoff && time > Date.parse(cutoff))) throw new Error('Use ordered selection stages with valid tribes, counts, and deadlines before the final cutoff.')
    if (mode === 'tribe_champion' && (stage.count !== 1 || tribes.has(stage.tribeId))) throw new Error('Each tribe gets one champion deadline.')
    tribes.add(stage.tribeId); previous = time
  }
}

export function validateSGExtensions(config: SGConfig): string[] {
  const errors: string[] = []
  if (config.gauntletIdolMode !== undefined && !['sealed_auction', 'retired_player'].includes(config.gauntletIdolMode)) errors.push('Invalid Gauntlet idol mode.')
  if (config.championRotation !== undefined && typeof config.championRotation !== 'boolean') errors.push('Invalid champion rotation rule.')
  if (config.waiverDelayHours !== undefined && (!Number.isInteger(config.waiverDelayHours) || config.waiverDelayHours < 0 || config.waiverDelayHours > 168)) errors.push('Use a post-chop waiver delay from 0 to 168 hours.')
  const expansion = config.rosterExpansion
  if (expansion !== undefined) {
    if (!expansion || typeof expansion.enabled !== 'boolean' ||
        (expansion.openingBenchSlots !== null && (!Number.isInteger(expansion.openingBenchSlots) || expansion.openingBenchSlots < 0 || expansion.openingBenchSlots > 40)) ||
        !Number.isInteger(expansion.benchPerExpansion) || expansion.benchPerExpansion < 0 || expansion.benchPerExpansion > 10 ||
        !Array.isArray(expansion.steps) || expansion.steps.length > 30) errors.push('Invalid roster expansion settings.')
    else {
      if (expansion.enabled && config.sport !== 'NFL') errors.push('The All-Stars roster expansion preset requires NFL; NBA keeps its sport roster.')
      let previous = 1
      for (const step of expansion.steps) {
        if (!Number.isInteger(step.period) || step.period <= previous || step.period >= config.championshipPeriod ||
            !['FLEX', 'SUPERFLEX'].includes(step.slot) || !Number.isInteger(step.count) || step.count < 1 || step.count > 5) errors.push('Use distinct, increasing roster expansion periods before the finale.')
        previous = step.period
      }
    }
  }
  if (config.rewardChallenges !== undefined) {
    if (!Array.isArray(config.rewardChallenges) || config.rewardChallenges.length > 30) errors.push('Invalid public reward challenges.')
    else {
      const periods = new Set<number>()
      for (const challenge of config.rewardChallenges) {
        if (!challenge || !Number.isInteger(challenge.period) || challenge.period < 1 || challenge.period >= config.championshipPeriod ||
            periods.has(challenge.period) || !['tribe_blowout_faab', 'highest_score_idol', 'highest_score_swap'].includes(challenge.kind) ||
            !Number.isInteger(challenge.amount) || challenge.amount < 0 || challenge.amount > 100000) errors.push('Invalid or duplicate reward challenge period.')
        periods.add(challenge?.period)
        if (challenge?.kind === 'highest_score_swap' && !config.enabledPowers.includes('tribe_swap')) errors.push('Enable tribe-swap powers before scheduling a swap-token challenge.')
      }
    }
  }
  return errors
}

export function sgEligibleChampions(config: SGConfig, period: number, members: { rosterId: string; tribeId: string }[],
  tribeId: string, history: unknown): string[] {
  const eligible = members.filter(m => m.tribeId === tribeId)
  if (!config.championRotation) return eligible.map(m => m.rosterId)
  const reset = Math.max(1, ...config.shufflePeriods.filter(p => p <= period))
  const rows = history && typeof history === 'object' ? history as Record<string, { teams?: SGTeam[] }> : {}
  const counts = eligible.map(m => ({ id: m.rosterId, count: Object.entries(rows).filter(([key, row]) =>
    Number(key) >= reset && Number(key) < period && row.teams?.some(t => t.id === m.rosterId && t.champion && t.tribeId === tribeId)).length }))
  const min = Math.min(...counts.map(row => row.count))
  return counts.filter(row => row.count === min).map(row => row.id)
}

export function sgSwapError(members: { rosterId: string; tribeId: string }[], firstId: string, secondId: string, swapped: string[]): string | null {
  const first = members.find(m => m.rosterId === firstId), second = members.find(m => m.rosterId === secondId)
  if (!first || !second || first.tribeId === second.tribeId) return 'Swap requires active managers from different tribes.'
  if (swapped.includes(firstId) || swapped.includes(secondId)) return 'Neither manager may appear in a second tribe swap in the same period.'
  return null
}
