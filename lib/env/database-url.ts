/**
 * Resolution order for Prisma and dashboard health checks.
 * Vercel/Neon integrations often inject POSTGRES_PRISMA_URL / POSTGRES_URL without a separate DATABASE_URL.
 * Keep DATABASE_URL first so explicit project config wins.
 */
const DATABASE_URL_ENV_KEYS = [
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  /** Vercel Postgres / Neon: direct (non-pooled) URL; must be postgres:// — see playwright.config.ts parity */
  "POSTGRES_URL_NON_POOLING",
  "NEON_DATABASE_URL",
  "DIRECT_URL",
] as const

type DatabaseEnv = Partial<Record<(typeof DATABASE_URL_ENV_KEYS)[number], string | undefined>>
type EnvLike = Record<string, string | undefined>

/** True in browsers / JSDOM; false in Node SSR. Used to avoid throwing when DB helpers leak into client bundles. */
export function isDomRuntime(): boolean {
  if (typeof globalThis === "undefined") return false
  const g = globalThis as typeof globalThis & { window?: unknown; document?: unknown }
  return typeof g.window !== "undefined" || typeof g.document !== "undefined"
}

const NOOP_POSTGRES_URL = "postgresql://noop:noop@localhost:5432/noop"

function normalizeDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url)

    // Supabase transaction pooler requires PgBouncer-safe Prisma settings.
    if (parsed.hostname.endsWith("pooler.supabase.com") && parsed.port === "6543") {
      if (!parsed.searchParams.has("pgbouncer")) {
        parsed.searchParams.set("pgbouncer", "true")
      }
      if (!parsed.searchParams.has("connection_limit")) {
        parsed.searchParams.set("connection_limit", "1")
      }
      return parsed.toString()
    }

    return url
  } catch {
    return url
  }
}

function hasSupportedPostgresScheme(url: string): boolean {
  return /^(postgres|postgresql):\/\//i.test(url.trim())
}

function envRecord(env: DatabaseEnv | EnvLike): Record<string, string | undefined> {
  return env as Record<string, string | undefined>
}

export function resolveDatabaseUrl(env: DatabaseEnv | EnvLike = process.env): string | null {
  const e = envRecord(env)
  for (const key of DATABASE_URL_ENV_KEYS) {
    const raw = e[key]
    const value = typeof raw === "string" ? raw.trim() : ""
    if (!value) continue
    if (!hasSupportedPostgresScheme(value)) continue
    return normalizeDatabaseUrl(value)
  }

  return null
}

export function hasDatabaseUrl(env: DatabaseEnv | EnvLike = process.env): boolean {
  return !!resolveDatabaseUrl(env)
}

export function getDatabaseUrlOrThrow(env: DatabaseEnv | EnvLike = process.env): string {
  // Browser / DOM: Prisma and server env are unavailable — never throw (webpack may still
  // pull this module into client chunks). Prefer isDomRuntime over `window` alone (embeds, workers).
  if (isDomRuntime()) {
    return NOOP_POSTGRES_URL
  }

  // During Next.js build phase, DATABASE_URL is not available at module-import time (it is
  // only injected at runtime). Return the noop URL so route scanning / page-data collection
  // can complete without crashing. Prisma will never actually connect with this URL because
  // API routes are always dynamic (never statically invoked during the build).
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return NOOP_POSTGRES_URL
  }

  const resolved = resolveDatabaseUrl(env)
  if (resolved) return resolved

  const invalidSchemeKeys: string[] = []
  const e = envRecord(env)
  for (const key of DATABASE_URL_ENV_KEYS) {
    const raw = e[key]
    if (raw == null || typeof raw !== "string") continue
    const value = raw.trim()
    if (!value) continue
    if (!hasSupportedPostgresScheme(value)) {
      invalidSchemeKeys.push(key)
    }
  }

  if (invalidSchemeKeys.length > 0) {
    throw new Error(
      `Invalid database URL: ${invalidSchemeKeys.join(", ")} must start with postgres:// or postgresql:// ` +
        `(Prisma does not use prisma:// Accelerate URLs as DATABASE_URL). Fix the value in Vercel and redeploy.`
    )
  }

  throw new Error(
    "DATABASE_URL is not set. Add it to your local environment and Vercel project settings. " +
      "Use DATABASE_URL, or a provider alias such as POSTGRES_PRISMA_URL / POSTGRES_URL (Neon/Vercel). " +
      "Set it for Production (and Preview if needed), use a postgres:// or postgresql:// URL, then redeploy so new serverless bundles pick up the variable."
  )
}
