export const BETA_2025_ITEM_POLICY = 'beta_2025' as const
export const WEAPON_POINTS: Record<string, number> = {
  weapon_knife: 4, weapon_axe: 6, weapon_bow: 8, weapon_gun: 10, weapon_bomb: 35,
}
export const WEAPON_LABELS: Record<string, string> = {
  weapon_knife: '🔪 Knife', weapon_axe: '🪓 Axe', weapon_bow: '🏹 Bow', weapon_gun: '🔫 Gun', weapon_bomb: '💣 Bomb',
}
export type BetaItem = {
  id: string; teamStatusId: string; itemType: string; isUsed: boolean; isExpired: boolean
  usedAtWeek?: number | null; usedEffect?: string | null; activatesAtWeek?: number | null
  activationState?: string; acquiredAtWeek?: number | null
}
export type ItemBonus = {
  frozen?: boolean; rosterId: string; role: string; weaponIds: string[]; serumIds: string[]; bombId: string | null
  weaponBonus: number; serumBonus: number; bonus: number
}
export type ItemScoreReceipt = { policy: 'beta_2025'; home: ItemBonus; away: ItemBonus }
export function itemRole(status: string): 'Survivor' | 'Zombie' | 'Whisperer' {
  const role = status.trim().toLowerCase().replace(/[_-]/g, ' ')
  if (role === 'zombie') return 'Zombie'
  if (role === 'whisperer') return 'Whisperer'
  if (['survivor', 'revived', 'revived survivor'].includes(role)) return 'Survivor'
  throw new Error('ZOMBIE_ITEMS_UNKNOWN_ROLE')
}
export const readyItem = (item: BetaItem, week: number) =>
  !item.isUsed && !item.isExpired && (item.activatesAtWeek == null || item.activatesAtWeek <= week) &&
  (!item.activationState || item.activationState === 'ready')
export function weaponForBaseScore(score: number): string | null {
  if (!Number.isFinite(score)) throw new Error('ZOMBIE_ITEMS_INVALID_SCORE')
  const cents = Math.round(score * 100)
  return cents >= 12000 ? 'weapon_bomb' : cents >= 11500 ? 'weapon_gun' : cents >= 11000 ? 'weapon_bow' :
    cents >= 10500 ? 'weapon_axe' : cents >= 10000 ? 'weapon_knife' : null
}
/** Bonuses are separate from player points: they never award more items. */
export function betaItemBonus(rosterId: string, status: string, items: readonly BetaItem[], week: number, weaponsEnabled = true): ItemBonus {
  const role = itemRole(status)
  const consumed = items.filter(i => !i.isExpired && i.isUsed && i.usedAtWeek === week)
  const serumIds = consumed.filter(i => i.usedEffect === 'beta2025_serum_10').map(i => i.id).sort()
  const bombs = consumed.filter(i => i.usedEffect === 'beta2025_bomb_35')
  if (bombs.length > 1) throw new Error('ZOMBIE_ITEMS_MULTIPLE_BOMBS')
  const bombId = bombs[0]?.id ?? null
  const weapons = role !== 'Zombie' && weaponsEnabled && !bombId
    ? items.filter(i => readyItem(i, week) && i.itemType !== 'weapon_bomb' && WEAPON_POINTS[i.itemType])
      .sort((a, b) => WEAPON_POINTS[b.itemType] - WEAPON_POINTS[a.itemType] || a.id.localeCompare(b.id)).slice(0, 2)
    : []
  const weaponBonus = bombId ? 35 : weapons.reduce((n, i) => n + WEAPON_POINTS[i.itemType], 0)
  const serumBonus = serumIds.length * 10
  // Consumed bonuses remain attached to the week even if the owner is infected later.
  return { rosterId, role, weaponIds: weapons.map(i => i.id), serumIds, bombId, weaponBonus, serumBonus, bonus: weaponBonus + serumBonus }
}
export function serumQuantity(message: string): number {
  if (/\bally\b/i.test(message)) throw new Error('Serums can only boost your own team. Trade an item to help another manager.')
  const match = message.match(/\buse\s+(\d+)\s+serums?\b/i) ?? message.match(/\bserums?\s+(\d+)\b/i)
  const count = match ? Number(match[1]) : (message.match(/🧪/gu)?.length ?? 1)
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error('Choose between 1 and 100 serums.')
  return count
}

