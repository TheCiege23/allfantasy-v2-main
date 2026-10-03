import { latestVersionOf } from '@/lib/commissioner-os/template/registry'
import type { LeagueTemplateDefinition, LeagueTemplateId } from '@/lib/commissioner-os/template/types'

/**
 * Templates a league's OWNER may apply from the Commissioner Hub.
 *
 * 🛑 NOTHING COULD WRITE A TEMPLATE PIN BEFORE THIS. `buildCommissionerTemplatePinFragment` had no
 * caller, so 0 production leagues carried a pin (measured 2026-10-02) and the EFL template, its
 * format hub and its hub card were unreachable — including for "EFL Dynasty League", the flat
 * 32-team Sleeper league the EFL template was written for.
 *
 * ⚠ AN ALLOWLIST, NOT "EVERY PUBLISHED TEMPLATE". Survivor All-Stars is published too, and
 * `lib/commissioner-os/capabilities.ts` records its runtime as explicitly not production safe.
 * Adding an id here is the deliberate decision to let owners switch that template on.
 */
export const OWNER_APPLICABLE_TEMPLATE_IDS: readonly LeagueTemplateId[] = ['efl_promotion_relegation_dynasty']

/**
 * The templates that fit this league, each at the version a NEW pin should use.
 *
 * Fit means: the template supports the sport, its base format is the league's format, and — where
 * the template fixes a team count — the league has exactly that many teams. A 12-team redraft
 * league is never offered a 32-team dynasty template. Pure: no DB, no clock.
 */
export function applicableTemplates(league: {
  sport: string | null | undefined
  canonicalFormatId: string | null | undefined
  teamCount: number | null | undefined
}): LeagueTemplateDefinition[] {
  const sport = String(league.sport ?? '').trim().toUpperCase()
  return OWNER_APPLICABLE_TEMPLATE_IDS.flatMap((id) => {
    const def = latestVersionOf(id)
    if (!def) return []
    if (!def.compatibleSports.some((s) => String(s).toUpperCase() === sport)) return []
    if (def.baseFormatId !== league.canonicalFormatId) return []
    const wanted = def.defaultSettings.teamCount
    if (typeof wanted === 'number' && league.teamCount !== wanted) return []
    return [def]
  })
}
