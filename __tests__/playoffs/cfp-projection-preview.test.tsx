import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import CfpProjectionPreview from "@/components/brackets/playoffs/CfpProjectionPreview"

describe("CFP projection preview", () => {
  it("labels the snapshot and shows all projected first-round matchups without pick controls", () => {
    render(<CfpProjectionPreview />)
    const preview = screen.getByTestId("cfp-projection-preview")
    expect(within(preview).getByText(/November 3 CFP rankings/)).toBeInTheDocument()
    expect(within(preview).getByText(/Subject to change/)).toBeInTheDocument()
    expect(within(preview).getByText("Boise State")).toBeInTheDocument()
    expect(within(preview).getByText("Notre Dame")).toBeInTheDocument()
    expect(within(preview).getAllByText(/winner/i).length).toBeGreaterThan(0)
    expect(within(preview).queryByRole("button")).not.toBeInTheDocument()
    expect(within(preview).getByRole("link", { name: "CFP rankings source" })).toHaveAttribute("href", "https://collegefootballplayoff.com/news/2026/11/3/rankings")
  })
})
