import 'server-only'

import {
  xaiResponsesJson,
  parseTextFromXaiResponse,
  extractAnnotations,
  type XaiTool,
} from '@/lib/xai-client'
import { reportProviderFailure } from '@/lib/ai-orchestration/providerOutageAlert'
import Anthropic from '@anthropic-ai/sdk'
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard'
import {
  CHIMMY_CLAUDE_FALLBACK_BETA,
  hasAnthropicKey,
  resolveChimmyClaudeModel,
} from '@/lib/ai/chimmyClaudeConfig'

/**
 * THE LAST RESORT FOR A SPORTS QUESTION WE HOLD NO DATA FOR.
 *
 * Everything else in this assistant answers from our own database and refuses
 * when the row is missing. That refusal is the right answer for anything that
 * touches a user's league — we are the only source of truth for their roster,
 * and a model guessing at it is worse than silence.
 *
 * But a great many questions are not about their league at all. "How many home
 * runs were hit in the majors yesterday" has a public, checkable answer that we
 * simply do not ingest, and returning "I don't have reliable data for that yet"
 * to it is technically true and completely useless. This path exists for
 * exactly that shape of question, and nothing else.
 *
 * ⚠ CITATIONS ARE THE GATE, NOT A DECORATION. This returns null when the search
 * came back without sources, even if the model produced confident prose. An
 * uncited answer here is indistinguishable from the hallucination the whole
 * refusal architecture exists to prevent, so it is discarded and the caller
 * falls back to the honest refusal. Never relax this into "cite if available".
 *
 * ⚠ IT ANSWERS FACTS, IT DOES NOT GIVE ADVICE. Start/sit, trade and waiver
 * questions stay on the grounded pipeline where the league data actually is.
 * Search results describe the world; they know nothing about a user's roster,
 * and a lineup call made without it would be confident and baseless.
 *
 * This mirrors the boundary lib/ai/xNewsSearch.ts draws for news. That module
 * is for player and team reporting and requires a named subject; this one takes
 * a whole question and is for public facts. Neither may decide anything.
 */

export type LiveSportsCitation = { label: string; url: string }

export type LiveSportsAnswer = {
  text: string
  /** Sources consulted. Never map one to a specific sentence — see below. */
  citations: LiveSportsCitation[]
  /** Which provider searched and answered. */
  provider?: 'claude' | 'grok'
  /** The model id that answered. */
  model?: string
}

/** Wall-clock ceiling. A chat reply that arrives after this is not a reply. */
const SEARCH_TIMEOUT_MS = 22_000

/** Enough to matter, few enough to render under a chat bubble. */
const MAX_CITATIONS = 6

const MODEL = 'grok-4-0709'

/*
 * Web search carries this; X search is added only for questions where recency
 * is the whole point. Web results reach box scores and schedule pages, which is
 * what a stat question actually needs — X is people talking about them.
 */
const BASE_TOOLS: XaiTool[] = [{ type: 'web_search' }]
const RECENCY_TOOLS: XaiTool[] = [{ type: 'web_search' }, { type: 'x_search' }]

const SYSTEM_PROMPT = [
  'You answer factual questions about professional and college sports using ONLY the search results you retrieve.',
  '',
  'RULES, IN ORDER OF IMPORTANCE:',
  '1. If the search results do not contain the answer, say plainly that you could not find it. Never fill the gap from memory — your training data is stale and a wrong score or stat line is worse than no answer.',
  '2. Give the number, name, date or result asked for, then stop. No preamble, no "great question", no speculation about why.',
  '3. State the date or time window the figure covers. "Yesterday" and "today" are ambiguous across time zones, so name the actual date you found.',
  '4. If sources disagree, say so and give both. Do not silently pick one.',
  '5. NEVER give fantasy advice — no start/sit, no trade verdicts, no waiver picks, no rankings. You cannot see the user\'s roster or league settings. If asked for advice, answer only the factual part and say the advice needs their league loaded.',
  '6. Keep it under 120 words. This renders in a chat bubble.',
  '7. Write PLAIN TEXT. No markdown: no **bold**, no [links](url), no bullets, no headings. The bubble does not render markdown, so the asterisks and brackets show up literally.',
  '8. Do NOT add inline citation markers like [1] or [2]. Sources are listed separately, and nothing in the payload maps a source to a particular sentence, so a marker next to one claim asserts a link that does not exist.',
].join('\n')

/**
 * Strip the markdown the model emits anyway.
 *
 * ⚠ THE FIRST LIVE ANSWER RENDERED "**32 home runs**" WITH THE ASTERISKS
 * SHOWING, and carried a "[[1]](https://…)" marker next to the number. The
 * prompt now forbids both, but a prompt is a request and this is a guarantee —
 * the bubble is plain text and the model is the one deciding what to send.
 *
 * ⚠ THE INLINE MARKER IS NOT COSMETIC. xAI returns `url_citation` annotations
 * with `start_index` and `end_index` BOTH ZERO, so nothing maps a source to the
 * span it supports. A `[1]` pinned to "32 home runs" claims exactly that
 * mapping. The sources belong in the list under the answer, where they read as
 * "consulted" rather than "this sentence came from here" — the same rule
 * lib/ai/xNewsSearch.ts states for its own citations.
 */
