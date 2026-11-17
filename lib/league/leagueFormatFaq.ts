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

/** Prefer persisted format identity; scoring/roster variants must not replace a base format. */
export function leagueFormatFaqHref(input: LeagueFormatFaqInput): string {
  const settings = input.settings && typeof input.settings === 'object' && !Array.isArray(input.settings)
    ? input.settings as Record<string, unknown> : {}
  const canonical = key(resolveLeagueIntroFormatKey({ leagueTypeColumn: input.leagueType, settings }))
  // Survivor Guilly deliberately persists as a redraft shell with a dedicated specialty variant.
  if ((!canonical || canonical === 'redraft') && key(input.leagueVariant) === 'survivor_guillotine') {
    return hrefFor('survivor_guillotine')
  }
  if (canonical) return hrefFor(canonical)
  const variant = key(input.leagueVariant)
  if (variant && hrefFor(variant) !== FAQ) return hrefFor(variant)
  if (input.guillotineMode === true || settings.guillotineMode === true || settings.guillotine_mode === true) return hrefFor('guillotine')
  if (input.bestBallMode === true || settings.bestBallMode === true || settings.best_ball_mode === true) return hrefFor('best_ball')
  const legacy = key(input.format)
  if (legacy && hrefFor(legacy) !== FAQ) return hrefFor(legacy)
  if (input.isDynasty === true) return hrefFor('dynasty')
  if (input.isDynasty === false) return hrefFor('redraft')
  return FAQ
}
