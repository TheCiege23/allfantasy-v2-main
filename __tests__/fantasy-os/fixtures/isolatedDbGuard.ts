/**
 * Fail-closed database guard for the durable-sync persisted integration suite.
 *
 * The suite writes real rows, so it must be impossible to point it at anything other than the ONE
 * explicitly-approved isolated test database. This guard refuses — by throwing immediately, never by
 * silently skipping — for a missing, malformed, unknown, non-allowlisted, or production database
 * identity, and requires an explicit opt-in. It never prints credentials or a full connection string:
 * error messages reference only the host and database name.
 */

/** Approved isolated, NON-production Neon project (a distinct project from prod). */
export const APPROVED_HOST_FRAGMENT = 'ep-muddy-leaf'
/** Approved database name on that project. */
export const REQUIRED_DB_NAME = 'neondb'
/** The known production endpoint — always refused. */
export const PRODUCTION_HOST_FRAGMENT = 'ep-curly-block'
/** Explicit opt-in required to run persisted writes. */
export const OPT_IN_ENV = 'ALLOW_SLEEPER_SYNC_INTEGRATION_WRITES'

export interface DbIdentity {
  /** host:port only — never includes user:password. */
  host: string
  database: string
}

/** Parse the host + database out of a Postgres URL WITHOUT surfacing credentials. Throws if unparseable. */
export function parseDbIdentity(databaseUrl: string): DbIdentity {
  const u = new URL(databaseUrl.trim().replace(/^postgres(ql)?:\/\//i, 'http://'))
  const host = u.host // host[:port] — credentials are on u.username/u.password and are intentionally ignored
  const database = decodeURIComponent(u.pathname.replace(/^\//, '')).split('?')[0]
  if (!host) throw new Error('no host')
  return { host, database }
}

/**
 * Assert the process is pointed at the approved isolated test database AND explicitly opted in.
 * Returns the sanitized identity on success; throws a credential-free error otherwise.
 */
export function assertIsolatedTestDatabase(
  databaseUrl: string | undefined | null,
  optInFlag: string | undefined | null,
): DbIdentity {
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error('[sleeper-sync integration] REFUSED: DATABASE_URL is missing — set the approved isolated test database.')
  }

  let identity: DbIdentity
  try {
    identity = parseDbIdentity(databaseUrl)
  } catch {
    // Deliberately does NOT echo the URL — it may contain credentials.
    throw new Error('[sleeper-sync integration] REFUSED: DATABASE_URL is malformed / unparseable.')
  }

  const { host, database } = identity

  if (host.includes(PRODUCTION_HOST_FRAGMENT)) {
    throw new Error(
      `[sleeper-sync integration] REFUSED: host "${host}" is the PRODUCTION endpoint — never run persisted tests against production.`,
    )
  }
  if (!host.includes(APPROVED_HOST_FRAGMENT)) {
    throw new Error(
      `[sleeper-sync integration] REFUSED: host "${host}" is not the approved isolated test database ` +
        `(must contain "${APPROVED_HOST_FRAGMENT}"). Unknown databases are refused, never silently skipped.`,
    )
  }
  if (database !== REQUIRED_DB_NAME) {
    throw new Error(
      `[sleeper-sync integration] REFUSED: database "${database}" is not the approved name "${REQUIRED_DB_NAME}".`,
    )
  }
  if (optInFlag !== 'true') {
    throw new Error(
      `[sleeper-sync integration] REFUSED: set ${OPT_IN_ENV}=true to explicitly opt in to persisted writes against the isolated test database.`,
    )
  }

  return { host, database }
}
