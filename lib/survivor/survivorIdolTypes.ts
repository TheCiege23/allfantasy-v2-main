import catalog from './idols/catalog.json'
import { survivorIdolEnginePowerFor, survivorIdolPlayEngine } from './survivorIdolEngines'

/**
 * Survivor idol types (survivor-theme handoff, `idols/catalog.json`).
 *
 * The bundled catalog is the seed for the `survivor_idol_types` table and the fallback when that
 * table is not migrated yet. New idols are added as rows; the server reads rows first.
 * Client-safe: no server imports.
 */

export const SURVIVOR_IDOL_CATEGORIES = ['Protection', 'Votes', 'Scoring', 'Roster', 'Game', 'Bluff'] as const
export type SurvivorIdolCategory = (typeof SURVIVOR_IDOL_CATEGORIES)[number]

export interface SurvivorIdolTypeDef {
  id: string
  name: string
  glow: string
  category: SurvivorIdolCategory
  tier: 1 | 2 | 3
  alwaysIn: boolean
  short: string
  power: string
  when: string
  target: string
  /** The resolution engine power this idol plays as, or null while it has no engine. */
  enginePowerType: string | null
  sortOrder: number
}

export const SURVIVOR_IDOL_COUNT_OPTIONS = [6, 7, 8] as const
export const SURVIVOR_IDOL_COUNT_DEFAULT = 7
/** Pick mode (owner's call, 2026-10-20): the commissioner sets a quantity per type, 1 to 12 idols in all. */
export const SURVIVOR_IDOL_PICK_COUNT_MIN = 1
export const SURVIVOR_IDOL_PICK_COUNT_MAX = 12
export const SURVIVOR_POINT_SURGE_DEFAULT_PCT = 15
export const SURVIVOR_TRIBUTE_DEFAULT_PCT = 10

type CatalogRow = { id: string; name: string; glow: string; cat: string; tier: number; always?: boolean; short: string; power: string; when: string; target: string }

function toCategory(value: string): SurvivorIdolCategory {
  return (SURVIVOR_IDOL_CATEGORIES as readonly string[]).includes(value) ? value as SurvivorIdolCategory : 'Game'
}

function toTier(value: number): 1 | 2 | 3 {
  return value >= 3 ? 3 : value <= 1 ? 1 : 2
}

export const BUNDLED_SURVIVOR_IDOL_TYPES: readonly SurvivorIdolTypeDef[] = (catalog as CatalogRow[]).map((row, index) => ({
  id: row.id,
  name: row.name,
  glow: row.glow,
  category: toCategory(row.cat),
  tier: toTier(row.tier),
  alwaysIn: row.always === true,
  short: row.short,
  power: row.power,
  when: row.when,
  target: row.target,
  enginePowerType: survivorIdolEnginePowerFor(row.id),
  sortOrder: index,
}))

const LEGACY_POWER_TO_TYPE: Readonly<Record<string, string>> = {
  vote_shield: 'immunity', protect_self: 'immunity', extra_vote: 'extra-vote', vote_steal: 'vote-steal',
  triple_steal: 'steal-three', island_raid: 'steal-three', vote_nullifier: 'idol-nullifier', skip_tribal: 'safety-net',
}

/** Catalog id for a stored `SurvivorIdol.powerType` (engine power or underscored catalog id). */
export function survivorIdolTypeIdForPower(powerType: string | null | undefined): string | null {
  if (!powerType) return null
  const mapped = LEGACY_POWER_TO_TYPE[powerType] ?? powerType.replace(/_/g, '-')
  return BUNDLED_SURVIVOR_IDOL_TYPES.some(type => type.id === mapped) ? mapped : null
}

/**
 * Whether an idol type can be played today: its engine power is in the play-engine registry
 * (lib/survivor/survivorIdolEngines.ts). Only playable types are drawn, picked or seeded.
 */
export function isSurvivorIdolTypePlayable(type: Pick<SurvivorIdolTypeDef, 'enginePowerType'>): boolean {
  return survivorIdolPlayEngine(type.enginePowerType) !== null
}

/** What a seeded idol stores as `powerType`: the engine power when one exists, else the catalog id. */
export function survivorIdolStoredPowerType(type: Pick<SurvivorIdolTypeDef, 'id' | 'enginePowerType'>): string {
  return type.enginePowerType ?? type.id.replace(/-/g, '_')
}

export function survivorIdolTierDots(tier: number): string {
  const filled = Math.max(1, Math.min(3, Math.round(tier)))
  return '●'.repeat(filled) + '○'.repeat(3 - filled)
}

/** Card tag: `Category · ●●○`, or "Always in" for the two protection idols. */
export function survivorIdolTag(type: Pick<SurvivorIdolTypeDef, 'alwaysIn' | 'category' | 'tier'>): string {
  return type.alwaysIn ? 'Always in' : `${type.category} · ${survivorIdolTierDots(type.tier)}`
}

/** Only catalog-shaped ids reach an asset URL. */
export function survivorIdolArt(id: string | null | undefined, variant: 'hero' | 'icon' = 'hero'): string | null {
  if (!id || !/^[a-z0-9-]{1,48}$/.test(id)) return null
  return `/survivor/idols/${id}${variant === 'icon' ? '-icon' : ''}.svg`
}

export type SurvivorIdolLeagueValues = { pointSurgePct?: number | null; tributePct?: number | null }

/** Card copy with the league's Point surge size and Tribute percentage filled in. */
export function survivorIdolCopy(typeId: string, text: string, values: SurvivorIdolLeagueValues = {}): string {
  if (typeId === 'point-surge' && values.pointSurgePct) return text.replace(/e\.g\. \+\d+%/, `+${values.pointSurgePct}%`)
  if (typeId === 'tribute' && values.tributePct) return text.replace(/\d+%/, `${values.tributePct}%`)
  return text
}
