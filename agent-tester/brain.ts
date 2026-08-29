/**
 * Decision-making for the explorer.
 *
 * Two modes, and the default is the cheap one on purpose:
 *
 *   heuristic (default) — deterministic, no API key, no per-run cost, safe to
 *     run on every PR. Catches the entire dead-end / patience / session /
 *     double-submit / tap-target class without a model, because those are
 *     structural failures, not judgement calls.
 *
 *   llm (AGENT_TESTER_BRAIN=llm) — uses the @anthropic-ai/sdk already in this
 *     project's dependencies. Adds the thing heuristics genuinely cannot do:
 *     decide whether a screen makes sense to a human, and pick the affordance a
 *     person pursuing a stated goal would actually reach for.
 *
 * Run heuristic in CI, LLM when you want a deeper sweep. Both produce the same
 * Finding shape, so the report is identical either way.
 */

import { type Archetype } from "./archetypes"
import { type Finding } from "./detectors"

export type BrainDecision =
  | { kind: "act"; index: number; why: string }
  | { kind: "give-up"; reason: string }

type AffordanceSummary = { label: string; kind: string }

type ChooseArgs = {
  goal: string
  archetype: Archetype
  url: string
  affordances: AffordanceSummary[]
  visited: string[]
}

function brainMode(): "heuristic" | "llm" {
  return process.env.AGENT_TESTER_BRAIN === "llm" ? "llm" : "heuristic"
}

/**
 * Words that signal a control moves the user forward. Ordered by how strongly
 * they imply progress. Used by the heuristic brain to prefer the affordance a
 * goal-directed person would take.
 */
const FORWARD_SIGNALS = [
  "continue", "next", "get started", "start", "sign up", "signup", "create",
  "join", "submit", "confirm", "save", "draft", "invite", "finish", "done",
  "log in", "login", "sign in", "signin",
]

/** Controls that abandon or destroy work — a goal-directed user avoids these. */
const AVOID_SIGNALS = [
  "cancel", "delete", "remove", "log out", "logout", "sign out", "signout",
  "back", "skip", "dismiss", "close", "leave", "abandon", "reset", "clear",
  "terms", "privacy", "cookie",
]

function scoreLabel(label: string): number {
  const l = label.toLowerCase()
  let score = 0
  FORWARD_SIGNALS.forEach((signal, i) => {
    if (l.includes(signal)) score += 10 - i * 0.2
  })
  AVOID_SIGNALS.forEach((signal) => {
    if (l.includes(signal)) score -= 15
  })
  return score
}

function heuristicChoice(args: ChooseArgs): BrainDecision {
  const { affordances, url } = args

  if (affordances.length === 0) {
    return { kind: "give-up", reason: "nothing on screen to interact with" }
  }

  // Form fields first: a person fills the form before pressing the button. The
  // explorer's ranking already put them first for careful readers; this makes it
  // true for everyone, because nobody submits an empty form on purpose.
  const firstEmptyInput = affordances.findIndex(
    (a) => a.kind === "input" && !args.visited.includes(`${url}::${a.label}`)
  )
  if (firstEmptyInput !== -1) {
    return {
      kind: "act",
      index: firstEmptyInput,
      why: "filling in the form before submitting it",
    }
  }

  const unvisited = affordances
    .map((a, index) => ({ ...a, index }))
    .filter((a) => !args.visited.includes(`${url}::${a.label}`))

  const pool = unvisited.length > 0 ? unvisited : affordances.map((a, index) => ({ ...a, index }))

  const best = pool
    .map((a) => ({ ...a, score: scoreLabel(a.label) }))
    .sort((x, y) => y.score - x.score)[0]

  // Everything left is something a goal-directed user would actively avoid.
  if (best.score < -10) {
    return {
      kind: "give-up",
      reason: "the only remaining controls are cancel/back/logout — the flow has no forward path",
    }
  }

  return {
    kind: "act",
    index: best.index,
    why: best.score > 0 ? `"${best.label}" looks like the way forward` : "exploring",
  }
}

let cachedClient: unknown = null

