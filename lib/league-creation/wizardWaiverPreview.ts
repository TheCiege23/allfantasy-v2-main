import { getLeagueFormatDefinition } from '@/lib/league/format-engine'
import { getWaiverDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import type { SportType, WaiverDefaults } from '@/lib/sport-defaults/types'

/**
 * The waiver defaults the create-league wizard previews.
 *
 * The wizard loads `/api/sport-defaults` keyed on the scoring VARIANT (STANDARD, PPR …), so an NBA or
 * NHL redraft league previewed rolling or reverse standings — while the canonical create path writes
 * `getWaiverDefaults(sport, format.id)` (lib/league/format-engine.ts), which is FAAB $100 for redraft.
 * For redraft the preview now reads the same registry row creation does. Other formats keep the
 * variant preset: their creation adds format-specific setup (dynasty, devy …) this does not model.
 */
export function wizardWaiverPreviewDefaults<T extends object>(
  presetWaiver: T | undefined,
  sport: string,
  leagueType: string | null | undefined,
): T | undefined {
  const formatId = getLeagueFormatDefinition(leagueType).id
  if (formatId !== 'redraft') return presetWaiver
  const created: WaiverDefaults = getWaiverDefaults(String(sport).toUpperCase() as SportType, formatId)
  // The preset's own shape is a loose copy of WaiverDefaults, so the registry row fits it.
  return (presetWaiver ? { ...presetWaiver, ...created } : created) as unknown as T
}
