/**
 * BlogContentGenerator — AI-assisted draft generation for blog articles.
 * Uses BlogGenerationService (multi-provider) when available; fallback to OpenAI-only.
 */

import { openaiChatJson, parseJsonContentFromChatCompletion } from "@/lib/openai-client"
import { normalizeToSupportedSport } from "@/lib/sport-scope"
import type { BlogDraftInput, GeneratedDraft } from "./types"
import { CONTENT_TYPE_PROMPTS } from "./types"
import { generateBlogDraftMultiProvider } from "./BlogGenerationService"

const SLUG_MAX = 120

function toSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, SLUG_MAX)
}

function ensureSlug(raw: string | undefined): string {
  if (typeof raw === "string" && /^[a-z0-9-]+$/.test(raw)) return raw.slice(0, SLUG_MAX)
  return toSlug(String(raw ?? "article"))
}

const CATEGORY_FALLBACK_TITLES: Record<string, string> = {
  waiver_wire: "Waiver Wire Targets",
  trade_value: "Trade Value Watch",
  ranking_updates: "Rankings Update",
  matchup_preview: "Matchup Preview",
  playoff_recap: "Weekly Recap",
  creator_recap: "Creator League Recap",
  player_trend_feature: "Player Trend Feature",
  weekly_strategy: "Weekly Strategy Guide",
}

function generateDeterministicFallbackDraft(input: BlogDraftInput): GeneratedDraft {
  const sport = normalizeToSupportedSport(input.sport)
  const topic = (input.topicHint ?? "").trim()
  const titleBase = CATEGORY_FALLBACK_TITLES[input.category] ?? "Fantasy Insights"
  const title = topic ? `${titleBase}: ${topic}` : `${sport} ${titleBase}`
  const excerpt = `Quick ${sport} ${input.category.replace(/_/g, " ")} draft generated while Chimmy providers are unavailable.`
  const body = [
    `# ${title}`,
    "",
    `This draft is generated with deterministic fallback content because Chimmy providers are currently unavailable.`,
    "",
    "## Key takeaways",
    "- Focus on recent usage trends and role stability.",
    "- Validate matchup context before making lineup decisions.",
    "- Prioritize flexible roster moves and short-term upside.",
    "",
    "## Action plan",
    "1. Review your roster needs by position and schedule.",
    "2. Compare waiver, trade, and matchup options using AllFantasy tools.",
    "3. Re-run Chimmy generation later for expanded analysis and narrative polish.",
  ].join("\n")

  return {
    title: title.slice(0, 512),
    slug: ensureSlug(title),
    excerpt: excerpt.slice(0, 240),
    body,
    seoTitle: `${title.slice(0, 50)} | AllFantasy`,
    seoDescription: excerpt.slice(0, 160),
    tags: [sport, input.category, "AllFantasy", "FantasySports"].slice(0, 6),
  }
}

/** OpenAI-only path (fallback when multi-provider fails or is unavailable). */
async function generateBlogDraftOpenAIOnly(input: BlogDraftInput): Promise<GeneratedDraft | null> {
  const sport = normalizeToSupportedSport(input.sport)
  const config = CONTENT_TYPE_PROMPTS[input.category]
  if (!config) return null

  const userParts = [
    config.userPrefix,
    `Sport: ${sport}.`,
    input.topicHint ? `Topic focus: ${input.topicHint}` : "",
  ].filter(Boolean)
  const userMessage = userParts.join(" ")

  const res = await openaiChatJson({
    messages: [
      { role: "system", content: config.system },
      { role: "user", content: userMessage },
    ],
    temperature: 0.7,
    maxTokens: 2500,
  })

  if (!res.ok) return null
  const json = parseJsonContentFromChatCompletion(res.json)
  if (!json || typeof json !== "object") return null

  const title = typeof json.title === "string" ? json.title.trim() : "Untitled"
  const body = typeof json.body === "string" ? json.body.trim() : ""
  const excerpt = typeof json.excerpt === "string" ? json.excerpt.trim() : body.slice(0, 200)
  const slug = ensureSlug(json.slug ?? title)
  const seoTitle = typeof json.seoTitle === "string" ? json.seoTitle.trim().slice(0, 60) : title.slice(0, 60)
  const seoDescription = typeof json.seoDescription === "string" ? json.seoDescription.trim().slice(0, 160) : excerpt.slice(0, 160)
  const tags = Array.isArray(json.tags) ? json.tags.filter((t: unknown): t is string => typeof t === "string").slice(0, 10) : []

  return {
    title: title.slice(0, 512),
    slug,
    excerpt,
    body,
    seoTitle,
    seoDescription,
    tags,
  }
}

export async function generateBlogDraft(input: BlogDraftInput): Promise<GeneratedDraft | null> {
  const multi = await generateBlogDraftMultiProvider(input)
  if (multi) return multi
  const openaiOnly = await generateBlogDraftOpenAIOnly(input)
  if (openaiOnly) return openaiOnly
  return generateDeterministicFallbackDraft(input)
}
