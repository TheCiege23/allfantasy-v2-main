import { describe, expect, it } from 'vitest'
import { zombieInventoryScore, zombieItemSwapValue, type ZombieValuationItem } from '@/lib/decision-os/trade/zombieItemValue'

const item = (id: string, itemType: string, activatesAtWeek = 1): ZombieValuationItem => ({
  id, itemType, activatesAtWeek, activationState: 'ready', isUsed: false, isExpired: false,
})
const window = { currentWeek: 4, finalWeek: 8, zombieCount: 5, teamCount: 20, weaponsEnabled: true }

describe('Zombie item value from verified inventory', () => {
  it('prices a weapon from the holder’s top two rather than its face value', () => {
    const owned = [item('gun', 'weapon_gun'), item('bow', 'weapon_bow'), item('knife', 'weapon_knife')]
    expect(zombieItemSwapValue({ owned, outgoingIds: ['knife'], incoming: [], window })?.outgoingCost).toBe(0)
    expect(zombieItemSwapValue({ owned: [], outgoingIds: [], incoming: [item('knife', 'weapon_knife')], window })?.incomingBenefit).toBe(16)
  })

  it('prices a bomb once and subtracts the ordinary weapons suppressed that week', () => {
    const armed = [item('gun', 'weapon_gun'), item('bow', 'weapon_bow')]
    expect(zombieItemSwapValue({ owned: armed, outgoingIds: [], incoming: [item('bomb', 'weapon_bomb')], window })?.incomingBenefit).toBe(17)
  })

  it('cannot spend a newly available bomb in a previous week', () => {
    const delayed = item('bomb', 'weapon_bomb', 8)
    expect(zombieInventoryScore([delayed], window)).toBe(35)
    expect(zombieInventoryScore([item('bomb', 'weapon_bomb', 9)], window)).toBe(0)
  })

  it('uses current Horde prevalence for single-use, stackable serums', () => {
    const one = zombieInventoryScore([item('s1', 'serum')], window)!
    const two = zombieInventoryScore([item('s1', 'serum'), item('s2', 'serum')], window)!
    expect(one).toBeGreaterThan(0)
    expect(one).toBeLessThanOrEqual(10)
    expect(Math.abs(two - one * 2)).toBeLessThanOrEqual(0.1)
  })

  it('refuses spent, duplicate, unknown, or unowned transfer assets', () => {
    const spent = { ...item('spent', 'serum'), isUsed: true }
    expect(zombieItemSwapValue({ owned: [spent], outgoingIds: ['spent'], incoming: [], window })).toBeNull()
    expect(zombieItemSwapValue({ owned: [], outgoingIds: [], incoming: [item('x', 'mystery')], window })).toBeNull()
    expect(zombieItemSwapValue({ owned: [], outgoingIds: ['x'], incoming: [], window })).toBeNull()
    expect(zombieItemSwapValue({ owned: [item('x', 'serum')], outgoingIds: ['x', 'x'], incoming: [], window })).toBeNull()
  })
})
