/**
 * DraftAdvisorContextService — unit tests
 *
 * Covers pure helper logic (re-implemented inline) and end-to-end
 * getDraftAdvisorContext composition with a mock snapshotLoader and
 * stubbed prisma.
 *
 * Tests:
 *  1.  normalizeLeagueFormat: "dynasty" variant → "dynasty"
 *  2.  normalizeLeagueFormat: null / empty → "redraft"
 *  3.  normalizeLeagueFormat: "keeper" → "keeper"
 *  4.  normalizeLeagueFormat: "best ball" (with space) → "best_ball"
 *  5.  normalizeScoring: null → "ppr"
 *  6.  normalizeScoring: "PPR" → "ppr"
 *  7.  computePositionalScarcity: RB pool < high threshold → high
 *  8.  computePositionalScarcity: WR large pool → low
 *  9.  computePositionalScarcity: QB mid-range pool → medium
 * 10.  computePositionalScarcity: tier1Available counts only confidence ≥0.65
 * 11.  computeRosterNeeds: empty roster → all standard positions returned
 * 12.  computeRosterNeeds: QB already filled → QB absent from needs
 * 13.  computeRosterNeeds: 2 WR needed → WR has highest urgency
 * 14.  computeByeWeekConflicts: 2 starters share bye week → positions flagged
 * 15.  computeByeWeekConflicts: empty roster → no conflicts
 * 16.  computeByeWeekConflicts: no bye map → no conflicts
 * 17.  bye week algorithm: team with missing week → bye = that week
 * 18.  getDraftAdvisorContext: empty candidates → confidence=0, no enriched
 * 19.  getDraftAdvisorContext: snapshots enrich candidates
 * 20.  getDraftAdvisorContext: no schedule → missingData includes bye_week_schedule
 * 21.  getDraftAdvisorContext: rosterNeeds computed from provided currentRoster
 * 22.  getDraftAdvisorContext: sport normalised to UPPER, generatedAt is ISO
 * 23.  getDraftAdvisorContext: failed snapshot → confidence=0 + missingData added
 * 24.  getDraftAdvisorContext: confidence is mean of all candidate confidences
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { FantasyValueSnapshot } from "@/lib/sports-reporting/FantasyValueSnapshotService"

vi.mock("server-only", () => ({}))

// ─── Prisma mock ─────────────────────────────────────────────────────────────

const prismaMock = vi.hoisted(() => ({
  sportsGame: {
    findMany: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}))

// ─── team-abbrev stub — identity pass-through (tests don't need real lookup) ─

vi.mock("@/lib/team-abbrev", () => ({
  normalizeTeamAbbrev: (raw: string | null | undefined) => {
    if (!raw || raw.trim() === "") return null
    return raw.trim().toUpperCase()
  },
}))

// ─── Snapshot factory ─────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<FantasyValueSnapshot> = {}): FantasyValueSnapshot {
  return {
    sport: "NFL",
    playerId: "p1",
    playerName: "Test Player",
    position: "QB",
    team: "KC",
    leagueFormat: "redraft",
    scoringFormat: "ppr",
    shortTermValue: 80,
    longTermValue: 85,
    riskScore: 0.2,
    injuryRisk: "low",
    roleConfidence: 0.9,
    dataFreshness: { latestAt: new Date().toISOString(), stale: false, staleDomains: [] },
    sourcesUsed: ["sportsPlayerRecord"],
    missingData: [],
    confidence: 0.9,
    ...overrides,
  }
}

// ─── Pure helpers (mirrors DraftAdvisorContextService internals) ─────────────

function normalizeLeagueFormat(value: string | null | undefined): string {
  const v = String(value ?? "redraft")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
  if (v.includes("dynasty")) return "dynasty"
  if (v.includes("keeper")) return "keeper"
  if (v.includes("best")) return "best_ball"
  return v || "redraft"
}

function normalizeScoring(value: string | null | undefined): string {
  return String(value ?? "ppr").trim().toLowerCase() || "ppr"
}

type PositionalScarcityEntry = {
  totalAvailable: number
  tier1Available: number
  scarcityRating: "high" | "medium" | "low"
}

const SCARCITY_HIGH: Record<string, number> = {
  QB: 4, RB: 10, WR: 14, TE: 3, K: 3, DEF: 3,
}
const SCARCITY_MEDIUM: Record<string, number> = {
  QB: 8, RB: 18, WR: 24, TE: 6, K: 6, DEF: 6,
}

function computePositionalScarcity(
  candidates: Array<{ position: string | null; snapshot: { confidence: number } }>,
  totalTeams: number | null
): Record<string, PositionalScarcityEntry> {
  const scarcity: Record<string, PositionalScarcityEntry> = {}
  const teams = Math.max(8, totalTeams ?? 12)
  const byPosition = new Map<string, typeof candidates>()
  for (const c of candidates) {
    const pos = c.position?.toUpperCase() ?? "FLEX"
    byPosition.set(pos, [...(byPosition.get(pos) ?? []), c])
  }
  for (const [pos, group] of byPosition.entries()) {
    const total = group.length
    const tier1 = group.filter((c) => c.snapshot.confidence >= 0.65).length
    const highThresh = Math.max(SCARCITY_HIGH[pos] ?? 3, Math.ceil(teams * 0.2))
    const medThresh = Math.max(SCARCITY_MEDIUM[pos] ?? 6, Math.ceil(teams * 0.5))
    const rating: PositionalScarcityEntry["scarcityRating"] =
      total <= highThresh ? "high" : total <= medThresh ? "medium" : "low"
    scarcity[pos] = { totalAvailable: total, tier1Available: tier1, scarcityRating: rating }
  }
  return scarcity
}

const STANDARD_STARTS: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 }

function computeRosterNeeds(
  currentRoster: Array<{ position: string }> | undefined
): string[] {
  if (!currentRoster || currentRoster.length === 0) {
    return Object.entries(STANDARD_STARTS).sort(([, a], [, b]) => b - a).map(([pos]) => pos)
  }
  const counts: Record<string, number> = {}
  for (const slot of currentRoster) {
    const pos = slot.position.toUpperCase()
    counts[pos] = (counts[pos] ?? 0) + 1
  }
  const needs: Array<{ pos: string; deficit: number }> = []
  for (const [pos, required] of Object.entries(STANDARD_STARTS)) {
    const deficit = required - (counts[pos] ?? 0)
    if (deficit > 0) needs.push({ pos, deficit })
  }
  return needs.sort((a, b) => b.deficit - a.deficit).map((n) => n.pos)
}

function computeByeWeekConflicts(
  currentRoster: Array<{ position: string; team?: string | null }> | undefined,
  byeWeekMap: Record<string, number>
): string[] {
  if (!currentRoster || currentRoster.length === 0 || Object.keys(byeWeekMap).length === 0) return []
  const byeConflicts = new Map<number, string[]>()
  for (const slot of currentRoster) {
    const team = (slot.team ?? "").trim().toUpperCase()
    const bye = byeWeekMap[team]
    if (!bye) continue
    const positions = byeConflicts.get(bye) ?? []
    positions.push(slot.position.toUpperCase())
    byeConflicts.set(bye, positions)
  }
  const conflicts: string[] = []
  for (const [, positions] of byeConflicts.entries()) {
    if (positions.length >= 2) for (const pos of positions) if (!conflicts.includes(pos)) conflicts.push(pos)
  }
  return conflicts
}

/**
 * The bye week algorithm: given a list of {homeTeam, awayTeam, week} game rows,
 * return a map of team → bye week (week where that team has no game).
 */
