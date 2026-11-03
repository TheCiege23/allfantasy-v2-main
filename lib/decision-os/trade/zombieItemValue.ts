import { BOMB_POINTS, SERUM_POINTS, WEAPONS_COUNTED } from '@/lib/trade-intel/zombie'
import { WEAPON_POINTS } from '@/lib/zombie/beta2025Items'

export type ZombieValuationItem = {
  id: string
  itemType: string
  isUsed: boolean
  isExpired: boolean
  activationState?: string | null
  activatesAtWeek?: number | null
}

export type ZombieItemWindow = {
  /** The current week is excluded: an in-progress score receipt may already be frozen. */
  currentWeek: number
  finalWeek: number
  zombieCount: number
  teamCount: number
  weaponsEnabled: boolean
}

const ordinaryWeapon = (type: string): number | null => {
  const value = WEAPON_POINTS[type]
  return type !== 'weapon_bomb' && Number.isFinite(value) ? value : null
}

export function knownZombieItem(type: string): boolean {
  return type === 'serum' || type === 'weapon_bomb' || ordinaryWeapon(type) !== null
}

/**
 * Expected future scoring from inventory already owned by an eligible Survivor or Whisperer.
 * Current-week bonuses are omitted because a saved score receipt may be locked. The serum
 * probability holds today's Horde share fixed; infection and cash outcomes are separate.
 */
export function zombieInventoryScore(items: readonly ZombieValuationItem[], window: ZombieItemWindow): number | null {
  if (!Number.isSafeInteger(window.currentWeek) || !Number.isSafeInteger(window.finalWeek) ||
      window.finalWeek < window.currentWeek || window.teamCount < 2 ||
      window.zombieCount < 0 || window.zombieCount >= window.teamCount) return null
  const active = items.filter(item => !item.isUsed && !item.isExpired)
  if (active.some(item => !knownZombieItem(item.itemType))) return null
  if (active.some(item => item.activationState === 'pending_activation' && item.activatesAtWeek == null)) return null
  let total = 0
  const serumChancePerWeek = Math.min(1, window.zombieCount / (window.teamCount - 1))
  const ordinaryBonusByWeek = new Map<number, number>()
  for (let week = window.currentWeek + 1; week <= window.finalWeek; week++) {
    const ready = active.filter(item => (item.activatesAtWeek ?? 0) <= week &&
      (item.activationState == null || item.activationState === 'ready' || item.activationState === 'pending_activation'))
    const ordinary = window.weaponsEnabled
      ? ready.map(item => ordinaryWeapon(item.itemType)).filter((value): value is number => value !== null)
          .sort((a, b) => b - a).slice(0, WEAPONS_COUNTED).reduce((sum, value) => sum + value, 0)
      : 0
    ordinaryBonusByWeek.set(week, ordinary)
    total += ordinary
  }
  // Spend bombs on the weeks where replacing ordinary weapons creates the most points.
  const unusedWeeks = new Set(ordinaryBonusByWeek.keys())
  const bombs = window.weaponsEnabled
    ? active.filter(item => item.itemType === 'weapon_bomb').sort((a, b) => (b.activatesAtWeek ?? 0) - (a.activatesAtWeek ?? 0))
    : []
  for (const bomb of bombs) {
    const choice = [...unusedWeeks]
      .filter(week => week >= (bomb.activatesAtWeek ?? 0))
      .sort((a, b) => (ordinaryBonusByWeek.get(a) ?? 0) - (ordinaryBonusByWeek.get(b) ?? 0) || a - b)[0]
    if (choice == null) continue
    total += Math.max(0, BOMB_POINTS - (ordinaryBonusByWeek.get(choice) ?? 0))
    unusedWeeks.delete(choice)
  }
  for (const item of active) {
    if (item.itemType !== 'serum') continue
    const firstWeek = Math.max(window.currentWeek + 1, item.activatesAtWeek ?? 0)
    const eligibleWeeks = Math.max(0, window.finalWeek - firstWeek + 1)
    // Multiple serums may be used in the same Zombie matchup; they do not consume one another.
    total += SERUM_POINTS * (1 - Math.pow(1 - serumChancePerWeek, eligibleWeeks))
  }
  return Math.round(total * 10) / 10
}

export function zombieItemSwapValue(args: {
  owned: readonly ZombieValuationItem[]
  outgoingIds: readonly string[]
  incoming: readonly ZombieValuationItem[]
  window: ZombieItemWindow
}): {
  before: number
  after: number
  outgoingCost: number
  incomingBenefit: number
  outgoingValues: ReadonlyMap<string, number>
  incomingValues: ReadonlyMap<string, number>
} | null {
  const owned = new Map(args.owned.map(item => [item.id, item]))
  if (owned.size !== args.owned.length || new Set(args.outgoingIds).size !== args.outgoingIds.length) return null
  if (new Set(args.incoming.map(item => item.id)).size !== args.incoming.length) return null
  if (args.outgoingIds.some(id => !owned.has(id)) || args.incoming.some(item => owned.has(item.id))) return null
  const transferable = (item: ZombieValuationItem) => !item.isUsed && !item.isExpired && item.activationState === 'ready' && knownZombieItem(item.itemType)
  if (args.outgoingIds.some(id => !transferable(owned.get(id)!)) || args.incoming.some(item => !transferable(item))) return null
  const retained = args.owned.filter(item => !args.outgoingIds.includes(item.id))
  const before = zombieInventoryScore(args.owned, args.window)
  const afterGiving = zombieInventoryScore(retained, args.window)
  const afterReceiving = zombieInventoryScore([...retained, ...args.incoming], args.window)
  if (before === null || afterGiving === null || afterReceiving === null) return null
  const outgoingValues = new Map<string, number>()
  const incomingValues = new Map<string, number>()
  let inventory = [...args.owned]
  let score = before
  for (const id of [...args.outgoingIds].sort()) {
    inventory = inventory.filter(item => item.id !== id)
    const next = zombieInventoryScore(inventory, args.window)
    if (next === null) return null
    outgoingValues.set(id, Math.round(Math.max(0, score - next) * 10) / 10)
    score = next
  }
  for (const item of [...args.incoming].sort((a, b) => a.id.localeCompare(b.id))) {
    inventory.push(item)
    const next = zombieInventoryScore(inventory, args.window)
    if (next === null) return null
    incomingValues.set(item.id, Math.round(Math.max(0, next - score) * 10) / 10)
    score = next
  }
  return {
    before,
    after: afterReceiving,
    outgoingCost: Math.round(Math.max(0, before - afterGiving) * 10) / 10,
    incomingBenefit: Math.round(Math.max(0, afterReceiving - afterGiving) * 10) / 10,
    outgoingValues,
    incomingValues,
  }
}
