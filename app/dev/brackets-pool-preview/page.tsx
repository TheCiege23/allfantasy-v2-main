/**
 * Dev-only preview of the bracket pool dashboard (/brackets/leagues/[id]).
 *
 * ⚠ WHY THIS EXISTS RATHER THAN OPENING A REAL POOL: the real route loads the
 * pool from Postgres, and the checkouts on this machine point `DATABASE_URL`
 * at production (see CLAUDE.md). A visual and language/mode pass does not
 * need real rows, so it runs here against obviously synthetic data. Same guard
 * and purpose as /dev/admin-29a-preview: 404s outside development, nothing
 * links to it.
 *
 * ⚠ EVERY NAME AND NUMBER BELOW IS INVENTED AND THIS FILE IS UNREACHABLE IN
 * PRODUCTION.
 */
import { notFound } from "next/navigation"
import PlayoffBracketShell from "@/components/brackets/playoffs/PlayoffBracketShell"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"

export const dynamic = "force-dynamic"

const VIEW = {
  viewerUserId: "preview-owner",
  challenge: {
    id: "preview-pool", name: "Preview Cup Pool", sport: "nba_cup", seasonYear: 2026, status: "open", isTestMode: false,
    ownerUserId: "preview-owner", inviteCode: "PREVIEW1", inviteUrl: "/brackets/leagues/preview-pool", visibility: "public",
    maxParticipants: 50, maxEntriesPerParticipant: 5, scoringStyle: "round_points", lockRule: "series_start",
    createdAt: "", updatedAt: "",
  },
  activeEntry: null,
  viewerTournamentBracketLimit: 5,
  viewerTournamentBracketUsed: 1,
  participants: [
    { userId: "preview-owner", displayName: "Preview Owner", entryCount: 1 },
    { userId: "preview-2", displayName: "Preview Rival", entryCount: 1 },
  ],
  entries: [
    { id: "e1", userId: "preview-owner", name: "Preview Bracket 1", pickCount: 18, isComplete: true, finalizedAt: "2026-11-01T00:00:00Z", rank: 2, totalScore: 9, potentialTotal: 61, correctPicks: 9, resolvedPicks: 14, createdAt: "" },
    { id: "e2", userId: "preview-2", name: "Preview Rival Bracket", pickCount: 20, isComplete: true, finalizedAt: "2026-11-01T00:00:00Z", rank: 1, totalScore: 11, potentialTotal: 63, correctPicks: 11, resolvedPicks: 14, createdAt: "" },
  ],
  series: Array.from({ length: 67 }, (_, i) => ({
    id: `s${i}`, round: "cup_group_play", roundIndex: 0, seriesNumber: 100 + i, conference: "east", homeSeed: 0, awaySeed: 0,
    homeTeamName: "Atlanta Hawks", awayTeamName: "Boston Celtics", winnerTeamName: null, bestOf: 1, status: "scheduled",
    startsAt: i < 60 ? "2026-11-20T00:00:00Z" : null, nextSeriesNumber: null, nextSeriesSlot: null, sourceSeriesHome: null, sourceSeriesAway: null,
  })),
  picks: [],
  rounds: ["cup_group_play", "cup_quarterfinals", "cup_semifinals", "cup_championship"],
} as unknown as PlayoffChallengeView

export default function BracketsPoolPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <PlayoffBracketShell initialView={VIEW} />
}
