import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { withApiUsage } from '@/lib/telemetry/usage'
import { buildFeedbackPromptBlock } from '@/lib/feedback-store'
import { getUserTradeProfile } from '@/lib/trade-feedback-profile'
import { executeSerperWebSearch, executeSerperNewsSearch } from '@/lib/serper'
import { getFantasyCalcValuesDbFirst as fetchCalcValues } from '@/lib/fantasycalc-db'
import { getOrCreateAiResult } from '@/lib/ai/ai-result-cache'
import { assertAiSpendAllowed, AiSpendDisabledError } from '@/lib/ai/aiSpendGuard'

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getGrokClient() {
  /*
   * PROVIDER BOUNDARY. This route reached three providers with no spend check at
   * all: two SDK clients and a direct fetch to api.x.ai below. It was ALSO
   * unauthenticated — 5 tool loops per minute per IP, MAX_TOOL_TURNS = 6, and
   * nothing metering the spend behind them. Production served one such request:
   * a 200 in 11,895 ms with no session.
   *
   * POST now requires a session before either client is constructed, and the limiter
   * keys on the user id. The guard stays in the factory rather than at the handler
   * entry so it still holds if a future path constructs a client elsewhere in the file.
   *
   * The guard belongs in the factory rather than at the handler entry so it
   * still holds if a future path constructs a client somewhere else in the file.
   */
  assertAiSpendAllowed('improve-trade.grok')

  const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY
  if (!apiKey) {
    throw new Error("XAI_API_KEY/GROK_API_KEY is missing")
  }

  return new OpenAI({
    apiKey,
    baseURL: "https://api.x.ai/v1",
  })
}

function getOpenAIClient() {
  assertAiSpendAllowed('improve-trade.openai')

  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing")
  }

  return new OpenAI({
    apiKey,
    baseURL:
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      "https://api.openai.com/v1",
  })
}

const MAX_TOOL_TURNS = 6

const GROK_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search current web for NFL news, injuries, signings, rookie updates, contract news. Returns organic results with position/date, answer boxes, knowledge graph data, top stories, and related questions.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, num: { type: 'number', description: 'Number of results (default 10)' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'news_search',
      description: 'Search Google News specifically for recent NFL/fantasy football news articles. Returns news with title, snippet, source, date. Best for breaking news, injuries, transactions.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, num: { type: 'number', description: 'Number of news results (default 10)' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'x_keyword_search',
      description: 'Search X (Twitter) for real-time player buzz, rookie hype, sentiment, injuries',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
    },
  },
]

async function runGrokWithTools(systemPrompt: string): Promise<string> {
    const grokClient = getGrokClient()
  let messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Analyze this trade using all provided context. Use your tools to search for the latest real-time news, injuries, signings, and X sentiment for the players involved. Then generate your counter-offer suggestions.' },
  ]

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const response = await grokClient.chat.completions.create({
      model: 'grok-4-0709',
      messages,
      tools: GROK_TOOLS,
      tool_choice: 'auto',
      temperature: 0.65,
      max_tokens: 1800,
    })

    const msg = response.choices[0].message
    messages.push(msg)

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return msg.content || '{}'
    }

    for (const toolCall of msg.tool_calls) {
      const fn = (toolCall as any).function
      if (!fn) continue
      const fnName = fn.name
      let args: any = {}
      try { args = JSON.parse(fn.arguments || '{}') } catch {}

      let result: any

      if (fnName === 'web_search') {
        result = await executeSerperWebSearch(args.query || 'NFL fantasy football news injuries 2026', args.num || 10)
      } else if (fnName === 'news_search') {
        result = await executeSerperNewsSearch(args.query || 'NFL fantasy football news 2026', args.num || 10)
      } else if (fnName === 'x_keyword_search') {
        // Deliberately outside the try below: that block turns any throw into a
        // 'search unavailable' note, which would silently downgrade a spend
        // refusal into a partial answer the caller cannot distinguish from a
        // provider timeout.
        assertAiSpendAllowed('improve-trade.x_keyword_search')
        try {
          const xRes = await fetch('https://api.x.ai/v1/tools/x_keyword_search', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.XAI_API_KEY || process.env.GROK_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: args.query, limit: args.limit || 12 }),
            signal: AbortSignal.timeout(5000),
          })
          result = xRes.ok ? await xRes.json().catch(() => ({ note: 'X search parse failed' })) : { note: `X search returned ${xRes.status}` }
        } catch (err: any) {
          result = { note: 'X search timeout or unavailable', query: args.query }
        }
      } else {
        result = { error: `Unknown tool: ${fnName}` }
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      })
    }
  }

  const finalMsg = messages[messages.length - 1]
  if (finalMsg.role === 'assistant' && typeof finalMsg.content === 'string') {
    return finalMsg.content
  }
  return '{}'
}

