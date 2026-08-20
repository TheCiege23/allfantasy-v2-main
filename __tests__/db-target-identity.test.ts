import { createRequire } from "module"

import { afterEach, describe, expect, it, vi } from "vitest"

import { assertNonProductionDbTarget } from "@/scripts/_db-target-identity"

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


/**
 * `assertNonProductionDbTarget` is the guard every `scripts/*-nonprod.ts`, conformance, probe and
 * staging-parity script now calls. It exits the process on refusal, so these tests stub
 * `process.exit` and assert on whether it fired.
 */
describe("assertNonProductionDbTarget", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.ALLOW_PROD_READONLY
  })

  /** Stub process.exit so a refusal is observable instead of killing the test run. */
  function runGuard(opts: Parameters<typeof assertNonProductionDbTarget>[0]) {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__EXIT__")
    }) as never)
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})
    let exited = false
    try {
      assertNonProductionDbTarget(opts)
    } catch (e) {
      if ((e as Error).message !== "__EXIT__") throw e
      exited = true
    }
    // Last call, not first: spying an already-spied method reuses the existing mock, so calls
    // accumulate across invocations within a single test.
    return { exited, exitCode: exit.mock.calls.at(-1)?.[0] }
  }

  it("permits the test database", () => {
    expect(runGuard({ script: "t", url: TEST_DB }).exited).toBe(false)
  })

  it("refuses production, pooled and direct alike", () => {
    expect(runGuard({ script: "t", url: PROD_DIRECT }).exited).toBe(true)
    expect(runGuard({ script: "t", url: PROD_POOLED }).exited).toBe(true)
  })

  // The regression this whole module exists for: the old per-file guard named the dev fork as
  // production, so it refused the safe database and let the real one through.
  it("does NOT refuse the old ep-spring-tooth marker as though it were production", () => {
    const { exited } = runGuard({ script: "t", url: OLD_MARKER })
    // It is still refused — but as an UNRECOGNISED target (fail-closed), not as production.
    expect(exited).toBe(true)
    expect(isProductionTarget(OLD_MARKER)).toBe(false)
  })

  it("fails closed on an unrecognised target rather than allowing it", () => {
    expect(runGuard({ script: "t", url: "postgresql://u:pw@ep-nobody-knows.neon.tech/neondb" }).exited).toBe(true)
  })

  it("fails closed when no URL can be resolved at all", () => {
    expect(runGuard({ script: "t", url: "" }).exited).toBe(true)
  })

  it("honours the caller's exit code so SKIPPED-style scripts keep exiting 0", () => {
    expect(runGuard({ script: "t", url: PROD_DIRECT, exitCode: 0 }).exitCode).toBe(0)
    expect(runGuard({ script: "t", url: PROD_DIRECT }).exitCode).toBe(1)
  })

  describe("read-only production opt-in", () => {
    it("still refuses production when the script did not opt in, even with the env var set", () => {
      process.env.ALLOW_PROD_READONLY = "1"
      expect(runGuard({ script: "t", url: PROD_DIRECT }).exited).toBe(true)
    })

    it("still refuses production when the script opted in but the env var is unset", () => {
      expect(runGuard({ script: "t", url: PROD_DIRECT, readOnlyProdOptIn: true }).exited).toBe(true)
    })

    it("permits production only when BOTH the opt-in and the env var are present", () => {
      process.env.ALLOW_PROD_READONLY = "1"
      expect(runGuard({ script: "t", url: PROD_DIRECT, readOnlyProdOptIn: true }).exited).toBe(false)
    })

    // The opt-in means "I know this is production", not "let anything through".
    it("does NOT rescue an unrecognised target", () => {
      process.env.ALLOW_PROD_READONLY = "1"
      const url = "postgresql://u:pw@ep-brand-new-branch99.neon.tech/neondb"
      expect(runGuard({ script: "t", url, readOnlyProdOptIn: true }).exited).toBe(true)
    })
  })
})
