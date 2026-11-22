/**
 * Turn one night's verified facts into a blog draft, or into nothing.
 *
 * The model writes the prose only. Everything a reader could cite or a search engine indexes as a
 * claim about the post — title, slug, SEO title, tags, the closing links — is set here in code, and
 * the prose is accepted only if `checkDraftAgainstFacts` finds no number or player outside the facts.
 * There is no fallback text: a failed or unchecked generation produces no draft.
 */

import { routeTextCall } from "@/lib/ai/providerRouter"
import type { GeneratedDraft } from "../types"
import { checkDraftAgainstFacts, type FactCheckResult } from "./factCheck"
import type { GameNightFacts, GameNightSport, Performer } from "./gameNightFacts"

export const DAILY_DRAFT_CATEGORY = "player_trend_feature"
/** Every daily draft's slug carries this, which is how the job counts and dedupes its own work. */
export const DAILY_DRAFT_SLUG_MARK = "-fantasy-standouts-"

const SPORT_COPY: Record<GameNightSport, { noun: string; landing: string; landingLabel: string }> = {
  NBA: { noun: "Basketball", landing: "/sports/fantasy-basketball", landingLabel: "Start a free fantasy basketball league" },
  NHL: { noun: "Hockey", landing: "/sports/fantasy-hockey", landingLabel: "Start a free fantasy hockey league" },
}

export function dailyDraftSlug(sport: GameNightSport, date: string): string {
  return `${sport.toLowerCase()}${DAILY_DRAFT_SLUG_MARK}${date}`
}

function performerLine(p: Performer): string {
  return `- ${p.name} (${p.team} vs ${p.opponent}): ${p.line}`
}

/** The facts exactly as the model sees them — and exactly what the number check reads. */
export function serializeFacts(f: GameNightFacts): string {
  const lines = [
    `Sport: ${f.sport}`,
    `Slate: games played on ${f.dateLabel} (US Eastern)`,
    `Games: ${f.games.length}`,
    "",
    "Final scores:",
    ...f.games.map((g) => `- ${g.away} ${g.awayScore}, ${g.home} ${g.homeScore} (${g.away} at ${g.home})`),
    "",
    `Top ${f.sport === "NHL" ? "skaters" : "players"}, best fantasy night first:`,
    ...f.performers.map(performerLine),
  ]
  if (f.goalies.length) lines.push("", "Goalies, best fantasy night first:", ...f.goalies.map(performerLine))
  return lines.join("\n")
}

function systemPrompt(sport: GameNightSport): string {
  const noun = SPORT_COPY[sport].noun.toLowerCase()
  return [
    `You write a short daily post for fantasy ${noun} managers on AllFantasy about last night's best fantasy performances.`,
    "",
    "HARD RULES (a post that breaks any of them is thrown away):",
    "- Use ONLY the facts provided. Do not mention any player, team, score or number that is not in them.",
    "- Write every stat exactly as the facts give it, in digits. Do not compute anything new: no percentages, averages, totals, combined numbers or per-game rates.",
    "- No season stats, records, streaks, career context, injuries, trades, roster or ownership percentages, projections, or predictions.",
    "- Do not say a player is available on waivers or how many leagues roster him.",
    "",
    "VOICE: direct and plain, like a sharp friend in your league chat. Short sentences. No hype words",
    "(never: leverage, synergy, game-changing, revolutionary, insane, elite, beast). Say what happened and why it matters for a fantasy lineup in general terms (points leagues vs categories leagues).",
    "",
    "SHAPE (markdown, 250-450 words):",
    "- One short opening paragraph (no heading).",
    "- `## The top lines`: a bulleted list, one bullet per player in the order given, each with the stat line and one sentence of fantasy meaning.",
    sport === "NHL" ? "- `## In net`: the goalies, same format." : "",
    "- `## What to take from it`: two or three sentences of general lineup advice that rest only on the lines above.",
    "",
    'Return JSON only: {"excerpt": string (1-2 sentences), "body": string (markdown as above, no title heading), "seoDescription": string (under 155 characters)}',
  ]
    .filter(Boolean)
    .join("\n")
}

/** One model call: the reply text, or why there is none. Injectable so tests never reach a provider. */
export type ModelCall = (args: {
  messages: Array<{ role: "system" | "user"; content: string }>
  temperature?: number
  maxTokens?: number
  skipCache?: boolean
}) => Promise<{ ok: true; text: string } | { ok: false; detail?: string }>

