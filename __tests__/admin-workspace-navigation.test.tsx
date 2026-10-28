import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { AdminWorkspace } from "@/components/admin/AdminWorkspace"

afterEach(() => {
  window.history.replaceState(null, "", "/")
})

describe("admin workspace navigation", () => {
  it("starts with the overview and switches to the selected area", () => {
    const { container } = render(
      <AdminWorkspace>
        <div data-admin-pane="overview">Current status</div>
        <div data-admin-pane="audience">User reports</div>
      </AdminWorkspace>,
    )

    expect(container.querySelector("#admin-workspace")).toHaveAttribute("data-view", "overview")
    fireEvent.click(screen.getByRole("button", { name: "People & growth" }))
    expect(container.querySelector("#admin-workspace")).toHaveAttribute("data-view", "audience")
    expect(screen.getByRole("button", { name: "People & growth" })).toHaveAttribute("aria-pressed", "true")
    expect(window.location.hash).toBe("#view-audience")
  })

  it("opens a collapsed report when linked directly to it", async () => {
    window.history.replaceState(null, "", "/#providers")
    const { container } = render(
      <AdminWorkspace>
        <div data-admin-pane="data">
          <details>
            <summary>Detailed diagnostics</summary>
            <span id="providers">Provider health</span>
          </details>
        </div>
      </AdminWorkspace>,
    )

    await waitFor(() => {
      expect(container.querySelector("#admin-workspace")).toHaveAttribute("data-view", "data")
      expect(container.querySelector("details")).toHaveAttribute("open")
    })
  })

  it("routes waitlist and stat recovery links to their areas", async () => {
    window.history.replaceState(null, "", "/#waitlist")
    const { container } = render(
      <AdminWorkspace>
        <div data-admin-pane="audience"><details><summary>Waitlist detail</summary><span id="waitlist">Signups</span></details></div>
        <div data-admin-pane="data"><span id="stat-reingest">Stats recovery</span></div>
      </AdminWorkspace>,
    )

    await waitFor(() => expect(container.querySelector("#admin-workspace")).toHaveAttribute("data-view", "audience"))
    await waitFor(() => expect(container.querySelector("details")).toHaveAttribute("open"))
    act(() => {
      window.history.replaceState(null, "", "/#stat-reingest")
      window.dispatchEvent(new Event("hashchange"))
    })
    await waitFor(() => expect(container.querySelector("#admin-workspace")).toHaveAttribute("data-view", "data"))
  })

  it("opens user search after a search request", () => {
    const { container } = render(
      <AdminWorkspace initialView="audience">
        <div data-admin-pane="audience">Find a user</div>
      </AdminWorkspace>,
    )

    expect(container.querySelector("#admin-workspace")).toHaveAttribute("data-view", "audience")
    expect(screen.getByText("Find a user")).toBeInTheDocument()
  })
})
