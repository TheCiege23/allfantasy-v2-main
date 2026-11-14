/**
 * Find a League in plain words (2026-11-14).
 *
 * The owner's ask, for every page: users should know what the page is for and what to do. A league
 * card said its sport twice ("NBA" chip, "NBA · 2026"), its type twice ("Redraft" chip, "League type:
 * redraft"), its draft twice ("Draft status: pre draft", "Draft not scheduled"), printed "AI features:
 * None", and a "Rank fit +48" nobody could read. These rules turn a card into one line per fact.
 *
 * Pure, so the rules are testable and the card stays a renderer.
 */
import type { DiscoveryCard } from "./types"

/** The page size the grid asks /api/discover/leagues for. */
export const FIND_LEAGUE_PAGE_SIZE = 12

/** The one draft line a card shows. A status that has moved on wins over a scheduled time. */
export type CardDraft =
  | { kind: "done" }
  | { kind: "live" }
  | { kind: "paused" }
  | { kind: "scheduled"; iso: string }
  | { kind: "unscheduled" }

export function cardDraft(league: Pick<DiscoveryCard, "draftStatus" | "draftDate">): CardDraft {
  const status = String(league.draftStatus ?? "").trim()
  if (status === "completed") return { kind: "done" }
  if (status === "in_progress") return { kind: "live" }
  if (status === "paused") return { kind: "paused" }
  const iso = league.draftDate
  if (iso && Number.isFinite(Date.parse(iso))) return { kind: "scheduled", iso }
  return { kind: "unscheduled" }
}

/** "1 seat left of 4", "All 12 seats taken", or just how many managers when the size is unknown. */
export type CardSeats =
  | { kind: "open"; left: number; teams: number }
  | { kind: "full"; teams: number }
  | { kind: "count"; members: number }

export function cardSeats(league: Pick<DiscoveryCard, "memberCount" | "maxMembers" | "teamCount">): CardSeats {
  const teams = league.teamCount > 0 ? league.teamCount : league.maxMembers
  if (!(teams > 0)) return { kind: "count", members: Math.max(0, league.memberCount) }
  const left = teams - league.memberCount
  return left > 0 ? { kind: "open", left, teams } : { kind: "full", teams }
}

/**
 * The "Filling fast" / "At your level" rows repeat leagues the grid already shows. They earn their
 * place only when the grid cannot show everything on one page; with two leagues found, the same
 * league appeared twice on the screen.
 */
export function showPickedRows(total: number, loading: boolean, pageSize = FIND_LEAGUE_PAGE_SIZE): boolean {
  return !loading && total > pageSize
}

/** The filters inside "More filters" — everything but Sport and Sort, which sit beside the search. */
export interface MoreFilterState {
  leagueType: string
  draftType: string
  draftStatus: string
  entryFee: string
  aiEnabled: boolean
  teamCountMin: string
  teamCountMax: string
  draftWhen: string
  tzRegion: string
  vibe: string
  visibility: string
}

export function moreFilterCount(s: MoreFilterState): number {
  return [
    s.leagueType !== "all",
    s.draftType !== "all",
    s.draftStatus !== "all",
    s.entryFee !== "all",
    s.aiEnabled,
    s.teamCountMin.trim() !== "" || s.teamCountMax.trim() !== "",
    s.draftWhen !== "any",
    s.tzRegion !== "any",
    s.vibe !== "all",
    s.visibility !== "public",
  ].filter(Boolean).length
}
