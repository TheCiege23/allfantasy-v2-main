export type StagingEnvironmentAssessment = {
  confirmed: boolean
  checks: {
    databaseUrlPresent: boolean
    databaseLooksStaging: boolean
    databaseLooksProduction: boolean
    nodeEnv: string
    nodeEnvLooksProduction: boolean
    vercelEnv: string
    vercelEnvLooksStaging: boolean
    vercelEnvLooksProduction: boolean
    appEnv: string
    appEnvLooksStaging: boolean
    appEnvLooksProduction: boolean
  }
  notes: string[]
}

function parseEnvValue(value: string | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

function containsAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle))
}

function tryParseDatabaseTarget(raw: string): { host: string; database: string } {
  if (!raw) return { host: '', database: '' }
  try {
    const url = new URL(raw)
    return {
      host: String(url.hostname ?? '').toLowerCase(),
      database: String(url.pathname ?? '').replace(/^\//, '').toLowerCase(),
    }
  } catch {
    return {
      host: raw.toLowerCase(),
      database: '',
    }
  }
}

export function assessStagingEnvironment(env: NodeJS.ProcessEnv): StagingEnvironmentAssessment {
  const nodeEnv = parseEnvValue(env.NODE_ENV)
  const vercelEnv = parseEnvValue(env.VERCEL_ENV)
  const appEnv = parseEnvValue(env.APP_ENV ?? env.AF_APP_ENV ?? env.NEXT_PUBLIC_APP_ENV)
  const databaseUrl = String(env.DATABASE_URL ?? '').trim().toLowerCase()

  const databaseUrlPresent = databaseUrl.length > 0
  const dbTarget = tryParseDatabaseTarget(databaseUrl)
  const dbHints = `${dbTarget.host} ${dbTarget.database}`
  const databaseLooksStaging = containsAny(dbHints, ['staging', 'stage', 'stg', 'preview', 'sandbox'])
  const databaseLooksProduction = containsAny(dbHints, ['prod', 'production'])

  const nodeEnvLooksProduction = nodeEnv === 'production'
  const vercelEnvLooksStaging = vercelEnv === 'preview' || vercelEnv === 'staging'
  const vercelEnvLooksProduction = vercelEnv === 'production'
  const appEnvLooksStaging = containsAny(appEnv, ['staging', 'stage', 'stg', 'preview', 'dev'])
  const appEnvLooksProduction = containsAny(appEnv, ['prod', 'production'])

  const hasStagingSignal = databaseLooksStaging || vercelEnvLooksStaging || appEnvLooksStaging
  const hasProductionSignal =
    databaseLooksProduction || vercelEnvLooksProduction || appEnvLooksProduction || nodeEnvLooksProduction

  const notes: string[] = []
  if (!databaseUrlPresent) notes.push('database_url_missing')
  if (!hasStagingSignal) notes.push('no_positive_staging_signal')
  if (hasProductionSignal) notes.push('production_signal_present')

  return {
    confirmed: databaseUrlPresent && hasStagingSignal && !hasProductionSignal,
    checks: {
      databaseUrlPresent,
      databaseLooksStaging,
      databaseLooksProduction,
      nodeEnv,
      nodeEnvLooksProduction,
      vercelEnv,
      vercelEnvLooksStaging,
      vercelEnvLooksProduction,
      appEnv,
      appEnvLooksStaging,
      appEnvLooksProduction,
    },
    notes,
  }
}
