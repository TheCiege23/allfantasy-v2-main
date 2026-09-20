import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import CreateEntryButton from "@/app/brackets/leagues/[leagueId]/CreateEntryButton"

/**
 * What the component RENDERS, not what its file says.
 *
 * 🛑 The static guard next door proves the create page is not pasted here
 * again. It cannot prove this thing is a button — a differently-worded copy
 * of the same form would satisfy it. So this renders the component and looks.
 */

const pushMock = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}))

describe("CreateEntryButton", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("is a button, not the create-pool form", () => {
    render(<CreateEntryButton leagueId="league-1" />)

    expect(screen.getByTestId("bracket-create-entry-open-button")).toBeTruthy()
    // The five-month regression, stated as an assertion: a component named
    // CreateEntryButton rendered the whole "Create Bracket Pool" page.
    expect(screen.queryByText("Create Bracket Pool")).toBeNull()
    expect(screen.queryByTestId("bracket-create-form")).toBeNull()
  })

  it("opens a one-field form and posts the entry to the endpoint that exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, entryId: "entry-1", tournamentId: "tour-1" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<CreateEntryButton leagueId="league-1" />)
    fireEvent.click(screen.getByTestId("bracket-create-entry-open-button"))

    fireEvent.change(screen.getByTestId("bracket-create-entry-name-input"), {
      target: { value: "My Bracket" },
    })
    fireEvent.submit(screen.getByTestId("bracket-create-entry-submit-button"))

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/bracket/entries")
    expect(JSON.parse(init.body)).toEqual({ leagueId: "league-1", name: "My Bracket" })

    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith("/bracket/tour-1/entry/entry-1"))
  })

  it("asks for the tiebreaker only when the pool uses one", () => {
    const { rerender } = render(<CreateEntryButton leagueId="league-1" />)
    fireEvent.click(screen.getByTestId("bracket-create-entry-open-button"))
    expect(screen.queryByTestId("bracket-create-entry-tiebreak-input")).toBeNull()

    rerender(<CreateEntryButton leagueId="league-1" tiebreakerEnabled />)
    expect(screen.getByTestId("bracket-create-entry-tiebreak-input")).toBeTruthy()
  })
})
