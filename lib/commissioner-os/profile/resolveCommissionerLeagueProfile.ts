/**
 * The pure builder for `CommissionerLeagueProfile`.
 *
 * See `./types.ts` for why this composes `resolveLeagueRules` instead of classifying anything
 * itself, and why role and platform arrive as explicit inputs.
 *
 * Pure: a plain object in, a plain object out. No prisma, no fetch, no clock, no randomness — so
 * the same league row always produces a byte-identical profile, which is what makes the planner
 * downstream testably deterministic.
 */

import { getLeagueFormatDefinitions, type LeagueFormatId } from '@/lib/league/format-engine'
import { resolveLeagueRules } from '@/lib/league-rules'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { resolveSpecialtyConceptKey } from '@/lib/specialty-automation/types'
import { composeCapabilities } from '@/lib/commissioner-os/capabilities'
import { resolveTemplate } from '@/lib/commissioner-os/template/registry'
import { templateKey } from '@/lib/commissioner-os/template/types'
import { readCommissionerTemplatePin } from '@/lib/commissioner-os/profile/templatePin'
import {
  COMMISSIONER_PROFILE_VERSION,
  type CommissionerFormatBasis,
  type CommissionerLeagueProfile,
  type CommissionerNetworkMembership,
  type CommissionerProfileDegradeReason,
  type CommissionerTemplateBinding,
} from '@/lib/commissioner-os/profile/types'
import type { LeagueSport, Prisma } from '@prisma/client'
import type { LeagueRole } from '@/lib/league/permissions'

/**
 * The league columns this needs, structurally typed.
 *
 * ⚠ NOT `League` FROM PRISMA. A structural shape keeps callers free to pass a `select`ed subset —
 * which is what every DB-first read path in this repo actually has — and keeps this module's own
 * imports type-only, so nothing here pulls the Prisma client at runtime.
 */
export type CommissionerLeagueRow = {
  id: string
  sport?: string | null
  season?: number | null
  leagueType?: string | null
  leagueVariant?: string | null
  isDynasty?: boolean | null
  settings?: Prisma.JsonValue | unknown
  keeperCount?: number | null
  keeperCostSystem?: string | null
  keeperRoundPenalty?: number | null
  guillotineMode?: boolean | null
  survivorMode?: boolean | null
  platform?: string | null
  status?: string | null
  lifecycleState?: string | null
}

export type ResolveCommissionerLeagueProfileInput = {
  league: CommissionerLeagueRow
  /**
   * The asking user's role in this league.
   *
   * ⚠ RESOLVED BY THE CALLER VIA `getLeagueRole`, NEVER HERE. `null` means "not established" and is
   * NOT the same as `'viewer'` — a surface that renders commissioner controls for an unestablished
   * role has skipped the check, not passed it.
   */
  commissionerRole: LeagueRole
  /** Caller-supplied. Nothing in this repo populates it yet. */
  networkMembership?: CommissionerNetworkMembership | null
}

const CANONICAL_FORMAT_IDS: ReadonlySet<string> = new Set(
  getLeagueFormatDefinitions().map((f) => f.id),
)

const SUPPORTED_SPORT_SET: ReadonlySet<string> = new Set<LeagueSport>([
  'NFL',
  'NBA',
  'MLB',
  'NHL',
  'NCAAF',
  'NCAAB',
  'SOCCER',
])

function normalizeKey(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_')
}

/**
 * Strict canonical-format lookup.
 *
 * 🛑 RETURNS NULL RATHER THAN 'redraft'. `toFormatId` in `lib/league/format-engine.ts` defaults to
 * redraft and is right to, for a create form that has to offer something. Here that default would
 * make an unclassifiable league look like a plain seasonal league and switch off every specialty
 * behaviour it has, with nothing red anywhere. The brief names this explicitly.
 */
function strictFormatId(value: string | null | undefined): LeagueFormatId | null {
  const key = normalizeKey(value)
  return CANONICAL_FORMAT_IDS.has(key) ? (key as LeagueFormatId) : null
}

function normalizeSport(value: string | null | undefined): LeagueSport | null {
  const key = String(value ?? '').trim().toUpperCase()
  return SUPPORTED_SPORT_SET.has(key) ? (key as LeagueSport) : null
}

/**
 * Precedence for the canonical format, in order, with the reason each step exists.
 *
 * 1. `concept.flattenedOnto` — the concept KNOWS its base shell. Royal and Pirate/Vampire are
 *    dynasty; King of the Hill is redraft. Taking the concept id instead would produce
 *    `king_of_the_hill`, which is not a `LeagueFormatId` at all.
 * 2. `concept.id` — for concepts that ARE formats (guillotine, survivor, dynasty, keeper, ...).
 * 3. `pricingBaseFormat` — the classifier's answer, when no catalog entry matched. Less specific
 *    but never wrong.
 * 4. the PINNED template's `baseFormatId` — last, because a pin is the least-verified input here.
 * 5. null — degraded.
 *
 * ⚠ STEP 1 BEFORE STEP 2 IS THE WHOLE ALIAS-PRESERVATION PROPERTY. `conceptId` is reported
 * separately and is never overwritten, so the profile says "King of the Hill, on a redraft shell"
 * rather than having to pick one and erase the other.
 */
