/**
 * OneBrainNarrativeComposer — one-brain merge: deterministic facts + DeepSeek (verify/significance) + Grok (frame) + OpenAI (final story).
 * Output is fact-grounded; no theatrical fiction.
 */

import { deepseekChat } from "@/lib/deepseek-client"
import { openaiChatJson, parseJsonContentFromChatCompletion } from "@/lib/openai-client"
import { grokEnrich } from "@/lib/ai-external/grok"
import { getStoryTypeLabel } from "./SportNarrativeResolver"
import type { NarrativeContextPackage, StoryOutput, StoryStyle } from "./types"

interface ComposeStoryOptions {
  preferredStyle?: StoryStyle
}

function contextToBlob(ctx: NarrativeContextPackage): string {
  const topDrama = ctx.dramaEvents.slice(0, 10)
  const topRivalries = ctx.rivalries.slice(0, 8)

  return JSON.stringify(
    {
      leagueId: ctx.leagueId,
      sport: ctx.sportLabel,
      season: ctx.season,
      storyType: ctx.storyType,
      storyTypeLabel: getStoryTypeLabel(ctx.storyType),
      dramaEvents: topDrama.map((e) => ({
        headline: e.headline,
        summary: e.summary,
        dramaType: e.dramaType,
        dramaScore: e.dramaScore,
        relatedManagerIds: e.relatedManagerIds,
        relatedTeamIds: e.relatedTeamIds ?? [],
      })),
      rivalries: topRivalries,
      graphSummary: ctx.graphSummary,
      rankingsSnapshot: ctx.rankingsSnapshot,
      legacyHint: ctx.legacyHint,
      simulationHint: ctx.simulationHint,
      deterministicEvidence: buildDeterministicEvidence(ctx),
    },
    null,
    2
  )
}

/**
 * Run one-brain merge and return structured StoryOutput. Uses only provided context; does not invent.
 */
