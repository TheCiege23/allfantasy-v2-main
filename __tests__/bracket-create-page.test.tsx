import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import NewBracketLeaguePage from "@/app/brackets/leagues/new/page"

const pushMock = vi.hoisted(() => vi.fn())
const backMock = vi.hoisted(() => vi.fn())
const searchParamsMock = vi.hoisted(() => vi.fn(() => new URLSearchParams()))
const createPlayoffMock = vi.hoisted(() => vi.fn())
const useSessionMock = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, back: backMock }),
  useSearchParams: () => searchParamsMock(),
}))

vi.mock("next-auth/react", () => ({
  useSession: useSessionMock,
}))

vi.mock("@/lib/playoffs/playoffClientApi", () => ({
  createPlayoffBracketChallengeClient: createPlayoffMock,
}))

describe("/brackets/leagues/new create page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParamsMock.mockReturnValue(new URLSearchParams())
    useSessionMock.mockReturnValue({ data: null })
    createPlayoffMock.mockResolvedValue({
      challengeId: "challenge-nba",
      redirectUrl: "/brackets/leagues/challenge-nba",
    })
  })

  it("renders Create Pool form", () => {
    render(<NewBracketLeaguePage />)

    expect(screen.getByText("Create Bracket Pool")).toBeInTheDocument()
    expect(screen.getByTestId("bracket-create-form")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Create Pool" })).toBeInTheDocument()
  })

  it("renders NBA sport preselected from query without auto-creating", () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("sport=nba&challengeType=playoff_challenge"))

    render(<NewBracketLeaguePage />)

    expect(screen.getByTestId("bracket-create-sport-NBA")).toHaveTextContent("NBA")
    // "an NBA", not "a NBA" — the article follows the SOUND of the letter N.
    // This line pinned the wrong copy for the life of the file, which is how
    // the sentence survived: a test can hold a bug in place as firmly as it
    // holds a behaviour.
    expect(screen.getByText("Build an NBA Playoff Challenge pool.")).toBeInTheDocument()
    expect(createPlayoffMock).not.toHaveBeenCalled()
  })

  /*
   * The sentence as reported, on the sport it was reported for.
   *
   * ⚠ These cases cannot prove the article is CHOSEN rather than hard-coded
   * to "an": every sport this form can display takes "an", and the one that
   * does not — Soccer — redirects to the World Cup create page before this
   * line renders. `indefinite-article.test.ts` carries that half ("a Soccer",
   * "a UFC"); these carry the rendered sentence.
   */
  it.each([
    ["mlb", "Build an MLB Playoff Challenge pool."],
    ["nhl", "Build an NHL Playoff Challenge pool."],
    ["ncaab", "Build an NCAA Basketball Playoff Challenge pool."],
  ])("writes the right article for %s", (sport, sentence) => {
    searchParamsMock.mockReturnValue(
      new URLSearchParams(`sport=${sport}&challengeType=playoff_challenge`),
    )

    render(<NewBracketLeaguePage />)

    expect(screen.getByText(sentence)).toBeInTheDocument()
  })

  it("submits NBA playoff pools through the playoff challenge API and redirects", async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("sport=nba&challengeType=playoff_challenge"))
    render(<NewBracketLeaguePage />)

    fireEvent.change(screen.getByTestId("bracket-create-name-input"), {
      target: { value: "Friends NBA Pool" },
    })
    fireEvent.click(screen.getByTestId("bracket-create-submit-button"))

    await waitFor(() => {
      expect(createPlayoffMock).toHaveBeenCalledWith(expect.objectContaining({
        name: "Friends NBA Pool",
        sport: "nba",
        visibility: "private",
        maxUsers: 50,
        bracketsPerUser: 1,
        scoringStyle: "momentum",
        lockRule: "series_start",
        config: expect.objectContaining({
          includePlayIn: false,
          pickSpread: false,
          pickOverUnder: false,
          maxEntriesPerParticipant: 1,
        }),
      }))
      expect(pushMock).toHaveBeenCalledWith("/brackets/leagues/challenge-nba")
    })
  })

  it("can create a playoff test pool with no-lock late picks enabled", async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("sport=nba&challengeType=playoff_challenge"))
    render(<NewBracketLeaguePage />)

    fireEvent.change(screen.getByTestId("bracket-create-name-input"), {
      target: { value: "Late Pick NBA Pool" },
    })
    fireEvent.change(screen.getByTestId("bracket-create-lock-rule-select"), {
      target: { value: "none" },
    })
    fireEvent.click(screen.getByTestId("bracket-create-submit-button"))

    await waitFor(() => {
      expect(createPlayoffMock).toHaveBeenCalledWith(expect.objectContaining({
        name: "Late Pick NBA Pool",
        sport: "nba",
        lockRule: "none",
        config: expect.objectContaining({ lockRule: "none" }),
      }))
    })
  })

  it("shows safe server errors from playoff create", async () => {
    createPlayoffMock.mockRejectedValue(new Error("Playoff pool creation needs the latest database migration."))
    searchParamsMock.mockReturnValue(new URLSearchParams("sport=nba&challengeType=playoff_challenge"))
    render(<NewBracketLeaguePage />)

    fireEvent.change(screen.getByTestId("bracket-create-name-input"), {
      target: { value: "Friends NBA Pool" },
    })
    fireEvent.click(screen.getByTestId("bracket-create-submit-button"))

    expect(await screen.findByText("Playoff pool creation needs the latest database migration.")).toBeInTheDocument()
  })

  it("renders locked AF Commissioner preview and upgrade link", () => {
    render(<NewBracketLeaguePage />)

    expect(screen.getByTestId("af-commissioner-options")).toHaveTextContent("Locked Preview")
    expect(screen.getByTestId("af-commissioner-upgrade-link")).toHaveAttribute("href", "/pricing")
    expect(screen.getByTestId("af-commissioner-option-exact-series-score-picks")).toBeDisabled()
  })

  it("unlocks AF Commissioner options for the all-access account", () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          email: "cjabar.henson@gmail.com",
          username: "TheCiege26",
          name: "TheCiege26",
        },
      },
    })

    render(<NewBracketLeaguePage />)

    expect(screen.getByTestId("af-commissioner-options")).not.toHaveTextContent("Locked Preview")
    expect(screen.queryByTestId("af-commissioner-upgrade-link")).not.toBeInTheDocument()
    expect(screen.getByTestId("af-commissioner-option-exact-series-score-picks")).not.toBeDisabled()
  })
})
