import type { C2CConfigClient } from '@/lib/c2c/c2cUiLabels'
import { C2C_LEGACY_FIELDS, type LegacyFieldSpec } from '@/lib/legacy-specialty-settings/legacySettingsSpec'

/** Props every legacy C2C settings tab takes from Commissioner Settings. */
export type LegacyC2CPanelProps = {
  config: C2CConfigClient | null
  leagueId?: string
  /** Commissioner (head or co). Everyone else sees read-only values. */
  canEdit?: boolean
  /** The updated `C2CLeague` record (plus `taxiLockMode`) the PATCH returned. */
  onSaved?: (config: C2CConfigClient) => void
}

/** `min` / `max` for an int field, straight from the route's allowlist. */
export function c2cRange(key: string): { min: number; max: number } {
  const s = C2C_LEGACY_FIELDS[key] as Extract<LegacyFieldSpec, { kind: 'int' }>
  return { min: s.min, max: s.max }
}

export const asRecord = (c: C2CConfigClient | null) => c as unknown as Record<string, unknown> | null
export const asC2C = (r: Record<string, unknown>) => r as unknown as C2CConfigClient
