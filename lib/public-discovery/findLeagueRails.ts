/**
 * The "picked for you" rows at the top of Find a League.
 *
 * Built from the same discovery cards the search grid shows, so a row can never recommend a
 * league the grid would hide (tier policy, privacy, a full league). The page used to ask
 * `/api/find-league/recommendations`, which never existed: every visit spent a request on a 404
 * and the section stayed blank.
 *
 * Each league appears in at most one row, the first it qualifies for, so four rows never show
 * the same three leagues four times. Only leagues with an open seat qualify.
 */

import type { DiscoveryCard } from "./types"

export type FindLeagueRailKind = "your_level" | "step_up" | "drafting_soon" | "filling_fast"

export interface FindLeagueRail {
  kind: FindLeagueRailKind
  title: string
  description: string
  leagues: DiscoveryCard[]
}

const RAIL_META: Record<FindLeagueRailKind, { title: string; description: string }> = {
  your_level: {
    title: "At your level",
    description: "Open seats in leagues rated close to your Class.",
  },
  step_up: {
    title: "Step up",
    description: "Stronger leagues with a seat for you, if you want the test.",
  },
  drafting_soon: {
    title: "Drafting this week",
    description: "Join now and you are in the draft room within seven days.",
  },
  filling_fast: {
    title: "Filling fast",
    description: "More than half full. These seats go first.",
  },
}

const RAIL_ORDER: FindLeagueRailKind[] = ["your_level", "step_up", "drafting_soon", "filling_fast"]

export const FIND_LEAGUE_RAIL_CAP = 6

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function hasOpenSeat(card: DiscoveryCard): boolean {
  return card.maxMembers > 0 && card.memberCount < card.maxMembers
}

function draftsWithinAWeek(card: DiscoveryCard, now: number): boolean {
  if (!card.draftDate) return false
  const t = Date.parse(card.draftDate)
  return Number.isFinite(t) && t > now && t - now <= WEEK_MS
}

function qualifies(kind: FindLeagueRailKind, card: DiscoveryCard, now: number): boolean {
  switch (kind) {
    case "your_level":
      return card.rankBand === "your_level"
    case "step_up":
      return card.rankBand === "step_up"
    case "drafting_soon":
      return draftsWithinAWeek(card, now)
    case "filling_fast":
      return card.fillPct >= 50
  }
}

/** Cards arrive in the order they should be shown (rank fit first); that order is kept. */
export function buildFindLeagueRails(cards: DiscoveryCard[], now: number = Date.now()): FindLeagueRail[] {
  const used = new Set<string>()
  const rails: FindLeagueRail[] = []
  for (const kind of RAIL_ORDER) {
    const leagues: DiscoveryCard[] = []
    for (const card of cards) {
      if (leagues.length >= FIND_LEAGUE_RAIL_CAP) break
      const key = `${card.source}:${card.id}`
      if (used.has(key) || !hasOpenSeat(card) || !qualifies(kind, card, now)) continue
      used.add(key)
      leagues.push(card)
    }
    if (leagues.length > 0) rails.push({ kind, ...RAIL_META[kind], leagues })
  }
  return rails
}
