// @vitest-environment jsdom
/**
 * Find a League's card chips read in BOTH themes. The chip text colours were fixed light colours written
 * for the dark theme, and measured 1.26–1.58:1 contrast on the light theme's cards (WCAG asks 4.5:1 for
 * text this small). Each now mixes with the theme's own `--text`, which measured 5.04:1 or better on light
 * and 11:1 or better on dark (2026-11-10, rendered with the app's compiled CSS). jsdom cannot compute
 * contrast, so this pins the rule: no chip carries a fixed text colour.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"

vi.mock("@/hooks/useUserTimezone", () => ({ useUserTimezone: () => ({ timezone: "America/New_York" }) }))

import { FindLeagueCard } from "@/components/discovery/FindLeagueCard"
import type { DiscoveryCard } from "@/lib/public-discovery/types"

const card = (o: Partial<DiscoveryCard> = {}): DiscoveryCard =>
  ({
    source: "fantasy", id: "L1", name: "Sunday Funday", description: null, sport: "NFL", memberCount: 7, maxMembers: 12,
    joinUrl: "/join?code=L1", joinMode: "invite", detailUrl: "/leagues/L1", ownerName: "Commissioner", ownerAvatar: null,
    creatorSlug: null, creatorName: null, tournamentName: null, season: 2026, scoringMode: "ppr", isPaid: false, isPrivate: false,
    createdAt: new Date().toISOString(), fillPct: 90, leagueType: "fantasy", leagueStyle: "redraft", draftType: "snake",
    draftStatus: "pre_draft", teamCount: 12, draftDate: null, commissionerName: "Commissioner", aiFeatures: [], leagueTier: 1,
    ...o,
  }) as DiscoveryCard

afterEach(() => cleanup())

describe("Find a League card chips", () => {
  it.each([
    ["a free public league with a vibe and a rank band", card({ vibes: ["casual"], rankBand: "your_level" } as Partial<DiscoveryCard>)],
    ["a paid league with AI features", card({ isPaid: true, entryFee: 25, aiFeatures: ["draft_assistant"] } as Partial<DiscoveryCard>)],
    ["a creator league", card({ source: "creator" })],
  ])("%s: every coloured chip mixes its colour with the theme's text", (_name, league) => {
    const { container } = render(<FindLeagueCard league={league} />)
    const coloured = [...container.querySelectorAll<HTMLElement>("span, p")].filter((el) => {
      const color = el.getAttribute("style")?.match(/(?:^|;)\s*color:\s*([^;]+)/)?.[1] ?? ""
      return /rgb|color-mix/.test(color)
    })
    expect(coloured.length).toBeGreaterThan(3)
    for (const el of coloured) {
      const color = el.getAttribute("style")!.match(/(?:^|;)\s*color:\s*([^;]+)/)![1]!
      expect(color, el.textContent ?? "").toContain("var(--text)")
    }
  })
})
