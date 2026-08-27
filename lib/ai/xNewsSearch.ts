/**
 * Live sports news from X, via xAI's server-side `x_search` tool.
 *
 * WHAT THIS IS FOR
 * Text whose value decays in hours: injury and inactive news, signings,
 * trades, call-ups, depth-chart moves. This is the one thing no other provider
 * in the router can do, because Grok has first-party X access.
 *
 * WHAT THIS IS NOT FOR
 * Highlights, GIFs, or clips. `x_search` returns text plus citation URLs and
 * (optionally) image embeds — never a media asset you can host. Sports video is
 * also licensed content, so re-hosting it is a legal question, not a technical
 * one. Do not add a "fetch the highlight" mode to this file.
 *
 * NEVER LET THIS DECIDE ANYTHING. Output is evidence for a human or for a
 * downstream deterministic step. It reports what reporters said and links the
 * post; it does not rank players, score trades, or recommend lineups. That
 * boundary is the same one lib/ai-external/grok-safety.ts enforces, and it
 * exists because a confident summary of an unreliable post reads exactly like
 * a confident summary of a reliable one.
 *
 * FRESHNESS IS THE PRODUCT. A cached inactive report at 12:55pm on Sunday is
 * worse than no report, so TTLs here are deliberately short and vary by kind
 * (see CACHE_TTL_SECONDS). Cost control belongs in the caller — do not raise
 * these to save money.
 */

import { xaiResponsesJson, parseTextFromXaiResponse, extractAnnotations } from '@/lib/xai-client'
import { cachedFetch, cacheKey } from '@/lib/api-cache'

export type XNewsKind =
  | 'injury'        // status, practice participation, inactives
  | 'transaction'   // signings, trades, waivers, call-ups
  | 'depth_chart'   // role and snap-share changes
  | 'general'       // catch-all player/team chatter

export type XNewsCitation = { label: string; url: string }

export type XNewsResult =
  | {
      ok: true
      kind: XNewsKind
      /** One-paragraph plain-language summary. May be empty when nothing was found. */
      summary: string
      /** Short factual bullets, each ideally traceable to a citation. */
      bullets: string[]
      /**
       * Posts the search consulted — NOT per-claim evidence.
       *
       * There is no way to attribute one of these to one bullet. xAI returns
       * `url_citation` annotations with `start_index` and `end_index` both 0
       * (verified on two live responses, 2026-08-27), so nothing maps a citation
       * to the span of prose it supports. Two searches minutes apart shared 8 of
       * 10 URLs while one reported news and the other reported none, which is
       * what that missing mapping looks like from the outside.
       *
       * Render as "sources consulted". Never hang one off a specific claim, and
       * never imply the order means relevance — the payload cannot support
       * either reading.
       *
       * DO NOT RENDER THESE WHEN `empty` IS TRUE. A search can return posts that
       * match the player but not the question — 11 citations alongside an empty
       * summary means "found posts, none were injury news", and showing those
       * links uncaptioned implies news that does not exist.
       */
      citations: XNewsCitation[]
      /**
       * Sources consulted. Derived from citations rather than trusted from
       * `usage.num_sources_used`, which was observed returning 0 on a live call
       * that produced 11 annotations and 8 server-side tool invocations.
       */
      sourcesUsed: number
      /** True when the search ran but produced no usable claim. Not an error. */
      empty: boolean
      searchedAt: string
    }
  | { ok: false; kind: XNewsKind; error: string }

// ── Handle allowlists ─────────────────────────────────────────────────────────
//
// Scoping to known reporters is what separates signal from the open firehose.
//
// ⚠ VERIFY THESE BEFORE RELYING ON THEM. Reporters change outlets and handles,
// and a dead handle silently narrows results rather than erroring. They are a
// starting point, not a maintained list. Override per sport without a deploy:
//
//   X_SEARCH_HANDLES_NFL="AdamSchefter,RapSheet,FieldYates"
//
// An empty allowlist is legitimate and means "search all of X" — broader and
// noisier, but never wrong. Prefer that to a stale list you have not checked.
const DEFAULT_HANDLES: Record<string, string[]> = {
  NFL: ['AdamSchefter', 'RapSheet', 'TomPelissero', 'MikeGarafolo', 'FieldYates'],
  NBA: ['ShamsCharania', 'ChrisBHaynes'],
  MLB: ['Ken_Rosenthal', 'JeffPassan'],
  NHL: ['PierreVLeBrun', 'FriedgeHNIC'],
}

