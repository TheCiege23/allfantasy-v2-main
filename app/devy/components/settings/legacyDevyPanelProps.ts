import { DEVY_LEGACY_FIELDS, type LegacyFieldSpec } from '@/lib/legacy-specialty-settings/legacySettingsSpec'

/** Props every legacy Devy settings tab takes from Commissioner Settings. */
export type LegacyDevyPanelProps = {
  config: Record<string, unknown> | null
  leagueId?: string
  /** Commissioner (head or co). Everyone else sees read-only values. */
  canEdit?: boolean
  /** The updated `DevyLeague` record the PATCH returned. */
  onSaved?: (config: Record<string, unknown>) => void
}

/** `min` / `max` for an int field, straight from the route's allowlist. */
export function devyRange(key: string): { min: number; max: number } {
  const s = DEVY_LEGACY_FIELDS[key] as Extract<LegacyFieldSpec, { kind: 'int' }>
  return { min: s.min, max: s.max }
}