function computeByeWeekMapFromGames(
  games: Array<{ homeTeam: string; awayTeam: string; week: number }>
): Record<string, number> {
  const byeMap: Record<string, number> = {}
  const teamWeeks = new Map<string, Set<number>>()
  for (const game of games) {
    for (const rawTeam of [game.homeTeam, game.awayTeam]) {
      const team = rawTeam.trim().toUpperCase()
      if (!team) continue
      const weeks = teamWeeks.get(team) ?? new Set<number>()
      weeks.add(game.week)
      teamWeeks.set(team, weeks)
    }
  }
  const allWeeks = Array.from(new Set(games.map((g) => g.week))).sort((a, b) => a - b)
  for (const [team, playedWeeks] of teamWeeks.entries()) {
    for (const week of allWeeks) {
      if (!playedWeeks.has(week)) {
        byeMap[team] = week
        break
      }
    }
  }
  return byeMap
}

// ─── Pure function tests ──────────────────────────────────────────────────────

describe("normalizeLeagueFormat", () => {
  it("1. dynasty variant → dynasty", () => {
    expect(normalizeLeagueFormat("Dynasty")).toBe("dynasty")
    expect(normalizeLeagueFormat("2qb-dynasty")).toBe("dynasty")
  })

  it("2. null / empty → redraft", () => {
    expect(normalizeLeagueFormat(null)).toBe("redraft")
    expect(normalizeLeagueFormat("")).toBe("redraft")
    expect(normalizeLeagueFormat(undefined)).toBe("redraft")
  })

  it("3. keeper → keeper", () => {
    expect(normalizeLeagueFormat("Keeper")).toBe("keeper")
    expect(normalizeLeagueFormat("KEEPER")).toBe("keeper")
  })

  it("4. best ball (with space) → best_ball", () => {
    expect(normalizeLeagueFormat("best ball")).toBe("best_ball")
    expect(normalizeLeagueFormat("Best-Ball")).toBe("best_ball")
  })
})

