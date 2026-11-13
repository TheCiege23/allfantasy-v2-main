import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import PlayoffBracketEntryShell from "@/components/brackets/playoffs/PlayoffBracketEntryShell"
import MyBracketsList from "@/components/brackets/MyBracketsList"
import { VIEWS } from "@/app/e2e/bracket-pool/fixtures"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: VIEWS.owner.viewerUserId } }, status: "authenticated" }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("bracket pick screen — visual audit", () => {
  it("keeps lock diagnostics in the DOM but off the owner's screen", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
    const { container } = render(<PlayoffBracketEntryShell initialView={VIEWS.owner} />)
    const entry = screen.getByTestId("playoff-entry-lock-diagnostics")
    expect(entry.hidden).toBe(true)
    const perSeries = container.querySelectorAll('[data-testid^="playoff-series-lock-diagnostics-"]')
    expect(perSeries.length).toBeGreaterThan(0)
    for (const el of perSeries) expect((el as HTMLElement).hidden).toBe(true)
    // Nothing visible spells out the engine's state.
    const shown = container.cloneNode(true) as HTMLElement
    shown.querySelectorAll("[hidden]").forEach((el) => el.remove())
    expect(shown.textContent).not.toMatch(/allowTestLatePicks=|projectionMode=|lockRule=/)
    expect(container.textContent).toMatch(/projectionMode=/)
  })

  it("gives a finished series no Next game or venue line", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
    render(<PlayoffBracketEntryShell initialView={VIEWS.pool} />)
    // ser-1 is final in the fixture, ser-5 is in progress.
    expect(screen.queryByTestId("playoff-series-next-ser-1")).toBeNull()
    expect(screen.queryByTestId("playoff-series-venue-ser-1")).toBeNull()
    expect(screen.getByTestId("playoff-series-next-ser-5").textContent).toMatch(/^Next: /)
  })
})

describe("My Brackets — visual audit", () => {
  it("keeps the trophy icon full size beside a pool name that wraps", () => {
    const { container } = render(<MyBracketsList language="en" leagues={[{ id: "p", name: "Office NBA Cup Knockout — Third Floor and Friends of the Third Floor", sport: "nba_cup", seasonYear: 2026, entries: [] }]} />)
    const icon = container.querySelector("header svg")
    expect(icon?.getAttribute("class") ?? "").toMatch(/\bshrink-0\b/)
  })
})
