/**
 * Deployment identity — safe, admin-only metadata that makes it unmistakable which
 * build, environment, and database the browser is actually talking to.
 *
 * Every consumer of this module is admin-gated. Even so, nothing here is a secret:
 * the database user, password, and full host are never read into the payload. The
 * endpoint label and database name ARE exposed, deliberately — "which database is
 * production pointing at" is the single question this module exists to answer, and
 * neither value is a credential. The one-way host fingerprint remains so two
 * deployments can be compared without either one disclosing its host.
 *
 * Nothing here infers identity from data (row counts, table contents). It reads
 * only deployment-wired configuration.
 */
import "server-only"
import crypto from "crypto"

export type DeploymentEnvironmentKey = "production" | "preview" | "development"

/**
 * Values that could not be determined are `null`, never a plausible-looking
 * default. A null commit SHA means "this build did not report one", which is
 * itself a finding — it must not render as "unknown version" or an empty string
 * that reads as absence of a problem.
 */
export type DeploymentIdentity = {
  /** Which host reported this identity; null when neither platform's variables are present. */
  platform: "railway" | "vercel" | null
  /** Railway service name (web and worker deploy from the same repo). Null off Railway. */
  serviceName: string | null
  /** Railway deployment id, or Vercel's dpl_… — the join key back to the host's dashboard. */
  deploymentId: string | null
  commitSha: string | null
  commitShaShort: string | null
  commitRef: string | null
  commitMessageSubject: string | null
  environment: DeploymentEnvironmentKey
  environmentLabel: string
  /** True when NODE_ENV/VERCEL_ENV disagree with an explicit OPERATOR_ENV_LABEL override. */
  environmentOverridden: boolean
  deploymentUrl: string | null
  region: string | null
  /**
   * Process start time. This is the closest safe proxy to a build timestamp that is
   * available at runtime — it is NOT when the build ran. Labeled as such in the UI.
   */
  processStartedAt: string
  database: DatabaseIdentity
}

export type DatabaseIdentity = {
  /** Neon/Postgres endpoint label — the leading DNS label of the host. Not a credential. */
  endpointLabel: string | null
  /** Database name from the connection path. Not a credential. */
  databaseName: string | null
  /** One-way fingerprint of the connection host; changes iff the host changes. */
  hostFingerprint: string | null
  /** True when DATABASE_URL is absent or unparseable — distinct from "parsed, but empty". */
  unavailable: boolean
  unavailableReason: string | null
}

const PROCESS_STARTED_AT = new Date().toISOString()

function normalize(value: string | null | undefined): string | null {
  const v = (value ?? "").trim()
  return v.length > 0 ? v : null
}

function resolveEnvironment(): {
  key: DeploymentEnvironmentKey
  label: string
  overridden: boolean
} {
  const override = normalize(process.env.OPERATOR_ENV_LABEL)?.toLowerCase()
  if (override === "production" || override === "prod") {
    return { key: "production", label: "PRODUCTION", overridden: true }
  }
  if (override === "preview" || override === "staging") {
    return { key: "preview", label: "PREVIEW", overridden: true }
  }
  if (override === "development" || override === "dev" || override === "local") {
    return { key: "development", label: "DEVELOPMENT", overridden: true }
  }

  const nodeEnv = normalize(process.env.NODE_ENV)
  const vercelEnv = normalize(process.env.VERCEL_ENV)

  /*
   * ⚠ PRODUCTION RUNS ON RAILWAY (since 2026-09-02), WHICH SETS NO VERCEL_ENV.
   * Until this branch the real production deploy fell through to the
   * "not deployed" case below and reported itself as DEVELOPMENT. Railway's
   * environment name is the equivalent signal; any other Railway environment
   * is a non-production deploy, which is what "preview" means here.
   */
  const railwayEnv = normalize(process.env.RAILWAY_ENVIRONMENT_NAME)?.toLowerCase()
  if (railwayEnv) {
    return railwayEnv === "production"
      ? { key: "production", label: "PRODUCTION", overridden: false }
      : { key: "preview", label: `PREVIEW (${railwayEnv})`, overridden: false }
  }

  if (vercelEnv === "production") return { key: "production", label: "PRODUCTION", overridden: false }
  if (vercelEnv === "preview") return { key: "preview", label: "PREVIEW", overridden: false }
  if (vercelEnv === "development") return { key: "development", label: "DEVELOPMENT", overridden: false }

  // Neither host: a production NODE_ENV build is a local `next build`, NOT production.
  // Saying so plainly prevents it from masquerading as the real thing.
  if (nodeEnv === "production") {
    return { key: "development", label: "PRODUCTION BUILD (not deployed)", overridden: false }
  }
  return { key: "development", label: "DEVELOPMENT", overridden: false }
}