export function stripMarkdown(text: string): string {
  return text
    /* [label](url) and the [[1]](url) shape → keep the label, drop the link. */
    .replace(/\[\[(\d+)\]\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')
    /* Bare inline markers left behind, e.g. "…15 games).[1]". */
    .replace(/\[\d+\]/g, '')
    /* Emphasis. Bold before italic, or the inner pass eats one asterisk. */
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    /* Headings and list bullets at the start of a line. */
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    /* Whitespace the removals leave behind, including before punctuation. */
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .trim()
}

/*
 * Questions where a day-old answer is wrong, not merely stale — these get X
 * search too, because reporters post before box scores update.
 */
function wantsRecency(question: string): boolean {
  return /\b(right now|live|currently|tonight|today|so far|latest|breaking|just|update)\b/i.test(
    question,
  )
}

/**
 * ⚠ ADVICE IS NOT A FACT LOOKUP, AND MUST NOT ARRIVE HERE.
 *
 * The refusals that reach this module include league-shaped ones. Handing "who
 * should I start" to a web search produces a confident answer built from
 * somebody else's rankings and none of this user's settings — which reads
 * exactly like a grounded recommendation and is not one.
 */
function isAdviceQuestion(question: string): boolean {
  return /\b(should i|start or sit|sit or start|who do i|drop|pick ?up|waiver|trade for|trade away|is it worth|worth it|my (team|roster|lineup)|better option)\b/i.test(
    question,
  )
}

/** True when this question is the kind a public search can honestly settle. */
export function isSearchableSportsQuestion(question: string): boolean {
  if (!question || question.trim().length < 8) return false
  if (isAdviceQuestion(question)) return false
  return true
}

function toCitations(
  annotations: ReturnType<typeof extractAnnotations>,
): LiveSportsCitation[] {
  const seen = new Set<string>()
  const out: LiveSportsCitation[] = []

  for (const a of annotations) {
    const url = (a as { url_citation?: { url?: string; title?: string } })?.url_citation?.url
      ?? (a as { url?: string })?.url
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue
    if (seen.has(url)) continue
    seen.add(url)

    const title = (a as { url_citation?: { title?: string } })?.url_citation?.title
    let label = typeof title === 'string' && title.trim() ? title.trim() : ''
    if (!label) {
      /* Fall back to the host, which is at least honest about the source. */
      try {
        label = new URL(url).hostname.replace(/^www\./, '')
      } catch {
        label = url
      }
    }
    out.push({ label, url })
    if (out.length >= MAX_CITATIONS) break
  }

  return out
}

/*
 * ── CLAUDE (the main model, user decision 2026-09-23) ─────────────────────────────────────────────
 *
 * Anthropic's server-side `web_search` tool: Claude searches, reads and answers inside ONE request.
 * There is no X search on this path — web results reach box scores and schedule pages, which is
 * what a stat question needs; X is people talking about them.
 *
 * ⚠ THE CITATION GATE IS STRONGER HERE, NOT WEAKER. Claude's citations are attached to the text
 * block they support (`web_search_result_location`, carrying the url and the cited text), so an
 * answer with no citation on any block used no search result at all — and is discarded exactly as
 * the Grok path discards an unannotated one. We still render them as a "consulted" list, not
 * per sentence, because the chat bubble has nowhere to put a span.
 */

/**
 * 🛑 THE BASIC `web_search_20250305`, NOT THE NEWER `web_search_20260209` — ON PURPOSE, AND MEASURED.
 *
 * The newer tool filters results through code execution before the model reads them, and its final
 * text comes back with NO citations attached. Measured live 2026-09-23 on claude-opus-5 with the
 * same prompt ("most recent Super Bowl winner and score"):
 *
 *     web_search_20260209   9 results, correct answer,  0 text citations   7.7s
 *     web_search_20250305  10 results, correct answer,  5 text citations   5.6s
 *
 * With the newer tool the gate below would discard EVERY answer — correct ones included — and the
 * mocked tests could never have shown it. Upgrading this tool means re-proving that citations still
 * arrive, against the live API, before relaxing anything.
 */
const CLAUDE_WEB_SEARCH_TOOL = 'web_search_20250305' as const

/** Wall-clock for a Claude search turn: a search, a read and a short answer. */
const CLAUDE_SEARCH_TIMEOUT_MS = 35_000

/** Searches per question. Each is billed; three reaches a box score and a cross-check. */
const CLAUDE_MAX_SEARCHES = 3

/**
 * A server-tool turn can come back `pause_turn` (the server hit its own iteration limit) and must be
 * re-sent to continue. Bounded, because each continuation is another billed request.
 */
const CLAUDE_MAX_CONTINUATIONS = 2

type ClaudeCitation = { type?: string; url?: string; title?: string | null }

/** Sources Claude actually cited, de-duplicated, in order. */
export function claudeCitations(content: Anthropic.ContentBlock[]): LiveSportsCitation[] {
  const seen = new Set<string>()
  const out: LiveSportsCitation[] = []
  for (const block of content) {
    if (block.type !== 'text') continue
    for (const c of (block.citations ?? []) as ClaudeCitation[]) {
      if (c.type !== 'web_search_result_location') continue
      const url = c.url
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || seen.has(url)) continue
      seen.add(url)
      let label = typeof c.title === 'string' && c.title.trim() ? c.title.trim() : ''
      if (!label) {
        try {
          label = new URL(url).hostname.replace(/^www\./, '')
        } catch {
          label = url
        }
      }
      out.push({ label, url })
      if (out.length >= MAX_CITATIONS) return out
    }
  }
  return out
}

async function answerWithClaude(question: string): Promise<LiveSportsAnswer | null> {
  // A provider boundary in its own right: a disabled kill switch must look like "no answer".
  if (!isAiSpendEnabled()) return null
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) return null

  const client = new Anthropic({ apiKey, maxRetries: 0 })
  const model = resolveChimmyClaudeModel()
  const deadline = Date.now() + CLAUDE_SEARCH_TIMEOUT_MS
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }]
  let useFallbacks = true

  const call = () => {
    const params = {
      model,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      // A fact lookup, not a judgement call: low effort keeps a chat reply fast.
      thinking: { type: 'adaptive' as const },
      output_config: { effort: 'low' as const },
      tools: [{ type: CLAUDE_WEB_SEARCH_TOOL, name: 'web_search' as const, max_uses: CLAUDE_MAX_SEARCHES }],
      messages,
      ...(useFallbacks ? { fallbacks: 'default' } : {}),
    } as Anthropic.MessageCreateParamsNonStreaming
    return client.messages.create(params, {
      timeout: Math.max(5_000, deadline - Date.now()),
      ...(useFallbacks ? { headers: { 'anthropic-beta': CHIMMY_CLAUDE_FALLBACK_BETA } } : {}),
    })
  }

  try {
    let response: Anthropic.Message | null = null
    for (let attempt = 0; attempt <= CLAUDE_MAX_CONTINUATIONS; attempt += 1) {
      if (Date.now() >= deadline) return null
      try {
        response = await call()
      } catch (err) {
        // The refusal-fallback beta is an add-on; it must never be why search fails.
        if (useFallbacks && err instanceof Anthropic.BadRequestError) {
          useFallbacks = false
          response = await call()
        } else {
          throw err
        }
      }
      if (response.stop_reason !== 'pause_turn') break
      messages.push({ role: 'assistant', content: response.content })
    }
    if (!response || response.stop_reason === 'pause_turn') return null
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null

    const text = stripMarkdown(
      response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(''),
    )
    if (!text) return null

    const citations = claudeCitations(response.content)
    // THE GATE — see the header. No citation means no search result was used.
    if (citations.length === 0) return null

    return { text, citations, provider: 'claude', model: response.model || model }
  } catch (err) {
    const e = err as { status?: number; message?: string } | null
    reportProviderFailure({ provider: 'anthropic', status: e?.status, detail: e?.message, surface: 'chimmy_live_search' })
    return null
  }
}

