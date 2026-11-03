import { isDynastyLeague, type DynastyLeagueFields } from '@/lib/league/isDynastyLeague'

const SPECIALTY_FORMATS = ['guillotine', 'survivor']

/** Dynasty-family leagues share a legacy visual, while specialty formats keep their own presentation. */
export function usesDynastyBackground(league: DynastyLeagueFields & { guillotineMode?: boolean | null }): boolean {
  const type = String(league.leagueType ?? '').toLowerCase()
  const variant = String(league.leagueVariant ?? '').toLowerCase()
  const format = String(league.format ?? '').toLowerCase()
  if (league.guillotineMode || SPECIALTY_FORMATS.includes(type) || SPECIALTY_FORMATS.includes(variant) || SPECIALTY_FORMATS.includes(format)) return false
  return isDynastyLeague(league)
}
