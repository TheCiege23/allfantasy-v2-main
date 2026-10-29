import catalog from './tribeCatalog.json'

export const SURVIVOR_TRIBE_CATALOG = catalog
/** A commissioner's choice for one tribe. Colours are optional `#rrggbb` overrides of the catalogue defaults. */
export type SurvivorTribeSlot = { catalogId: string; managerCount: number; primaryColor?: string; secondaryColor?: string }
export const SURVIVOR_TRIBE_SPORTS = ['nfl', 'ncaaf', 'nba', 'ncaab', 'mlb', 'nhl', 'soccer'] as const
export type SurvivorTribeSportKey = (typeof SURVIVOR_TRIBE_SPORTS)[number]
const SPORTS = new Set<string>(SURVIVOR_TRIBE_SPORTS)
const SPORT_KIT: Record<SurvivorTribeSportKey, string> = { nfl: 'football', ncaaf: 'football', nba: 'basketball', ncaab: 'basketball', mlb: 'baseball', nhl: 'hockey', soccer: 'soccer' }
const HEX = /^#[0-9a-f]{6}$/i
/** Bump when the composer's output changes so long-cached emblem URLs refresh. */
export const TRIBE_EMBLEM_VERSION = '1'
const LEGACY_CREST = /^\/survivor\/tribes\/crests\/[a-z]+\/([a-z]+)\.svg$/

export type TribeEmblemOptions = { name?: string | null; primaryColor?: string | null; secondaryColor?: string | null }

export function isTribeHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value)
}

export function tribeSportKey(sport: string | null | undefined): SurvivorTribeSportKey | null {
  const key = String(sport ?? '').toLowerCase()
  return SPORTS.has(key) ? key as SurvivorTribeSportKey : null
}

function emblemQuery(catalogId: string, extra: Record<string, string>, opts?: TribeEmblemOptions): string {
  const q = new URLSearchParams({ tribe: catalogId, ...extra })
  const tribe = catalog.find(t => t.id === catalogId)
  const name = typeof opts?.name === 'string' ? opts.name.trim() : ''
  if (name && name !== tribe?.name) q.set('name', Array.from(name).slice(0, 64).join(''))
  if (isTribeHex(opts?.primaryColor) && opts.primaryColor.toLowerCase() !== tribe?.primary) q.set('p', opts.primaryColor.slice(1).toLowerCase())
  if (isTribeHex(opts?.secondaryColor) && opts.secondaryColor.toLowerCase() !== tribe?.secondary) q.set('s', opts.secondaryColor.slice(1).toLowerCase())
  q.set('v', TRIBE_EMBLEM_VERSION)
  return q.toString()
}

/**
 * Crest URL, composed server-side by /api/survivor/tribe-emblem/crest. The URL carries every input
 * (tribe, sport, colours, display name), so a renamed or recoloured tribe gets a new, cacheable URL.
 */
export function tribeCrestUrl(catalogId: string, sport: string, opts?: TribeEmblemOptions): string | null {
  if (!catalog.some(tribe => tribe.id === catalogId)) return null
  const key = tribeSportKey(sport)
  if (!key) return null
  return `/api/survivor/tribe-emblem/crest?${emblemQuery(catalogId, { sport: key }, opts)}`
}

/** Round avatar mark (mascot in the league sport's kit, no banner). */
export function tribeMarkUrl(catalogId: string, sport: string, opts?: Omit<TribeEmblemOptions, 'name'>): string | null {
  if (!catalog.some(tribe => tribe.id === catalogId)) return null
  const key = tribeSportKey(sport)
  if (!key) return null
  return `/api/survivor/tribe-emblem/mark?${emblemQuery(catalogId, { kit: SPORT_KIT[key] }, { primaryColor: opts?.primaryColor, secondaryColor: opts?.secondaryColor })}`
}

/** Catalogue id for a tribe row: the stored column, else the legacy static crest URL it was provisioned with. */
export function tribeCatalogIdFor(row: { catalogId?: string | null; logoUrl?: string | null }): string | null {
  if (row.catalogId && catalog.some(t => t.id === row.catalogId)) return row.catalogId
  const legacy = row.logoUrl ? LEGACY_CREST.exec(row.logoUrl)?.[1] : undefined
  return legacy && catalog.some(t => t.id === legacy) ? legacy : null
}

export type SurvivorTribeEmblemRow = {
  name: string; logoUrl?: string | null; catalogId?: string | null
  primaryColor?: string | null; secondaryColor?: string | null
}

export type ResolvedTribeEmblem = { crestUrl: string | null; markUrl: string | null; catalogId: string | null; mascot: string | null }

/**
 * The image a tribe row should show: catalogue tribes are composed with their CURRENT name and
 * colours (so a rename shows in the banner); anything else keeps its stored logoUrl.
 */
export function resolveTribeEmblem(row: SurvivorTribeEmblemRow, sport: string | null | undefined): ResolvedTribeEmblem {
  const catalogId = tribeCatalogIdFor(row)
  const fallback = row.logoUrl ?? null
  if (!catalogId) return { crestUrl: fallback, markUrl: fallback, catalogId: null, mascot: null }
  const colors = { primaryColor: row.primaryColor, secondaryColor: row.secondaryColor }
  const s = sport ?? 'nfl'
  return {
    crestUrl: tribeCrestUrl(catalogId, s, { name: row.name, ...colors }) ?? fallback,
    markUrl: tribeMarkUrl(catalogId, s, colors) ?? fallback,
    catalogId,
    mascot: catalog.find(t => t.id === catalogId)?.mascot ?? null,
  }
}

/** Accessible name for a full crest: "<Name> tribe crest, <mascot>". Decorative marks beside a visible name use alt="". */
export function tribeCrestAlt(name: string, mascot?: string | null): string {
  return mascot ? `${name} tribe crest, ${mascot}` : `${name} tribe crest`
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
    for (const key of ['primaryColor', 'secondaryColor'] as const) {
      if (slot[key] !== undefined && slot[key] !== null && !isTribeHex(slot[key])) return 'Tribe colours must be six-digit hex colours.'
    }
    total += slot.managerCount
  }
  return total === managers ? null : `Tribe capacities total ${total}; they must total ${managers} managers.`
}

/** Keep only known slot fields (call after validateTribeSlots), lowercasing colour overrides. */
export function canonicalTribeSlots(slots: SurvivorTribeSlot[]): SurvivorTribeSlot[] {
  return slots.map(slot => ({
    catalogId: slot.catalogId,
    managerCount: slot.managerCount,
    ...(isTribeHex(slot.primaryColor) ? { primaryColor: slot.primaryColor.toLowerCase() } : {}),
    ...(isTribeHex(slot.secondaryColor) ? { secondaryColor: slot.secondaryColor.toLowerCase() } : {}),
  }))
}

export function readTribeSlots(settings: Record<string, unknown>, managers: number, tribes: number): SurvivorTribeSlot[] {
  const nested = settings.survivorFoundationSettings as Record<string, unknown> | undefined
  const value = settings.survivorTribeSlots ?? nested?.survivorTribeSlots
  return validateTribeSlots(value, managers, tribes) === null ? canonicalTribeSlots(value as SurvivorTribeSlot[]) : defaultTribeSlots(managers, tribes)
}
