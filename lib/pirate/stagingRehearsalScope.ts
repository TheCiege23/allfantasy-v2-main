/** Temporary rehearsal infrastructure; disabled unless every isolation guard agrees. */
export const PIRATE_STAGING_PROJECT = '80e84d3b-778a-4fe6-be53-6c16068e8aa2'
export const PIRATE_STAGING_ENVIRONMENT = '686eb5e0-af93-4370-806a-af544049ea93'
export const PIRATE_REHEARSAL_MAX_UNTIL = Date.parse('2026-11-07T12:00:00Z')

export function pirateRehearsalEnabled(env: Record<string, string | undefined>, now = Date.now()): boolean {
  try {
    const until = Date.parse(env.PIRATE_REHEARSAL_UNTIL || '')
    const host = new URL(env.DATABASE_URL || '').hostname.replace('-pooler', '')
    return env.PIRATE_REHEARSAL_ENABLED === '1' &&
      env.RAILWAY_PROJECT_ID === PIRATE_STAGING_PROJECT &&
      env.RAILWAY_ENVIRONMENT_ID === PIRATE_STAGING_ENVIRONMENT &&
      /^ep-winter-salad-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(host) &&
      Number.isFinite(until) && now < until && until <= PIRATE_REHEARSAL_MAX_UNTIL &&
      !!env.PIRATE_REHEARSAL_LEAGUE_ID?.trim()
  } catch { return false }
}

export function isPirateRehearsalLeague(league: {
  id: string; tenantId: string; platform: string; leagueType: string | null; leagueVariant: string | null; settings: unknown
}, leagueId: string): boolean {
  const settings = league.settings as Record<string, unknown> | null
  return league.id === leagueId && league.tenantId.startsWith('pirate-capture-live-') &&
    league.platform === 'manual' && league.leagueType === 'pirate' && league.leagueVariant === 'pirate' &&
    settings?.pirate_live_rehearsal === true
}

/** A separately pinned daily pilot; requests cannot supply arbitrary league IDs. */
export function isPirateDailyRehearsalLeague(league: Parameters<typeof isPirateRehearsalLeague>[0], leagueId: string): boolean {
  const settings = league.settings as Record<string, unknown> | null
  const sportConfig = settings?.sportConfig as Record<string, unknown> | null
  return isPirateRehearsalLeague(league, leagueId) && league.tenantId.startsWith('pirate-capture-live-daily-') &&
    settings?.pirate_daily_rehearsal === true && sportConfig?.lineupLockType === 'daily' && sportConfig.dailyLineupsEnabled === true
}
