import { createRequire } from "module"

import { describe, expect, it } from "vitest"

const requireCjs = createRequire(import.meta.url)
const {
  identifyTarget,
  isProductionTarget,
  describeTarget,
  endpointOf,
} = requireCjs("../scripts/db-target-identity.cjs")

/**
 * Guards `scripts/prisma-cli-guard.cjs` and `scripts/prisma-migrate-deploy.cjs`.
 *
 * The bug being locked out: the previous guard keyed on the host substring
 * "ep-spring-tooth" believing it was production. It is the dev fork. So the guard
 * refused a safe target and let real production through.
 */

const PROD_DIRECT = "postgresql://u:pw@ep-curly-block-ad0dlt9o.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require"
const PROD_POOLED = "postgresql://u:pw@ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require"
const SHADOW_POOLED = "postgresql://u:pw@ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech/mydb_shadow?sslmode=require"
const STAGING = "postgresql://u:pw@ep-winter-salad-ad34lce8-pooler.c-2.us-east-1.aws.neon.tech/neondb"
const TEST_DB = "postgresql://u:pw@ep-muddy-leaf-adigvvph-pooler.c-2.us-east-1.aws.neon.tech/neondb"
const REDRAFT_TEST = "postgresql://u:pw@ep-sparkling-mountain-ads99f9t-pooler.c-2.us-east-1.aws.neon.tech/neondb"
const OLD_MARKER = "postgresql://u:pw@ep-spring-tooth-adaoi9x1.c-2.us-east-1.aws.neon.tech/neondb"

describe("production identification", () => {
  it("identifies production on both the direct and pooled host", () => {
    expect(identifyTarget(PROD_DIRECT).kind).toBe("production")
    expect(identifyTarget(PROD_POOLED).kind).toBe("production")
    expect(isProductionTarget(PROD_DIRECT)).toBe(true)
  })

  it("does NOT treat the dev shadow as production, on production's own compute", () => {
    // The load-bearing case: same endpoint as production, different database. Only the
    // db name separates them, which is why host-only matching cannot work here.
    const shadow = identifyTarget(SHADOW_POOLED)
    expect(shadow.kind).toBe("safe")
    expect(shadow.endpoint).toBe(identifyTarget(PROD_POOLED).endpoint)
    expect(shadow.database).not.toBe(identifyTarget(PROD_POOLED).database)
  })

  it("does NOT identify the old PROD_HOST_MARKER endpoint as production", () => {
    // The inverted mapping the previous guard shipped with: ep-spring-tooth is the
    // claude-dashboard-local-dev fork, never production.
    expect(isProductionTarget(OLD_MARKER)).toBe(false)
  })

  it("does not classify staging/test as production despite sharing the neondb name", () => {
    // `neondb` is not unique to production — refusing on the name alone would have
    // blocked all of these while still not identifying production.
    for (const url of [STAGING, TEST_DB, REDRAFT_TEST]) {
      const t = identifyTarget(url)
      expect(t.kind).toBe("safe")
      expect(t.database).toBe("neondb")
    }
  })
})

describe("failing closed", () => {
  it("treats an unrecognised endpoint as unknown, not safe", () => {
    const t = identifyTarget("postgresql://u:pw@ep-brand-new-xyz123-pooler.c-2.us-east-1.aws.neon.tech/neondb")
    expect(t.kind).toBe("unknown")
    // Explicitly not "safe" — the previous guard's failure was allowing the unrecognised.
    expect(t.kind).not.toBe("safe")
  })

  it("treats the old marker endpoint as unknown rather than silently safe", () => {
    expect(identifyTarget(OLD_MARKER).kind).toBe("unknown")
  })

  it("reports unparseable input rather than throwing or defaulting to safe", () => {
    for (const bad of ["", "not-a-url", null, undefined]) {
      const t = identifyTarget(bad as unknown as string)
      expect(["unknown", "unparseable"]).toContain(t.kind)
      expect(t.kind).not.toBe("safe")
      expect(t.kind).not.toBe("production")
    }
  })

  it("allows a local database", () => {
    expect(identifyTarget("postgresql://postgres:postgres@localhost:5432/af_dev").kind).toBe("safe")
    expect(identifyTarget("postgresql://postgres:postgres@127.0.0.1:5432/af_dev").kind).toBe("safe")
  })
})

describe("endpoint normalisation", () => {
  it("collapses the -pooler variant onto the same endpoint id", () => {
    expect(endpointOf("ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech")).toBe(
      endpointOf("ep-curly-block-ad0dlt9o.c-2.us-east-1.aws.neon.tech"),
    )
  })
})

describe("describeTarget", () => {
  it("never leaks credentials — it is used in error messages and logs", () => {
    const described = describeTarget(PROD_POOLED)
    expect(described).not.toContain("pw")
    expect(described).not.toContain("://")
    expect(described).toContain("ep-curly-block-ad0dlt9o")
    expect(described).toContain("PRODUCTION")
  })
})
