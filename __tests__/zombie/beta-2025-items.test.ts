import { describe, it, expect } from 'vitest'
import { betaItemBonus, planBetaItemSettlement, serumQuantity, weaponForBaseScore, type BetaItem } from '@/lib/zombie/beta2025Items'
const item = (id: string, itemType: string, teamStatusId = 'A', extra: Partial<BetaItem> = {}): BetaItem => ({ id, itemType, teamStatusId, isUsed: false, isExpired: false, activationState: 'ready', ...extra })
function plan(winnerStatus = 'Survivor', loserStatus = 'Zombie', extra: Partial<Parameters<typeof planBetaItemSettlement>[0]> = {}) {
  return planBetaItemSettlement({ week: 4, matchups: [{ matchupId: 'M', homeRosterId: 'a', awayRosterId: 'b', homeScore: 110, awayScore: 100, homeBaseScore: 100, awayBaseScore: 100, homeWeaponBonus: 0, awayWeaponBonus: 0 }], teams: [{ id: 'A', rosterId: 'a', status: winnerStatus }, { id: 'B', rosterId: 'b', status: loserStatus }], items: [item('s1', 'serum', 'B'), item('s2', 'serum', 'B'), item('g', 'weapon_gun', 'B'), item('k', 'weapon_knife', 'B')], openingByRoster: { a: 5, b: 20 }, bashingThreshold: 60, maulingThreshold: 60, weaponsEnabled: true, highScoreEnabled: true, combatSerumsEnabled: true, ...extra })
}
describe('2025 item score bands', () => {
  it.each([[99.99, null], [100, 'weapon_knife'], [104.99, 'weapon_knife'], [105, 'weapon_axe'], [109.99, 'weapon_axe'], [110, 'weapon_bow'], [114.99, 'weapon_bow'], [115, 'weapon_gun'], [119.99, 'weapon_gun'], [120, 'weapon_bomb'], [300, 'weapon_bomb']])('base score %s earns %s', (score, type) => expect(weaponForBaseScore(score as number)).toBe(type))
  it('rejects unknown scores', () => expect(() => weaponForBaseScore(NaN)).toThrow())
})
describe('2025 bonuses', () => {
  const weapons = [item('k', 'weapon_knife'), item('a', 'weapon_axe'), item('g', 'weapon_gun'), item('b', 'weapon_bow')]
  it.each(['Survivor', 'Whisperer'])('automatically equips the strongest two for %s', role => expect(betaItemBonus('a', role, weapons, 4)).toMatchObject({ weaponIds: ['g', 'b'], bonus: 18 }))
  it('Zombies hold weapons without wielding them', () => expect(betaItemBonus('a', 'Zombie', weapons, 4).bonus).toBe(0))
  it('ordinary weapons are reusable next week', () => expect(betaItemBonus('a', 'Survivor', weapons, 5).bonus).toBe(18))
  it('supports two of the same weapon', () => expect(betaItemBonus('a', 'Survivor', [item('g1', 'weapon_gun'), item('g2', 'weapon_gun')], 4).bonus).toBe(20))
  it('a consumed bomb replaces weapon bonuses and stacks with serums', () => expect(betaItemBonus('a', 'Survivor', [...weapons, item('bomb', 'weapon_bomb', 'A', { isUsed: true, usedAtWeek: 4, usedEffect: 'beta2025_bomb_35' }), item('s1', 'serum', 'A', { isUsed: true, usedAtWeek: 4, usedEffect: 'beta2025_serum_10' }), item('s2', 'serum', 'A', { isUsed: true, usedAtWeek: 4, usedEffect: 'beta2025_serum_10' })], 4)).toMatchObject({ weaponIds: [], weaponBonus: 35, serumBonus: 20, bonus: 55 }))
  it('spent bomb and serums never score in a later week', () => expect(betaItemBonus('a', 'Survivor', [item('s', 'serum', 'A', { isUsed: true, usedAtWeek: 3, usedEffect: 'beta2025_serum_10' })], 4).bonus).toBe(0))
  it('awarded or looted weapons cannot affect the settled week retroactively', () => expect(betaItemBonus('a', 'Survivor', [item('g', 'weapon_gun', 'A', { activatesAtWeek: 5 })], 4).bonus).toBe(0))
  it('simple mode disables weapons but retains used serums', () => expect(betaItemBonus('a', 'Survivor', weapons, 4, false).bonus).toBe(0))
  it('expired and spent ordinary weapons do not count', () => expect(betaItemBonus('a', 'Survivor', [item('g', 'weapon_gun', 'A', { isExpired: true }), item('k', 'weapon_knife', 'A', { isUsed: true })], 4).bonus).toBe(0))
  it('rejects duplicate bomb use', () => expect(() => betaItemBonus('a', 'Survivor', ['1', '2'].map(id => item(id, 'weapon_bomb', 'A', { isUsed: true, usedAtWeek: 4, usedEffect: 'beta2025_bomb_35' })), 4)).toThrow())
  it('multiple serums are explicitly parsed', () => { expect(serumQuantity('@Chimmy use 3 serums')).toBe(3); expect(serumQuantity('🧪🧪')).toBe(2) })
  it.each(['use 0 serums', 'use 101 serums', 'use serum protect ally Bob'])('refuses unsupported quantity or target: %s', m => expect(() => serumQuantity(m)).toThrow())
})
describe('2025 item loot and awards', () => {
  it('a Survivor takes one serum and the highest weapon on an unassisted win', () => expect(plan().transfers.map(t => t.itemId)).toEqual(['s1', 'g']))
  it('weapon assistance blocks ordinary weapon theft', () => expect(plan('Survivor', 'Zombie', { matchups: [{ matchupId: 'M', homeRosterId: 'a', awayRosterId: 'b', homeScore: 110, awayScore: 100, homeBaseScore: 100, awayBaseScore: 100, homeWeaponBonus: 10, awayWeaponBonus: 0 }] }).transfers.map(t => t.itemId)).toEqual(['s1']))
  it.each([['Whisperer', 'Survivor'], ['Whisperer', 'Zombie'], ['Zombie', 'Survivor'], ['Zombie', 'Whisperer']])('%s takes all unused serums from %s', (w, l) => expect(plan(w, l).transfers.filter(t => t.itemId.startsWith('s'))).toHaveLength(2))
  it('Zombie versus Zombie takes no serums unless all accumulated winnings were taken', () => expect(plan('Zombie', 'Zombie').transfers.filter(t => t.itemId.startsWith('s'))).toHaveLength(0))
  it('rounded-up winning margin clears the carcass', () => expect(plan('Zombie', 'Zombie', { openingByRoster: { a: 0, b: 10 } }).transfers.filter(t => t.itemId.startsWith('s'))).toHaveLength(2))
  it('a Survivor cannot steal a bomb from another Survivor', () => expect(plan('Survivor', 'Survivor', { items: [item('bomb', 'weapon_bomb', 'B'), item('gun', 'weapon_gun', 'B')] }).transfers.map(t => t.itemId)).toEqual(['gun']))
  it('a Whisperer can steal an unused bomb', () => expect(plan('Whisperer', 'Survivor', { items: [item('bomb', 'weapon_bomb', 'B')] }).transfers.map(t => t.itemId)).toEqual(['bomb']))
  it('bashing and mauling take all held items and award only eligible combat serums', () => {
    const matchups = [{ matchupId: 'M', homeRosterId: 'a', awayRosterId: 'b', homeScore: 160, awayScore: 100, homeBaseScore: 120, awayBaseScore: 100, homeWeaponBonus: 20, awayWeaponBonus: 0 }]
    expect(plan('Survivor', 'Zombie', { matchups }).transfers).toHaveLength(4)
    expect(plan('Survivor', 'Survivor', { matchups }).awards.some(a => a.reason === 'bashing')).toBe(false)
    expect(plan('Whisperer', 'Zombie', { matchups }).awards.some(a => a.reason === 'mauling')).toBe(false)
    expect(plan('Zombie', 'Whisperer', { matchups }).awards.some(a => a.reason === 'mauling')).toBe(true)
  })
  it('awards weapons by base score, never the boosted score', () => expect(plan().awards.filter(a => a.itemType.startsWith('weapon_')).map(a => a.itemType)).toEqual(['weapon_knife', 'weapon_knife']))
  it('Whisperers can earn the high-score serum too', () => expect(plan('Whisperer').awards).toContainEqual({ rosterId: 'a', itemType: 'serum', reason: 'weekly_high_score' }))
  it('ties award scoring items but steal nothing', () => expect(plan('Survivor', 'Zombie', { matchups: [{ matchupId: 'M', homeRosterId: 'a', awayRosterId: 'b', homeScore: 100, awayScore: 100, homeBaseScore: 100, awayBaseScore: 100, homeWeaponBonus: 0, awayWeaponBonus: 0 }] }).transfers).toEqual([]))
  it('held items received too late to use are still eligible loot', () => expect(plan('Zombie', 'Survivor', { items: [item('late-serum', 'serum', 'B', { activatesAtWeek: 5 })] }).transfers.map(t => t.itemId)).toEqual(['late-serum']))
  it('spent serums and bombs cannot be looted', () => expect(plan('Zombie', 'Survivor', { items: [item('spent', 'serum', 'B', { isUsed: true })] }).transfers).toEqual([]))
})
