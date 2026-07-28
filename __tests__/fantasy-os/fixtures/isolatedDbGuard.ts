/**
 * Fail-closed database guard for the durable-sync persisted integration suite.
 *
 * The suite writes real rows, so it must be impossible to point it at anything other than the ONE
 * explicitly-approved isolated test database. The allowlist is an EXACT hostname comparison (no
 * substring / prefix / suffix / regex matching), the scheme must be postgres/postgresql, the database
 * name must be `neondb`, and an explicit opt-in is required. It refuses — by throwing immediately,
 * never by silently skipping — for any missing, malformed, non-allowlisted, wrong-scheme,
 * wrong-database, or production identity. Error messages reference only the hostname and database
 * name — never a username, password, query string, or full connection string.
 */

/**
 * EXACT approved hostnames — the direct + pooler endpoints of the isolated, NON-production Neon project
 * used by `.env.test` (a distinct project from production). Matched by full-hostname equality only.
 */
export const APPROVED_HOSTNAMES: readonly string[] = Object.freeze([
  'ep-muddy-leaf-adigvvph-pooler.c-2.us-east-1.aws.neon.tech', // .env.test DATABASE_URL (pooler)
  'ep-muddy-leaf-adigvvph.c-2.us-east-1.aws.neon.tech', // .env.test DIRECT_URL (direct)
])

/** Known production endpoints — refused with an explicit message (exact match, superset of the allowlist gate). */
const KNOWN_PRODUCTION_HOSTNAMES: readonly string[] = Object.freeze([
  'ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech',
  'ep-curly-block-ad0dlt9o.c-2.us-east-1.aws.neon.tech',
])

const APPROVED_SCHEMES: ReadonlySet<string> = new Set(['postgres', 'postgresql'])

/** Approved database name on the isolated project. */
export const REQUIRED_DB_NAME = 'neondb'
/** Explicit opt-in required to run persisted writes. */
export const OPT_IN_ENV = 'ALLOW_SLEEPER_SYNC_INTEGRATION_WRITES'

export interface DbIdentity {
  /** Hostname ONLY — never includes a port, username, or password. */
  host: string
  database: string
}

interface ParsedDb {
  scheme: string
  hostname: string
  database: string
}

/** Parse scheme + hostname + database WITHOUT surfacing credentials. Throws if unparseable. */
export function parseDbIdentity(databaseUrl: string): ParsedDb {
  const raw = databaseUrl.trim()
  const schemeMatch = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i)
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : ''
  // Scheme-neutral swap so the WHATWG URL parser accepts it; user/password/query are ignored below.
  const u = new URL(raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, 'http://'))
  const hostname = u.hostname // hostname only — no port, no credentials
  const database = decodeURIComponent(u.pathname.replace(/^\//, '')).split('?')[0]
  if (!hostname) throw new Error('no host')
  return { scheme, hostname, database }
}

/**
 * Assert the process is pointed at an EXACT approved isolated test hostname AND explicitly opted in.
 * Returns the sanitized identity on success; throws a credential-free error otherwise.
 */
export function assertIsolatedTestDatabase(
  databaseUrl: string | undefined | null,
  optInFlag: string | undefined | null,
): DbIdentity {
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error('[sleeper-sync integration] REFUSED: DATABASE_URL is missing — set the approved isolated test database.')
  }

  let parsed: ParsedDb
  try {
    parsed = parseDbIdentity(databaseUrl)
  } catch {
    // Deliberately does NOT echo the URL — it may contain credentials.
    throw new Error('[sleeper-sync integration] REFUSED: DATABASE_URL is malformed / unparseable.')
  }

  const { scheme, hostname, database } = parsed

  if (!APPROVED_SCHEMES.has(scheme)) {
    throw new Error(`[sleeper-sync integration] REFUSED: scheme "${scheme}" is not postgres/postgresql.`)
  }
  if (KNOWN_PRODUCTION_HOSTNAMES.includes(hostname)) {
    throw new Error(`[sleeper-sync integration] REFUSED: host "${hostname}" is the PRODUCTION endpoint — never run persisted tests against production.`)
  }
  if (!APPROVED_HOSTNAMES.includes(hostname)) {
    // EXACT match only — a host that merely contains or resembles the approved name is refused.
    throw new Error(
      `[sleeper-sync integration] REFUSED: host "${hostname}" is not an EXACT approved isolated test hostname. ` +
        `Unknown databases are refused, never silently skipped.`,
    )
  }
  if (database !== REQUIRED_DB_NAME) {
    throw new Error(`[sleeper-sync integration] REFUSED: database "${database}" is not the approved name "${REQUIRED_DB_NAME}".`)
  }
  if (optInFlag !== 'true') {
    throw new Error(`[sleeper-sync integration] REFUSED: set ${OPT_IN_ENV}=true to explicitly opt in to persisted writes against the isolated test database.`)
  }

  return { host: hostname, database }
}
