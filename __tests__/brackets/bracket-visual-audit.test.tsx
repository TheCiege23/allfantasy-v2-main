import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"
import PlayoffBracketShell from "@/components/brackets/playoffs/PlayoffBracketShell"
import { VIEWS } from "@/app/e2e/bracket-pool/fixtures"
import { poolDashboardCopy } from "@/lib/brackets/poolDashboardCopy"
import { getLeagueFilterOptions } from "@/lib/league-discovery/LeagueFilterResolver"

const writeText = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

afterEach(() => { cleanup() })

describe("bracket pool dashboard — visual audit", () => {
  it("shows the owner the same invite link the button copies", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    render(<PlayoffBracketShell initialView={VIEWS.owner} />)
    const shown = screen.getByTestId("playoff-invite-link").textContent
    // The server's inviteUrl is a relative dashboard path; the box must not print it with a bolted-on query.
    expect(shown).toBe(`${window.location.origin}/brackets/leagues/e2e-pool?code=HOOPS27`)
    fireEvent.click(screen.getByTestId("playoff-copy-invite-link-btn"))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(shown))
  })

  it("keeps the sync-tools diagnostic out of sight", () => {
    render(<PlayoffBracketShell initialView={VIEWS.owner} />)
    const debug = screen.getByTestId("playoff-sync-tools-visibility-debug")
    expect(debug.hidden).toBe(true)
    expect(debug.textContent).toContain("syncToolsVisible=true")
  })

  it("counts one entry as one entry", () => {
    expect(poolDashboardCopy("en").entriesCount(1)).toBe("1 entry")
    expect(poolDashboardCopy("en").entriesCount(2)).toBe("2 entries")
    render(<PlayoffBracketShell initialView={VIEWS.pool} />)
    expect(screen.getAllByText("1 entry").length).toBe(8)
    expect(screen.queryByText("1 entries")).toBeNull()
  })
})

describe("bracket discovery and create — visual audit", () => {
  it("says what each discovery filter's catch-all option means", () => {
    const o = getLeagueFilterOptions()
    const allLabels = [o.entryFees, o.visibilities, o.difficulties].map((list) => list.find((x) => x.value === "all")?.label)
    expect(allLabels).toEqual(["Any entry fee", "Any visibility", "Any difficulty"])
  })

  it("keeps the playoff create card out of light mode's clamp", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/brackets/playoffs/PlayoffCreateForm.tsx"), "utf8")
    expect(src).toMatch(/^\s*<div className="af-draft-dark mx-auto max-w-xl rounded-3xl/m)
  })
})
