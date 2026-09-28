import { getRosterDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import { SPORT_TYPES, type SportType } from '@/lib/sport-defaults/types'
export type DraftAdvisorStarterSlot = { slotName:string; starterCount:number; allowedPositions:string[] }

/** Maximum assignment keeps a multi-position player from hiding a real unmet starter slot. */
export function draftAdvisorRosterNeeds(sport:string, roster:Array<{position:string}> = [], overrides?:DraftAdvisorStarterSlot[]):string[] {
  if (!SPORT_TYPES.includes(sport as SportType)) return []
  const defaults = getRosterDefaults(sport as SportType)
  const rows = overrides ?? Object.entries(defaults.starter_slots).map(([slotName,starterCount]) => ({slotName,starterCount,allowedPositions:defaults.flex_definitions.find(flex => flex.slotName === slotName)?.allowedPositions ?? [slotName]}))
  const slots = rows.flatMap(row => Array.from({length:Math.max(0,row.starterCount)}, () => ({name:row.slotName,positions:row.allowedPositions.map(position => position.toUpperCase())})))
  const players = roster.map(player => player.position.toUpperCase().split(/[,/]/).map(position => position.trim()))
  const owners = new Map<number,number>()
  function assign(player:number,seen:Set<number>):boolean {
    for (let slot=0;slot<slots.length;slot++) {
      if (seen.has(slot) || !players[player].some(position => slots[slot].positions.includes(position))) continue
      seen.add(slot)
      const previous = owners.get(slot)
      if (previous == null || assign(previous,seen)) { owners.set(slot,player); return true }
    }
    return false
  }
  players.forEach((_,index) => assign(index,new Set()))
  const deficits = new Map<string,number>()
  slots.forEach((slot,index) => { if (!owners.has(index)) deficits.set(slot.name,(deficits.get(slot.name) ?? 0)+1) })
  return [...deficits].sort((a,b) => b[1]-a[1]).map(([name]) => name)
}