describe("normalizeScoring", () => {
  it("5. null → ppr", () => {
    expect(normalizeScoring(null)).toBe("ppr")
    expect(normalizeScoring(undefined)).toBe("ppr")
  })

  it("6. PPR (uppercased) → ppr", () => {
    expect(normalizeScoring("PPR")).toBe("ppr")
    expect(normalizeScoring("Standard")).toBe("standard")
  })
})

describe("computePositionalScarcity", () => {
  const makePool = (pos: string, count: number, confidence = 0.9) =>
    Array.from({ length: count }, () => ({ position: pos, snapshot: { confidence } }))

  it("7. RB pool < high threshold (10) → high scarcity", () => {
    const candidates = makePool("RB", 5)
    const result = computePositionalScarcity(candidates, 12)
    expect(result.RB.scarcityRating).toBe("high")
  })

  it("8. WR large pool (30 candidates) → low scarcity", () => {
    const candidates = makePool("WR", 30)
    const result = computePositionalScarcity(candidates, 12)
    expect(result.WR.scarcityRating).toBe("low")
  })

  it("9. QB mid-range pool (6 candidates, high=4, medium=8) → medium", () => {
    const candidates = makePool("QB", 6)
    const result = computePositionalScarcity(candidates, 12)
    expect(result.QB.scarcityRating).toBe("medium")
  })

  it("10. tier1Available counts only confidence ≥ 0.65", () => {
    const candidates = [
      { position: "TE", snapshot: { confidence: 0.8 } },   // tier1
      { position: "TE", snapshot: { confidence: 0.3 } },   // not tier1
      { position: "TE", snapshot: { confidence: 0.65 } },  // exactly tier1 (boundary)
    ]
    const result = computePositionalScarcity(candidates, 12)
    expect(result.TE.totalAvailable).toBe(3)
    expect(result.TE.tier1Available).toBe(2)
  })
})

describe("computeRosterNeeds", () => {
  it("11. empty roster → all standard positions returned, ordered by required slots", () => {
    const needs = computeRosterNeeds(undefined)
    expect(needs.length).toBeGreaterThan(0)
    // RB and WR both need 2 starters, so they should appear before QB/TE/K/DEF
    const rbIdx = needs.indexOf("RB")
    const wrIdx = needs.indexOf("WR")
    const qbIdx = needs.indexOf("QB")
    expect(rbIdx).not.toBe(-1)
    expect(wrIdx).not.toBe(-1)
    expect(qbIdx).not.toBe(-1)
    // RB/WR (deficit=2) should sort before QB/TE/K/DEF (deficit=1)
    expect(rbIdx).toBeLessThan(qbIdx)
  })

  it("12. QB already filled → QB absent from needs", () => {
    const roster = [{ position: "QB" }]
    const needs = computeRosterNeeds(roster)
    expect(needs).not.toContain("QB")
  })

  it("13. 2 WR needed, 0 rostered → WR in needs with highest urgency", () => {
    const roster = [{ position: "QB" }, { position: "RB" }, { position: "RB" }, { position: "TE" }]
    const needs = computeRosterNeeds(roster)
    expect(needs[0]).toBe("WR")
  })
})

