/**
 * Zombie universe sizes (create flow): internal tier ladder Alpha > Beta > Gamma.
 */
export type ZombieUniverseTierId = 'single_gamma' | 'beta_trio' | 'alpha_hex'

export const ZOMBIE_UNIVERSE_TIER_LABELS: Record<
  ZombieUniverseTierId,
  { title: string; description: string; leagueTotal: number }
> = {
  single_gamma: {
    title: '1-League Zombie Universe',
    description: 'Single Gamma league — full survival gameplay on one homepage. No multi-league commissioner dashboard.',
    leagueTotal: 1,
  },
  beta_trio: {
    title: '3-League Zombie Universe',
    description: 'Two Beta leagues + one Gamma. Enables Universe Tracker and Zombie Commissioner Dashboard.',
    leagueTotal: 3,
  },
  alpha_hex: {
    title: '6-League Zombie Universe',
    description: 'One Alpha + two Beta + three Gamma. Full cross-league tracking and commissioner tooling.',
    leagueTotal: 6,
  },
}

export function zombieUniverseTierRequiresDashboard(tier: ZombieUniverseTierId): boolean {
  return tier === 'beta_trio' || tier === 'alpha_hex'
}

/** Level rows: name, rankOrder (higher = top tier), leagues to spawn in this level. */
export function getZombieUniverseLevelPlan(tier: ZombieUniverseTierId): {
  name: string
  rankOrder: number
  tierLabel: string
  leagueSlots: number
}[] {
  if (tier === 'single_gamma') {
    return [{ name: 'Gamma', rankOrder: 1, tierLabel: 'Gamma', leagueSlots: 1 }]
  }
  if (tier === 'beta_trio') {
    return [
      { name: 'Beta', rankOrder: 2, tierLabel: 'Beta', leagueSlots: 2 },
      { name: 'Gamma', rankOrder: 1, tierLabel: 'Gamma', leagueSlots: 1 },
    ]
  }
  return [
    { name: 'Alpha', rankOrder: 3, tierLabel: 'Alpha', leagueSlots: 1 },
    { name: 'Beta', rankOrder: 2, tierLabel: 'Beta', leagueSlots: 2 },
    { name: 'Gamma', rankOrder: 1, tierLabel: 'Gamma', leagueSlots: 3 },
  ]
}

/** New creation supports every size from one through six; existing tier layouts remain stable. */
export function getZombieUniverseLevelPlanForCount(count: number): ReturnType<typeof getZombieUniverseLevelPlan> {
  if (!Number.isInteger(count) || count < 1 || count > 6) throw new Error('Choose between 1 and 6 Zombie leagues.')
  if (count === 1) return getZombieUniverseLevelPlan('single_gamma')
  if (count === 3) return getZombieUniverseLevelPlan('beta_trio')
  if (count === 6) return getZombieUniverseLevelPlan('alpha_hex')
  if (count === 2) return [
    { name: 'Beta', rankOrder: 2, tierLabel: 'Beta', leagueSlots: 1 },
    { name: 'Gamma', rankOrder: 1, tierLabel: 'Gamma', leagueSlots: 1 },
  ]
  return [
    { name: 'Alpha', rankOrder: 3, tierLabel: 'Alpha', leagueSlots: 1 },
    { name: 'Beta', rankOrder: 2, tierLabel: 'Beta', leagueSlots: count - 3 },
    { name: 'Gamma', rankOrder: 1, tierLabel: 'Gamma', leagueSlots: 2 },
  ]
}
