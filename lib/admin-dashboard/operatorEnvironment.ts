/**
 * Operator environment detection — single source of truth for the environment
 * badge shown across the Operator Command Center.
 *
 * Mirrors the production check already used elsewhere in the codebase
 * (see app/api/admin/duplicate-manager-verify/route.ts):
 *   production === NODE_ENV === "production" && VERCEL_ENV === "production"
 *
 * Everything that is NOT production is treated as a lower-trust environment so a
 * developer/preview build can never be mistaken for production. An explicit
 * `OPERATOR_ENV_LABEL` override is honored last for self-hosted/staging setups
 * that do not set VERCEL_ENV.
 */

export type OperatorEnvironmentKey = "production" | "staging" | "development"

export type OperatorEnvironment = {
  key: OperatorEnvironmentKey
  /** Short label rendered in the badge, e.g. "PRODUCTION". */
  label: string
  /** Longer human description for tooltips / access-denied context. */
  description: string
  isProduction: boolean
  /** Raw signals, surfaced for the System Settings / diagnostics view. */
  raw: {
    nodeEnv: string | null
    vercelEnv: string | null
    override: string | null
  }
}

function normalize(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toLowerCase()
  return v.length > 0 ? v : null
}

export function getOperatorEnvironment(): OperatorEnvironment {
  const nodeEnv = normalize(process.env.NODE_ENV)
  const vercelEnv = normalize(process.env.VERCEL_ENV)
  const override = normalize(process.env.OPERATOR_ENV_LABEL)

  const raw = { nodeEnv, vercelEnv, override }

  // Explicit override wins for self-hosted / non-Vercel deploys.
  if (override === "production" || override === "prod") {
    return {
      key: "production",
      label: "PRODUCTION",
      description: "Live production — changes affect real users.",
      isProduction: true,
      raw,
    }
  }
  if (override === "staging" || override === "preview") {
    return {
      key: "staging",
      label: "STAGING",
      description: "Staging / preview build — not customer-facing production.",
      isProduction: false,
      raw,
    }
  }
  if (override === "development" || override === "dev" || override === "local") {
    return {
      key: "development",
      label: "DEVELOPMENT",
      description: "Local / development build.",
      isProduction: false,
      raw,
    }
  }

  // The same conjunction production trust is gated on elsewhere in the app.
  if (nodeEnv === "production" && vercelEnv === "production") {
    return {
      key: "production",
      label: "PRODUCTION",
      description: "Live production — changes affect real users.",
      isProduction: true,
      raw,
    }
  }

  // Vercel preview deployments.
  if (vercelEnv === "preview") {
    return {
      key: "staging",
      label: "STAGING",
      description: "Vercel preview deployment — not production.",
      isProduction: false,
      raw,
    }
  }

  // A production Next build that is NOT on production Vercel (e.g. a self-run
  // `next start`) is still safer to label as staging than to imply production.
  if (nodeEnv === "production") {
    return {
      key: "staging",
      label: "STAGING",
      description: "Production build outside production Vercel — treated as staging.",
      isProduction: false,
      raw,
    }
  }

  return {
    key: "development",
    label: "DEVELOPMENT",
    description: "Local / development build.",
    isProduction: false,
    raw,
  }
}