export function resolveDatabaseIdentity(rawUrl: string | undefined = process.env.DATABASE_URL): DatabaseIdentity {
  const raw = normalize(rawUrl)
  if (!raw) {
    return {
      endpointLabel: null,
      databaseName: null,
      hostFingerprint: null,
      unavailable: true,
      unavailableReason: "DATABASE_URL is not set",
    }
  }

  try {
    // Swap the scheme so the WHATWG URL parser accepts it; credentials are never read.
    const parsed = new URL(raw.replace(/^postgres(ql)?:\/\//, "http://"))
    const host = parsed.hostname
    if (!host) {
      return {
        endpointLabel: null,
        databaseName: null,
        hostFingerprint: null,
        unavailable: true,
        unavailableReason: "DATABASE_URL has no host",
      }
    }

    const databaseName = normalize(parsed.pathname.replace(/^\//, ""))
    // Neon hosts look like ep-<name>-<id>.<region>.aws.neon.tech; the first label identifies
    // the endpoint. For non-Neon hosts this is still the most identifying safe component.
    const endpointLabel = normalize(host.split(".")[0])

    return {
      endpointLabel,
      databaseName,
      hostFingerprint: crypto.createHash("sha256").update(host).digest("hex").slice(0, 12),
      unavailable: false,
      unavailableReason: null,
    }
  } catch {
    return {
      endpointLabel: null,
      databaseName: null,
      hostFingerprint: null,
      unavailable: true,
      unavailableReason: "DATABASE_URL could not be parsed",
    }
  }
}

export function getDeploymentIdentity(): DeploymentIdentity {
  const { key, label, overridden } = resolveEnvironment()
  const env = process.env
  const onRailway = Boolean(normalize(env.RAILWAY_ENVIRONMENT_NAME) || normalize(env.RAILWAY_DEPLOYMENT_ID))
  const onVercel = Boolean(normalize(env.VERCEL_ENV) || normalize(env.VERCEL_DEPLOYMENT_ID))
  // Same precedence as /api/af-debug/sha, so the two never disagree about the live build.
  const commitSha =
    normalize(env.BUILD_SHA) ?? normalize(env.RAILWAY_GIT_COMMIT_SHA) ?? normalize(env.VERCEL_GIT_COMMIT_SHA)
  const message = normalize(env.RAILWAY_GIT_COMMIT_MESSAGE) ?? normalize(env.VERCEL_GIT_COMMIT_MESSAGE)
  const publicDomain = normalize(env.RAILWAY_PUBLIC_DOMAIN)

  return {
    platform: onRailway ? "railway" : onVercel ? "vercel" : null,
    serviceName: normalize(env.RAILWAY_SERVICE_NAME),
    deploymentId: normalize(env.RAILWAY_DEPLOYMENT_ID) ?? normalize(env.VERCEL_DEPLOYMENT_ID),
    commitSha,
    commitShaShort: commitSha ? commitSha.slice(0, 7) : null,
    commitRef: normalize(env.RAILWAY_GIT_BRANCH) ?? normalize(env.VERCEL_GIT_COMMIT_REF),
    commitMessageSubject: message?.split("\n")[0] ?? null,
    environment: key,
    environmentLabel: label,
    environmentOverridden: overridden,
    deploymentUrl: publicDomain ? `https://${publicDomain}` : normalize(env.VERCEL_URL),
    region: normalize(env.RAILWAY_REPLICA_REGION) ?? normalize(env.VERCEL_REGION),
    processStartedAt: PROCESS_STARTED_AT,
    database: resolveDatabaseIdentity(),
  }
}
