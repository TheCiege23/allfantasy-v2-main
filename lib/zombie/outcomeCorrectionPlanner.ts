import type { ZombieSettlementSnapshotV1 } from '@/lib/zombie/weeklySettlementSnapshot'

export type ReplayWeekResult = {
  matchupId: string
  homeRosterId: string
  awayRosterId: string
  homeScore: number
  awayScore: number
}
export type ReplayInfection = {
  matchupId: string
  victimRosterId: string
  infectorRosterId: string
  victimScore: number
  infectorScore: number
}
export type OutcomeReplayPlan = {
  infections: ReplayInfection[]
  spentItemIds: string[]
  serumAwards: Array<{ rosterId: string; reason: string }>
  weaponAwards: Array<{ rosterId: string; itemType: string; label: string }>
  statusByRoster: Map<string, string>
}

/**
 * Pure correction plan from the pre-week snapshot. Combat decisions and automatic
 * revivals have independent side effects, so this planner declines those weeks.
 */
export function planZombieOutcomeReplay(
  results: ReadonlyArray<ReplayWeekResult>,
  snapshot: ZombieSettlementSnapshotV1,
  week: number,
  experienceMode: string | null,
): OutcomeReplayPlan | null {
  if (!snapshot.config || snapshot.config.autoSerumRevive || !results.length) return null
  if (results.some(row => !row.homeRosterId || !row.awayRosterId ||
      !Number.isFinite(row.homeScore) || !Number.isFinite(row.awayScore) ||
      Math.abs(row.homeScore - row.awayScore) >= snapshot.rules.bashingThreshold)) return null
  const byRoster = new Map(snapshot.teams.map(team => [team.rosterId, team]))
  const statusByRoster = new Map(snapshot.teams.map(team => [team.rosterId, team.status]))
  const byTeamId = new Map(snapshot.teams.map(team => [team.id, team.rosterId]))
  const spentItemIds = new Set<string>()
  const infections: ReplayInfection[] = []
  const threatened = new Set<string>()
  const protectedRosters = new Set<string>()
  for (const item of snapshot.items) {
    const rosterId = byTeamId.get(item.teamStatusId)
    if (!rosterId || item.isUsed || item.isExpired || item.activatesAtWeek !== week || item.activationState !== 'pending_activation') continue
    if (item.itemType.includes('serum') ||
        (['weapon_knife', 'weapon_bow', 'weapon_axe', 'weapon_gun'].includes(item.itemType) &&
          item.usedEffect === 'infection_shield')) protectedRosters.add(rosterId)
  }
  for (const row of results) {
    if (!byRoster.has(row.homeRosterId) || !byRoster.has(row.awayRosterId)) return null
    if (row.homeScore === row.awayScore) continue
    const homeWon = row.homeScore > row.awayScore
    const winnerId = homeWon ? row.homeRosterId : row.awayRosterId
    const loserId = homeWon ? row.awayRosterId : row.homeRosterId
    const winnerStatus = statusByRoster.get(winnerId)
    if (statusByRoster.get(loserId) !== 'Survivor' ||
        (winnerStatus !== 'Zombie' && winnerStatus !== 'Whisperer')) continue
    threatened.add(loserId)
    const enabled = winnerStatus === 'Zombie'
      ? snapshot.config.infectionLossToZombie
      : snapshot.config.infectionLossToWhisperer
    if (!enabled || protectedRosters.has(loserId)) continue
    infections.push({
      matchupId: row.matchupId, victimRosterId: loserId, infectorRosterId: winnerId,
      victimScore: homeWon ? row.awayScore : row.homeScore,
      infectorScore: homeWon ? row.homeScore : row.awayScore,
    })
    statusByRoster.set(loserId, 'Zombie')
  }
  for (const item of snapshot.items) {
    const rosterId = byTeamId.get(item.teamStatusId)
    const threat = results.find(row => {
      if (rosterId !== row.homeRosterId && rosterId !== row.awayRosterId) return false
      const lost = rosterId === row.homeRosterId
        ? row.homeScore < row.awayScore
        : row.awayScore < row.homeScore
      if (!lost) return false
      const opponentId = rosterId === row.homeRosterId ? row.awayRosterId : row.homeRosterId
      const opponentStatus = snapshot.teams.find(team => team.rosterId === opponentId)?.status
      return opponentStatus === 'Zombie' || opponentStatus === 'Whisperer'
    })
    const threatStatus = threat && snapshot.teams.find(team =>
      team.rosterId === (rosterId === threat.homeRosterId ? threat.awayRosterId : threat.homeRosterId))?.status
    const infectionEnabled = threatStatus === 'Zombie'
      ? snapshot.config.infectionLossToZombie
      : threatStatus === 'Whisperer' && snapshot.config.infectionLossToWhisperer
    if (rosterId && threatened.has(rosterId) && infectionEnabled && !item.isUsed && !item.isExpired &&
        item.activatesAtWeek === week && item.activationState === 'pending_activation' &&
        (item.itemType.includes('serum') || (item.usedEffect === 'infection_shield' &&
          ['weapon_knife', 'weapon_bow', 'weapon_axe', 'weapon_gun'].includes(item.itemType)))) {
      spentItemIds.add(item.id)
    }
  }
  const serumAwards: OutcomeReplayPlan['serumAwards'] = []
  if (snapshot.config.serumAwardHighScore) {
    const highest = Math.max(...results.flatMap(row => [row.homeScore, row.awayScore]))
    for (const row of results) {
      for (const [rosterId, score] of [
        [row.homeRosterId, row.homeScore], [row.awayRosterId, row.awayScore],
      ] as const) {
        if (score === highest && statusByRoster.get(rosterId) !== 'Whisperer') {
          serumAwards.push({ rosterId, reason: 'weekly_high_score' })
        }
      }
    }
  }
  const weaponAwards: OutcomeReplayPlan['weaponAwards'] = []
  if (experienceMode !== 'simple') {
    const pending = new Set<string>()
    const addWeapon = (rosterId: string, itemType: string, label: string) => {
      const key = rosterId + ':' + itemType
      if (pending.has(key) || snapshot.items.some(item =>
        byTeamId.get(item.teamStatusId) === rosterId && item.itemType === itemType && !item.isUsed)) return
      pending.add(key)
      weaponAwards.push({ rosterId, itemType, label })
    }
    for (const row of results) {
      const margin = Math.abs(row.homeScore - row.awayScore)
      for (const [rosterId, score, won] of [
        [row.homeRosterId, row.homeScore, row.homeScore >= row.awayScore],
        [row.awayRosterId, row.awayScore, row.awayScore >= row.homeScore],
      ] as const) {
        if (score >= snapshot.rules.weaponShieldThreshold) addWeapon(rosterId, 'weapon_knife', '🔪 Knife')
        if (score >= snapshot.rules.weaponAmbushThreshold) addWeapon(rosterId, 'weapon_bow', '🏹 Bow')
        if (won && margin >= snapshot.rules.weaponAxeMargin) addWeapon(rosterId, 'weapon_axe', '🪓 Axe')
      }
    }
  }
  return {
    infections, spentItemIds: [...spentItemIds], serumAwards, weaponAwards, statusByRoster,
  }
}
