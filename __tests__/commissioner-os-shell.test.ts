import { describe, expect, it } from "vitest"
import {
  COMMISSIONER_MODULE_NAV_ITEMS,
  COMMISSIONER_SECONDARY_NAV_ITEMS,
  COMMISSIONER_ALL_NAV_ITEMS,
  COMMISSIONER_SEARCH_ROUTE,
  isCommissionerModuleActive,
  getActiveCommissionerModuleId,
} from "@/lib/commissioner-ui/navigation/moduleNav"
import { resolveBreadcrumbs } from "@/lib/commissioner-ui/navigation/breadcrumbs"
import {
  DEFAULT_COMMISSIONER_MODULE_FLAGS,
  isCommissionerModuleEnabled,
} from "@/lib/commissioner-ui/featureFlags"

describe("commissioner-os shell — module navigation", () => {
  it("defines nine primary module nav items plus two secondary items", () => {
    expect(COMMISSIONER_MODULE_NAV_ITEMS).toHaveLength(9)
    expect(COMMISSIONER_SECONDARY_NAV_ITEMS).toHaveLength(2)
    expect(COMMISSIONER_ALL_NAV_ITEMS).toHaveLength(11)
  })

  it("every nav item's id is unique", () => {
    const ids = COMMISSIONER_ALL_NAV_ITEMS.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("every nav item's href is unique and lives under /commissioner-os", () => {
    const hrefs = COMMISSIONER_ALL_NAV_ITEMS.map((item) => item.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
    for (const href of hrefs) {
      expect(href === "/commissioner-os" || href.startsWith("/commissioner-os/")).toBe(true)
    }
  })

  it("search has a direct route but no sidebar entry", () => {
    expect(COMMISSIONER_SEARCH_ROUTE).toBe("/commissioner-os/search")
    expect(COMMISSIONER_ALL_NAV_ITEMS.some((item) => item.href === COMMISSIONER_SEARCH_ROUTE)).toBe(false)
  })

  it("treats the root path as active only for an exact match", () => {
    expect(isCommissionerModuleActive("/commissioner-os", "/commissioner-os")).toBe(true)
    expect(isCommissionerModuleActive("/commissioner-os/league-health", "/commissioner-os")).toBe(false)
  })

  it("treats a module path and its sub-paths as active", () => {
    expect(isCommissionerModuleActive("/commissioner-os/league-health", "/commissioner-os/league-health")).toBe(true)
    expect(
      isCommissionerModuleActive("/commissioner-os/league-health/risk-analysis", "/commissioner-os/league-health")
    ).toBe(true)
    expect(isCommissionerModuleActive("/commissioner-os/recommendations", "/commissioner-os/league-health")).toBe(false)
  })

  it("resolves the active module id from a pathname", () => {
    expect(getActiveCommissionerModuleId("/commissioner-os")).toBe("mission-control")
    expect(getActiveCommissionerModuleId("/commissioner-os/workspace")).toBe("workspace")
    expect(getActiveCommissionerModuleId("/commissioner-os/activity")).toBe("activity")
    expect(getActiveCommissionerModuleId("/unrelated-route")).toBeNull()
    expect(getActiveCommissionerModuleId(null)).toBeNull()
  })
})

describe("commissioner-os shell — breadcrumbs", () => {
  it("returns no breadcrumbs at depth 1", () => {
    expect(resolveBreadcrumbs("league-health", 1)).toEqual([])
  })

  it("returns no breadcrumbs when there is no active module", () => {
    expect(resolveBreadcrumbs(null, 2)).toEqual([])
  })

  it("returns a single-entry trail at depth 2", () => {
    const trail = resolveBreadcrumbs("league-health", 2)
    expect(trail).toEqual([{ label: "League Health", href: "/commissioner-os/league-health" }])
  })

  it("appends a detail label at depth 3", () => {
    const trail = resolveBreadcrumbs("recommendations", 3, "Evidence")
    expect(trail).toHaveLength(2)
    expect(trail[0]).toEqual({ label: "Recommendations", href: "/commissioner-os/recommendations" })
    expect(trail[1].label).toBe("Evidence")
  })
})

describe("commissioner-os shell — feature flags", () => {
  it("defaults every module to enabled during the scaffolding phase", () => {
    for (const item of COMMISSIONER_ALL_NAV_ITEMS) {
      expect(isCommissionerModuleEnabled(item.id)).toBe(true)
    }
  })

  it("the default flag map has exactly the eleven module keys, no more, no fewer", () => {
    const flagKeys = Object.keys(DEFAULT_COMMISSIONER_MODULE_FLAGS).sort()
    const navIds = COMMISSIONER_ALL_NAV_ITEMS.map((item) => item.id).sort()
    expect(flagKeys).toEqual(navIds)
  })

  it("respects an explicitly disabled module", () => {
    const flags = { ...DEFAULT_COMMISSIONER_MODULE_FLAGS, workspace: false }
    expect(isCommissionerModuleEnabled("workspace", flags)).toBe(false)
    expect(isCommissionerModuleEnabled("mission-control", flags)).toBe(true)
  })
})
