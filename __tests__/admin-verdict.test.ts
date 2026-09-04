import { describe, expect, it } from "vitest"
import { buildAdminVerdict } from "@/lib/admin-dashboard/adminVerdict"
import type { AdminCommandCenterMetrics } from "@/lib/admin-dashboard/AdminCommandCenterService"
import type { AdminProviderHealthRow, AdminProviderHealthStatus } from "@/lib/admin-dashboard/AdminProviderHealthService"

/**
 * buildAdminVerdict only reads providerHealth, productionReadiness.crons and
 * productionReadiness.env — everything else on AdminCommandCenterMetrics is irrelevant to it,
 * so the fixture supplies only those three, cast rather than fully populating the real
 * (much larger) metrics shape.
 */
function metricsWith(providerHealth: AdminProviderHealthRow[]): AdminCommandCenterMetrics {
  return {
    providerHealth,
    productionReadiness: { env: [], crons: [] },
  } as unknown as AdminCommandCenterMetrics
}

function provider(status: AdminProviderHealthStatus, overrides: Partial<AdminProviderHealthRow> = {}): AdminProviderHealthRow {
  return {
    id: "test_provider",
    name: "Test Provider",
    category: "General sports",
    status,
    configured: status !== "missing_env" && status !== "disabled",
    envVars: [],
    dataCategories: [],
    consumedBy: ["some feature"],
    storage: [],
    requestCount24h: null,
    avgLatencyMs24h: null,
    rateLimit: "Not tracked yet",
    importedRows: null,
    lastSyncAt: null,
    lastError: null,
    costProtection: [],
    note: "",
    ...overrides,
  }
}

describe("buildAdminVerdict — providers", () => {
  it("THE ACTUAL BUG: a provider missing its env vars entirely raises a critical issue", () => {
    // missing_env is configured: false BY DEFINITION (statusFromConfig's only path to it) --
    // this is exactly the case the old `if (!provider.configured) continue` guard silently ate
    // before PROVIDER_FAULT was ever consulted, despite PROVIDER_FAULT itself listing
    // missing_env as 'critical'.
    const verdict = buildAdminVerdict(metricsWith([provider("missing_env", { configured: false })]))

    expect(verdict.ok).toBe(false)
    expect(verdict.issues).toHaveLength(1)
    expect(verdict.issues[0]).toMatchObject({
      id: "provider-test_provider",
      severity: "critical",
      title: "Test Provider — missing its environment variables",
    })
  })

  it("a provider that is configured and failing also raises a critical issue", () => {
    const verdict = buildAdminVerdict(
      metricsWith([provider("configured_failing", { configured: true, lastError: "401 revoked" })]),
    )

    expect(verdict.issues).toHaveLength(1)
    expect(verdict.issues[0].severity).toBe("critical")
  })

  it("still does not raise an issue for deliberately unconfigured or unmeasured states", () => {
    // The property the old guard was trying (incorrectly) to protect: these three must stay
    // silent. Confirms the fix didn't just delete a guard and start alarming on everything.
    const verdict = buildAdminVerdict(
      metricsWith([
        provider("disabled", { configured: false }),
        provider("public_fallback", { configured: true }),
        provider("unknown", { configured: false }),
      ]),
    )

    expect(verdict.issues).toHaveLength(0)
    expect(verdict.ok).toBe(true)
  })

  it("a plain configured provider with no fault does not raise an issue", () => {
    const verdict = buildAdminVerdict(metricsWith([provider("configured", { configured: true })]))
    expect(verdict.issues).toHaveLength(0)
  })

  it("warn-level provider faults (not_production_ready, scaffold_only) still raise, at warn severity", () => {
    const verdict = buildAdminVerdict(
      metricsWith([
        provider("not_production_ready", { configured: true }),
        provider("scaffold_only", { configured: false }),
      ]),
    )

    expect(verdict.issues).toHaveLength(2)
    expect(verdict.issues.every((i) => i.severity === "warn")).toBe(true)
    expect(verdict.ok).toBe(false) // any issue, even warn-only, means not "all nominal"
  })

  it("names the blast radius from consumedBy, or says nothing depends on it", () => {
    const withConsumers = buildAdminVerdict(
      metricsWith([provider("missing_env", { configured: false, consumedBy: ["Trade Analyzer", "Draft Advisor"] })]),
    )
    expect(withConsumers.issues[0].consequence).toBe("Goes dark: Trade Analyzer, Draft Advisor.")

    const withoutConsumers = buildAdminVerdict(
      metricsWith([provider("missing_env", { configured: false, consumedBy: [] })]),
    )
    expect(withoutConsumers.issues[0].consequence).toBe("Goes dark: no surface records a dependency on it.")
  })
})