/** Kind-specific cache TTLs. Injury news is worthless stale; transactions age slower. */
const CACHE_TTL_SECONDS: Record<XNewsKind, number> = {
  injury: 300,        // 5 min — inactives move fast on game day
  depth_chart: 900,   // 15 min
  transaction: 1800,  // 30 min
  general: 1800,
}

/** Default lookback per kind, in hours. */
const DEFAULT_LOOKBACK_HOURS: Record<XNewsKind, number> = {
  injury: 48,
  depth_chart: 168,
  transaction: 168,
  general: 72,
}

export function resolveHandles(sport: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const key = `X_SEARCH_HANDLES_${sport.toUpperCase()}`
  const override = env[key]?.trim()
  if (override !== undefined && override !== '') {
    return override.split(',').map((h) => h.trim().replace(/^@/, '')).filter(Boolean)
  }
  // An explicitly empty override ("") means "search all of X" — honour it.
  if (override === '') return []
  return DEFAULT_HANDLES[sport.toUpperCase()] ?? []
}

function isoHoursAgo(hours: number, now: Date = new Date()): string {
  return new Date(now.getTime() - hours * 3_600_000).toISOString().slice(0, 10)
}

export function buildQuery(input: {
  kind: XNewsKind
  subject: string
  teamName?: string | null
}): string {
  const subject = input.teamName ? `${input.subject} (${input.teamName})` : input.subject
  switch (input.kind) {
    case 'injury':
      return `Latest injury status, practice participation, and inactive/active designation for ${subject}.`
    case 'transaction':
      return `Any signing, trade, waiver claim, release, or roster move involving ${subject}.`
    case 'depth_chart':
      return `Any change to role, starting status, snap share, or depth chart position for ${subject}.`
    case 'general':
      return `Recent notable news about ${subject}.`
  }
}

const SYSTEM_PROMPT = [
  'You report what sources on X actually said about a sports player or team. You are a wire service, not an analyst.',
  '',
  'Rules:',
  '- Report only what a source stated. Never infer, project, or speculate.',
  '- Never give fantasy advice: no start/sit, add/drop, buy/sell, or trade recommendations.',
  '- Never invent a URL. Only cite pages the search tool actually returned.',
  '- Attribute every claim ("Schefter reports...", "the team announced...").',
  '- Prefer the most recent source when reports conflict, and say that they conflict.',
  '- If nothing relevant was found, return empty arrays. Saying nothing is correct and useful.',
  '',
  'Respond with a single JSON object and no surrounding text:',
  '{"summary": string, "bullets": string[]}',
  'summary: one short paragraph, or "" if nothing was found.',
  'bullets: short factual statements, each with attribution. Empty array if nothing was found.',
].join('\n')

function parseModelJson(raw: string | null): { summary: string; bullets: string[] } {
  if (!raw) return { summary: '', bullets: [] }
  // Models sometimes wrap JSON in a fenced block despite instructions.
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(cleaned) as { summary?: unknown; bullets?: unknown }
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
      bullets: Array.isArray(parsed.bullets)
        ? parsed.bullets.filter((b): b is string => typeof b === 'string' && b.trim() !== '')
        : [],
    }
  } catch {
    // Malformed JSON is not a hard failure: the prose is still evidence, and
    // dropping it would lose a live report over a formatting slip.
    return { summary: cleaned.slice(0, 1200), bullets: [] }
  }
}

/**
 * Exported for tests. The label rule below depends on a provider quirk that no
 * unit test would have predicted and only live traffic revealed, so it needs to
 * be pinned somewhere that runs in CI.
 */
