export type ProviderWriteMode = 'dry-run' | 'write'

export type ProviderWriteSafetyInput = {
  write: boolean
  targetSport: string
  providerMode: string
  allowedMarkers?: string[]
  env?: NodeJS.ProcessEnv
  execArgv?: string[]
}

export type ProviderWriteSafetyReport = {
  mode: ProviderWriteMode
  allowed: boolean
  targetSport: string
  providerMode: string
  appEnv: string | null
  databaseBranch: string | null
  databaseHost: string | null
  databaseName: string | null
  envFile: string | null
  errors: string[]
  warnings: string[]
}

const DEFAULT_ALLOWED_MARKERS = ['redraft-v1-data-test', 'provider-assets-data-test']

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim()
  return trimmed ? trimmed : null
}

function findEnvFile(execArgv: string[] = []): string | null {
  for (let index = 0; index < execArgv.length; index += 1) {
    const arg = execArgv[index] ?? ''
    if (arg.startsWith('--env-file=')) return blankToNull(arg.slice('--env-file='.length))
    if (arg === '--env-file') return blankToNull(execArgv[index + 1])
  }
  return null
}

function sanitizeDatabaseUrl(raw: string | null): { host: string | null; database: string | null; error: string | null } {
  if (!raw) return { host: null, database: null, error: 'DATABASE_URL is not set' }
  try {
    const parsed = new URL(raw)
    const database = parsed.pathname.replace(/^\/+/, '') || null
    return {
      host: parsed.hostname || null,
      database,
      error: null,
    }
  } catch {
    return { host: null, database: null, error: 'DATABASE_URL is not a valid URL' }
  }
}

export function inspectProviderWriteSafety(input: ProviderWriteSafetyInput): ProviderWriteSafetyReport {
  const env = input.env ?? process.env
  const allowedMarkers = input.allowedMarkers?.length ? input.allowedMarkers : DEFAULT_ALLOWED_MARKERS
  const appEnv = blankToNull(env.APP_ENV)
  const databaseBranch = blankToNull(env.DATABASE_BRANCH)
  const dbUrl = blankToNull(env.DATABASE_URL ?? env.POSTGRES_PRISMA_URL ?? env.NEON_DATABASE_URL)
  const sanitized = sanitizeDatabaseUrl(dbUrl)
  const envFile = findEnvFile(input.execArgv ?? process.execArgv)
  const errors: string[] = []
  const warnings: string[] = []
  const mode: ProviderWriteMode = input.write ? 'write' : 'dry-run'

  if (sanitized.error) warnings.push(sanitized.error)

  if (input.write) {
    if (!appEnv || !allowedMarkers.includes(appEnv)) {
      errors.push(`APP_ENV must be one of ${allowedMarkers.join(', ')} for provider writes`)
    }
    if (!databaseBranch || !allowedMarkers.includes(databaseBranch)) {
      errors.push(`DATABASE_BRANCH must be one of ${allowedMarkers.join(', ')} for provider writes`)
    }
    if (envFile && /\.env\.local$/i.test(envFile.replace(/\\/g, '/'))) {
      errors.push('Provider writes refuse .env.local; use .env.redraft-test or another ignored staging env file')
    }
    if (!sanitized.host || !sanitized.database) {
      errors.push('DATABASE_URL must be set and parseable before provider writes')
    }
    const joined = `${appEnv ?? ''} ${databaseBranch ?? ''} ${sanitized.host ?? ''} ${sanitized.database ?? ''}`.toLowerCase()
    if (/\bprod(uction)?\b/.test(joined)) {
      errors.push('Provider writes refuse production-like env, branch, host, or database labels')
    }
  }

  return {
    mode,
    allowed: !input.write || errors.length === 0,
    targetSport: input.targetSport.toUpperCase(),
    providerMode: input.providerMode,
    appEnv,
    databaseBranch,
    databaseHost: sanitized.host,
    databaseName: sanitized.database,
    envFile,
    errors,
    warnings,
  }
}

export function assertProviderWriteAllowed(input: ProviderWriteSafetyInput): ProviderWriteSafetyReport {
  const report = inspectProviderWriteSafety(input)
  if (input.write && !report.allowed) {
    throw new Error(`Unsafe provider write refused: ${report.errors.join('; ')}`)
  }
  return report
}
