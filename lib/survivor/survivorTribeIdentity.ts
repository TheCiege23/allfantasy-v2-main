import catalog from './tribeCatalog.json'

export const SURVIVOR_TRIBE_CATALOG = catalog
export type SurvivorTribeSlot = { catalogId: string; managerCount: number }
const SPORTS = new Set(['nfl', 'ncaaf', 'nba', 'ncaab', 'nhl', 'mlb', 'soccer'])

export function tribeCrestUrl(catalogId: string, sport: string): string | null {
  if (!catalog.some(tribe => tribe.id === catalogId)) return null
  const key = sport.toLowerCase()
  if (!SPORTS.has(key)) return null
  return `/survivor/tribes/crests/${key}/${catalogId}.svg`
}

export function defaultTribeSlots(managers: number, tribes: number): SurvivorTribeSlot[] {
  return Array.from({ length: tribes }, (_, index) => ({
    catalogId: catalog[index % catalog.length].id,
    managerCount: Math.floor(managers / tribes) + (index < managers % tribes ? 1 : 0),
  }))
}

/** Validate without coercing or silently discarding a commissioner's choices. */
export function validateTribeSlots(value: unknown, managers: number, tribes: number): string | null {
  if (!Array.isArray(value) || value.length !== tribes) return 'Choose one identity and capacity for every tribe.'
  const ids = new Set<string>()
  let total = 0
  for (const slot of value) {
    if (!slot || typeof slot !== 'object' || !catalog.some(tribe => tribe.id === slot.catalogId)) return 'Choose a tribe from the catalogue.'
    if (ids.has(slot.catalogId)) return 'Each tribe must have a different identity.'
    ids.add(slot.catalogId)
    if (!Number.isInteger(slot.managerCount) || slot.managerCount < 1 || slot.managerCount > managers) return 'Each tribe needs a positive whole-number manager capacity.'
    total += slot.managerCount
  }
  return total === managers ? null : `Tribe capacities total ${total}; they must total ${managers} managers.`
}

export function readTribeSlots(settings: Record<string, unknown>, managers: number, tribes: number): SurvivorTribeSlot[] {
  const nested = settings.survivorFoundationSettings as Record<string, unknown> | undefined
  const value = settings.survivorTribeSlots ?? nested?.survivorTribeSlots
  return validateTribeSlots(value, managers, tribes) === null ? value as SurvivorTribeSlot[] : defaultTribeSlots(managers, tribes)
}