export function toCitations(
  annotations: ReturnType<typeof extractAnnotations>,
): XNewsCitation[] {
  const seen = new Set<string>()
  const out: XNewsCitation[] = []
  for (const a of annotations) {
    const url = a?.url?.trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    // xAI sets `title` to a verbatim copy of `url` — on every annotation of both
    // live responses checked on 2026-08-27. A copy is truthy, so it silently beat
    // the fallback and every label rendered as a full
    // "https://x.com/i/status/2092371465660236156". Treat a title that only
    // repeats the URL as no title at all.
    //
    // The fallback is still an opaque status id, and deliberately so: these are
    // `/i/status/` URLs, which carry no handle, and the annotation carries no post
    // text. There is nothing to build a human label out of, so this shows the
    // shortest honest form rather than inventing one.
    const title = a.title?.trim()
    const label = title && title !== url ? title : url.replace(/^https?:\/\//, '').slice(0, 80)
    out.push({ label, url })
  }
  return out
}

/**
 * Search X for recent news about a player or team.
 *
 * Returns `ok: true, empty: true` when the search ran but found nothing — that
 * is a real answer ("no news"), and callers must not render it as a failure.
 */
export async function searchXForNews(input: {
  sport: string
  /** Player or team name. */
  subject: string
  teamName?: string | null
  kind?: XNewsKind
  /** Overrides the kind's default lookback. */
  lookbackHours?: number
  skipCache?: boolean
}): Promise<XNewsResult> {
  const kind = input.kind ?? 'general'
  const subject = input.subject?.trim()
  if (!subject) return { ok: false, kind, error: 'subject is required' }

  const run = () => runSearch({ ...input, kind, subject })
  if (input.skipCache) return run()

  const key = cacheKey('x-news', kind, input.sport, subject, input.teamName ?? '', input.lookbackHours ?? '')
  return cachedFetch(key, CACHE_TTL_SECONDS[kind], run)
}

async function runSearch(input: {
  sport: string
  subject: string
  teamName?: string | null
  kind: XNewsKind
  lookbackHours?: number
}): Promise<XNewsResult> {
  const { kind } = input
  const handles = resolveHandles(input.sport)
  const lookback = input.lookbackHours ?? DEFAULT_LOOKBACK_HOURS[kind]

  try {
    const result = await xaiResponsesJson({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildQuery({ kind, subject: input.subject, teamName: input.teamName }) },
      ],
      tools: [
        {
          type: 'x_search',
          from_date: isoHoursAgo(lookback),
          // Omit the key entirely when empty — an empty array could read as
          // "allow nothing" rather than "no restriction".
          ...(handles.length > 0 ? { allowed_x_handles: handles } : {}),
        },
      ],
      temperature: 0,
      maxTokens: 700,
      // The caller owns caching (TTL varies by kind), so don't double-cache.
      skipCache: true,
    })

    if (!result.ok) {
      return { ok: false, kind, error: `xAI search failed (HTTP ${result.status}): ${result.details.slice(0, 300)}` }
    }

    const { summary, bullets } = parseModelJson(parseTextFromXaiResponse(result.json))
    const citations = toCitations(extractAnnotations(result.json))
    const empty = bullets.length === 0 && summary === ''

    // Observed live 2026-08-27: usage.num_sources_used was 0 on a response that
    // carried 11 annotations and 8 server-side tool calls. Trust the annotations.
    const reported = result.json.usage?.num_sources_used ?? 0
    const sourcesUsed = Math.max(reported, citations.length)

    return {
      ok: true,
      kind,
      summary,
      bullets,
      // Citations only travel with claims. Dropping them on an empty result
      // makes the contradictory "links but no news" shape unrepresentable,
      // rather than relying on every caller to remember the rule.
      citations: empty ? [] : citations,
      sourcesUsed,
      empty,
      searchedAt: new Date().toISOString(),
    }
  } catch (e) {
    // The spend guard throws here when AI_FEATURES_ENABLED is unset. Surface it
    // as a normal failure so a disabled platform degrades instead of 500ing.
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, kind, error: msg }
  }
}
