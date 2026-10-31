import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import BracketExperienceHub from "@/components/brackets/BracketExperienceHub"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"
const getView = vi.hoisted(() => vi.fn())
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }))
vi.mock("@/lib/playoffs/playoffClientApi", () => ({ getPlayoffBracketViewClient: getView, createPlayoffBracketEntryClient: vi.fn() }))
vi.mock("@/components/brackets/playoffs/MlbBracketBoard", () => ({ default: ({ view, actions }: any) => <div data-testid="owned-board">{view.challenge.name}{actions}</div> }))

const ownLeague = { challengeId: "mine", name: "Our Saturday Crew", sport: "ncaaf", seasonYear: 2026 }
const ownedView = {
  challenge: { id: "mine", name: "Our Saturday Crew", sport: "ncaaf", seasonYear: 2026, inviteCode: "MYCREW", ownerUserId: "me", status: "open", isTestMode: false, createdAt: "", updatedAt: "" },
  activeEntry: { id: "entry", name: "My real bracket", userId: "me", pickCount: 4, isComplete: true, rank: 2, createdAt: "" },
  entries: [{ id: "entry", name: "My real bracket", userId: "me", rank: 2, totalScore: 7, potentialTotal: 20, finalizedAt: "2026-10-30T00:00:00Z", isComplete: true, pickCount: 4, createdAt: "" }], participants: [], series: [], picks: [], rounds: [],
} satisfies PlayoffChallengeView

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 }))) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("approved bracket experience workspace", () => {
  it("renders an honest public format preview and working creation links", async () => {
    render(<BracketExperienceHub language="en" season={2026} />)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Own the bracket.Win the league.")
    expect(await screen.findByText("Bracket preview")).toBeInTheDocument()
    expect(screen.getByText("Not ranked yet")).toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: /Create Bracket League/ })[0]).toHaveAttribute("href", "/brackets/leagues/new?sport=NCAAF&challengeType=playoff_challenge")
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/brackets/playoffs?sport=ncaaf", expect.objectContaining({ cache: "no-store" })))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
  it("switches to NBA Cup with remaining-game rules and the correct creation target", async () => {
    render(<BracketExperienceHub language="en" season={2026} />)
    fireEvent.click(screen.getByRole("button", { name: "NBA Cup" }))
    expect(screen.getByText("30 teams · Group Play + 8-team knockout")).toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: /Create Bracket League/ })[0]).toHaveAttribute("href", expect.stringContaining("sport=NBA_CUP"))
    fireEvent.click(screen.getByRole("button", { name: "Rules & Scoring" }))
    expect(screen.getByText(/Missed games earn zero/)).toBeInTheDocument()
    expect(screen.getAllByText("Group Play").length).toBeGreaterThan(0)
  })
  it("loads only the selected season and sport and displays actual saved picks and rank", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ challenges: [ownLeague, { ...ownLeague, challengeId: "old", seasonYear: 2025 }, { ...ownLeague, challengeId: "other-sport", sport: "nba_cup" }] }), { status: 200 }))
    getView.mockResolvedValue(ownedView)
    render(<BracketExperienceHub language="en" season={2026} />)
    await screen.findByTestId("owned-board")
    expect(getView).toHaveBeenCalledExactlyOnceWith("mine")
    expect(screen.getByText("4 picks saved")).toBeInTheDocument()
    expect(screen.getByText("#2")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Review & finalize/ })).toHaveAttribute("href", "/brackets/leagues/mine/entries/entry")
  })
  it("exposes a retry when the API fails and never substitutes sample scores", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 503 }))
    render(<BracketExperienceHub language="en" season={2026} />)
    expect(await screen.findByRole("alert")).toHaveTextContent("Your leagues could not load")
    expect(screen.queryByTestId("owned-board")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
  })
  it("renders Spanish copy and keeps the capacity and no-gambling boundary visible", async () => {
    render(<BracketExperienceHub language="es" season={2026} />)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Domina el cuadro.")
    expect(screen.getByText("1 gratis · 5 con AF Pro")).toBeInTheDocument()
    expect(screen.getByText(/AllFantasy no ofrece premios/)).toBeInTheDocument()
  })
})
