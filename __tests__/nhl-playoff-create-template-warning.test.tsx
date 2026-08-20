import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

describe("NHL create pool copy", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("explicitly warns about template bracket when official consumer sync flag is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_PLAYOFF_NHL_OFFICIAL_SYNC", "")
    const NhlPlayoffPoolCreatePage = (await import("@/app/brackets/nhl/create/page")).default
    render(<NhlPlayoffPoolCreatePage />)

    expect(
      screen.getByText(/Using test\/template NHL bracket until official playoff sync is connected/i)
    ).toBeInTheDocument()
  })
})
