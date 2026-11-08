import { render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import CfpProjectionPreview from "@/components/brackets/playoffs/CfpProjectionPreview"

afterEach(() => { vi.unstubAllGlobals() })
describe("CFP projection preview", () => {
  it("labels the snapshot and shows projected teams without pick controls", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
    render(<CfpProjectionPreview />)
    const preview = screen.getByTestId("cfp-projection-preview")
    expect(within(preview).getByText(/November 3 CFP rankings/)).toBeInTheDocument()
    expect(within(preview).getByText(/Subject to change/)).toBeInTheDocument()
    expect(within(preview).getByText("Boise State")).toBeInTheDocument()
    expect(within(preview).getByText("Notre Dame")).toBeInTheDocument()
    expect(within(preview).getAllByText(/winner/i).length).toBeGreaterThan(0)
    expect(within(preview).queryByRole("button")).not.toBeInTheDocument()
    expect(within(preview).getByRole("link", { name: "CFP rankings source" })).toHaveAttribute("href", "https://collegefootballplayoff.com/rankings")
  })
  it("updates the displayed seeds and ranking date after a newer projection arrives", async () => {
    const teams = ["Georgia", "Miami", "Utah", "Indiana", "Alabama", "Kentucky", "Texas", "UCLA", "BYU", "Ole Miss", "Notre Dame", "Boise State"]
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ season: 2026, rankingDate: "2026-11-10", teams, groupSix: "Boise State" }) }))
    render(<CfpProjectionPreview />)
    expect(await screen.findByText(/November 10 CFP rankings/)).toBeInTheDocument()
    const seed = screen.getByText("1", { selector: ".cfp-preview-seed" })
    expect(seed.parentElement).toHaveTextContent("Georgia")
  })
})