function resolveCanonicalFormat(
  rules: ReturnType<typeof resolveLeagueRules>,
  templateBaseFormatId: LeagueFormatId | null,
): {
  canonicalFormatId: LeagueFormatId | null
  formatBasis: CommissionerFormatBasis
} {
  const flattened = strictFormatId(rules.concept?.flattenedOnto ?? null)
  if (flattened) return { canonicalFormatId: flattened, formatBasis: 'flattened_base' }

  const fromConcept = strictFormatId(rules.concept?.id ?? null)
  if (fromConcept) return { canonicalFormatId: fromConcept, formatBasis: 'concept_id' }

  const fromPricing = strictFormatId(rules.pricingBaseFormat)
  if (fromPricing) return { canonicalFormatId: fromPricing, formatBasis: 'pricing_base' }

  if (templateBaseFormatId) {
    return { canonicalFormatId: templateBaseFormatId, formatBasis: 'template_base' }
  }

  return { canonicalFormatId: null, formatBasis: 'unresolved' }
}

function bindTemplate(
  settings: unknown,
  sport: LeagueSport | null,
): { binding: CommissionerTemplateBinding | null; degrade: CommissionerProfileDegradeReason[] } {
  const pin = readCommissionerTemplatePin(settings)
  if (!pin) return { binding: null, degrade: [] }

  const definition = resolveTemplate(pin.id, pin.version)
  const key = templateKey(pin.id, pin.version)

  if (!definition) {
    return {
      binding: {
        id: pin.id,
        version: pin.version,
        key,
        definition: null,
        /*
         * ⚠ THE MESSAGE SAYS "NOT PUBLISHED", NOT "UNKNOWN TEMPLATE". A pin can fail because the id
         * is wrong OR because that id exists at other versions — and in the second case the
         * tempting repair is to run a version we do have, which is the silent-upgrade failure the
         * registry refuses. Naming the pin verbatim keeps the repair a human decision.
         */
        unresolvedReason: `No published template ${key}.`,
      },
      degrade: ['template_pin_unresolved'],
    }
  }

  const degrade: CommissionerProfileDegradeReason[] = []
  if (sport && !definition.compatibleSports.includes(sport)) {
    degrade.push('template_sport_incompatible')
  }

  return {
    binding: { id: pin.id, version: pin.version, key, definition, unresolvedReason: null },
    degrade,
  }
}

export function resolveCommissionerLeagueProfile(
  input: ResolveCommissionerLeagueProfileInput,
): CommissionerLeagueProfile {
  const { league } = input
  const sport = normalizeSport(league.sport)

  /*
   * 🛑 ONE CALL, AND EVERY FORMAT FACT COMES OUT OF IT. Alias tags are read inside
   * `resolveLeagueRules` by the one reader that knows the path, handed to `readFormatRules` by the
   * one classifier that knows `idp` is a modifier and `royal` is a format, and returned with the
   * concept and pricing base kept separate. Re-deriving any of that here would be a second answer
   * to a question that already has one.
   */
  const rules = resolveLeagueRules({
    leagueType: league.leagueType,
    isDynasty: league.isDynasty,
    keeperCount: league.keeperCount,
    keeperCostSystem: league.keeperCostSystem,
    keeperRoundPenalty: league.keeperRoundPenalty,
    settings: league.settings,
    sport: league.sport,
  })

  const { binding, degrade: templateDegrade } = bindTemplate(league.settings, sport)
  const { canonicalFormatId, formatBasis } = resolveCanonicalFormat(
    rules,
    binding?.definition?.baseFormatId ?? null,
  )

  const capabilityIds = composeCapabilities({
    canonicalFormatId,
    conceptId: rules.concept?.id ?? null,
    modifierIds: rules.modifiers.map((m) => m.id),
    templateCapabilityIds: binding?.definition?.capabilityIds,
  })

  /*
   * ⚠ THE LEGACY KEY IS COMPUTED FROM THE SAME ROW, NOT FROM THE PROFILE. Deriving it from
   * `capabilityIds` would change what the existing automation pipeline dispatches — a behaviour
   * change smuggled into a foundation phase. It is called with exactly the shape it already
   * expects, so it answers exactly what it answers today.
   */
  const legacySpecialtyConceptKey = resolveSpecialtyConceptKey({
    leagueType: league.leagueType ?? null,
    leagueVariant: league.leagueVariant ?? null,
    settings: (league.settings ?? null) as Prisma.JsonValue,
    guillotineMode: league.guillotineMode ?? null,
    survivorMode: league.survivorMode ?? null,
  })

  const degradedReasons: CommissionerProfileDegradeReason[] = [...templateDegrade]
  if (!canonicalFormatId) degradedReasons.push('unknown_format')
  if (!rules.concept) degradedReasons.push('no_catalog_concept')
  /*
   * ⚠ `sportSupported` IS THREE-VALUED — `null` MEANS NO SPORT WAS SUPPLIED, NOT "UNSUPPORTED".
   * Testing it truthily would report every league whose caller omitted `sport` as playing a sport
   * its own format does not support.
   */
  if (rules.sportSupported === false) degradedReasons.push('concept_sport_unsupported')

  return {
    profileVersion: COMMISSIONER_PROFILE_VERSION,

    leagueId: league.id,
    season: typeof league.season === 'number' ? league.season : null,
    sport,

    canonicalFormatId,
    formatBasis,
    conceptId: rules.concept?.id ?? null,
    conceptLabel: rules.concept?.label ?? null,
    flattenedOnto: rules.flattenedOnto,
    pricingBaseFormat: rules.pricingBaseFormat,
    aliasTags: rules.aliasTags,
    modifierIds: rules.modifiers.map((m) => m.id),

    capabilityIds,
    template: binding,
    legacySpecialtyConceptKey,

    commissionerRole: input.commissionerRole,
    platform: league.platform ?? null,
    writeAuthority: resolveWriteAuthority(league.platform),
    networkMembership: input.networkMembership ?? null,

    lifecycleState: league.lifecycleState ?? null,
    status: league.status ?? null,

    resolution: degradedReasons.length > 0 ? 'degraded' : 'resolved',
    degradedReasons: [...new Set(degradedReasons)].sort(),

    rules,
  }
}
