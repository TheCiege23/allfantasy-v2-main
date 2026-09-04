import { describe, expect, it } from "vitest"
import {
  DEFAULT_DATA_MODE,
  DATA_MODE_LABELS,
  isValidDataMode,
  normalizeDataMode,
} from "@/lib/commissioner-ui/demo-mode/constants"
import { stubDecisionOSClient } from "@/lib/commissioner-ui/decision-os-client/stub"
import { demoDecisionOSClient } from "@/lib/commissioner-ui/decision-os-client/demo"
import { liveDecisionOSClient } from "@/lib/commissioner-ui/decision-os-client/live"

describe("commissioner-os demo mode — constants", () => {
  it("defaults to demo mode", () => {
    expect(DEFAULT_DATA_MODE).toBe("demo")
  })

  it("validates exactly the three defined modes", () => {
    expect(isValidDataMode("stub")).toBe(true)
    expect(isValidDataMode("demo")).toBe(true)
    expect(isValidDataMode("live")).toBe(true)
    expect(isValidDataMode("production")).toBe(false)
    expect(isValidDataMode(null)).toBe(false)
    expect(isValidDataMode(undefined)).toBe(false)
  })

  it("normalizes an invalid or missing value to the default", () => {
    expect(normalizeDataMode("nonsense")).toBe(DEFAULT_DATA_MODE)
    expect(normalizeDataMode(undefined)).toBe(DEFAULT_DATA_MODE)
    expect(normalizeDataMode("live")).toBe("live")
  })

  it("has a label for every mode", () => {
    expect(Object.keys(DATA_MODE_LABELS).sort()).toEqual(["demo", "live", "stub"])
  })
})

describe("commissioner-os demo mode — client parity", () => {
  const methods = [
    "getLeagueHealthSummary",
    "getManagerHighlights",
    "getMissionControlKpis",
  ] as const

  it("stub, demo, and live implementations all satisfy the same method surface", () => {
    for (const method of methods) {
      expect(typeof stubDecisionOSClient[method]).toBe("function")
      expect(typeof demoDecisionOSClient[method]).toBe("function")
      expect(typeof liveDecisionOSClient[method]).toBe("function")
    }
  })

  it("stub and demo both return source-tagged, error-free responses", async () => {
    for (const method of methods) {
      const stubResponse = await stubDecisionOSClient[method]()
      const demoResponse = await demoDecisionOSClient[method]()
      expect(stubResponse.source).toBe("stub")
      expect(demoResponse.source).toBe("demo")
      expect(stubResponse.error).toBeNull()
      expect(demoResponse.error).toBeNull()
      expect(stubResponse.data).not.toBeNull()
      expect(demoResponse.data).not.toBeNull()
    }
  })

  it("the live placeholder returns an honest, typed error rather than fixture data", async () => {
    for (const method of methods) {
      const response = await liveDecisionOSClient[method]()
      expect(response.source).toBe("live")
      expect(response.data).toBeNull()
      expect(response.error).not.toBeNull()
      expect(response.error?.category).toBe("upstream_unavailable")
      expect(response.error?.retryable).toBe(false)
    }
  })

  it("demo data is a distinct, more elaborate scenario than the minimal stub fixtures", async () => {
    const stubHealth = await stubDecisionOSClient.getLeagueHealthSummary()
    const demoHealth = await demoDecisionOSClient.getLeagueHealthSummary()
    expect(demoHealth.data?.score).not.toBe(stubHealth.data?.score)
  })
})
