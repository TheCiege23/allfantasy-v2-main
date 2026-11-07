import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { hydrateRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import BracketCommsDock from "@/components/brackets/BracketCommsDock"

const session = vi.hoisted(() => ({ current: { status: "unauthenticated", data: null } as any }))
vi.mock("next-auth/react", () => ({ useSession: () => session.current }))
vi.mock("next/dynamic", () => ({
  default: () => (props: any) => <div data-testid="comms-dock">{JSON.stringify(props)}</div>,
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  session.current = { status: "unauthenticated", data: null }
})

describe("bracket communications dock", () => {
  it("hydrates a signed-in visitor without adding server-side bracket chrome", async () => {
    session.current = { status: "authenticated", data: { user: { id: "a" } } }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ leagues: [] }) }))
    const container = document.createElement("div")
    document.body.appendChild(container)
    container.innerHTML = renderToString(<BracketCommsDock tokenCost={10} />)
    expect(container.innerHTML).toBe("")
    const errors: unknown[] = []
    let root: ReturnType<typeof hydrateRoot>
    await act(async () => { root = hydrateRoot(container, <BracketCommsDock tokenCost={10} />, { onRecoverableError: (error) => errors.push(error) }) })
    expect(errors).toEqual([])
    expect(screen.getByTestId("comms-dock")).toBeInTheDocument()
    await act(async () => root!.unmount())
    container.remove()
  })

  it("does not mount or fetch for a signed-out visitor", () => {
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    render(<BracketCommsDock tokenCost={10} />)
    expect(screen.queryByTestId("comms-dock")).not.toBeInTheDocument()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("loads real fantasy league scope without using the bracket league id", async () => {
    session.current = { status: "authenticated", data: { user: { id: "a", email: "a@example.test" } } }
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ leagues: [
      { id: "real", name: "Fantasy League", platform: "SLEEPER", platformLeagueId: "external" },
      { id: "legacy", name: "Old snapshot", hasUnifiedRecord: false },
    ] }) })
    vi.stubGlobal("fetch", fetcher)
    render(<BracketCommsDock tokenCost={10} />)
    await waitFor(() => expect(screen.getByTestId("comms-dock")).toHaveTextContent("Fantasy League"))
    const props = JSON.parse(screen.getByTestId("comms-dock").textContent!)
    expect(props.pageLeagueId).toBeNull()
    expect(props.leagues).toEqual([{ id: "real", name: "Fantasy League", platform: "sleeper", platformLeagueId: "external", isCommissioner: false, teamCount: 0 }])
    expect(props.chimmyTokenCost).toBe(10)
    expect(fetcher).toHaveBeenCalledWith("/api/league/list?summary=1", expect.objectContaining({ cache: "no-store" }))
  })

  it("clears the previous account on sign-out and reports league-list errors", async () => {
    session.current = { status: "authenticated", data: { user: { id: "a" } } }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }))
    const view = render(<BracketCommsDock tokenCost={null} />)
    expect(await screen.findByRole("status")).toHaveTextContent("couldn't load")
    session.current = { status: "unauthenticated", data: null }
    view.rerender(<BracketCommsDock tokenCost={null} />)
    expect(screen.queryByTestId("comms-dock")).not.toBeInTheDocument()
  })

  it("keeps the drawer mounted during session refresh, but discards the old account on a switch", async () => {
    let finishFirst!: (value: unknown) => void
    const first = new Promise((resolve) => { finishFirst = resolve })
    const fetcher = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce({ ok: true, json: async () => ({ leagues: [{ id: "b-league", name: "B League" }] }) })
    vi.stubGlobal("fetch", fetcher)
    session.current = { status: "authenticated", data: { user: { id: "a" } } }
    const view = render(<BracketCommsDock tokenCost={10} />)
    expect(screen.getByTestId("comms-dock")).toBeInTheDocument()
    session.current = { status: "loading", data: null }
    view.rerender(<BracketCommsDock tokenCost={10} />)
    expect(screen.getByTestId("comms-dock")).toBeInTheDocument()
    session.current = { status: "authenticated", data: { user: { id: "b" } } }
    view.rerender(<BracketCommsDock tokenCost={10} />)
    finishFirst({ ok: true, json: async () => ({ leagues: [{ id: "a-league", name: "A League" }] }) })
    await waitFor(() => expect(screen.getByTestId("comms-dock")).toHaveTextContent("B League"))
    expect(screen.getByTestId("comms-dock")).not.toHaveTextContent("A League")
  })
})

