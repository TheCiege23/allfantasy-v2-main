import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { getDeploymentIdentity, resolveDatabaseIdentity } from "@/lib/admin-dashboard/deploymentIdentity"

const ENV_KEYS = [
  "OPERATOR_ENV_LABEL",
  "VERCEL_ENV",
  "VERCEL_DEPLOYMENT_ID",
  "VERCEL_GIT_COMMIT_SHA",
  "VERCEL_GIT_COMMIT_REF",
  "VERCEL_GIT_COMMIT_MESSAGE",
  "VERCEL_URL",
  "VERCEL_REGION",
  "DATABASE_URL",
] as const

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe("resolveDatabaseIdentity", () => {
  // Fictional endpoint on purpose: this repo is public, and the real production
  // endpoint label is not something a test fixture needs to disclose.
  const NEON = "postgresql://db_owner:npg_FAKE_TEST_VALUE@ep-fixture-endpoint-00000000.c-2.us-east-1.aws.neon.tech/appdb?sslmode=require"

  it("extracts the endpoint label and database name an operator needs", () => {
    const identity = resolveDatabaseIdentity(NEON)
    expect(identity.endpointLabel).toBe("ep-fixture-endpoint-00000000")
    expect(identity.databaseName).toBe("appdb")
    expect(identity.unavailable).toBe(false)
  })

  it("never exposes the password, user, or full host", () => {
    const serialized = JSON.stringify(resolveDatabaseIdentity(NEON))
    expect(serialized).not.toContain("npg_FAKE_TEST_VALUE")
    expect(serialized).not.toContain("db_owner")
    expect(serialized).not.toContain("aws.neon.tech")
  })

  it("produces a stable one-way fingerprint that differs per host", () => {
    const a = resolveDatabaseIdentity(NEON).hostFingerprint
    const b = resolveDatabaseIdentity(NEON).hostFingerprint
    const other = resolveDatabaseIdentity(
      "postgresql://u:p@ep-other-fixture-11111111.c-2.us-east-1.aws.neon.tech/otherdb",
    ).hostFingerprint

    expect(a).toBe(b)
    expect(a).not.toBe(other)
    expect(a).toMatch(/^[0-9a-f]{12}$/)
  })

  it("distinguishes 'not set' from 'unparseable' rather than reporting a plausible default", () => {
    const missing = resolveDatabaseIdentity(undefined)
    expect(missing.unavailable).toBe(true)
    expect(missing.unavailableReason).toBe("DATABASE_URL is not set")
    expect(missing.endpointLabel).toBeNull()

    const broken = resolveDatabaseIdentity("::::not a url::::")
    expect(broken.unavailable).toBe(true)
    expect(broken.endpointLabel).toBeNull()
  })
})

describe("getDeploymentIdentity — environment resolution", () => {
  it("reports production only when Vercel says so", () => {
    process.env.VERCEL_ENV = "production"
    expect(getDeploymentIdentity().environment).toBe("production")
  })

  it("does not call a local production build 'production'", () => {
    // A local `next build` sets NODE_ENV=production. Treating that as PRODUCTION is how a
    // dev machine ends up masquerading as the live deployment in the admin panel.
    process.env.NODE_ENV = "production"
    const identity = getDeploymentIdentity()
    expect(identity.environment).toBe("development")
    expect(identity.environmentLabel).toBe("PRODUCTION BUILD (not on Vercel)")
  })

  it("marks an explicit override so a mislabeled environment is visible", () => {
    process.env.VERCEL_ENV = "preview"
    process.env.OPERATOR_ENV_LABEL = "production"
    const identity = getDeploymentIdentity()
    expect(identity.environment).toBe("production")
    expect(identity.environmentOverridden).toBe(true)
  })

  it("reports preview for preview deployments", () => {
    process.env.VERCEL_ENV = "preview"
    const identity = getDeploymentIdentity()
    expect(identity.environment).toBe("preview")
    expect(identity.environmentOverridden).toBe(false)
  })
})

describe("getDeploymentIdentity — build identity", () => {
  it("surfaces the deployment id and commit so a deployed SHA can be verified", () => {
    process.env.VERCEL_ENV = "production"
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_8WRqYn5bbg82kd3B5RHnXMLR4yCd"
    process.env.VERCEL_GIT_COMMIT_SHA = "e61a63886189c65e3aeea5ff7f6017f5cc70dae8"
    process.env.VERCEL_GIT_COMMIT_REF = "main"
    process.env.VERCEL_GIT_COMMIT_MESSAGE = "fix(decision-os): Truth Phase 1\n\nlong body ignored"

    const identity = getDeploymentIdentity()
    expect(identity.deploymentId).toBe("dpl_8WRqYn5bbg82kd3B5RHnXMLR4yCd")
    expect(identity.commitShaShort).toBe("e61a638")
    expect(identity.commitRef).toBe("main")
    expect(identity.commitMessageSubject).toBe("fix(decision-os): Truth Phase 1")
  })

  it("reports null — not a plausible placeholder — when the build reported no commit", () => {
    const identity = getDeploymentIdentity()
    expect(identity.commitSha).toBeNull()
    expect(identity.commitShaShort).toBeNull()
    expect(identity.deploymentId).toBeNull()
  })
})
