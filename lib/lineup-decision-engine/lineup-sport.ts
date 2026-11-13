import { DEFAULT_SPORT, isSupportedSport, normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'

/** Prisma-backed sports plus optimizer-first extensions (not all are LeagueSport yet). */
export type ExtendedLineupSport = SupportedSport | 'GOLF' | 'NASCAR'

export function resolveExtendedLineupSport(raw?: string | null): ExtendedLineupSport {
  const u = raw?.trim().toUpperCase() ?? ''
  if (u === 'PGA' || u === 'GOLF') return 'GOLF'
  if (u === 'CUP' || u === 'NASCAR') return 'NASCAR'
  if (isSupportedSport(u)) return u as SupportedSport
  return normalizeToSupportedSport(raw)
}

export function displaySportLabel(sport: string): string {
  if (sport === 'GOLF') return 'Golf'
  if (sport === 'NASCAR') return 'NASCAR'
  return sport
}

export { DEFAULT_SPORT }
