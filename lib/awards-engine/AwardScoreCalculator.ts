/**
 * AwardScoreCalculator — compute winner and score for each award type from season performance.
 */

import type { SeasonPerformanceInput, AwardType } from './types'

/**
 * For each award type, return the winning candidate (managerId + score). One winner per type.
 */
export function calculateAwardWinners(input: SeasonPerformanceInput): { awardType: AwardType; managerId: string; score: number; reason?: string }[] {
  const results: { awardType: AwardType; managerId: string; score: number; reason?: string }[] = []
  const managers = Object.entries(input.byManager).filter(([, m]) => m.wins + m.losses > 0 || m.draftScore > 0 || m.waiverClaimCount > 0 || m.seasonsInLeague > 0)
  if (managers.length === 0) return results

  const gmWinner = gmOfTheYear(managers)
  if (gmWinner) results.push({ awardType: 'gm_of_the_year', ...gmWinner })

  const draftWinner = bestDraft(managers)
  if (draftWinner) results.push({ awardType: 'best_draft', ...draftWinner })

  const tradeWinner = tradeMaster(managers)
  if (tradeWinner) results.push({ awardType: 'trade_master', ...tradeWinner })

  const waiverWinner = waiverWizard(managers)
  if (waiverWinner) results.push({ awardType: 'waiver_wizard', ...waiverWinner })

  const comebackWinner = bestComeback(managers)
  if (comebackWinner) results.push({ awardType: 'best_comeback', ...comebackWinner })

  const upsetWinner = biggestUpset(managers)
  if (upsetWinner) results.push({ awardType: 'biggest_upset', ...upsetWinner })

  const rookieWinner = rookieKing(managers)
  if (rookieWinner) results.push({ awardType: 'rookie_king', ...rookieWinner })

  const dynastyWinner = dynastyBuilder(managers)
  if (dynastyWinner) results.push({ awardType: 'dynasty_builder', ...dynastyWinner })

  return results
}

type ManagerEntry = [string, SeasonPerformanceInput['byManager'][string]]

function gmOfTheYear(
  managers: ManagerEntry[]
): { managerId: string; score: number; reason?: string } | null {
  let best: ManagerEntry | null = null
  let bestScore = -1
  for (const [managerId, m] of managers) {
    const wins = m.wins
    const total = m.wins + m.losses
    const winPct = total > 0 ? wins / total : 0
    const score = winPct * 50 + (m.champion ? 40 : 0) + Math.min(10, (m.pointsFor || 0) / 100)
    if (score > bestScore) {
      bestScore = score
      best = [managerId, m]
    }
  }
  if (!best) return null
  const [, m] = best
  return {
    managerId: best[0],
    score: Math.round(bestScore * 100) / 100,
    reason: `${m.wins}-${m.losses} record${m.playoffFinish ? `, ${m.playoffFinish}` : ''}`,
  }
}

function bestDraft(managers: ManagerEntry[]): { managerId: string; score: number; reason?: string } | null {
  let best: ManagerEntry | null = null
  let bestScore = -1
  for (const [managerId, m] of managers) {
    if (m.draftScore <= 0) continue
    if (m.draftScore > bestScore) {
      bestScore = m.draftScore
      best = [managerId, m]
    }
  }
  if (!best) return null
  return {
    managerId: best[0],
    score: best[1].draftScore,
    reason: `Draft grade score ${best[1].draftScore}`,
  }
}

function tradeMaster(managers: ManagerEntry[]): { managerId: string; score: number; reason?: string } | null {
  let best: ManagerEntry | null = null
  let bestCount = -1
  for (const [managerId, m] of managers) {
    if (m.tradeCount > bestCount) {
      bestCount = m.tradeCount
      best = [managerId, m]
    }
  }
  if (!best || bestCount <= 0) return null
  return {
    managerId: best[0],
    score: bestCount,
    reason: `${bestCount} trades`,
  }
}

function waiverWizard(managers: ManagerEntry[]): { managerId: string; score: number; reason?: string } | null {
  let best: ManagerEntry | null = null
  let bestCount = -1
  for (const [managerId, m] of managers) {
    if (m.waiverClaimCount > bestCount) {
      bestCount = m.waiverClaimCount
      best = [managerId, m]
    }
  }
  if (!best || bestCount <= 0) return null
  return {
    managerId: best[0],
    score: bestCount,
    reason: `${bestCount} waiver claims`,
  }
}

function bestComeback(managers: ManagerEntry[]): { managerId: string; score: number; reason?: string } | null {
  const withRecord = managers.filter(([, m]) => m.wins + m.losses > 0)
  if (withRecord.length === 0) return null
  let best: ManagerEntry | null = null
  let bestImprovement = -1
  for (const entry of withRecord) {
    const [, m] = entry
    const total = m.wins + m.losses
    const winPct = m.wins / total
    const pointsDiff = m.pointsFor - m.pointsAgainst
    const improvement = winPct * 30 + Math.max(0, Math.min(70, (pointsDiff || 0) / 20))
    if (improvement > bestImprovement) {
      bestImprovement = improvement
      best = entry
    }
  }
  if (!best) return null
  const [, m] = best
  return {
    managerId: best[0],
    score: Math.round(bestImprovement * 100) / 100,
    reason: `${m.wins}-${m.losses}, PF ${m.pointsFor?.toFixed(0) ?? 0}`,
  }
}

function biggestUpset(managers: ManagerEntry[]): { managerId: string; score: number; reason?: string } | null {
  const withRecord = managers.filter(([, m]) => m.wins + m.losses > 0 && m.champion)
  if (withRecord.length === 0) return null
  let best: ManagerEntry | null = null
  let bestScore = -1
  for (const entry of withRecord) {
    const [, m] = entry
    const total = m.wins + m.losses
    const winPct = m.wins / total
    const score = winPct < 0.7 ? (1 - winPct) * 100 : 0
    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }
  if (!best) return null
  const [, m] = best
  return {
    managerId: best[0],
    score: Math.round(bestScore * 100) / 100,
    reason: `${m.playoffFinish ?? (m.champion ? 'Champion' : 'Playoff run')} at ${m.wins}-${m.losses}`,
  }
}

function rookieKing(managers: ManagerEntry[]): { managerId: string; score: number; reason?: string } | null {
  const rookies = managers.filter(([, m]) => m.isRookie && (m.wins + m.losses > 0 || m.draftScore > 0))
  if (rookies.length === 0) return null
  let best: ManagerEntry | null = null
  let bestScore = -1
  for (const entry of rookies) {
    const [, m] = entry
    const total = m.wins + m.losses
    const winPct = total > 0 ? m.wins / total : 0
    const score = winPct * 60 + Math.min(40, m.draftScore)
    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }
  if (!best) return null
  return {
    managerId: best[0],
    score: Math.round(bestScore * 100) / 100,
    reason: 'First season in league',
  }
}

function dynastyBuilder(managers: ManagerEntry[]): { managerId: string; score: number; reason?: string } | null {
  const multi = managers.filter(([, m]) => m.seasonsInLeague >= 2)
  if (multi.length === 0) return null
  let best: ManagerEntry | null = null
  let bestScore = -1
  for (const entry of multi) {
    const [, m] = entry
    const score = m.seasonsInLeague * 20 + m.championshipCount * 50
    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }
  if (!best) return null
  const [, m] = best
  return {
    managerId: best[0],
    score: bestScore,
    reason: `${m.seasonsInLeague} seasons, ${m.championshipCount} titles`,
  }
}
