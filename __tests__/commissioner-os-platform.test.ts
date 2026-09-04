import { describe, expect, it, vi } from "vitest"
import { CommissionerEventBus, commissionerEventBus } from "@/lib/commissioner-ui/platform/eventBus"
import type { CommissionerPlatformEvent } from "@/lib/commissioner-ui/platform/events"
import {
  COMMISSIONER_PLATFORM_SERVICE_CONTRACTS,
  getCommissionerPlatformService,
  type CommissionerPlatformServiceId,
} from "@/lib/commissioner-ui/platform/serviceRegistry"

describe("commissioner-os platform — event bus", () => {
  it("delivers a published event to a subscribed listener", () => {
    const bus = new CommissionerEventBus()
    const listener = vi.fn()
    bus.subscribe("module:activated", listener)

    const event: CommissionerPlatformEvent = {
      type: "module:activated",
      moduleId: "league-health",
      timestamp: "2026-01-01T00:00:00.000Z",
    }
    bus.publish(event)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(event)
  })

  it("does not deliver an event to a listener subscribed to a different type", () => {
    const bus = new CommissionerEventBus()
    const listener = vi.fn()
    bus.subscribe("notification:raised", listener)

    bus.publish({ type: "module:activated", moduleId: "workspace", timestamp: "2026-01-01T00:00:00.000Z" })

    expect(listener).not.toHaveBeenCalled()
  })

  it("supports multiple listeners for the same event type", () => {
    const bus = new CommissionerEventBus()
    const first = vi.fn()
    const second = vi.fn()
    bus.subscribe("module:activated", first)
    bus.subscribe("module:activated", second)

    bus.publish({ type: "module:activated", moduleId: "settings", timestamp: "2026-01-01T00:00:00.000Z" })

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("unsubscribe stops further delivery to that listener", () => {
    const bus = new CommissionerEventBus()
    const listener = vi.fn()
    const unsubscribe = bus.subscribe("module:activated", listener)

    unsubscribe()
    bus.publish({ type: "module:activated", moduleId: "reports", timestamp: "2026-01-01T00:00:00.000Z" })

    expect(listener).not.toHaveBeenCalled()
  })

  it("publishing with no subscribers does not throw", () => {
    const bus = new CommissionerEventBus()
    expect(() =>
      bus.publish({ type: "notification:raised", severity: "informational", message: "test", timestamp: "2026-01-01T00:00:00.000Z" })
    ).not.toThrow()
  })

  it("listenerCount reflects active subscriptions", () => {
    const bus = new CommissionerEventBus()
    expect(bus.listenerCount("module:activated")).toBe(0)
    const unsubscribe = bus.subscribe("module:activated", vi.fn())
    expect(bus.listenerCount("module:activated")).toBe(1)
    unsubscribe()
    expect(bus.listenerCount("module:activated")).toBe(0)
  })

  it("the shared singleton instance is exported and usable directly", () => {
    const listener = vi.fn()
    const unsubscribe = commissionerEventBus.subscribe("module:activated", listener)
    commissionerEventBus.publish({ type: "module:activated", moduleId: "analytics", timestamp: "2026-01-01T00:00:00.000Z" })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})

describe("commissioner-os platform — service registry", () => {
  const expectedIds: CommissionerPlatformServiceId[] = ["search", "notifications", "activity-stream", "help-center"]

  it("registers exactly the four services this phase was asked to prepare placeholders for", () => {
    expect(Object.keys(COMMISSIONER_PLATFORM_SERVICE_CONTRACTS).sort()).toEqual([...expectedIds].sort())
  })

  it("every contract's id matches its own registry key", () => {
    for (const id of expectedIds) {
      expect(COMMISSIONER_PLATFORM_SERVICE_CONTRACTS[id].id).toBe(id)
    }
  })

  it("Search, Activity Stream, and Help Center are marked as having a dedicated blueprint; Notifications is not", () => {
    expect(getCommissionerPlatformService("search").hasDedicatedBlueprint).toBe(true)
    expect(getCommissionerPlatformService("activity-stream").hasDedicatedBlueprint).toBe(true)
    expect(getCommissionerPlatformService("notifications").hasDedicatedBlueprint).toBe(false)
    expect(getCommissionerPlatformService("help-center").hasDedicatedBlueprint).toBe(true)
  })

  it("every contract has a non-empty display name", () => {
    for (const id of expectedIds) {
      expect(getCommissionerPlatformService(id).displayName.length).toBeGreaterThan(0)
    }
  })
})