describe("computeByeWeekConflicts", () => {
  const byeMap = { KC: 11, DAL: 11, NYG: 7 }

  it("14. two starters on same bye → both positions flagged", () => {
    const roster = [
      { position: "QB", team: "KC" },  // bye week 11
      { position: "RB", team: "DAL" }, // bye week 11 — conflict!
    ]
    const conflicts = computeByeWeekConflicts(roster, byeMap)
    expect(conflicts).toContain("QB")
    expect(conflicts).toContain("RB")
  })

  it("15. empty roster → no conflicts", () => {
    expect(computeByeWeekConflicts(undefined, byeMap)).toEqual([])
  })

  it("16. no bye map → no conflicts", () => {
    const roster = [{ position: "QB", team: "KC" }]
    expect(computeByeWeekConflicts(roster, {})).toEqual([])
  })

  it("single player on a bye week — no conflict (need 2+ for a conflict)", () => {
    const roster = [{ position: "QB", team: "KC" }, { position: "RB", team: "NYG" }]
    const conflicts = computeByeWeekConflicts(roster, byeMap)
    expect(conflicts).not.toContain("QB")   // KC is alone on week 11 here
    expect(conflicts).not.toContain("RB")   // NYG alone on week 7
  })
})

describe("bye week computation algorithm", () => {
  it("17. team with no game in week 3 → bye = 3", () => {
    const games = [
      { homeTeam: "KC", awayTeam: "DAL", week: 1 },
      { homeTeam: "KC", awayTeam: "NYG", week: 2 },
      // KC has no week-3 game ← bye
      { homeTeam: "KC", awayTeam: "BUF", week: 4 },
      // DAL plays all four weeks — no bye
      { homeTeam: "DAL", awayTeam: "SF", week: 2 },
      { homeTeam: "DAL", awayTeam: "PHI", week: 3 },
      { homeTeam: "DAL", awayTeam: "NYG", week: 4 },
    ]
    const map = computeByeWeekMapFromGames(games)
    expect(map["KC"]).toBe(3)
    expect(map["DAL"]).toBeUndefined() // DAL plays weeks 1–4, no gap detected
  })

  it("team playing all weeks has no bye detected", () => {
    const games = [
      { homeTeam: "GB", awayTeam: "CHI", week: 1 },
      { homeTeam: "GB", awayTeam: "DET", week: 2 },
      { homeTeam: "GB", awayTeam: "MIN", week: 3 },
    ]
    const map = computeByeWeekMapFromGames(games)
    expect(map["GB"]).toBeUndefined()
  })
})

// ─── getDraftAdvisorContext integration (with mocked prisma + snapshotLoader) ─