function buildSystemPrompt(ctx: {
  tradeText: string
  leagueSize: number
  scoring: string
  isDynasty: boolean
  currentVerdict: string
  currentFairness: number
  leagueSettings?: any
  userRoster?: string
  userFAABRemaining?: number
  userContentionWindow?: string
  userRecord?: string
  fantasyCalcSnippet?: string
  feedbackBlock?: string
  userPreferenceProfile?: string
}) {
  const {
    tradeText, leagueSize, scoring, isDynasty, currentVerdict, currentFairness,
    leagueSettings, userRoster, userFAABRemaining, userContentionWindow, userRecord,
    fantasyCalcSnippet, feedbackBlock, userPreferenceProfile,
  } = ctx

  const format = isDynasty ? 'Dynasty' : 'Redraft'
  const scoringLabel = scoring.toUpperCase()
  const settingsJson = leagueSettings ? JSON.stringify(leagueSettings) : 'Not provided'
  const contention = userContentionWindow || 'unknown'
  const record = userRecord || 'Unknown'
  const faab = userFAABRemaining != null ? `${userFAABRemaining}%` : 'Not provided'
  const roster = userRoster || 'No roster provided'
  const fairnessStr = `${currentFairness >= 0 ? '+' : ''}${currentFairness}%`
  const fcBlock = fantasyCalcSnippet ? `\nFantasyCalc objective values (league-size adjusted):\n${fantasyCalcSnippet}\n` : ''

  return `You are the world's #1 fantasy football trade analyst (2026).
You have real-time web + X search tools. Use them aggressively to research players in the trade.

LEAGUE SIZE SPECIFICITY IS CRITICAL:
- 4-8 team leagues: Picks have almost no value, stars dominate
- 10-12 team leagues: Balanced pick/player values
- 14-16 team leagues: Picks gain huge value, depth matters enormously
- 20-32 team leagues: Even late picks are extremely valuable, roster depth is king

=== LEAGUE & USER CONTEXT ===
League size: ${leagueSize}-team
Format: ${format}
Scoring: ${scoringLabel}
Full league settings: ${settingsJson}
User's contention window: ${contention}
User's current record: ${record}
User's FAAB remaining: ${faab}
${fcBlock}
User's roster (critical for replacement level, positional needs, surplus, age curve, contention fit):
"""
${roster}
"""
${userPreferenceProfile ? `
=== USER'S LEARNED TRADE PREFERENCE PROFILE ===
This profile was built from the user's past feedback on trade suggestions. Tailor your suggestions to match these preferences:
${userPreferenceProfile}
` : ''}
Trade being evaluated (user is the "I give" / "you" side):
"""
${tradeText}
"""

Current AI verdict: ${currentVerdict}
Current value delta: ${fairnessStr} (positive = better for user)

=== TASK ===
Generate 3-5 highly realistic, personalized counter-offer suggestions that meaningfully improve the deal for the user.

Take EVERYTHING into account:
- Exact positional scarcity based on league starters, bench size, flex rules, TE-premium, Superflex
- User's roster needs / surplus / age / injury risk / contention window
- Dynasty-specific value: future picks (early/mid/late adjusted for league size/format), rookie draft outlook
- Volatility: boom/bust players, injury history, contract situations
- FAAB implications if relevant
- FantasyCalc objective values when available - use them to ground your suggestions
- Real-time news: injuries, signings, trades, rookie buzz, X sentiment
- Acceptance likelihood - suggest counters a rational opponent would consider

For each suggestion return:
- Short title (8-15 words)
- Exact natural-language counter-offer text (copy-paste ready, "I give: X\\nI get: Y" format)
- Estimated new fairness impact (e.g. "+18% for you", "now strong win", "higher acceptance chance")
- 3-5 concise, specific bullets explaining WHY it's better (reference roster, league settings, contention, etc.)
- Optional sensitivity note (one sentence) - e.g. "Only if you're truly win-now", null if not needed

Rules:
- Be brutally honest - never suggest trades that hurt the user
- Prioritize high-acceptance counters: depth swaps, future picks, small upgrades
- In dynasty: weight youth, picks, long-term upside heavily
- If no roster provided, fall back to general positional scarcity but note limitation
- Keep language clear, confident, conversational - like advising a league mate
- Order from most to least likely to be accepted

${feedbackBlock || ''}
Return ONLY valid JSON:
{
  "suggestions": [
    {
      "title": "string (8-15 words)",
      "counter": "exact copy-paste offer (I give: X\\nI get: Y)",
      "impact": "string like +15% for you",
      "reasons": ["max 12 words each", "3-5 bullets"],
      "sensitivityNote": "string or null"
    }
  ]
}`
}

