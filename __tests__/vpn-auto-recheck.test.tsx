/**
 * /vpn-blocked re-checks on its own, so someone who turns the VPN off goes straight
 * in without tapping "try again" (owner's request, 2026-09-28). Every check can
 * cost a vendor lookup, so the schedule must also STOP.
 */

import React from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AUTO_RECHECK_DELAYS_S, VpnRetryPanel } from "@/app/vpn-blocked/VpnRetryPanel"

const fetchMock = vi.fn()
const replaceMock = vi.fn()

function verdict(blocked: boolean, kind: string | null = "vpn") {
  return { ok: true, json: async () => ({ blocked, kind: blocked ? kind : null }) }
}

/** Let the timer fire and the awaited fetch/json settle. */
async function advance(seconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(seconds * 1000)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  replaceMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  Object.defineProperty(window, "location", { configurable: true, value: { replace: replaceMock } })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("VpnRetryPanel automatic re-check", () => {
  it("goes straight in once the VPN is off, without the button", async () => {
    fetchMock.mockResolvedValueOnce(verdict(true)).mockResolvedValueOnce(verdict(false))
    render(<VpnRetryPanel href="/core" />)

    await advance(AUTO_RECHECK_DELAYS_S[0])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe("/api/geo/vpn-status?recheck=1")
    expect(replaceMock).not.toHaveBeenCalled()

    await advance(AUTO_RECHECK_DELAYS_S[1])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(replaceMock).toHaveBeenCalledWith("/core")
  })

  it("stays quiet while still blocked — no warning box, just the time", async () => {
    fetchMock.mockResolvedValue(verdict(true))
    render(<VpnRetryPanel href="/core" />)

    await advance(AUTO_RECHECK_DELAYS_S[0])
    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.getByTestId("vpn-auto-recheck").textContent).toMatch(/Last checked/)
  })

  it("stops after the schedule runs out", async () => {
    fetchMock.mockResolvedValue(verdict(true))
    render(<VpnRetryPanel href="/core" />)

    for (const delay of AUTO_RECHECK_DELAYS_S) await advance(delay)
    expect(fetchMock).toHaveBeenCalledTimes(AUTO_RECHECK_DELAYS_S.length)

    await advance(600)
    expect(fetchMock).toHaveBeenCalledTimes(AUTO_RECHECK_DELAYS_S.length)
    expect(screen.getByTestId("vpn-auto-recheck").textContent).toMatch(/Stopped checking automatically/)
  })

  it("starts the schedule over when the button is tapped", async () => {
    fetchMock.mockResolvedValue(verdict(true))
    render(<VpnRetryPanel href="/core" />)
    for (const delay of AUTO_RECHECK_DELAYS_S) await advance(delay)
    const exhausted = fetchMock.mock.calls.length

    await act(async () => {
      fireEvent.click(screen.getByText(/I turned it off/))
    })
    expect(screen.getByRole("status").textContent).toMatch(/still see a VPN/)

    await advance(AUTO_RECHECK_DELAYS_S[0])
    expect(fetchMock.mock.calls.length).toBe(exhausted + 2)
  })

  it("skips checks while the page is hidden", async () => {
    fetchMock.mockResolvedValue(verdict(true))
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
    render(<VpnRetryPanel href="/core" />)

    await advance(AUTO_RECHECK_DELAYS_S[0] + AUTO_RECHECK_DELAYS_S[1])
    expect(fetchMock).not.toHaveBeenCalled()
    visibility.mockRestore()
  })

  it("does not reload the page when an automatic check fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"))
    render(<VpnRetryPanel href="/core" />)

    await advance(AUTO_RECHECK_DELAYS_S[0])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it("asks about paid pages when the block was for a paid page", async () => {
    fetchMock.mockResolvedValue(verdict(true, "privacy_relay"))
    render(<VpnRetryPanel href="/billing" paidScope />)

    await advance(AUTO_RECHECK_DELAYS_S[0])
    expect(fetchMock.mock.calls[0][0]).toBe("/api/geo/vpn-status?recheck=1&scope=paid")
  })
})
