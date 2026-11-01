import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), session: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { playoffBracketChallenge: { findMany: mocks.findMany } } }))
vi.mock("next-auth", () => ({ getServerSession: mocks.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`) } }))
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }))
vi.mock("@/lib/preferences/ServerRenderPreferenceResolver", () => ({ resolveServerRenderPreferences: async () => ({ language: "en" }) }))
import MyBracketsPage from "@/app/brackets/my/page"
import MyBracketsList from "@/components/brackets/MyBracketsList"
import { listMyBrackets, type MyBracketLeague } from "@/lib/playoffs/myBrackets"

const league: MyBracketLeague = { id: "cup-league", name: "Friday Cup Crew", sport: "nba_cup", seasonYear: 2025, entries: [
  { id: "draft-entry", name: "My unfinished Cup", finalizedAt: null, _count: { picks: 3 } },
  { id: "final-entry", name: "My second Cup", finalizedAt: new Date("2025-11-01"), _count: { picks: 8 } },
] }
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ user: { id: "viewer" } }); mocks.findMany.mockResolvedValue([]) })
afterEach(cleanup)

describe("My Brackets recovery", () => {
  it("requires login before reading any saved entries and returns to My Brackets", async () => {
    mocks.session.mockResolvedValue(null)
    await expect(MyBracketsPage()).rejects.toThrow("REDIRECT /login?callbackUrl=%2Fbrackets%2Fmy")
    expect(mocks.findMany).not.toHaveBeenCalled()
    await expect(listMyBrackets("")).rejects.toThrow("Authentication required")
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
  it("scopes both league membership and nested entries to the authenticated viewer without filtering drafts or old seasons", async () => {
    await MyBracketsPage()
    const query = mocks.findMany.mock.calls[0][0]
    expect(query.where).toEqual({ OR: [{ ownerUserId: "viewer" }, { entries: { some: { userId: "viewer" } } }] })
    expect(query.select.entries.where).toEqual({ userId: "viewer" })
    expect(query.where).not.toHaveProperty("seasonYear")
    expect(query.select.entries.where).not.toHaveProperty("finalizedAt")
    expect(query.select.entries.select).not.toHaveProperty("picks")
  })
  it("opens every saved entry directly, including old-season drafts and multiple entries", async () => {
    mocks.findMany.mockResolvedValue([league])
    render(await MyBracketsPage())
    expect(screen.getByRole("heading", { name: "My Brackets" })).toBeInTheDocument()
    expect(screen.getByText("NBA Cup · 2025")).toBeInTheDocument()
    expect(screen.getByText("Draft · 3 picks saved")).toBeInTheDocument()
    expect(screen.getByText("Finalized · 8 picks saved")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open bracket: My unfinished Cup" })).toHaveAttribute("href", "/brackets/leagues/cup-league/entries/draft-entry")
    expect(screen.getByRole("link", { name: "Open bracket: My second Cup" })).toHaveAttribute("href", "/brackets/leagues/cup-league/entries/final-entry")
  })
  it("keeps an owned league findable even before its first entry is created", () => {
    render(<MyBracketsList language="en" leagues={[{ ...league, entries: [] }]} />)
    expect(screen.getByText(/haven’t made a bracket yet/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /League dashboard/ })).toHaveAttribute("href", "/brackets/leagues/cup-league")
  })
  it("distinguishes an unavailable database from an empty account", async () => {
    mocks.findMany.mockRejectedValue(new Error("unavailable"))
    render(await MyBracketsPage())
    expect(screen.getByRole("alert")).toHaveTextContent("Your brackets could not load")
    expect(screen.queryByText("No saved brackets yet")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/brackets/my")
  })
  it("offers creation and joining for an empty account and translates the destination", () => {
    render(<MyBracketsList language="es" leagues={[]} />)
    expect(screen.getByRole("heading", { name: "Mis cuadros" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Unirse con código" })).toHaveAttribute("href", "/brackets/join")
  })
})