async function fetchFantasyCalcValuesForTrade(isDynasty: boolean, leagueSize: number, scoring: string): Promise<string | undefined> {
  try {
    const pprValue = scoring === 'ppr' ? 1 : scoring === 'half' ? 0.5 : 0
    const data = await fetchCalcValues({
      isDynasty,
      numTeams: leagueSize,
      ppr: pprValue,
      numQbs: 1,
    })
    if (!Array.isArray(data) || data.length === 0) return undefined
    const top30 = data.slice(0, 30).map((p) => ({
      name: p.player?.name || 'Unknown',
      pos: p.player?.position || 'Unknown',
      value: p.value,
      trend: p.trend30Day,
    }))
    return JSON.stringify(top30)
  } catch {
    return undefined
  }
}

function parseSuggestions(parsed: any) {
  const rawList = Array.isArray(parsed) ? parsed : parsed?.suggestions
  if (!rawList || !Array.isArray(rawList) || rawList.length === 0) return null
  return rawList.slice(0, 5).map((s: any) => ({
    title: String(s.title || 'Alternative trade'),
    counter: String(s.counter || s.counterOfferText || ''),
    impact: String(s.impact || s.estimatedImpact || ''),
    reasons: Array.isArray(s.reasons || s.whyBetter) ? (s.reasons || s.whyBetter).map(String).slice(0, 5) : [],
    sensitivityNote: s.sensitivityNote ? String(s.sensitivityNote) : null,
  }))
}

