import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import PlayoffCreateForm from "@/components/brackets/playoffs/PlayoffCreateForm"

const pushMock = vi.hoisted(() => vi.fn())
const createPlayoffBracketChallengeClientMock = vi.hoisted(() => vi.fn())
const toastSuccessMock = vi.hoisted(() => vi.fn())
const toastErrorMock = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}))

vi.mock("@/lib/playoffs/playoffClientApi", () => ({
  createPlayoffBracketChallengeClient: createPlayoffBracketChallengeClientMock,
}))

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}))

describe("PlayoffCreateForm", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows NBA create success toast and redirects", async () => {
    createPlayoffBracketChallengeClientMock.mockResolvedValue({
      challengeId: "challenge-nba",
      entryId: null,
      sport: "nba",
      name: "NBA Playoff Pool",
      redirectUrl: "/brackets/playoffs/challenge-nba",
    })

    render(<PlayoffCreateForm initialSport="nba" />)
    fireEvent.click(screen.getByRole("button", { name: "Create Pool" }))

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("NBA Playoff Pool created.")
      expect(pushMock).toHaveBeenCalledWith("/brackets/playoffs/challenge-nba")
    })
  })

  it("shows NHL create success toast and redirects", async () => {
    createPlayoffBracketChallengeClientMock.mockResolvedValue({
      challengeId: "challenge-nhl",
      entryId: null,
      sport: "nhl",
      name: "NHL Playoff Pool",
      redirectUrl: "/brackets/playoffs/challenge-nhl",
    })

    render(<PlayoffCreateForm initialSport="nhl" />)
    fireEvent.click(screen.getByRole("button", { name: "Create Pool" }))

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("NHL Playoff Pool created.")
      expect(pushMock).toHaveBeenCalledWith("/brackets/playoffs/challenge-nhl")
    })
  })

  it("shows missing challenge error when API response does not include challengeId", async () => {
    createPlayoffBracketChallengeClientMock.mockRejectedValue(new Error("Bracket was not created. Please try again."))

    render(<PlayoffCreateForm initialSport="nba" />)
    fireEvent.click(screen.getByRole("button", { name: "Create Pool" }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Bracket was not created. Please try again.")
    })
  })
})
