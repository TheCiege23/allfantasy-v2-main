import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}))

import { AdminLiveRefresh } from "@/components/admin/AdminLiveRefresh"
import { ADMIN_REFRESH_EVENT } from "@/components/admin/adminRefreshSignal"

const T0 = new Date("2026-09-22T12:00:00.000Z")

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state })
}

describe("AdminLiveRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    refresh.mockClear()
    setVisibility("visible")
  })
  afterEach(() => {
    vi.useRealTimers()
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    document.body.innerHTML = ""
  })

  it("refreshes the route every minute while the tab is visible", () => {
    render(<AdminLiveRefresh generatedAt={T0.toISOString()} />)
    expect(refresh).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(60_000))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("does not poll a hidden tab, and catches up when it becomes visible", () => {
    setVisibility("hidden")
    render(<AdminLiveRefresh generatedAt={T0.toISOString()} />)
    act(() => vi.advanceTimersByTime(180_000))
    expect(refresh).not.toHaveBeenCalled()

    setVisibility("visible")
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("does not refresh under someone typing into a field", () => {
    render(
      <>
        <input data-testid="field" />
        <AdminLiveRefresh generatedAt={T0.toISOString()} />
      </>,
    )
    ;(screen.getByTestId("field") as HTMLInputElement).focus()
    act(() => vi.advanceTimersByTime(60_000))
    expect(refresh).not.toHaveBeenCalled()
  })

  it("tells client panels to reload when a refresh lands, not on mount", () => {
    const heard = vi.fn()
    window.addEventListener(ADMIN_REFRESH_EVENT, heard)
    const { rerender } = render(<AdminLiveRefresh generatedAt={T0.toISOString()} />)
    expect(heard).not.toHaveBeenCalled()

    rerender(<AdminLiveRefresh generatedAt={new Date(T0.getTime() + 60_000).toISOString()} />)
    expect(heard).toHaveBeenCalledTimes(1)
    window.removeEventListener(ADMIN_REFRESH_EVENT, heard)
  })

  it("marks the data stale when the server stamp stops advancing", () => {
    render(<AdminLiveRefresh generatedAt={T0.toISOString()} />)
    const stamp = screen.getByTestId("admin-live-refresh")
    act(() => vi.advanceTimersByTime(1_000))
    expect(stamp.getAttribute("data-stale")).toBe("false")

    // Refreshes are requested but generatedAt never moves — i.e. they are failing.
    act(() => vi.advanceTimersByTime(181_000))
    expect(stamp.getAttribute("data-stale")).toBe("true")
    expect(stamp.textContent).toContain("stale")
  })
})
