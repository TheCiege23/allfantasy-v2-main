import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

describe("NBA create pool copy", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("explicitly warns about template bracket when official consumer sync flag is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_PLAYOFF_NBA_OFFICIAL_SYNC", "")
    const NbaPlayoffPoolCreatePage = (await import("@/app/brackets/nba/create/page")).default
    render(<NbaPlayoffPoolCreatePage />)

    expect(screen.getByTestId("nba-create-template-banner")).toBeInTheDocument()
    expect(screen.getByText(/Test \/ template bracket/i)).toBeInTheDocument()
  })
})