/** Per-provider wait. A draft is ~1,400 tokens, far past the router's 12 s chat default. */
const PROVIDER_TIMEOUT_MS = 60_000

/**
 * The default model call goes through the AI fallback router, never one provider directly.
 *
 * 🛑 THE FIRST LIVE RUN (2026-11-16) PRODUCED NOTHING because this called `openaiChatJson` directly
 * and the worker's OpenAI key answered 401 for both sports. The router moves past a dead key (401 is
 * fallback-eligible) to whichever provider is answering, and the fact check below is what makes the
 * output safe — it does not care which model wrote the prose.
 */
export const routerModelCall: ModelCall = async (args) => {
  const res = await routeTextCall({
    messages: args.messages,
    temperature: args.temperature,
    maxTokens: args.maxTokens,
    skipCache: args.skipCache,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    feature: "blog-daily-drafts",
  })
  if (res.ok) return { ok: true, text: res.text }
  const tried = res.failure?.attempts.map((a) => `${a.provider}:${a.category}`).join(", ")
  return { ok: false, detail: tried ? `all providers failed (${tried})` : "all providers failed" }
}

/**
 * The JSON object in a model reply. Providers differ: some return bare JSON, some wrap it in a
 * ```json fence or a sentence. Anything that is not one object parses to null and the draft is dropped.
 */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const unfenced = text.replace(/```(?:json)?/gi, "")
  const start = unfenced.indexOf("{")
  const end = unfenced.lastIndexOf("}")
  if (start === -1 || end <= start) return null
  try {
    const value: unknown = JSON.parse(unfenced.slice(start, end + 1))
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export type DraftOutcome =
  | { ok: true; draft: GeneratedDraft; check: FactCheckResult }
  | { ok: false; reason: "generation_failed" | "bad_output" | "fact_check_failed"; check?: FactCheckResult; detail?: string }

function footer(sport: GameNightSport): string {
  const c = SPORT_COPY[sport]
  return [
    "",
    "---",
    "",
    "Every line above comes from the final box score, checked against the game's final score before this was written.",
    "",
    `[${c.landingLabel}](${c.landing}) on AllFantasy, or see who to add with the [Waiver Advisor](/waiver-ai).`,
  ].join("\n")
}

export async function writeGameNightDraft(args: {
  facts: GameNightFacts
  nameUniverse: string[]
  chat?: ModelCall
}): Promise<DraftOutcome> {
  const { facts } = args
  const chat: ModelCall = args.chat ?? routerModelCall
  const factsText = serializeFacts(facts)

  let res: Awaited<ReturnType<ModelCall>>
  try {
    res = await chat({
      messages: [
        { role: "system", content: systemPrompt(facts.sport) },
        { role: "user", content: factsText },
      ],
      temperature: 0.3,
      maxTokens: 1400,
      skipCache: true,
    })
  } catch (err) {
    return { ok: false, reason: "generation_failed", detail: err instanceof Error ? err.message.slice(0, 160) : "error" }
  }
  if (!res.ok) return { ok: false, reason: "generation_failed", detail: res.detail ?? "no reply" }

  const json = parseJsonObject(res.text)
  const body = typeof json?.body === "string" ? json.body.trim() : ""
  const excerpt = typeof json?.excerpt === "string" ? json.excerpt.trim() : ""
  const seoDescription = typeof json?.seoDescription === "string" ? json.seoDescription.trim() : ""
  if (body.length < 200 || !excerpt) return { ok: false, reason: "bad_output" }

  const check = checkDraftAgainstFacts({
    draftTexts: [body, excerpt, seoDescription],
    factsText,
    allowedNames: [...facts.performers, ...facts.goalies].map((p) => p.name),
    nameUniverse: args.nameUniverse,
  })
  if (!check.ok) return { ok: false, reason: "fact_check_failed", check }

  const noun = SPORT_COPY[facts.sport].noun
  const title = `Fantasy ${noun} Standouts: ${facts.dateLabel}`
  return {
    ok: true,
    check,
    draft: {
      title,
      slug: dailyDraftSlug(facts.sport, facts.date),
      excerpt: excerpt.slice(0, 1000),
      body: body + "\n" + footer(facts.sport),
      seoTitle: `${title} | AllFantasy`,
      seoDescription: (seoDescription || excerpt).slice(0, 160),
      tags: [`fantasy ${noun.toLowerCase()}`, `${facts.sport.toLowerCase()} fantasy`, "fantasy standouts"],
    },
  }
}
