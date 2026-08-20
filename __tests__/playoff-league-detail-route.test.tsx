import React from "react"
import { render, screen } from "@testing-library/react"
import { describe, it, expect, beforeEach, vi } from "vitest"

const getServerSessionMock = vi.hoisted(() => vi.fn())
const getPlayoffBracketViewMock = vi.hoisted(() => vi.fn())
const redirectMock = vi.hoisted(() => vi.fn())
const bracketLeagueFindUniqueMock = vi.hoisted(() => vi.fn())

vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}))

vi.mock("@/lib/playoffs/playoffService", () => ({
  getPlayoffBracketView: getPlayoffBracketViewMock,
}))

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bracketLeague: {
      findUnique: bracketLeagueFindUniqueMock,
    },
  },
}))

vi.mock("@/components/brackets/playoffs/PlayoffBracketShell", () => ({
  default: ({ initialView }: { initialView: { challenge: { id: string } } }) => (
    <div data-testid="playoff-dashboard-shell">dashboard-{initialView.challenge.id}</div>
  ),
}))

const playoffView = {
  challenge: {
    id: "challenge-1",
    sport: "nba",
    name: "NBA Playoff Bracket",
  },
  participants: [{ userId: "u1", displayName: "User 1", entryCount: 1 }],
  entries: [{ id: "e1", name: "Bracket 1", userId: "u1", pickCount: 0, isComplete: false, createdAt: new Date().toISOString() }],
  viewerUserId: "u1",
  activeEntry: null,
  picks: [],
  rounds: [],
  series: [],
}