export type ItemWeekMatchup = {
  matchupId: string; homeRosterId: string; awayRosterId: string
  homeScore: number; awayScore: number; homeBaseScore: number; awayBaseScore: number
  homeWeaponBonus: number; awayWeaponBonus: number
}
export type ItemPlan = {
  transfers: Array<{ itemId: string; fromRosterId: string; toRosterId: string }>
  awards: Array<{ rosterId: string; itemType: string; reason: string }>
}
/** Loot always uses pre-week roles and inventory, never the status changed by infection processing. */
export function planBetaItemSettlement(input: {
  week: number; matchups: readonly ItemWeekMatchup[]
  teams: ReadonlyArray<{ id: string; rosterId: string; status: string }>; items: readonly BetaItem[]
  openingByRoster: Record<string, number>; bashingThreshold: number; maulingThreshold: number
  weaponsEnabled: boolean; highScoreEnabled: boolean; combatSerumsEnabled: boolean
}): ItemPlan {
  const { week, matchups, teams, items } = input
  const plan: ItemPlan = { transfers: [], awards: [] }
  const teamByRoster = new Map(teams.map(t => [t.rosterId, t]))
  const usedRosters = new Set<string>()
  const high = Math.max(...matchups.flatMap(m => [m.homeBaseScore, m.awayBaseScore]))
  const award = (rosterId: string, itemType: string, reason: string) => plan.awards.push({ rosterId, itemType, reason })
  for (const m of matchups) {
    if ([m.homeScore, m.awayScore, m.homeBaseScore, m.awayBaseScore, m.homeWeaponBonus, m.awayWeaponBonus].some(n => !Number.isFinite(n))) throw new Error('ZOMBIE_ITEMS_INVALID_SCORE')
    for (const [rid, score] of [[m.homeRosterId, m.homeBaseScore], [m.awayRosterId, m.awayBaseScore]] as const) {
      if (!teamByRoster.has(rid) || usedRosters.has(rid)) throw new Error('ZOMBIE_ITEMS_INVALID_MATCHUP')
      usedRosters.add(rid)
      if (input.highScoreEnabled && score === high) award(rid, 'serum', 'weekly_high_score')
      const weapon = input.weaponsEnabled ? weaponForBaseScore(score) : null
      if (weapon) award(rid, weapon, 'score_band')
    }
    if (m.homeScore === m.awayScore) continue
    const homeWon = m.homeScore > m.awayScore
    const win = homeWon ? m.homeRosterId : m.awayRosterId
    const lose = homeWon ? m.awayRosterId : m.homeRosterId
    const winner = teamByRoster.get(win)!, loser = teamByRoster.get(lose)!
    const wRole = itemRole(winner.status), lRole = itemRole(loser.status)
    const margin = Math.round(Math.abs(m.homeScore - m.awayScore) * 100) / 100
    const bash = wRole === 'Survivor' && margin >= input.bashingThreshold
    const maul = wRole === 'Zombie' && margin >= input.maulingThreshold
    if (input.combatSerumsEnabled && ((bash && lRole === 'Zombie') || maul)) award(win, 'serum', maul ? 'mauling' : 'bashing')
    const loserItems = items.filter(i => i.teamStatusId === loser.id && !i.isUsed && !i.isExpired && (!i.activationState || i.activationState === 'ready'))
    const transfer = (item: BetaItem) => plan.transfers.push({ itemId: item.id, fromRosterId: lose, toRosterId: win })
    if (bash || maul) {
      loserItems.filter(i => i.itemType.includes('serum') || i.itemType.startsWith('weapon_')).forEach(transfer)
      continue
    }
    const serums = loserItems.filter(i => i.itemType.includes('serum')).sort((a, b) => a.id.localeCompare(b.id))
    const emptyCarcass = wRole === 'Zombie' && lRole === 'Zombie' && Math.ceil(margin) >= input.openingByRoster[lose]
    if (wRole === 'Survivor' && lRole !== 'Survivor') serums.slice(0, 1).forEach(transfer)
    else if (wRole === 'Whisperer' || (wRole === 'Zombie' && (lRole !== 'Zombie' || emptyCarcass))) serums.forEach(transfer)
    const weaponBonus = homeWon ? m.homeWeaponBonus : m.awayWeaponBonus
    // A weapon-assisted win cannot steal a weapon. Bombs used this week are already spent.
    if (weaponBonus === 0) {
      const weapons = loserItems.filter(i => WEAPON_POINTS[i.itemType] &&
        !(i.itemType === 'weapon_bomb' && wRole === 'Survivor' && lRole === 'Survivor'))
        .sort((a, b) => WEAPON_POINTS[b.itemType] - WEAPON_POINTS[a.itemType] || a.id.localeCompare(b.id))
      weapons.slice(0, 1).forEach(transfer)
    }
  }
  return plan
}
