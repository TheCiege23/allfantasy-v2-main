import { readConfirmedLeagueConcept } from './leagueConceptOptions'
import { normalizeConceptToFormat } from '@/lib/league-creation/canonical/normalizeConcept'
import { resolveLeagueIntroFormatKey } from './resolveLeagueIntroFormatKey'

export type LeagueFormatFaqInput = {
  leagueType?: string | null
  leagueVariant?: string | null
  settings?: unknown
  isDynasty?: boolean | null
  guillotineMode?: boolean | null
  bestBallMode?: boolean | null
  format?: string | null
}

const FAQ = '/league-types/faq'
const aliases: Record<string, string> = {
  bestball: 'best_ball', devy_dynasty: 'devy', merged_devy_c2c: 'c2c',
  tournament_mode: 'tournament', dynasty_idp: 'dynasty',
}
function key(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[ -]+/g, '_') : ''
}
function hrefFor(value: string): string {
  if (value === 'survivor_guillotine') return FAQ + '#survivor-guillotine'
  if (value === 'idp') return FAQ + '#modifier-idp'
  const format = normalizeConceptToFormat(aliases[value] ?? value)
  return format ? FAQ + '#' + format.formatId : FAQ
}

/** A member-confirmed concept wins; older specialty leagues can still have the default redraft column. */
export function leagueFormatFaqHref(input: LeagueFormatFaqInput): string {
  const settings = input.settings && typeof input.settings === 'object' && !Array.isArray(input.settings)
    ? input.settings as Record<string, unknown> : {}
  const confirmed = readConfirmedLeagueConcept(settings)
  if (confirmed) return hrefFor(confirmed)
  const canonical = key(resolveLeagueIntroFormatKey({ leagueTypeColumn: input.leagueType, settings }))
  if (canonical && canonical !== 'redraft') return hrefFor(canonical)
  const variant = key(input.leagueVariant)
  // A bare IDP variant is a roster add-on to the saved redraft format.
  if (variant && !(canonical && variant === 'idp') && hrefFor(variant) !== FAQ) return hrefFor(variant)
  if (input.guillotineMode === true || settings.guillotineMode === true || settings.guillotine_mode === true) return hrefFor('guillotine')
  if (input.bestBallMode === true || settings.bestBallMode === true || settings.best_ball_mode === true || settings.best_ball === true) return hrefFor('best_ball')
  const legacy = key(input.format)
  if (legacy && hrefFor(legacy) !== FAQ) return hrefFor(legacy)
  if (input.isDynasty === true || settings.isDynasty === true) return hrefFor('dynasty')
  if (canonical === 'redraft' || input.isDynasty === false) return hrefFor('redraft')
  return FAQ
}