describe("getDraftAdvisorContext integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.sportsGame.findMany.mockResolvedValue([])
  })

  it("18. empty candidates → confidence=0, empty enrichedCandidates", async () => {
    const { getDraftAdvisorContext } = await import(
      "@/lib/sports-reporting/DraftAdvisorContextService"
    )
    const ctx = await getDraftAdvisorContext(
      { sport: "NFL", candidates: [] },
      vi.fn().mockResolvedValue(makeSnapshot())
    )
    expect(ctx.enrichedCandidates).toHaveLength(0)
    expect(ctx.confidence).toBe(0)
    expect(ctx.missingData).toContain("bye_week_schedule")
  })

  it("19. snapshots enrich candidates — playerName and position carried through", async () => {
    const { getDraftAdvisorContext } = await import(
      "@/lib/sports-reporting/DraftAdvisorContextService"
    )
    const loader = vi
      .fn()
      .mockResolvedValueOnce(makeSnapshot({ playerName: "Patrick Mahomes", position: "QB", confidence: 1 }))
      .mockResolvedValueOnce(makeSnapshot({ playerName: "Justin Jefferson", position: "WR", confidence: 0.8 }))

    const ctx = await getDraftAdvisorContext(
      {
        sport: "NFL",
        candidates: [
          { playerName: "Patrick Mahomes", position: "QB", adp: 2.3 },
          { playerName: "Justin Jefferson", position: "WR", adp: 5.1 },
        ],
      },
      loader
    )

    expect(ctx.enrichedCandidates).toHaveLength(2)
    expect(ctx.enrichedCandidates[0].playerName).toBe("Patrick Mahomes")
    expect(ctx.enrichedCandidates[0].adp).toBe(2.3)
    expect(ctx.enrichedCandidates[1].position).toBe("WR")
    // positional scarcity computed
    expect(ctx.positionalScarcity["QB"]).toBeDefined()
    expect(ctx.positionalScarcity["WR"]).toBeDefined()
  })

  it("20. no schedule data → missingData includes bye_week_schedule", async () => {
    prismaMock.sportsGame.findMany.mockResolvedValue([])
    const { getDraftAdvisorContext } = await import(
      "@/lib/sports-reporting/DraftAdvisorContextService"
    )
    const ctx = await getDraftAdvisorContext(
      { sport: "NFL", candidates: [{ playerName: "CeeDee Lamb" }] },
      vi.fn().mockResolvedValue(makeSnapshot({ playerName: "CeeDee Lamb" }))
    )
    expect(ctx.missingData).toContain("bye_week_schedule")
  })

  it("21. rosterNeeds computed from provided currentRoster", async () => {
    const { getDraftAdvisorContext } = await import(
      "@/lib/sports-reporting/DraftAdvisorContextService"
    )
    // Roster already has QB + 2 RBs + TE + K + DEF — needs WR most urgently
    const ctx = await getDraftAdvisorContext(
      {
        sport: "NFL",
        candidates: [],
        currentRoster: [
          { position: "QB" }, { position: "RB" }, { position: "RB" },
          { position: "TE" }, { position: "K" }, { position: "DEF" },
        ],
      },
      vi.fn()
    )
    expect(ctx.rosterNeeds[0]).toBe("WR")
    expect(ctx.rosterNeeds).not.toContain("QB")
    expect(ctx.rosterNeeds).not.toContain("RB")
  })

  it("22. sport normalised to upper-case, generatedAt is ISO string", async () => {
    const { getDraftAdvisorContext } = await import(
      "@/lib/sports-reporting/DraftAdvisorContextService"
    )
    const ctx = await getDraftAdvisorContext(
      { sport: "nfl", candidates: [] },
      vi.fn()
    )
    expect(ctx.sport).toBe("NFL")
    expect(() => new Date(ctx.generatedAt)).not.toThrow()
    expect(new Date(ctx.generatedAt).toISOString()).toBe(ctx.generatedAt)
  })

  it("23. snapshot loader that throws → candidate confidence=0 + missingData populated", async () => {
    const { getDraftAdvisorContext } = await import(
      "@/lib/sports-reporting/DraftAdvisorContextService"
    )
    const loader = vi.fn().mockRejectedValue(new Error("DB timeout"))
    const ctx = await getDraftAdvisorContext(
      { sport: "NFL", candidates: [{ playerName: "Josh Allen" }] },
      loader
    )
    expect(ctx.enrichedCandidates).toHaveLength(1)
    expect(ctx.enrichedCandidates[0].snapshot.confidence).toBe(0)
    expect(ctx.missingData).toContain("snapshot_load_error")
    expect(ctx.confidence).toBe(0)
  })

  it("24. confidence is mean of all candidate snapshot confidences", async () => {
    const { getDraftAdvisorContext } = await import(
      "@/lib/sports-reporting/DraftAdvisorContextService"
    )
    const loader = vi
      .fn()
      .mockResolvedValueOnce(makeSnapshot({ confidence: 1.0 }))
      .mockResolvedValueOnce(makeSnapshot({ confidence: 0.5 }))
      .mockResolvedValueOnce(makeSnapshot({ confidence: 0.75 }))

    const ctx = await getDraftAdvisorContext(
      {
        sport: "NFL",
        candidates: [
          { playerName: "Player A" },
          { playerName: "Player B" },
          { playerName: "Player C" },
        ],
      },
      loader
    )
    // (1.0 + 0.5 + 0.75) / 3 = 0.75
    expect(ctx.confidence).toBeCloseTo(0.75, 2)
  })
})
