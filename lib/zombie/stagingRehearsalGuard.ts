export const REHEARSAL_PROJECT = '2fa5548e-62f6-467d-9a63-6e6773c62f8a'
export function stagingRehearsalEnabled(env: Record<string, string | undefined>): boolean {
  return env.RAILWAY_PROJECT_ID === REHEARSAL_PROJECT &&
    env.RAILWAY_ENVIRONMENT_NAME === 'staging' && env.ZOMBIE_STAGING_REHEARSAL_ENABLED === '1'
}
export function rehearsalSourceIds(env: Record<string, string | undefined>): string[] {
  const ids = (env.ZOMBIE_REHEARSAL_SOURCE_LEAGUES ?? '').split(',').map(x => x.trim()).filter(Boolean)
  return ids.length === 4 && new Set(ids).size === 4 && ids.every(x => /^[a-f0-9-]{36}$/.test(x)) ? ids : []
}
