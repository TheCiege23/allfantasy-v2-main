/**
 * Gate Opening Plan, Option C — the second, independent gate every
 * live.ts checks before a real Decision OS call can render: reuses the
 * app's existing site-admin allowlist (lib/auth/admin.ts's isSiteAdmin(),
 * already backed by ALL_ACCESS_USERNAMES/ADMIN_EMAILS and the static
 * theciege26 entry) rather than inventing new scoping.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getServerSessionMock = vi.hoisted(() => vi.fn())
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

import { canAccessLiveDecisionOSData } from "@/lib/commissioner-os/liveModeAccess"

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("canAccessLiveDecisionOSData — reuses the existing site-admin allowlist", () => {
  it("resolves true for the static allowlisted username (theciege26)", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1", username: "theciege26" } })
    expect(await canAccessLiveDecisionOSData()).toBe(true)
  })

  it("resolves true regardless of username casing, matching isSiteAdmin's own normalization", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1", username: "TheCiege26" } })
    expect(await canAccessLiveDecisionOSData()).toBe(true)
  })

  it("resolves true for the static allowlisted email", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "user-2", email: "cjabar.henson@gmail.com" } })
    expect(await canAccessLiveDecisionOSData()).toBe(true)
  })

  it("resolves false for an ordinary, non-allowlisted account", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "user-3", email: "regular.manager@example.com", username: "regular_manager" } })
    expect(await canAccessLiveDecisionOSData()).toBe(false)
  })

  it("resolves false when there is no session at all", async () => {
    getServerSessionMock.mockResolvedValue(null)
    expect(await canAccessLiveDecisionOSData()).toBe(false)
  })

  it("resolves false, never throws, if session resolution itself fails", async () => {
    getServerSessionMock.mockRejectedValue(new Error("no request scope"))
    await expect(canAccessLiveDecisionOSData()).resolves.toBe(false)
  })
})
