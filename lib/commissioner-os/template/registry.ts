/**
 * The template registry — every published version of every template, and no "latest" anywhere.
 *
 * 🛑 `resolveTemplate` RESOLVES AN EXACT `id@version` OR RETURNS NULL. There is deliberately no
 * fallback to the newest version, not even when only one version exists. A silent upgrade is the
 * whole failure this design is here to prevent: it would change the rules of a running season with
 * no conflict, no error, no failing test and nothing for a commissioner to notice. An unresolvable
 * pin is a DEGRADED state that a surface must show, not a problem to paper over by guessing.
 *
 * ⚠ `latestVersionOf` EXISTS AND IS FOR NEW LEAGUES ONLY. It answers "what should I pin when
 * creating", never "what should I run for a league already pinned to something else". The two
 * questions look alike and only one of them is safe to answer from the registry.
 *
 * ⚠ VERSIONS ARE NEVER DELETED FROM THIS MAP. A league pinned to `1.0.0` keeps playing `1.0.0`
 * forever. Removing an entry to tidy up strands that league in the degraded state, which is honest
 * but useless.
 *
 * Pure: frozen data and lookups.
 */

import { EFL_PROMOTION_RELEGATION_DYNASTY_V1 } from '@/lib/commissioner-os/template/definitions/eflPromotionRelegationDynasty'
import { EFL_PROMOTION_RELEGATION_DYNASTY_V1_1 } from '@/lib/commissioner-os/template/definitions/eflPromotionRelegationDynastyV1_1'
import { EFL_PROMOTION_RELEGATION_DYNASTY_V1_2 } from '@/lib/commissioner-os/template/definitions/eflPromotionRelegationDynastyV1_2'
import { SURVIVOR_ALL_STARS_GUILLOTINE_V1 } from '@/lib/commissioner-os/template/definitions/survivorAllStarsGuillotine'
import {
  templateKey,
  type LeagueTemplateDefinition,
  type LeagueTemplateId,
  type LeagueTemplateKey,
} from '@/lib/commissioner-os/template/types'

/**
 * ⚠ 1.0.0 STAYS HERE FOREVER, BESIDE 1.1.0. A league pinned to `efl_promotion_relegation_dynasty@1.0.0`
 * keeps playing 1.0.0; removing the entry to tidy up would strand it in the degraded state. The cost
 * of keeping it is a frozen object.
 */
const ALL_TEMPLATE_VERSIONS: readonly LeagueTemplateDefinition[] = Object.freeze([
  EFL_PROMOTION_RELEGATION_DYNASTY_V1,
  EFL_PROMOTION_RELEGATION_DYNASTY_V1_1,
  EFL_PROMOTION_RELEGATION_DYNASTY_V1_2,
  SURVIVOR_ALL_STARS_GUILLOTINE_V1,
])

const BY_KEY: ReadonlyMap<LeagueTemplateKey, LeagueTemplateDefinition> = new Map(
  ALL_TEMPLATE_VERSIONS.map((t) => [templateKey(t.id, t.version), t]),
)

/**
 * Resolve an exact pin.
 *
 * ⚠ RETURNS NULL FOR AN UNKNOWN ID *AND* FOR A KNOWN ID AT AN UNKNOWN VERSION, AND THOSE ARE THE
 * SAME ANSWER ON PURPOSE. Both mean "this league is pinned to rules I do not have"; distinguishing
 * them would tempt a caller into substituting a version it does have.
 */
export function resolveTemplate(
  id: string | null | undefined,
  version: string | null | undefined,
): LeagueTemplateDefinition | null {
  if (!id || !version) return null
  return BY_KEY.get(`${id}@${version}`) ?? null
}

/** Resolve from a stored `id@version` string. */
export function resolveTemplateByKey(key: string | null | undefined): LeagueTemplateDefinition | null {
  if (!key) return null
  return BY_KEY.get(key) ?? null
}

/** Every published version, in registration order. */
export function listTemplateVersions(): readonly LeagueTemplateDefinition[] {
  return ALL_TEMPLATE_VERSIONS
}

/** Every version of one template. */
export function listVersionsOf(id: LeagueTemplateId): LeagueTemplateDefinition[] {
  return ALL_TEMPLATE_VERSIONS.filter((t) => t.id === id)
}

/**
 * The version a NEW league should pin.
 *
 * 🛑 NEVER CALL THIS TO DECIDE WHAT TO RUN FOR AN EXISTING LEAGUE. Use `resolveTemplate` with the
 * league's own stored pin. This function exists for creation and for an explicit, deliberate,
 * commissioner-approved migration — nothing else.
 *
 * Compares numerically by semver segment rather than lexically, because `'1.10.0' < '1.9.0'` as
 * strings and a string sort would hand a new league the older ruleset.
 */
export function latestVersionOf(id: LeagueTemplateId): LeagueTemplateDefinition | null {
  const versions = listVersionsOf(id)
  if (versions.length === 0) return null
  return versions.reduce((best, t) => (compareSemver(t.version, best.version) > 0 ? t : best))
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export { templateKey }
