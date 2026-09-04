import { describe, expect, it } from "vitest"
import { CONTRACT_VERSION, isCommissionerResponseOk } from "@/lib/commissioner-ui/contracts"
import type {
  CommissionerModuleId,
  CommissionerErrorContract,
  CommissionerPlatformResponse,
  CommissionerEvidenceMetadata,
  CommissionerNotificationPayload,
  CommissionerSearchResultContract,
  CommissionerActivityEventContract,
  CommissionerModuleRegistration,
} from "@/lib/commissioner-ui/contracts"
import { COMMISSIONER_ALL_NAV_ITEMS } from "@/lib/commissioner-ui/navigation/moduleNav"
import { DEFAULT_COMMISSIONER_MODULE_FLAGS } from "@/lib/commissioner-ui/featureFlags"

describe("commissioner-os platform contracts — versioning", () => {
  it("exposes a semantic contract version", () => {
    expect(CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe("commissioner-os platform contracts — backward compatibility", () => {
  it("re-exported CommissionerModuleId matches the type still used by moduleNav.ts", () => {
    const id: CommissionerModuleId = "league-health"
    expect(COMMISSIONER_ALL_NAV_ITEMS.some((item) => item.id === id)).toBe(true)
  })

  it("re-exported feature flag type matches the still-existing default flag map", () => {
    const flags: Record<CommissionerModuleId, boolean> = DEFAULT_COMMISSIONER_MODULE_FLAGS
    expect(Object.keys(flags)).toHaveLength(11)
  })
})

describe("commissioner-os platform contracts — response envelope", () => {
  it("isCommissionerResponseOk is true only when there is data and no error", () => {
    const ok: CommissionerPlatformResponse<{ value: number }> = {
      data: { value: 1 },
      error: null,
      source: "stub",
      timestamp: "2026-01-01T00:00:00.000Z",
    }
    const withError: CommissionerPlatformResponse<{ value: number }> = {
      data: null,
      error: {
        category: "upstream_unavailable",
        message: "not ready",
        retryable: true,
        timestamp: "2026-01-01T00:00:00.000Z",
      } satisfies CommissionerErrorContract,
      source: "stub",
      timestamp: "2026-01-01T00:00:00.000Z",
    }

    expect(isCommissionerResponseOk(ok)).toBe(true)
    expect(isCommissionerResponseOk(withError)).toBe(false)
  })

  it("distinguishes stub data from live data via the source field", () => {
    const stub: CommissionerPlatformResponse<null> = { data: null, error: null, source: "stub", timestamp: "2026-01-01T00:00:00.000Z" }
    const live: CommissionerPlatformResponse<null> = { data: null, error: null, source: "live", timestamp: "2026-01-01T00:00:00.000Z" }
    expect(stub.source).not.toBe(live.source)
  })
})

describe("commissioner-os platform contracts — shape checks", () => {
  it("evidence metadata accepts only the four established confidence levels", () => {
    const metadata: CommissionerEvidenceMetadata = {
      confidence: "high",
      asOf: "2026-01-01T00:00:00.000Z",
      sourceModuleId: "league-health",
    }
    expect(["developing_signal", "moderate", "high", "very_high"]).toContain(metadata.confidence)
  })

  it("notification payload and activity event share the same severity vocabulary", () => {
    const notification: CommissionerNotificationPayload = {
      id: "n1",
      severity: "warning",
      message: "test",
      sourceModuleId: "recommendations",
      createdAt: "2026-01-01T00:00:00.000Z",
      read: false,
    }
    const activity: CommissionerActivityEventContract = {
      id: "a1",
      type: "recommendation:created",
      sourceModuleId: "recommendations",
      severity: "warning",
      initiator: "system",
      summary: "test",
      timestamp: "2026-01-01T00:00:00.000Z",
    }
    expect(notification.severity).toBe(activity.severity)
  })

  it("search result category is one of the module-aligned categories", () => {
    const result: CommissionerSearchResultContract = {
      id: "r1",
      category: "recommendation",
      title: "test",
      href: "/commissioner-os/recommendations",
      sourceModuleId: "recommendations",
    }
    expect(result.category).toBe("recommendation")
  })

  it("module registration ties id, route, and flag key together", () => {
    const registration: CommissionerModuleRegistration = {
      id: "workspace",
      displayName: "Commissioner Workspace",
      route: "/commissioner-os/workspace",
      flagKey: "workspace",
    }
    expect(registration.id).toBe(registration.flagKey)
  })
})
