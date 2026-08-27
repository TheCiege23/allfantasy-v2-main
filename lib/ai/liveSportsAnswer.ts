import 'server-only'

import {
  xaiResponsesJson,
  parseTextFromXaiResponse,
  extractAnnotations,
  type XaiTool,
} from '@/lib/xai-client'

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

/**
 * Try to answer a sports question from live search.
 *
 * Returns null for every failure — spend disabled, no key, provider error,
 * timeout, empty text, and above all NO CITATIONS. A null here means the caller
 * should keep whatever honest refusal it already had.
 */
export async function answerSportsQuestionFromSearch(
  question: string,
): Promise<LiveSportsAnswer | null> {
  if (!isSearchableSportsQuestion(question)) return null

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

    if (!result || !result.ok) return null

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

    return { text, citations }
  } catch {
    /*
     * Includes AiSpendDisabledError. A disabled kill switch must look exactly
     * like "no answer available", never like a broken assistant.
     */
    return null
  }
}
