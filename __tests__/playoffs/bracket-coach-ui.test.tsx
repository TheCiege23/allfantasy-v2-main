import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import BracketCoachPanel, { bracketGameCalendar } from "@/components/brackets/playoffs/BracketCoachPanel"
import ChimmyMatchupAdvice from "@/components/brackets/playoffs/ChimmyMatchupAdvice"
import { buildBracketCoach } from "@/lib/playoffs/bracketCoach"
import { buildMatchupEvidence } from "@/lib/playoffs/bracketCoachEvidence"
import { buildPlayoffTemplate } from "@/lib/playoffs/playoffTemplate"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"
const paid = vi.hoisted(() => vi.fn())
vi.mock("@/lib/tokens/paidToolClient", () => ({ paidToolFetchWithConfirm: paid }))
vi.mock("next/link", () => ({ default: ({ href, children }: any) => <a href={href}>{children}</a> }))
vi.mock("@/components/i18n/LanguageProviderClient", () => ({ useOptionalLanguage: () => ({ language: "en" }) }))
const view = (): PlayoffChallengeView => ({
  challenge: { id: "cup", name: "Friends", sport: "nba_cup", seasonYear: 2026, ownerUserId: "me", status: "open", isTestMode: false, createdAt: "", updatedAt: "" },
  viewerUserId: "me", activeEntry: { id: "mine", name: "My entry", userId: "me", isComplete: true, pickCount: 1, finalizedAt: "2026-11-06T20:00:00Z", createdAt: "" }, entries: [], rounds: [],
  series: [{ ...buildPlayoffTemplate({ sport: "nba_cup", seasonYear: 2026 })[0], id: "g", round: "cup_group_play", homeTeamName: "Boston Celtics", awayTeamName: "Atlanta Hawks", startsAt: "2026-11-07T02:00:00Z" }], picks: [],
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
describe("bracket coach interactions", () => {
  it("loads the personal slate and exposes rooting, comparison and recap without changing picks", async () => {
    const v = view(), response = buildBracketCoach(v, null, Date.parse("2026-11-07T00:00:00Z"))
    const fetcher = vi.fn(async () => Response.json(response)); vi.stubGlobal("fetch", fetcher)
    render(<BracketCoachPanel view={v} />)
    expect(await screen.findByText("Your pick: No pick · 1 point available")).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("entryId=mine"), expect.objectContaining({ cache: "no-store" }))
    fireEvent.click(screen.getByRole("button", { name: "Who to root for" }))
    expect(screen.getByText(/Future picks and drafts stay private/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Compare brackets" }))
    expect(screen.getByRole("table")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "My recap" }))
    expect(screen.getByRole("button", { name: "Copy my recap" })).toBeInTheDocument()
    expect(fetcher.mock.calls.every((args) => (args[1] as RequestInit | undefined)?.method !== "POST")).toBe(true)
  })
  it("survives malformed responses and gives signed-out viewers a sign-in action", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ wrong: true })))
    const node = render(<BracketCoachPanel view={view()} />)
    expect(await screen.findByRole("alert")).toHaveTextContent("Coach feed is delayed")
    node.unmount()
    const v = view(); v.viewerUserId = null
    render(<BracketCoachPanel view={v} />)
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument()
  })
  it("uses paid consent transport for real analysis and only saves a recommendation after a separate click", async () => {
    const v = view()
    v.teamProfiles = { "Boston Celtics": { won: 6, lost: 1, winPercentage: 85.7, plusMinus: 20, seasonReview: "", source: "cached_standings" }, "Atlanta Hawks": { won: 2, lost: 5, winPercentage: 28.6, plusMinus: -20, seasonReview: "", source: "cached_standings" } }
    const evidence = buildMatchupEvidence(v, v.series[0], [], [], "No verified injury coverage")
    paid.mockResolvedValue(Response.json({ evidence, generative: true, analysis: "Verified form favors Boston; injury coverage is limited." }))
    const onPick = vi.fn()
    render(<ChimmyMatchupAdvice challengeId="cup" seriesId="g" canPick onPick={onPick} />)
    fireEvent.click(screen.getByRole("button", { name: "Ask Chimmy for full analysis" }))
    expect(await screen.findByLabelText("Chimmy analysis")).toHaveTextContent("Verified form favors Boston")
    expect(paid).toHaveBeenCalledWith("/api/brackets/playoffs/cup/coach/matchup", expect.objectContaining({ method: "POST" }))
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Use this pick · Boston Celtics" }))
    expect(onPick).toHaveBeenCalledExactlyOnceWith("Boston Celtics")
  })
  it("downloads opt-in reminders without leaking picks and escapes calendar content", () => {
    const v = view(), game = buildBracketCoach(v, null).nextLocks[0] ?? { id: "g", home: "BOS\nBEGIN:VEVENT", away: "ATL", startsAt: "2099-11-07T02:00:00Z", status: "scheduled", points: 1, pick: "PRIVATE PICK", eligible: false, locked: false, homeScore: null, awayScore: null }
    const calendar = bracketGameCalendar({ ...game, pick: "PRIVATE PICK" }, "https://example.test/brackets/leagues/cup")!
    expect(calendar).toContain("TRIGGER:-PT10M")
    expect(calendar).not.toContain("PRIVATE PICK")
    expect(calendar.match(/\r\nBEGIN:VEVENT\r\n/g)).toHaveLength(1)
    expect(bracketGameCalendar({ ...game, startsAt: null }, "https://example.test")).toBeNull()
  })
})
