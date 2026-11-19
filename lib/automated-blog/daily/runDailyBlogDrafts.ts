/**
 * Daily blog drafts — once a day, write up to two "fantasy standouts" DRAFTS from last night's
 * verified box scores. Nothing is published: each draft lands in the blog admin as `draft` and a
 * person decides whether it goes live.
 *
 * Rides `/api/cron/morning-briefing` (12:00 UTC, after the 07:00 UTC stat-lines import) because the
 * cron registry is at its ceiling — the same reason the reminders ride it.
 *
 * Guarantees, each tested:
 *   - DRAFTS ONLY. This module never sets a publish status.
 *   - CAPPED. At most `MAX_DRAFTS_PER_DAY` drafts in any 20-hour window, counted from the database,
 *     so a second fire the same day (a retry, a manual run) cannot add more.
 *   - IDEMPOTENT. One slug per sport per date; an existing slug is skipped, never suffixed.
 *   - GROUNDED. A sport with too few verified games is skipped ("thin"), and a draft that fails the
 *     fact check is discarded.
 *   - OFF SWITCH. `BLOG_DAILY_DRAFTS=off` in the environment stops it; `?blogDrafts=off` skips one fire,
 *     `?blogDrafts=dry` reports what it would write without calling the model or writing a row.
 */

import { prisma } from "@/lib/prisma"
import { createDraft } from "../BlogDraftWorkflowService"
import {
  GAME_NIGHT_SPORTS,
  easternDate,
  loadGameNightFacts,
  loadRecentPlayerNames,
  type GameNightFacts,
  type GameNightSport,
} from "./gameNightFacts"
import {
  DAILY_DRAFT_CATEGORY,
  DAILY_DRAFT_SLUG_MARK,
  dailyDraftSlug,
  writeGameNightDraft,
  type DraftOutcome,
} from "./gameNightDraft"
import type { GeneratedDraft } from "../types"

export const MAX_DRAFTS_PER_DAY = 2
/** Below this many verified games the night is not worth a post. */
export const MIN_VERIFIED_GAMES = 3
const MIN_PERFORMERS = 5
const CAP_WINDOW_MS = 20 * 60 * 60 * 1000

export type DailyDraftMode = "run" | "dry" | "off"

export interface DailyDraftReport {
  ran: boolean
  reason?: "off" | "disabled"
  date?: string
  created: Array<{ sport: GameNightSport; slug: string; articleId: string }>
  wouldCreate: Array<{ sport: GameNightSport; slug: string; games: number }>
  skipped: Array<{ sport: GameNightSport; reason: string; detail?: string }>
}

export interface DailyDraftDeps {
  loadFacts: (sport: GameNightSport, date: string) => Promise<GameNightFacts>
  loadNames: (sport: GameNightSport, date: string) => Promise<string[]>
  write: (facts: GameNightFacts, names: string[]) => Promise<DraftOutcome>
  saveDraft: (sport: GameNightSport, draft: GeneratedDraft) => Promise<{ articleId: string; slug: string } | null>
  slugExists: (slug: string) => Promise<boolean>
  countRecent: (since: Date) => Promise<number>
}

export const defaultDailyDraftDeps: DailyDraftDeps = {
  loadFacts: loadGameNightFacts,
  loadNames: loadRecentPlayerNames,
  write: (facts, names) => writeGameNightDraft({ facts, nameUniverse: names }),
  saveDraft: (sport, draft) => createDraft({ sport, category: DAILY_DRAFT_CATEGORY, draft }),
  slugExists: async (slug) => Boolean(await prisma.blogArticle.findUnique({ where: { slug }, select: { articleId: true } })),
  countRecent: (since) =>
    prisma.blogArticle.count({ where: { slug: { contains: DAILY_DRAFT_SLUG_MARK }, createdAt: { gte: since } } }),
}

export function parseDailyDraftMode(raw: string | null | undefined): DailyDraftMode {
  const m = (raw ?? "").trim().toLowerCase()
  return m === "off" || m === "dry" ? m : "run"
}

export async function runDailyBlogDrafts(opts: {
  now?: Date
  mode?: DailyDraftMode
  deps?: DailyDraftDeps
}): Promise<DailyDraftReport> {
  const report: DailyDraftReport = { ran: false, created: [], wouldCreate: [], skipped: [] }
  const mode = opts.mode ?? "run"
  if (mode === "off") return { ...report, reason: "off" }
  if ((process.env.BLOG_DAILY_DRAFTS ?? "").trim().toLowerCase() === "off") return { ...report, reason: "disabled" }

  const deps = opts.deps ?? defaultDailyDraftDeps
  const now = opts.now ?? new Date()
  const date = easternDate(now, 1)
  report.ran = true
  report.date = date

  // Gather every sport's night first, then spend the cap on the biggest slates.
  const candidates: GameNightFacts[] = []
  for (const sport of GAME_NIGHT_SPORTS) {
    const slug = dailyDraftSlug(sport, date)
    if (await deps.slugExists(slug)) {
      report.skipped.push({ sport, reason: "exists" })
      continue
    }
    const facts = await deps.loadFacts(sport, date)
    if (facts.games.length < MIN_VERIFIED_GAMES || facts.performers.length < MIN_PERFORMERS) {
      report.skipped.push({
        sport,
        reason: "thin",
        detail: `${facts.games.length} verified game(s), ${facts.droppedGames} dropped`,
      })
      continue
    }
    candidates.push(facts)
  }
  candidates.sort((a, b) => b.games.length - a.games.length)

  let remaining = MAX_DRAFTS_PER_DAY - (await deps.countRecent(new Date(now.getTime() - CAP_WINDOW_MS)))
  for (const facts of candidates) {
    const slug = dailyDraftSlug(facts.sport, date)
    if (remaining <= 0) {
      report.skipped.push({ sport: facts.sport, reason: "cap" })
      continue
    }
    if (mode === "dry") {
      report.wouldCreate.push({ sport: facts.sport, slug, games: facts.games.length })
      remaining -= 1
      continue
    }

    const names = await deps.loadNames(facts.sport, date)
    const outcome = await deps.write(facts, names)
    if (!outcome.ok) {
      const detail = outcome.check
        ? [
            outcome.check.unknownNumbers.length ? `numbers: ${outcome.check.unknownNumbers.slice(0, 8).join(", ")}` : "",
            outcome.check.unknownNames.length ? `names: ${outcome.check.unknownNames.slice(0, 5).join(", ")}` : "",
          ]
            .filter(Boolean)
            .join("; ")
        : outcome.detail
      report.skipped.push({ sport: facts.sport, reason: outcome.reason, ...(detail ? { detail } : {}) })
      continue
    }
    const saved = await deps.saveDraft(facts.sport, outcome.draft)
    if (!saved) {
      report.skipped.push({ sport: facts.sport, reason: "save_failed" })
      continue
    }
    report.created.push({ sport: facts.sport, slug: saved.slug, articleId: saved.articleId })
    remaining -= 1
  }
  return report
}
