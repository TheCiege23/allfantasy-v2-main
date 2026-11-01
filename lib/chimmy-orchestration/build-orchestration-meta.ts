import type { ChimmyIntentClassification } from './intent-classifier'
import {
  buildFollowUps,
  intentToToolId,
  resolveToolLaunches,
  type ToolRoutingContext,
} from './tool-routing-map'
import type { ChimmyOrchestrationMeta } from './types'

export function buildMemorySummaryLine(prefs: Record<string, unknown> | null): string | null {
  if (!prefs || typeof prefs !== 'object') return null
  const parts: string[] = []
  const risk = prefs.riskStyle
  const arch = prefs.teamArchetype
  const sc = prefs.scoringPreference
  const lt = prefs.favoriteLeagueType
  if (typeof risk === 'string') parts.push(`risk style: ${risk}`)
  if (typeof arch === 'string') parts.push(`team build: ${arch}`)
  if (typeof sc === 'string') parts.push(`scoring preference: ${sc}`)
  if (typeof lt === 'string') parts.push(`league type: ${lt}`)
  if (parts.length === 0) return null
  return `Remembered preferences — ${parts.join('; ')}.`
}

export function buildOrchestrationPromptSection(args: {
  classification: ChimmyIntentClassification
  ctx: ToolRoutingContext
  memorySummary: string | null
}): string {
  const { classification, ctx, memorySummary } = args
  const { primary, secondary } = resolveToolLaunches(classification.intent, ctx)
  const toolLine = primary
    ? `Recommended tool: ${primary.label} → ${primary.href}`
    : 'No specific tool link; stay in chat.'
  const alt =
    secondary.length > 0
      ? `Secondary: ${secondary.map((s) => `${s.label} (${s.href})`).join('; ')}`
      : ''

  /*
   * 🛑 THIS USED TO REQUIRE FIVE HEADINGS ON EVERY REPLY — Direct, Why, Tool, Confidence, Follow-up —
   * and told the model to state "routing match ~N%". So "Explain PPR scoring in two short sentences"
   * (2026-10-31) came back as five sections with "Routing match for this intent is ~62%" in it: the
   * user's own length instruction lost to ours, and an internal classifier score was published as if
   * it meant something to them. The routing score is no longer in the prompt at all; a model cannot
   * repeat a number it was never shown.
   */
  return `
## CHIMMY ORCHESTRATION (follow these rules)
- Likely topic: ${classification.label}. Internal hint only — never mention intents, routing, or match percentages.
- ${toolLine}
${alt ? `- ${alt}` : ''}
- You are the premium AllFantasy assistant: concise, confident, never generic — never boilerplate or vague.

### HOW TO ANSWER
- Answer the question that was asked, first. If the user sets a length or format ("two sentences", "one word", "a list"), follow it exactly — it overrides everything below.
- A definition or rules question gets a short plain answer: no headings, no confidence line, no tool pitch.
- A decision (start/sit, trade, waiver, draft) leads with the call, then 2–4 reasons tied to the loaded league and roster data, and says plainly what data is missing. Use short headings only when the answer has several distinct parts.
- Link one AllFantasy tool only when deeper work there would genuinely help, e.g. [Trade Analyzer](/trade-evaluator); prefer the recommended tool above.
- Never show internal field or tool names (leagueId, players_query_context, find_open_leagues, …) — say what is missing in plain words.
- ${memorySummary ? `User memory: ${memorySummary}` : 'No explicit preference memory yet — infer cautiously from context.'}
`.trim()
}

export function buildOrchestrationMeta(args: {
  classification: ChimmyIntentClassification
  ctx: ToolRoutingContext
  memorySummary: string | null
}): ChimmyOrchestrationMeta {
  const { classification, ctx, memorySummary } = args
  const { primary, secondary } = resolveToolLaunches(classification.intent, ctx)
  const recommendedToolId = intentToToolId(classification.intent)
  const followUps = buildFollowUps(classification.intent, ctx)

  return {
    intent: classification.intent,
    intentLabel: classification.label,
    recommendedToolId,
    confidence: classification.confidence,
    primaryLaunch: primary,
    secondaryLaunches: secondary,
    followUps,
    memorySummary,
    answerShape: {
      directAnswer: 'Lead with the clearest actionable recommendation for this intent.',
      why: 'Explain using roster/league context when loaded; cite uncertainty when data is thin.',
      recommendedTool: primary ? `Open ${primary.label} for deeper analysis: ${primary.href}` : 'Continue in Chimmy for clarification.',
      confidenceLine: `Routing confidence ~${(classification.confidence * 100).toFixed(0)}% for intent ${classification.intent}.`,
      followUp: followUps[0]?.prompt ?? 'What would you like to double-check next?',
    },
  }
}