export const POST = withApiUsage({ endpoint: '/api/instant/improve-trade', tool: 'ImproveTradeAI' })(async (req: Request) => {
  try {
    /*
     * SIGN-IN REQUIRED. This runs BEFORE the provider clients are constructed, so an
     * anonymous caller never reaches a paid boundary at all.
     *
     * Why this is safe to require, rather than a funnel we are closing: the UI chain
     * that called this route is DEAD. The only fetch of /api/instant/improve-trade is
     * app/components/ImproveTradeModal.tsx, the only component that mounts that modal is
     * app/components/InstantTradeAnalyzer.tsx, and NOTHING mounts InstantTradeAnalyzer —
     * verified across static, relative and dynamic imports, with a positive control
     * (StartSitLauncher) proving the same search does find real mounts. So the route was
     * reachable only by direct HTTP.
     *
     * That matters, because production had already served one: ApiUsageEvent recorded a
     * 200 at 11,895 ms — a real multi-turn tool loop — with no session behind it, plus
     * four 429s from the IP limiter. MAX_TOOL_TURNS is 6 and this handler reaches three
     * providers (Grok, OpenAI, Serper), so one unauthenticated request was worth several
     * model calls.
     *
     * The IP limiter stays as a second layer, but it was never sufficient on its own: it
     * is an in-process Map (lib/rate-limit.ts), so on Vercel every new function instance
     * hands the same IP a fresh budget.
     */
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    const sessionUserId = session?.user?.id
    if (!sessionUserId) {
      return NextResponse.json(
        { error: 'Sign in to use the trade improver.' },
        { status: 401 }
      )
    }

    const grokClient = getGrokClient()
    const openaiClient = getOpenAIClient()

    const ip = getClientIp(req as any) || 'unknown'
    const rl = rateLimit(`improve-trade:${sessionUserId}:${ip}`, 5, 60_000)
    if (!rl.success) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a minute and try again.' },
        { status: 429 }
      )
    }

    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const { tradeText, currentVerdict, currentFairness, contextId } = body
    const shouldStream = body.stream !== false
    const useRealTimeNews = body.useRealTimeNews !== false
    const leagueSize = typeof body.leagueSize === 'number' && [8, 10, 12, 14, 16, 32].includes(body.leagueSize) ? body.leagueSize : 12
    const scoring = ['ppr', 'half', 'standard', 'superflex'].includes(body.scoring) ? body.scoring : 'ppr'
    const isDynasty = typeof body.isDynasty === 'boolean' ? body.isDynasty : true
    const leagueSettings = body.leagueSettings && typeof body.leagueSettings === 'object' ? body.leagueSettings : undefined
    const userRoster = typeof body.userRoster === 'string' && body.userRoster.trim() ? body.userRoster.trim().slice(0, 2000) : undefined
    const userFAABRemaining = typeof body.userFAABRemaining === 'number' ? Math.max(0, Math.min(100, body.userFAABRemaining)) : undefined
    const userContentionWindow = ['win-now', 'contender', 'rebuild', 'retooling'].includes(body.userContentionWindow) ? body.userContentionWindow : undefined
    const userRecord = typeof body.userRecord === 'string' && body.userRecord.trim() ? body.userRecord.trim().slice(0, 20) : undefined

    if (!tradeText || typeof tradeText !== 'string' || tradeText.trim().length < 5) {
      return NextResponse.json({ error: 'Trade text is required.' }, { status: 400 })
    }

    if (tradeText.length > 1000) {
      return NextResponse.json({ error: 'Trade text is too long.' }, { status: 400 })
    }

    if (req.signal?.aborted) {
      return new Response('Request aborted', { status: 499 })
    }

    const percentDiff = typeof currentFairness === 'number' ? currentFairness : 0

    // Reuses the session resolved at the top of the handler — it is now guaranteed to
    // exist, so this no longer needs its own getServerSession round trip.
    let userPreferenceProfile: string | null = null
    try {
      userPreferenceProfile = await getUserTradeProfile(sessionUserId)
    } catch {}

    const fantasyCalcSnippet = await fetchFantasyCalcValuesForTrade(isDynasty, leagueSize, scoring)

    const systemPrompt = buildSystemPrompt({
      tradeText, leagueSize, scoring, isDynasty,
      currentVerdict: currentVerdict || 'unknown', currentFairness: percentDiff,
      leagueSettings, userRoster, userFAABRemaining, userContentionWindow, userRecord,
      fantasyCalcSnippet,
      feedbackBlock: buildFeedbackPromptBlock(),
      userPreferenceProfile: userPreferenceProfile || undefined,
    })

    // Deterministic cache path only (no streaming, no real-time tool calls).
    if (!shouldStream && !useRealTimeNews) {
      const deterministicPayload = {
        feature: 'instant-improve-trade-suggestions',
        contextId: typeof contextId === 'string' ? contextId : null,
        tradeText,
        currentVerdict: currentVerdict || 'unknown',
        currentFairness: percentDiff,
        leagueSize,
        scoring,
        isDynasty,
        leagueSettings: leagueSettings || null,
        userRoster: userRoster || null,
        userFAABRemaining: userFAABRemaining ?? null,
        userContentionWindow: userContentionWindow || null,
        userRecord: userRecord || null,
        fantasyCalcSnippet: fantasyCalcSnippet || null,
        userPreferenceProfile: userPreferenceProfile || null,
        promptVersion: 'v1',
      }

      const aiResult = await getOrCreateAiResult({
        feature: 'instant-improve-trade-suggestions',
        scopeType: 'context',
        scopeId: (typeof contextId === 'string' && contextId.trim()) || `ip:${ip}`,
        provider: 'openai+grok',
        model: 'gpt-4o|grok-4-0709',
        payload: deterministicPayload,
        ttlSeconds: 60 * 60,
        onCacheMiss: async () => {
          const [grokResult, openaiResult] = await Promise.allSettled([
            grokClient.chat.completions.create({
              model: 'grok-4-0709',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Generate the counter-offer suggestions now. Return only JSON.' },
              ],
              temperature: 0.6,
              max_tokens: 1800,
              response_format: { type: 'json_object' },
            }).then(r => r.choices[0]?.message?.content || '{}'),
            openaiClient.chat.completions.create({
              model: 'gpt-4o',
              messages: [
                {
                  role: 'system',
                  content: systemPrompt + '\n\nYou are the strategic verification brain. Focus on long-term dynasty implications, roster fit, risk assessment, and acceptance probability. Return only JSON.',
                },
                {
                  role: 'user',
                  content: 'Generate the counter-offer suggestions now. Focus on deep strategic reasoning and risk-adjusted value. Return only JSON.',
                },
              ],
              temperature: 0.5,
              max_tokens: 1400,
              response_format: { type: 'json_object' },
            }),
          ])

          const grokContent = grokResult.status === 'fulfilled'
            ? grokResult.value
            : '{"error": "Grok unavailable"}'
          const openaiContent = openaiResult.status === 'fulfilled'
            ? (openaiResult.value.choices[0]?.message?.content || '{}')
            : '{"error": "OpenAI unavailable"}'

          if (grokResult.status === 'rejected' && openaiResult.status === 'rejected') {
            throw new Error('Both AI models are unavailable. Please try again.')
          }

          const hasSingleSource = grokResult.status === 'rejected' || openaiResult.status === 'rejected'
          if (hasSingleSource) {
            let parsedSingle: any
            try { parsedSingle = JSON.parse(grokResult.status === 'rejected' ? openaiContent : grokContent) } catch {}
            const directSuggestions = parsedSingle ? parseSuggestions(parsedSingle) : null
            if (directSuggestions && directSuggestions.length > 0) {
              return {
                resultText: JSON.stringify({ suggestions: directSuggestions }),
                resultJson: { suggestions: directSuggestions },
                tokenPrompt: null,
                tokenOutput: null,
              }
            }
          }

          const synthesis = await openaiClient.chat.completions.create({
            model: 'gpt-4o',
            messages: [
              {
                role: 'system',
                content: `You are the final synthesizer combining two elite AI trade analysts. Merge Grok's real-time research with OpenAI's strategically deep suggestions into one cohesive, best-possible set of 3-5 counter-offers. Pick the strongest from both, deduplicate, and order by acceptance likelihood. Return ONLY valid JSON with "suggestions" array.`,
              },
              {
                role: 'user',
                content: `Grok (real-time research with web/X tools) output:\n${grokContent}\n\nOpenAI (strategic depth) output:\n${openaiContent}\n\nProduce the final merged 3-5 suggestions in exact JSON format.`,
              },
            ],
            temperature: 0.4,
            max_tokens: 1600,
            response_format: { type: 'json_object' },
          })

          const rawContent = synthesis.choices[0]?.message?.content || '{}'
          let parsed: any
          try {
            parsed = JSON.parse(rawContent)
          } catch {
            throw new Error('Could not parse AI suggestions. Please try again.')
          }

          const suggestions = parseSuggestions(parsed)
          if (!suggestions || suggestions.length === 0) {
            throw new Error('AI returned no suggestions. Please try again.')
          }

          return {
            resultText: JSON.stringify({ suggestions }),
            resultJson: { suggestions },
            tokenPrompt: synthesis.usage?.prompt_tokens ?? null,
            tokenOutput: synthesis.usage?.completion_tokens ?? null,
          }
        },
      })

      if (aiResult.cacheHit) {
        console.log(`[instant/improve-trade] AI cache hit { contextId: '${(typeof contextId === 'string' && contextId.trim()) || 'none'}' }`)
      } else {
        console.log(`[instant/improve-trade] AI cache miss { contextId: '${(typeof contextId === 'string' && contextId.trim()) || 'none'}', modelCallMs: ${aiResult.modelDurationMs ?? -1} }`)
        console.log(`[instant/improve-trade] saved AiResult { id: '${aiResult.row.id}', resultKey: '${aiResult.row.resultKey}' }`)
      }

      const cachedSuggestions = ((aiResult.row.resultJson as any)?.suggestions as any[]) || []
      if (!Array.isArray(cachedSuggestions) || cachedSuggestions.length === 0) {
        return NextResponse.json(
          { error: 'AI returned no suggestions. Please try again.' },
          { status: 500 }
        )
      }
      return NextResponse.json({ suggestions: cachedSuggestions })
    }

    if (req.signal?.aborted) {
      return new Response('Request aborted', { status: 499 })
    }

    const grokCall = useRealTimeNews
      ? runGrokWithTools(systemPrompt)
      : grokClient.chat.completions.create({
          model: 'grok-4-0709',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Generate the counter-offer suggestions now. Return only JSON.' },
          ],
          temperature: 0.6,
          max_tokens: 1800,
          response_format: { type: 'json_object' },
        }).then(r => r.choices[0]?.message?.content || '{}')

    const [grokResult, openaiResult] = await Promise.allSettled([
      grokCall,
      openaiClient.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: systemPrompt + '\n\nYou are the strategic verification brain. Focus on long-term dynasty implications, roster fit, risk assessment, and acceptance probability. Return only JSON.',
          },
          {
            role: 'user',
            content: 'Generate the counter-offer suggestions now. Focus on deep strategic reasoning and risk-adjusted value. Return only JSON.',
          },
        ],
        temperature: 0.5,
        max_tokens: 1400,
        response_format: { type: 'json_object' },
      }),
    ])

    const grokContent = grokResult.status === 'fulfilled'
      ? grokResult.value
      : '{"error": "Grok unavailable"}'
    const openaiContent = openaiResult.status === 'fulfilled'
      ? (openaiResult.value.choices[0]?.message?.content || '{}')
      : '{"error": "OpenAI unavailable"}'

    if (grokResult.status === 'rejected') {
      console.error('[improve-trade] Grok agentic loop failed, continuing with OpenAI only:', (grokResult.reason as any)?.message)
    }
    if (openaiResult.status === 'rejected') {
      console.error('[improve-trade] OpenAI failed, continuing with Grok only:', (openaiResult.reason as any)?.message)
    }

    if (grokResult.status === 'rejected' && openaiResult.status === 'rejected') {
      return NextResponse.json({ error: 'Both AI models are unavailable. Please try again.' }, { status: 503 })
    }

    const hasSingleSource = grokResult.status === 'rejected' || openaiResult.status === 'rejected'
    const singleSourceContent = grokResult.status === 'rejected' ? openaiContent : grokContent

    if (hasSingleSource) {
      let parsed: any
      try { parsed = JSON.parse(singleSourceContent) } catch {}
      const directSuggestions = parsed ? parseSuggestions(parsed) : null
      if (directSuggestions && directSuggestions.length > 0) {
        if (shouldStream) {
          const encoder = new TextEncoder()
          const readable = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ suggestions: directSuggestions, done: true })}\n\n`))
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
            },
          })
          return new Response(readable, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
          })
        }
        return NextResponse.json({ suggestions: directSuggestions })
      }
    }

    if (req.signal?.aborted) {
      return new Response('Request aborted', { status: 499 })
    }

    if (shouldStream) {
      const synthesisStream = await openaiClient.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are the final synthesizer combining two elite AI trade analysts. Merge Grok's real-time research (which may include live web search results) with OpenAI's strategically deep suggestions into one cohesive, best-possible set of 3-5 counter-offers.

Rules:
- Pick the strongest suggestions from both sources - deduplicate similar ideas
- If both AIs agree on a counter, it's high-confidence - rank it first
- If they disagree, include the more realistic/higher-acceptance option
- Incorporate any real-time news/injury data that Grok found via tools
- Preserve the exact JSON format with title, counter, impact, reasons, sensitivityNote
- Order from most to least likely to be accepted

Return ONLY valid JSON:
{
  "suggestions": [
    {
      "title": "string",
      "counter": "I give: X\\nI get: Y",
      "impact": "string",
      "reasons": ["string"],
      "sensitivityNote": "string or null"
    }
  ]
}`,
          },
          {
            role: 'user',
            content: `Grok (real-time research with web/X tools) output:\n${grokContent}\n\nOpenAI (strategic depth) output:\n${openaiContent}\n\nProduce the final merged 3-5 suggestions.`,
          },
        ],
        temperature: 0.4,
        max_tokens: 1600,
        response_format: { type: 'json_object' },
        stream: true,
      })

      const encoder = new TextEncoder()
      const readable = new ReadableStream({
        async start(controller) {
          try {
            let accumulated = ''
            for await (const chunk of synthesisStream) {
              const delta = chunk.choices[0]?.delta?.content || ''
              if (delta) {
                accumulated += delta
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta, accumulated })}\n\n`))
              }
            }

            let parsed: any
            try {
              parsed = JSON.parse(accumulated)
            } catch {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Could not parse AI suggestions.' })}\n\n`))
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
              return
            }

            const suggestions = parseSuggestions(parsed)
            if (!suggestions || suggestions.length === 0) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'AI returned no suggestions.' })}\n\n`))
            } else {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ suggestions, done: true })}\n\n`))
            }

            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          } catch (err: any) {
            console.error('[improve-trade] Synthesis stream error:', err?.message || err)
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Stream failed. Please try again.' })}\n\n`))
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          }
        },
      })

      return new Response(readable, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    const synthesis = await openaiClient.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are the final synthesizer combining two elite AI trade analysts. Merge Grok's real-time research with OpenAI's strategically deep suggestions into one cohesive, best-possible set of 3-5 counter-offers. Pick the strongest from both, deduplicate, and order by acceptance likelihood. Return ONLY valid JSON with "suggestions" array.`,
        },
        {
          role: 'user',
          content: `Grok (real-time research with web/X tools) output:\n${grokContent}\n\nOpenAI (strategic depth) output:\n${openaiContent}\n\nProduce the final merged 3-5 suggestions in exact JSON format.`,
        },
      ],
      temperature: 0.4,
      max_tokens: 1600,
      response_format: { type: 'json_object' },
    })

    const rawContent = synthesis.choices[0]?.message?.content || '{}'

    let parsed: any
    try {
      parsed = JSON.parse(rawContent)
    } catch {
      console.error('[improve-trade] Invalid JSON from synthesis:', rawContent.slice(0, 200))
      return NextResponse.json(
        { error: 'Could not parse AI suggestions. Please try again.' },
        { status: 500 }
      )
    }

    const suggestions = parseSuggestions(parsed)
    if (!suggestions || suggestions.length === 0) {
      console.error('[improve-trade] No suggestions in synthesis response')
      return NextResponse.json(
        { error: 'AI returned no suggestions. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ suggestions })
  } catch (err: any) {
    // A disabled spend switch is a payment state, not a fault. Reporting it as
    // 'Something went wrong' with a 500 would read as an outage and send the
    // next person debugging the provider instead of checking the flag.
    if (err instanceof AiSpendDisabledError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.httpStatus })
    }
    console.error('[improve-trade] Unexpected error:', err?.message || err)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
})


