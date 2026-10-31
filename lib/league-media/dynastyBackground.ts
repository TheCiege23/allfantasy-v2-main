/** Dynasty-family leagues share a legacy visual, while specialty formats keep their own presentation. */
export function usesDynastyBackground(league: { isDynasty?: boolean | null; leagueType?: string | null; leagueVariant?: string | null; format?: string | null; guillotineMode?: boolean | null }): boolean {
  const type = String(league.leagueType ?? '').toLowerCase()
  const variant = String(league.leagueVariant ?? '').toLowerCase()
  const format = String(league.format ?? '').toLowerCase()
  if (league.guillotineMode || ['guillotine', 'survivor'].includes(type) || ['guillotine', 'survivor'].includes(variant) || ['guillotine', 'survivor'].includes(format)) return false
  return Boolean(league.isDynasty || ['dynasty', 'devy', 'c2c'].includes(type) || ['dynasty', 'devy', 'c2c', 'devy_dynasty', 'merged_devy_c2c'].includes(variant) || format === 'dynasty')
}