export async function composeOneBrainStory(
  context: NarrativeContextPackage,
  options: ComposeStoryOptions = {}
): Promise<StoryOutput | null> {
  const preferredStyle = normalizePreferredStyle(options.preferredStyle)
  const blob = contextToBlob(context)
  const fallback = buildDeterministicStoryFallback(context, preferredStyle)

  const [deepSeekResult, grokResult] = await Promise.allSettled([
    deepseekChat({
      prompt: `Using ONLY the following league data (facts only), identify in 2-3 sentences what is most significant for a ${context.storyType} story. Do not invent any names, scores, or events. If context is thin, say that clearly.\n\n${blob}`,
      systemPrompt:
        "You are a fantasy sports analyst. Output only the significance summary, no preamble. Be factual. Reference only entities and numbers from the data.",
      temperature: 0.3,
      maxTokens: 250,
    }).then((r) => (r.error ? "" : r.content?.trim() ?? "")),
    grokEnrich({
      kind: "league_story",
      context: { scope: "league_story", storyType: context.storyType, leagueId: context.leagueId },
      payload: {
        sport: context.sport,
        storyTypeLabel: getStoryTypeLabel(context.storyType),
        graphSummary: context.graphSummary,
        dramaCount: context.dramaEvents.length,
        rivalryCount: context.rivalries.length,
        topDramaHeadlines: context.dramaEvents.slice(0, 3).map((event) => event.headline),
      },
    })
      .then((r) => {
        if (!r.ok || !r.narrative?.length) return ""
        return Array.isArray(r.narrative) ? r.narrative.join(" ") : String(r.narrative)
      })
      .catch(() => ""),
  ])

  const significance = deepSeekResult.status === "fulfilled" ? deepSeekResult.value : ""
  const narrativeFraming = grokResult.status === "fulfilled" ? grokResult.value : ""

  const systemPrompt = `You are the AllFantasy League Story Creator. You produce fact-grounded narrative stories from structured league data.

RULES:
- Use ONLY the provided context. Do not invent players, matchups, standings, trades, rivalries, or scores.
- Every claim must be traceable to the context (drama events, rivalries, graph summary).
- If data is thin, keep the story short and say so.
- Output valid JSON only, with these exact keys: headline, whatHappened, whyItMatters, whoItAffects, keyEvidence (array of strings), nextStorylineToWatch, shortVersion, socialVersion, longVersion, style.
- Optional: shortVersion (under 280 chars), socialVersion (under 280 chars), longVersion (2-4 sentences).
- style must be one of: announcer, recap, neutral.
- keyEvidence must list only facts from the context (e.g. "Drama event: [headline]", "Rivalry: [nodeA] vs [nodeB]").
- Tone: engaging but factual, not theatrical.`

  const userPrompt = `Context (facts only):
${blob}
${significance ? `\nSignificance (from analysis): ${significance}` : ""}
${narrativeFraming ? `\nNarrative framing: ${narrativeFraming}` : ""}
Preferred style: ${preferredStyle}

Generate a ${context.storyType} league story. Return JSON only.`

  const res = await openaiChatJson({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.5,
    maxTokens: 1200,
  })

  if (!res.ok) return fallback
  const json = parseJsonContentFromChatCompletion(res.json)
  if (!json || typeof json !== "object") return fallback
  if (typeof json.whatHappened !== 'string' || !json.whatHappened.trim() ||
      typeof json.whyItMatters !== 'string' || !json.whyItMatters.trim()) return fallback

  const headline = typeof json.headline === "string" ? json.headline.trim() : fallback.headline
  const whatHappened =
    typeof json.whatHappened === "string" ? json.whatHappened.trim() : fallback.whatHappened
  const whyItMatters =
    typeof json.whyItMatters === "string" ? json.whyItMatters.trim() : fallback.whyItMatters
  const whoItAffects =
    typeof json.whoItAffects === "string" ? json.whoItAffects.trim() : fallback.whoItAffects
  const keyEvidence = Array.isArray(json.keyEvidence)
    ? (json.keyEvidence as string[]).filter((e): e is string => typeof e === "string").slice(0, 10)
    : fallback.keyEvidence
  const nextStorylineToWatch =
    typeof json.nextStorylineToWatch === "string"
      ? json.nextStorylineToWatch.trim()
      : fallback.nextStorylineToWatch

  const style = normalizePreferredStyle(json.style) ?? preferredStyle

  const shortVersion =
    typeof json.shortVersion === "string"
      ? json.shortVersion.slice(0, 280)
      : buildShortVersion(headline, whatHappened)
  const socialVersion =
    typeof json.socialVersion === "string"
      ? json.socialVersion.slice(0, 280)
      : buildSocialVersion(headline, whyItMatters, nextStorylineToWatch)
  const longVersion =
    typeof json.longVersion === "string"
      ? json.longVersion.slice(0, 800)
      : buildLongVersion(headline, whatHappened, whyItMatters, whoItAffects, nextStorylineToWatch)

  return {
    source: 'ai',
    headline: headline.slice(0, 200),
    whatHappened: whatHappened.slice(0, 1500),
    whyItMatters: whyItMatters.slice(0, 800),
    whoItAffects: whoItAffects.slice(0, 500),
    keyEvidence: keyEvidence.length ? keyEvidence : fallback.keyEvidence,
    nextStorylineToWatch: nextStorylineToWatch.slice(0, 300),
    shortVersion,
    socialVersion,
    longVersion,
    style: style ?? "neutral",
  }
}

export function buildDeterministicStoryFallback(
  context: NarrativeContextPackage,
  preferredStyle: StoryStyle = "neutral"
): StoryOutput {
  const topDrama = context.dramaEvents[0]
  const topRivalry = context.rivalries[0]
  const evidence = buildDeterministicEvidence(context)

  const headline = topDrama?.headline
    ? topDrama.headline
    : `${getStoryTypeLabel(context.storyType)} in ${context.sportLabel}`
  const whatHappened = topDrama
    ? `The top event in this league cycle is "${topDrama.headline}". ${topDrama.summary ?? "Recent results pushed this storyline to the front."}`
    : `No single high-signal drama event is available, so this story is generated from current rivalry and graph context only.`
  const whyItMatters = topRivalry
    ? `This matters because rivalry intensity remains active between ${topRivalry.nodeA} and ${topRivalry.nodeB}, creating downstream pressure on weekly decisions and standings momentum.`
    : `This matters because league relationship signals indicate active storyline pressure even with limited event detail.`
  const whoItAffects = topRivalry
    ? `Primary impact is on ${topRivalry.nodeA} and ${topRivalry.nodeB}, with secondary effects across connected managers in this league graph.`
    : `Primary impact is distributed across the most active managers in the current league storyline graph.`
  const nextStorylineToWatch = context.simulationHint
    ? context.simulationHint
    : `Watch whether this trend strengthens in the next slate, especially around rivalry intensity and new drama events.`

  return {
    source: 'template',
    headline: headline.slice(0, 200),
    whatHappened: whatHappened.slice(0, 1500),
    whyItMatters: whyItMatters.slice(0, 800),
    whoItAffects: whoItAffects.slice(0, 500),
    keyEvidence: evidence,
    nextStorylineToWatch: nextStorylineToWatch.slice(0, 300),
    shortVersion: buildShortVersion(headline, whatHappened),
    socialVersion: buildSocialVersion(headline, whyItMatters, nextStorylineToWatch),
    longVersion: buildLongVersion(
      headline,
      whatHappened,
      whyItMatters,
      whoItAffects,
      nextStorylineToWatch
    ),
    style: preferredStyle,
  }
}