describe("/brackets/leagues/[leagueId] detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } })
    bracketLeagueFindUniqueMock.mockResolvedValue(null)
  })

  it("renders dashboard when pool exists", async () => {
    getPlayoffBracketViewMock.mockResolvedValue(playoffView)
    const mod = await import("@/app/brackets/leagues/[leagueId]/page")

    const element = await mod.default({ params: { leagueId: "challenge-1" }, searchParams: {} })
    expect((element as React.ReactElement).props.initialView.challenge.id).toBe("challenge-1")
  })

  it("renders dashboard when NHL pool exists", async () => {
    getPlayoffBracketViewMock.mockResolvedValue({
      ...playoffView,
      challenge: {
        ...playoffView.challenge,
        id: "challenge-nhl",
        sport: "nhl",
      },
    })
    const mod = await import("@/app/brackets/leagues/[leagueId]/page")

    const element = await mod.default({ params: { leagueId: "challenge-nhl" }, searchParams: {} })
    expect((element as React.ReactElement).props.initialView.challenge.id).toBe("challenge-nhl")
  })

  it("does not render create pool form on existing pool detail route", async () => {
    getPlayoffBracketViewMock.mockResolvedValue(playoffView)
    const mod = await import("@/app/brackets/leagues/[leagueId]/page")

    const element = await mod.default({ params: { leagueId: "challenge-1" }, searchParams: {} })
    render(element as React.ReactElement)
    expect(screen.queryByText("Create Bracket Challenge Pool")).not.toBeInTheDocument()
  })

  it("shows recovery UI for legacy bracket pool (loop-guard: does NOT redirect to /league/[id])", async () => {
    getPlayoffBracketViewMock.mockResolvedValue(null)
    bracketLeagueFindUniqueMock.mockResolvedValue({ id: "league-123", sport: null, name: "Old Pool" })
    const mod = await import("@/app/brackets/leagues/[leagueId]/page")

    const element = await mod.default({ params: { leagueId: "league-123" }, searchParams: {} })
    render(element as React.ReactElement)

    // Must NOT redirect back to /league/[id] — that would create an infinite loop
    expect(redirectMock).not.toHaveBeenCalled()
    // Must show accurate copy describing the older format, not a false "migrated" claim
    expect(screen.getByText("This pool uses the older bracket format")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Create New Playoff Pool" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Back to My Pools" })).toBeInTheDocument()
  })

  it("recovery UI create button links to sport-prefilled URL for NBA pool", async () => {
    getPlayoffBracketViewMock.mockResolvedValue(null)
    bracketLeagueFindUniqueMock.mockResolvedValue({
      id: "league-nba",
      name: "NBA Old Pool",
      tournament: { sport: "NBA" },
    })
    const mod = await import("@/app/brackets/leagues/[leagueId]/page")

    const element = await mod.default({ params: { leagueId: "league-nba" }, searchParams: {} })
    render(element as React.ReactElement)

    const createLink = screen.getByRole("link", { name: "Create New Playoff Pool" }) as HTMLAnchorElement
    expect(createLink.href).toContain("sport=NBA")
    expect(createLink.href).toContain("challengeType=playoff_challenge")
  })

  it("recovery UI create button links to sport-prefilled URL for NHL pool", async () => {
    getPlayoffBracketViewMock.mockResolvedValue(null)
    bracketLeagueFindUniqueMock.mockResolvedValue({
      id: "league-nhl",
      name: "NHL Old Pool",
      tournament: { sport: "NHL" },
    })
    const mod = await import("@/app/brackets/leagues/[leagueId]/page")

    const element = await mod.default({ params: { leagueId: "league-nhl" }, searchParams: {} })
    render(element as React.ReactElement)

    const createLink = screen.getByRole("link", { name: "Create New Playoff Pool" }) as HTMLAnchorElement
    expect(createLink.href).toContain("sport=NHL")
    expect(createLink.href).toContain("challengeType=playoff_challenge")
  })

  it("recovery UI create button falls back to generic URL for unknown sport", async () => {
    getPlayoffBracketViewMock.mockResolvedValue(null)
    bracketLeagueFindUniqueMock.mockResolvedValue({ id: "league-ncaa", sport: "NCAAB", name: "March Madness" })
    const mod = await import("@/app/brackets/leagues/[leagueId]/page")

    const element = await mod.default({ params: { leagueId: "league-ncaa" }, searchParams: {} })
    render(element as React.ReactElement)

    const createLink = screen.getByRole("link", { name: "Create New Playoff Pool" }) as HTMLAnchorElement
    expect(createLink.href).not.toContain("sport=NCAAB")
    expect(createLink.href).toContain("challengeType=playoff_challenge")
  })

  it("shows friendly not-found state for missing pool", async () => {
    getPlayoffBracketViewMock.mockResolvedValue(null)
    bracketLeagueFindUniqueMock.mockResolvedValue(null)
    const mod = await import("@/app/brackets/leagues/[leagueId]/page")

    const element = await mod.default({ params: { leagueId: "missing-pool" }, searchParams: {} })
    render(element as React.ReactElement)
    expect(screen.getByText("Pool not found")).toBeInTheDocument()
  })

  it("renders safe fallback when P2021 missing table error is thrown", async () => {
    const p2021 = Object.assign(new Error("The table `public.playoff_bracket_challenges` does not exist in the current database."), { code: "P2021" })
    getPlayoffBracketViewMock.mockRejectedValue(p2021)
    bracketLeagueFindUniqueMock.mockResolvedValue(null)
    const mod = await import("@/app/brackets/leagues/[leagueId]/page")

    const element = await mod.default({ params: { leagueId: "any-id" }, searchParams: {} })
    render(element as React.ReactElement)
    expect(screen.getByText("Playoff pools are being prepared")).toBeInTheDocument()
  })

  it("renders safe fallback when playoff lookup throws PrismaClientValidationError", async () => {
    const prismaValidation = Object.assign(
      new Error("Unknown field `name` for select statement on model `AppUser`"),
      { name: "PrismaClientValidationError" }
    )
    getPlayoffBracketViewMock.mockRejectedValue(prismaValidation)
    bracketLeagueFindUniqueMock.mockResolvedValue(null)
    const mod = await import("@/app/brackets/leagues/[leagueId]/page")

    const element = await mod.default({ params: { leagueId: "broken-id" }, searchParams: {} })
    render(element as React.ReactElement)
    expect(screen.getByText("Playoff pools are being prepared")).toBeInTheDocument()
  })

  it("generateMetadata returns generic title when playoff lookup fails with expected error", async () => {
    const prismaValidation = Object.assign(
      new Error("Unknown field `name` for select statement on model `AppUser`"),
      { name: "PrismaClientValidationError" }
    )
    getPlayoffBracketViewMock.mockRejectedValue(prismaValidation)
    const mod = await import("@/app/brackets/leagues/[leagueId]/page")

    const metadata = await mod.generateMetadata({ params: { leagueId: "broken-id" } })
    expect(metadata.title).toBe("Bracket Pool")
  })

  it("renders emergency fallback for unexpected route errors", async () => {
    getPlayoffBracketViewMock.mockRejectedValue(new Error("unexpected DB error"))
    const mod = await import("@/app/brackets/leagues/[leagueId]/page")

    const element = await mod.default({ params: { leagueId: "any-id" }, searchParams: {} })
    render(element as React.ReactElement)

    expect(screen.getByText("Pool dashboard is temporarily unavailable")).toBeInTheDocument()
  })
})

describe("/brackets/playoffs/[bracketId] compatibility route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("redirects to canonical leagues detail route", async () => {
    const mod = await import("@/app/brackets/playoffs/[bracketId]/page")

    await mod.default({ params: { bracketId: "challenge-1" }, searchParams: {} })

    expect(redirectMock).toHaveBeenCalledWith("/brackets/leagues/challenge-1")
  })

  it("preserves entryId when redirecting", async () => {
    const mod = await import("@/app/brackets/playoffs/[bracketId]/page")

    await mod.default({ params: { bracketId: "challenge-1" }, searchParams: { entryId: "entry-9" } })

    expect(redirectMock).toHaveBeenCalledWith("/brackets/leagues/challenge-1?entryId=entry-9")
  })

  it("returns generic metadata", async () => {
    const mod = await import("@/app/brackets/playoffs/[bracketId]/page")
    const metadata = await mod.generateMetadata({ params: { bracketId: "challenge-1" } })
    expect(metadata.title).toBe("Playoff Bracket")
  })
})
