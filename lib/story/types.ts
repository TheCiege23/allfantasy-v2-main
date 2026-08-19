/**
 * G15.12 — Story Engine types.
 *
 * The Story Engine turns the G15 Commissioner Intelligence READ MODELS into privacy-safe
 * narrative drafts. It consumes ONLY the IntelligenceQueryService (activity summary, health
 * snapshot, commissioner action items, audit feed) — never raw event payloads, raw provider
 * data, chat content, or private user ids. Sport/concept-agnostic.
 *
 * Backend foundation only: no UI, no auto-post, no write actions, no LLM call.
 */

/** The initial first-class story types (G15.12). */
export const STORY_TYPES = {
  WEEKLY_RECAP: 'weekly_recap',
  COMMISSIONER_SUMMARY: 'commissioner_summary',
  ACTIVITY_REPORT: 'activity_report',
  WHAT_HAPPENED_RECENTLY: 'what_happened_recently',
  HEALTH_NARRATIVE: 'health_narrative',
} as const
export type StoryType = (typeof STORY_TYPES)[keyof typeof STORY_TYPES]
export const ALL_STORY_TYPES: StoryType[] = Object.values(STORY_TYPES)

/** Why a context/draft is degraded — mirrors the grounding adapter's never-throw contract. */
export type StoryContextStatus = 'ok' | 'empty' | 'restricted'

/** Privacy-safe action item (no `meta` — that can hold league-internal user ids). */
export interface StorySafeActionItem {
  kind: string
  severity: string
  message: string
}

/** Privacy-safe timeline entry (audit feed already strips payloads/PII). */
export interface StoryTimelineEntry {
  type: string
  summary: string
  occurredAt: string
}

/**
 * The single privacy-safe context every story generator consumes. Contains only counts, scores,
 * labels, and pre-summarized timeline strings — NO user ids/names, payloads, or provider tokens.
 */
export interface StoryContext {
  status: StoryContextStatus
  leagueId: string
  sport: string | null
  leagueConcept: string | null
  generatedAt: string
  activity: {
    totalEvents: number
    firstEventAt: string | null
    lastActivityAt: string | null
    openTradeProposals: number
    counts: Record<string, number>
  }
  health: {
    score: number
    status: string
    activeManagers: number
    totalManagers: number
    daysSinceLastActivity: number | null
  }
  actionItems: StorySafeActionItem[]
  recent: StoryTimelineEntry[]
}

/** A single rendered section of a deterministic story draft. */
export interface StorySection {
  heading: string
  body: string
}

/** A deterministic, privacy-safe narrative draft. No LLM involved. */
export interface StoryDraft {
  type: StoryType
  status: StoryContextStatus
  title: string
  /** One-line lede. */
  headline: string
  sections: StorySection[]
  /** Flat bullet list (handy for chat/preview surfaces later). */
  bullets: string[]
  /** Plain-text rendering of the whole draft. */
  text: string
  /** True when there is not enough recorded activity to tell a story. */
  empty: boolean
  /** When this draft was produced (context build time). */
  generatedAt: string
  /** Source freshness: last recorded league activity, or null. */
  sourceFreshness: string | null
}

/** LLM-ready, privacy-safe prompt pair. Provided for later; G15.12 does NOT call an LLM. */
export interface StoryPrompt {
  type: StoryType
  system: string
  user: string
}