/**
 * Try to answer a sports question from live search.
 *
 * Claude when `ANTHROPIC_API_KEY` is set (the main model); Grok only for a deployment without one.
 * Returns null for every failure — spend disabled, no key, provider error,
 * timeout, empty text, and above all NO CITATIONS. A null here means the caller
 * should keep whatever honest refusal it already had.
 */
export async function answerSportsQuestionFromSearch(
  question: string,
): Promise<LiveSportsAnswer | null> {
  if (!isSearchableSportsQuestion(question)) return null
  if (hasAnthropicKey()) return answerWithClaude(question)
  return answerWithGrok(question)
}

async function answerWithGrok(question: string): Promise<LiveSportsAnswer | null> {
  try {
    const result = await Promise.race([
      xaiResponsesJson({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: question },
        ],
        tools: wantsRecency(question) ? RECENCY_TOOLS : BASE_TOOLS,
        temperature: 0,
        maxTokens: 700,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SEARCH_TIMEOUT_MS)),
    ])

    if (!result || !result.ok) {
      /* xAI-only path: an exhausted account must reach the owner, not just return null. */
      if (result) reportProviderFailure({ provider: 'grok', status: result.status, detail: result.details, surface: 'chimmy_live_search' })
      return null
    }

    const text = stripMarkdown(parseTextFromXaiResponse(result.json) ?? '')
    if (!text) return null

    const citations = toCitations(extractAnnotations(result.json))

    /*
     * THE GATE. Prose without sources is the model answering from memory, which
     * is the one thing this path exists to avoid. Discard it and let the caller
     * keep its refusal — a wrong stat delivered confidently costs more trust
     * than an admitted gap.
     */
    if (citations.length === 0) return null

    return { text, citations, provider: 'grok', model: MODEL }
  } catch {
    /*
     * Includes AiSpendDisabledError. A disabled kill switch must look exactly
     * like "no answer available", never like a broken assistant.
     */
    return null
  }
}
