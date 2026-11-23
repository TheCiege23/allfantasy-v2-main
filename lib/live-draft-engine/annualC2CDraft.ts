/** A native annual draft where each numbered pick can take a Canton rookie or a Campus player. */
export const ANNUAL_C2C_DRAFT = 'merged_rookie_college'

export function annualC2CDraftSeason(session: { draftModeLabel?: string | null; c2cConfig?: unknown } | null | undefined): number | null {
  if (session?.draftModeLabel !== ANNUAL_C2C_DRAFT) return null
  const config = session.c2cConfig as { annualSeason?: unknown } | null
  const year = config?.annualSeason
  return typeof year === 'number' && Number.isInteger(year) && year >= 1990 && year <= 2100 ? year : null
}
