/**
 * Temporary NCAAF compatibility boundary.
 *
 * G50 canonicalizes NFL Redraft only. Keeping the legacy API-Sports imports in
 * this explicitly named NCAAF module prevents the shared cron routes from
 * becoming a silent second NFL ingestion path.
 */
export async function syncLegacyNcaafScores(season?: string): Promise<number> {
  const { syncAPISportsGamesToDb } = await import('@/lib/api-sports')
  return syncAPISportsGamesToDb({ season, sport: 'NCAAF' })
}

export async function syncLegacyNcaafInjuries(season?: string): Promise<number> {
  const { syncAPISportsInjuriesToDb } = await import('@/lib/api-sports')
  return syncAPISportsInjuriesToDb({ season, sport: 'NCAAF' })
}