async function getClient(): Promise<any | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (cachedClient) return cachedClient
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk")
    cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    return cachedClient
  } catch {
    return null
  }
}

const MODEL = process.env.AGENT_TESTER_MODEL ?? "claude-sonnet-5"

async function llmChoice(args: ChooseArgs): Promise<BrainDecision> {
  const client = await getClient()
  if (!client) return heuristicChoice(args)

  const list = args.affordances
    .map((a, i) => `${i}: [${a.kind}] ${a.label}`)
    .join("\n")

  const prompt = [
    `You are testing a fantasy sports web app by behaving like a specific kind of user.`,
    ``,
    `Who you are: ${args.archetype.label} — ${args.archetype.premise}`,
    `What you are trying to do: ${args.goal}`,
    `Current page: ${args.url}`,
    ``,
    `Controls available on screen:`,
    list,
    ``,
    `Already tried on this page: ${args.visited.length > 0 ? args.visited.join(", ") : "nothing yet"}`,
    ``,
    `Pick the ONE control this person would use next. Stay in character — a`,
    `scanning user grabs the obvious big button, a careful user reads and fills`,
    `fields in order, an expert goes straight for the action.`,
    ``,
    `Reply with ONLY a JSON object, no prose:`,
    `{"index": <number>, "why": "<short reason>"}`,
    `or, if this person would genuinely quit here:`,
    `{"giveUp": true, "reason": "<why they'd quit>"}`,
  ].join("\n")

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    })

    const text = response.content
      ?.filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("") ?? ""

    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return heuristicChoice(args)

    const parsed = JSON.parse(match[0]) as {
      index?: number
      why?: string
      giveUp?: boolean
      reason?: string
    }

    if (parsed.giveUp) {
      return { kind: "give-up", reason: parsed.reason ?? "the model judged this a dead end" }
    }

    if (
      typeof parsed.index === "number" &&
      parsed.index >= 0 &&
      parsed.index < args.affordances.length
    ) {
      return { kind: "act", index: parsed.index, why: parsed.why ?? "model choice" }
    }

    return heuristicChoice(args)
  } catch {
    // Never let a model outage fail a test run — degrade to heuristics.
    return heuristicChoice(args)
  }
}

export async function chooseAction(args: ChooseArgs): Promise<BrainDecision> {
  return brainMode() === "llm" ? llmChoice(args) : heuristicChoice(args)
}

type JudgeArgs = {
  archetype: Archetype
  goal: string
  url: string
  text: string
}

/**
 * The judgement heuristics cannot make: is this screen comprehensible to the
 * person in front of it? Returns null in heuristic mode — silence is correct
 * there, rather than a fabricated opinion.
 */
export async function judgeScreen(args: JudgeArgs): Promise<Finding | null> {
  if (brainMode() !== "llm") return null

  const client = await getClient()
  if (!client) return null

  const prompt = [
    `You are: ${args.archetype.label} — ${args.archetype.premise}`,
    `You were trying to: ${args.goal}`,
    `You have ended up on: ${args.url}`,
    ``,
    `The screen says:`,
    `"""`,
    args.text.slice(0, 3000),
    `"""`,
    ``,
    `As this person, is anything here confusing, misleading, or broken? Judge the`,
    `copy and the apparent state — not the visual design.`,
    ``,
    `If it is fine, reply exactly: OK`,
    `If not, reply with ONLY JSON:`,
    `{"severity":"blocker|major|minor","title":"<short>","narrative":"<what confused you, in first person>"}`,
  ].join("\n")

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    })

    const text = response.content
      ?.filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("") ?? ""

    if (text.trim().toUpperCase().startsWith("OK")) return null

    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null

    const parsed = JSON.parse(match[0]) as {
      severity?: string
      title?: string
      narrative?: string
    }

    const severity =
      parsed.severity === "blocker" || parsed.severity === "major" ? parsed.severity : "minor"

    if (!parsed.title) return null

    return {
      severity,
      title: parsed.title,
      narrative: parsed.narrative ?? "",
      url: args.url,
      evidence: "reported by LLM screen judgement",
    }
  } catch {
    return null
  }
}