function buildDeterministicEvidence(context: NarrativeContextPackage): string[] {
  const evidence: string[] = []
  context.dramaEvents.slice(0, 4).forEach((event) => {
    evidence.push(`Drama: ${event.headline} (${event.dramaType}, score ${event.dramaScore.toFixed(0)})`)
  })
  context.rivalries.slice(0, 3).forEach((rivalry) => {
    evidence.push(
      `Rivalry: ${rivalry.nodeA} vs ${rivalry.nodeB}${typeof rivalry.intensityScore === "number" ? ` (intensity ${rivalry.intensityScore.toFixed(0)})` : ""}`
    )
  })
  if (context.graphSummary) evidence.push(`Graph: ${context.graphSummary}`)
  if (context.rankingsSnapshot) evidence.push(`Rankings: ${context.rankingsSnapshot}`)
  if (context.legacyHint) evidence.push(`Legacy: ${context.legacyHint}`)
  if (context.simulationHint) evidence.push(`Simulation: ${context.simulationHint}`)
  return evidence.slice(0, 10)
}

function normalizePreferredStyle(style: unknown): StoryStyle | undefined {
  return style === "announcer" || style === "recap" || style === "neutral" ? style : undefined
}

function buildShortVersion(headline: string, whatHappened: string): string {
  return `${headline}: ${whatHappened}`.replace(/\s+/g, " ").trim().slice(0, 280)
}

function buildSocialVersion(headline: string, whyItMatters: string, nextStorylineToWatch: string): string {
  return `${headline} — ${whyItMatters} Next watch: ${nextStorylineToWatch}`
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280)
}

function buildLongVersion(
  headline: string,
  whatHappened: string,
  whyItMatters: string,
  whoItAffects: string,
  nextStorylineToWatch: string
): string {
  return [headline, whatHappened, whyItMatters, whoItAffects, `Next watch: ${nextStorylineToWatch}`]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800)
}

/* ─── Storyline Studio: re-voice one hook (lib/storyline-studio) ───────────────────────────── */

export type HookTone = "announcer" | "trash_talk" | "neutral"

const TONE_BRIEF: Record<HookTone, string> = {
  announcer: "a big-game TV announcer: energetic, dramatic, one or two sentences",
  trash_talk:
    "playful league trash talk aimed at the TEAMS and how they play — never at the managers as people (no looks, intelligence, family, job)",
  neutral: "a clean, neutral one- or two-sentence summary",
}

/**
 * Rewrite one Storyline Studio hook in a tone. The hook's facts are the ONLY material: same teams,
 * same players, same numbers. The caller must run the result through `validateHookRewrite`
 * (./StoryFactGuard.ts) and fall back to the template text when it fails — this returns the model's
 * text, or null when the model gave nothing usable.
 */
export async function rewriteHookInTone(input: {
  text: string
  facts: Array<{ key: string; value: string | number }>
  tone: HookTone
  language: "en" | "es"
}): Promise<string | null> {
  const systemPrompt = `You rewrite one fantasy football league chat line in a requested tone.
RULES:
- Use ONLY the facts given. Keep every team name and player name exactly as written.
- Do not add any number that is not in the facts. Do not change any number.
- Do not invent results, injuries, quotes or predictions. No guarantees.
- Talk about fantasy teams and their play, never insult a manager as a person.
- No profanity. Under 280 characters.
- Write in ${input.language === "es" ? "Spanish (use «reclamo», never «waiver», for waiver concepts)" : "English"}.
- Output JSON only: {"text": "..."}`
  const userPrompt = `Tone: ${TONE_BRIEF[input.tone]}
Facts (JSON): ${JSON.stringify(input.facts)}
Original line: ${input.text}`
  const res = await openaiChatJson({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: input.tone === "neutral" ? 0.2 : 0.7,
    maxTokens: 220,
  })
  if (!res.ok) return null
  const json = parseJsonContentFromChatCompletion(res.json)
  const text = json && typeof json === "object" && typeof (json as { text?: unknown }).text === "string" ? (json as { text: string }).text.trim() : ""
  return text ? text.slice(0, 400) : null
}
