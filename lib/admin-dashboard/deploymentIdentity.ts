/**
 * Deployment identity — safe, admin-only metadata that makes it unmistakable
 * which build the browser is talking to. No secrets: the database fingerprint
 * is a one-way hash of the connection host, never the host, credentials, or
 * database name itself.
 */
import "server-only"
import crypto from "crypto"
import packageJson from "@/package.json"

export type DeploymentEnvironmentKey = "production" | "staging" | "development"

export type DeploymentIdentity = {
  version: string
  commitSha: string | null
  commitShaShort: string | null
  branch: string | null
  environment: DeploymentEnvironmentKey
  environmentLabel: string
  deploymentUrl: string | null
  /** Process start time — the closest safe proxy to a build timestamp available at runtime. */
  processStartedAt: string
  /** One-way fingerprint of the DB connection host. Changes iff the host changes; never reversible. */
  databaseHostFingerprint: string | null
}

const PROCESS_STARTED_AT = new Date().toISOString()

function normalize(value: string | null | undefined): string | null {
  const v = (value ?? "").trim()
  return v.length > 0 ? v : null
}

function resolveEnvironment(): { key: DeploymentEnvironmentKey; label: string } {
  const override = normalize(process.env.OPERATOR_ENV_LABEL)?.toLowerCase()
  if (override === "production" || override === "prod") return { key: "production", label: "PRODUCTION" }
  if (override === "staging" || override === "preview") return { key: "staging", label: "STAGING" }
  if (override === "development" || override === "dev" || override === "local") {
    return { key: "development", label: "DEVELOPMENT" }
  }

  const nodeEnv = normalize(process.env.NODE_ENV)
  const vercelEnv = normalize(process.env.VERCEL_ENV)
  if (nodeEnv === "production" && vercelEnv === "production") return { key: "production", label: "PRODUCTION" }
  if (vercelEnv === "preview") return { key: "staging", label: "STAGING" }
  if (nodeEnv === "production") return { key: "staging", label: "STAGING (build outside prod Vercel)" }
  return { key: "development", label: "DEVELOPMENT" }
}

function resolveDatabaseHostFingerprint(): string | null {
  const raw = process.env.DATABASE_URL
  if (!raw) return null
  try {
    const host = new URL(raw.replace(/^postgres(ql)?:\/\//, "http://")).host
    return crypto.createHash("sha256").update(host).digest("hex").slice(0, 12)
  } catch {
    return null
  }
}

export function getDeploymentIdentity(): DeploymentIdentity {
  const { key, label } = resolveEnvironment()
  const commitSha = normalize(process.env.VERCEL_GIT_COMMIT_SHA) ?? normalize(process.env.RAILWAY_GIT_COMMIT_SHA)
  const branch = normalize(process.env.VERCEL_GIT_COMMIT_REF) ?? normalize(process.env.RAILWAY_GIT_BRANCH)
  const deploymentUrl = normalize(process.env.VERCEL_URL) ?? normalize(process.env.RAILWAY_PUBLIC_DOMAIN)

  return {
    version: packageJson.version ?? "unknown",
    commitSha,
    commitShaShort: commitSha ? commitSha.slice(0, 7) : null,
    branch,
    environment: key,
    environmentLabel: label,
    deploymentUrl,
    processStartedAt: PROCESS_STARTED_AT,
    databaseHostFingerprint: resolveDatabaseHostFingerprint(),
  }
}
