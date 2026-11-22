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
    // Both layouts carry the field; CSS shows one (broadcast when wide, stacked when narrow).
    for (const layout of [screen.getByTestId("cfp-bracket-stage"), screen.getByTestId("cfp-bracket-stack")]) {
      expect(within(layout).getByText("Boise State")).toBeInTheDocument()
      expect(within(layout).getByText("Notre Dame")).toBeInTheDocument()
      expect(within(layout).getAllByText(/winner/i).length).toBeGreaterThan(0)
    }
    expect(within(preview).queryByRole("button")).not.toBeInTheDocument()
    expect(within(preview).getByRole("link", { name: "CFP rankings source" })).toHaveAttribute("href", "https://collegefootballplayoff.com/rankings")
  })

  it("updates the displayed seeds and ranking date after a newer projection arrives", async () => {
    const teams = ["Georgia", "Miami", "Utah", "Indiana", "Alabama", "Kentucky", "Texas", "UCLA", "BYU", "Ole Miss", "Notre Dame", "Boise State"]
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ season: 2026, rankingDate: "2026-11-10", teams, groupSix: "Boise State" }) }))
    render(<CfpProjectionPreview />)
    expect(await screen.findByText(/November 10 CFP rankings/)).toBeInTheDocument()
    const stage = screen.getByTestId("cfp-bracket-stage")
    const seed = within(stage).getByText("1.", { selector: ".cfp-slot-seed" })
    expect(seed.parentElement).toHaveTextContent("Georgia")
  })

  it("puts a bowl crest and name above every game from the quarterfinals on", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
    render(<CfpProjectionPreview />)
    const stage = screen.getByTestId("cfp-bracket-stage")
    const stageBowls = Array.from(stage.querySelectorAll(".cfp-bowl-tag")).map(tag => tag.getAttribute("data-bowl"))
    expect(stageBowls.sort()).toEqual(["cotton", "fiesta", "orange", "peach", "rose", "sugar", "title"])
    expect(within(stage).getByText("National Championship")).toBeInTheDocument()
    const stack = screen.getByTestId("cfp-bracket-stack")
    const firstRound = within(stack).getByRole("region", { name: "First round" })
    expect(firstRound.querySelectorAll(".cfp-bowl-tag")).toHaveLength(0)
    const quarterfinals = within(stack).getByRole("region", { name: "Quarterfinals" })
    expect(Array.from(quarterfinals.querySelectorAll(".cfp-bowl-tag")).map(tag => tag.getAttribute("data-bowl"))).toEqual(["rose", "fiesta", "peach", "cotton"])
    // Our own crest, decorative: the bowl name sits right beside it.
    expect(quarterfinals.querySelector("svg.af-pb-crest")?.getAttribute("aria-hidden")).toBe("true")
  })

  it("shows the committee rank beside each seed when the projection carries ranks", async () => {
    const teams = ["Georgia", "Miami", "Utah", "Indiana", "Alabama", "Kentucky", "Texas", "UCLA", "BYU", "Ole Miss", "Notre Dame", "Boise State"]
    const ranks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17]
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ season: 2026, rankingDate: "2026-11-10", teams, groupSix: "Boise State", ranks }) }))
    render(<CfpProjectionPreview />)
    await screen.findByText(/November 10 CFP rankings/)
    const stage = screen.getByTestId("cfp-bracket-stage")
    expect(within(stage).getByText("Boise State").closest(".cfp-slot")).toHaveTextContent("[17]")
  })

  it("draws no rank for a projection cached before ranks existed", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
    const { container } = render(<CfpProjectionPreview />)
    expect(container.querySelector(".cfp-slot-rank")).toBeNull()
  })
})
